/*
 * Renders the Chrome Web Store screenshots into dist/store/, and the running
 * shot the README uses into docs/.
 *
 *   node tools/make-store-shots.mjs
 *
 * The store wants 1280x800 (or 640x400) PNGs, at least one, up to five. These
 * are shot from the extension actually running against Chrome's fake camera,
 * so the listing shows what the extension does rather than a mock-up.
 *
 * Shot 2 is the one to lead with: a scene replaces the camera picture outright,
 * so nothing of the fake camera is in the frame and it looks exactly as it
 * would on a real machine. Shot 1 still has Chrome's green test pattern behind
 * the head, and wants retaking on a machine with a webcam.
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

/* 2 — the same, with a scene behind the head */
await preview.evaluate(() => {
  const scene = document.querySelector('.scene:not([data-background="none"])');
  if (scene) scene.click();
});
await preview.waitForTimeout(2500);
await preview.screenshot({ path: join(out, '2-scene.png') });
// The README shows the same view, so write it while the page is set up.
mkdirSync(join(root, 'docs'), { recursive: true });
await preview.screenshot({ path: join(root, 'docs', 'preview.png') });

/* 3 — the popup, where people pick an avatar and a scene */
// Back to defaults first: the preview above pinned the head and chose a scene,
// and a listing should not show the tracking controls greyed out.
await preview.evaluate(() => chrome.storage.sync.set({ settings: {} }));

const popup = await context.newPage();
await popup.setViewportSize({ width: 420, height: 900 });
await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
await popup.waitForTimeout(2500);
// The popup is taller than the viewport now that it has a scene picker, so
// this has to be a full-page capture or the bottom of it is simply cut off.
const body = await popup.locator('body').boundingBox();
const shot = await popup.screenshot({
  fullPage: true,
  clip: { x: 0, y: 0, width: Math.ceil(body.width), height: Math.ceil(body.height) }
});
console.log(`  popup is ${Math.ceil(body.width)}x${Math.ceil(body.height)}`);

/*
 * A popup is a tall narrow window: 342x1079 against a 1280x800 frame, so
 * centring it leaves most of the canvas empty. Set it to one side and give the
 * other side a line about what the controls are for.
 */
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

  const scale = (H - 56) / image.height;
  const w = image.width * scale, h = image.height * scale;
  const x = W - w - 96, y = (H - h) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();

  const left = 96;
  const font = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillStyle = '#1d1b19';
  ctx.font = `600 46px ${font}`;
  ctx.fillText('Pick a head.', left, 320);
  ctx.fillStyle = '#e0703a';
  ctx.fillText('Pick a scene.', left, 380);
  ctx.fillStyle = '#736c64';
  ctx.font = `20px ${font}`;
  for (const [i, line] of [
    'Six rigged characters and seven painted',
    'backdrops, with sliders for the fit.',
    'Everything runs on your own machine.'
  ].entries()) {
    ctx.fillText(line, left, 436 + i * 30);
  }
  return canvas.toDataURL('image/png');
}, { dataUrl: 'data:image/png;base64,' + shot.toString('base64'), W, H });
writeFileSync(join(out, '3-controls.png'), Buffer.from(composed.split(',')[1], 'base64'));

await context.close();
console.log(out);
for (const name of ['1-live-preview.png', '2-scene.png', '3-controls.png']) console.log('  ' + name);
console.log(join(root, 'docs', 'preview.png'));
