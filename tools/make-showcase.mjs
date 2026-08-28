/*
 * Renders docs/animals.png — the line-up used in the README.
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

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals.js'), 'utf8') });

const dataUrl = await page.evaluate(() => {
  const NS = globalThis.__CritterCam;
  const list = NS.animals.list();
  const cols = 7;
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
    NS.animals.drawThumb(ctx, spec.id, cell, moods[index % moods.length]);
    ctx.fillStyle = '#736c64';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.name, cell / 2, cell + 14);
    ctx.restore();
  });
  return canvas.toDataURL('image/png');
});

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs/animals.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('docs/animals.png');
await browser.close();
