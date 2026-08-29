/*
 * Shrinks the textures inside a .glb. Generators hand back 2K or 4K maps for a
 * whole body; a head that renders a few hundred pixels wide in a video call
 * does not need them, and the file is downloaded on every page that asks for
 * the camera.
 *
 *   node tools/shrink-textures.mjs in.glb out.glb [--max 1024] [--quality 0.85]
 *
 * Geometry, materials and UVs are untouched — only the image bytes change, so
 * this is safe to run after cropping. Decoding and re-encoding happen in
 * headless Chromium, which the repo already needs for its tests; point
 * PLAYWRIGHT_CHROMIUM at a Chromium on disk if Playwright has none of its own.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const [input, output] = args;
if (!input || !output) {
  console.error('usage: node tools/shrink-textures.mjs in.glb out.glb [--max 1024] [--quality 0.85]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const maxSize = opt('max', 1024);
const quality = opt('quality', 0.85);

/* ---------------------------------------------------------- read the glb */

const bytes = readFileSync(input);
if (bytes.readUInt32LE(0) !== 0x46546c67) { console.error('not a .glb'); process.exit(1); }
let json = null;
let bin = Buffer.alloc(0);
let off = 12;
while (off + 8 <= bytes.length) {
  const len = bytes.readUInt32LE(off);
  const type = bytes.readUInt32LE(off + 4);
  const data = bytes.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
if (!json) { console.error('no JSON chunk'); process.exit(1); }
if (!json.images || !json.images.length) {
  writeFileSync(output, bytes);
  console.log(`${output}\n  no embedded images — copied unchanged`);
  process.exit(0);
}

/* ------------------------------------------------------ resize in a page */

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage();

const replacements = [];
for (const [index, image] of json.images.entries()) {
  if (image.bufferView === undefined) { replacements.push(null); continue; }
  const view = json.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  const source = bin.subarray(start, start + view.byteLength);
  const mime = image.mimeType || 'image/png';

  const result = await page.evaluate(async ({ dataUrl, mime, maxSize, quality }) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return { skipped: true, width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Re-encode in the format it arrived in, so alpha survives a PNG.
    const out = canvas.toDataURL(mime === 'image/png' ? 'image/png' : 'image/jpeg', quality);
    return { data: out.slice(out.indexOf(',') + 1), from: bitmap.width, width: canvas.width, height: canvas.height };
  }, {
    dataUrl: `data:${mime};base64,${source.toString('base64')}`,
    mime, maxSize, quality
  });

  if (result.skipped) {
    replacements.push(null);
    console.log(`  ${image.name || 'image ' + index}  ${result.width}x${result.height} — already small enough`);
  } else {
    const data = Buffer.from(result.data, 'base64');
    replacements.push(data);
    console.log(`  ${image.name || 'image ' + index}  ${result.from}px -> ${result.width}px, ` +
      `${(view.byteLength / 1024).toFixed(0)}KB -> ${(data.length / 1024).toFixed(0)}KB`);
  }
}
await browser.close();

/* --------------------------------------------------- rebuild the binary */

// Every view is re-emitted in order, so replacing an image resizes the buffer
// without disturbing the accessors, which address views by index.
const imageViewOf = new Map();
json.images.forEach((image, i) => {
  if (image.bufferView !== undefined && replacements[i]) imageViewOf.set(image.bufferView, replacements[i]);
});

const parts = [];
let cursor = 0;
json.bufferViews.forEach((view, i) => {
  const replacement = imageViewOf.get(i);
  const data = replacement || Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
  const pad = (4 - (data.length % 4)) % 4;
  view.byteOffset = cursor;
  view.byteLength = data.length;
  parts.push(data);
  if (pad) parts.push(Buffer.alloc(pad));
  cursor += data.length + pad;
});
const binOut = Buffer.concat(parts);
json.buffers[0].byteLength = binOut.length;

const jsonText = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonText.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPad, 0x20)]);
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binOut.length, 8);
const chunk = (data, type) => {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
};
const result = Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binOut, 0x004e4942)]);
writeFileSync(output, result);

console.log(`${output}`);
console.log(`  ${(bytes.length / 1024).toFixed(0)}KB -> ${(result.length / 1024).toFixed(0)}KB`);
