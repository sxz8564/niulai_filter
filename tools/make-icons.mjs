/*
 * Regenerates icons/*.png from the Niulai renderer in src/core/animals.js.
 * The icons are drawn by the same code that draws the filter, so they never
 * drift from the art.
 *
 *   node tools/make-icons.mjs
 *
 * Requires Playwright's Chromium (dev-only dependency; not shipped).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.addScriptTag({ content: readFileSync(join(root, 'vendor/three/three.iife.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/niulai-shape.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/niulai-model.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals3d.js'), 'utf8') });

const icons = await page.evaluate((sizes) => {
  const NS = globalThis.__CritterCam;
  const out = {};
  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Warm rounded-square plate behind the head.
    const radius = size * 0.23;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#ffd9a8');
    bg.addColorStop(1, '#f0a35c');
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.clip();
    const spec = NS.animals.get('niulai');
    const renderer = NS.avatar3d.sharedRenderer();
    if (renderer) {
      // Fill the plate rather than using the picker's roomier framing.
      const layer = renderer.render(spec, { x: size / 2, y: size * 0.54, size: size * 0.74, roll: 0 }, {}, size, size);
      ctx.drawImage(layer, 0, 0, size, size);
    } else {
      ctx.translate(size / 2, size * 0.56);
      const scale = size * (size <= 32 ? 0.66 : 0.60);
      ctx.scale(scale, scale);
      NS.animals.draw(ctx, spec, { jawOpen: 0.1 });
    }
    ctx.restore();

    out[size] = canvas.toDataURL('image/png');
  }
  return out;
}, SIZES);

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of SIZES) {
  const base64 = icons[size].split(',')[1];
  writeFileSync(join(root, `icons/icon${size}.png`), Buffer.from(base64, 'base64'));
  console.log(`icons/icon${size}.png`);
}
await browser.close();
