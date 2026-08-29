/*
 * Renders the Chrome Web Store screenshots into dist/store/.
 *
 *   node tools/make-store-shots.mjs
 *
 * The store wants 1280x800 (or 640x400) PNGs, at least one, up to five. These
 * are shot from the extension actually running against Chrome's fake camera,
 * so the listing shows what the extension does rather than a mock-up.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'store');
mkdirSync(out, { recursive: true });

const W = 1280, H = 800;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'critter-shots-')), {
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  viewport: { width: W, height: H },
  args: [
    `--disable-extensions-except=${root}`, `--load-extension=${root}`,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--enable-unsafe-swiftshader'
  ]
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
const id = new URL(worker.url()).host;

/* 1 — the preview page, camera running, avatar over the feed */
const preview = await context.newPage();
await preview.setViewportSize({ width: W, height: H });
await preview.goto(`chrome-extension://${id}/src/preview/preview.html`);
await preview.getByRole('button', { name: 'Start camera' }).click();
await preview.waitForTimeout(4000);
await preview.evaluate(() => document.getElementById('manual')?.click());
await preview.waitForTimeout(1500);
await preview.screenshot({ path: join(out, '1-live-preview.png') });

/* 2 — the popup, where people pick an avatar and adjust the fit */
// Back to defaults first: the preview above pinned the head, which dims the
// tracking controls, and a listing should not show them greyed out.
await preview.evaluate(() => chrome.storage.sync.set({ settings: {} }));

const popup = await context.newPage();
await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
await popup.waitForTimeout(2500);
const body = await popup.locator('body').boundingBox();
const shot = await popup.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(body.width), height: Math.ceil(body.height) } });

// A popup is a tall narrow window; centre it on the canvas the store expects
// rather than leaving it stranded in a corner of a 1280x800 frame.
const composed = await popup.evaluate(async ({ dataUrl, W, H }) => {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f6f5f3');
  bg.addColorStop(1, '#e7e2db');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const scale = Math.min(1, (H - 64) / image.height);
  const w = image.width * scale, h = image.height * scale;
  const x = (W - w) / 2, y = (H - h) / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(image, x, y, w, h);
  return canvas.toDataURL('image/png');
}, { dataUrl: 'data:image/png;base64,' + shot.toString('base64'), W, H });
writeFileSync(join(out, '2-controls.png'), Buffer.from(composed.split(',')[1], 'base64'));

await context.close();
console.log(out);
for (const name of ['1-live-preview.png', '2-controls.png']) console.log('  ' + name);
