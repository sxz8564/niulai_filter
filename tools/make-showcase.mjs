/*
 * Renders the two line-ups the README uses: docs/animals.png, the characters,
 * and docs/scenes.png, the backdrops.
 *
 *   node tools/make-showcase.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Software GL so the 3D heads render in headless.
const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined
});
const page = await browser.newPage();
await page.addScriptTag({ content: readFileSync(join(root, 'vendor/three/three.iife.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/model-loader.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals3d.js'), 'utf8') });

// The avatars are imported models, so they have to be handed over before
// anything can be drawn.
const registry = JSON.parse(readFileSync(join(root, 'models/avatars/index.json'), 'utf8'));
const models = registry.map((e) => ({
  entry: e,
  base64: readFileSync(join(root, 'models/avatars', e.file)).toString('base64')
}));

const dataUrl = await page.evaluate(async (models) => {
  const NS = globalThis.__CritterCam;
  NS.avatarModels.registerAll(models.map((m) => m.entry));
  for (const model of models) {
    const bytes = Uint8Array.from(atob(model.base64), (c) => c.charCodeAt(0)).buffer;
    NS.avatarModels.provide(model.entry.id, bytes);
    await NS.avatarModels.parse(bytes, model.entry);
  }
  const list = NS.animals.list();
  const cols = 3;
  const rows = Math.ceil(list.length / cols);
  const cell = 150;
  const label = 24;
  const topPad = 16; // bunny ears reach above the head box
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = cols * cell * scale;
  canvas.height = rows * (cell + label + topPad) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#f6f5f3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // A different expression per animal, so the sheet shows the range.
  const moods = [
    {}, { jawOpen: 0.8, smile: 0.4 }, { blinkL: 1, blinkR: 1, smile: 0.7 },
    { yaw: 0.7, earSwing: 0.2 }, { jawOpen: 0.35, brow: 0.8 }, { yaw: -0.6, pitch: 0.35 }
  ];

  list.forEach((spec, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * cell;
    const y = row * (cell + label + topPad) + topPad;
    ctx.save();
    ctx.translate(x, y);
    if (!NS.avatar3d.paintThumb(ctx, spec, cell)) {
      NS.animals.drawThumb(ctx, spec.id, cell, moods[index % moods.length]);
    }
    ctx.fillStyle = '#736c64';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.name, cell / 2, cell + 14);
    ctx.restore();
  });
  return canvas.toDataURL('image/png');
}, models);

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs/animals.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('docs/animals.png');

/* The scenes, as a strip of labelled thumbnails. */
const scenes = JSON.parse(readFileSync(join(root, 'models/backgrounds/index.json'), 'utf8')).map((e) => ({
  entry: e,
  base64: readFileSync(join(root, 'models/backgrounds', e.file)).toString('base64')
}));

const sceneUrl = await page.evaluate(async (scenes) => {
  const images = await Promise.all(scenes.map(async (s) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = reject;
      image.src = 'data:image/webp;base64,' + s.base64;
    });
    return { name: s.entry.name, image };
  }));

  const cols = 4;
  const rows = Math.ceil(images.length / cols);
  const cellW = 208, cellH = 117, label = 22, gap = 10, pad = 14;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = (pad * 2 + cols * cellW + (cols - 1) * gap) * scale;
  canvas.height = (pad * 2 + rows * (cellH + label) + (rows - 1) * gap) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#f6f5f3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  images.forEach((item, index) => {
    const x = pad + (index % cols) * (cellW + gap);
    const y = pad + Math.floor(index / cols) * (cellH + label + gap);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 8);
    ctx.clip();
    ctx.drawImage(item.image, x, y, cellW, cellH);
    ctx.restore();
    ctx.fillStyle = '#736c64';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.name, x + cellW / 2, y + cellH + 16);
  });
  return canvas.toDataURL('image/png');
}, scenes);

writeFileSync(join(root, 'docs/scenes.png'), Buffer.from(sceneUrl.split(',')[1], 'base64'));
console.log('docs/scenes.png');
await browser.close();
