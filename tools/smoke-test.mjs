/*
 * Loads the unpacked extension into Chromium with a fake camera and checks the
 * two things that are hard to eyeball: that the MediaPipe worker starts from
 * the extension origin, and that getUserMedia on a real host page hands back a
 * filtered canvas stream.
 *
 *   node tools/smoke-test.mjs [outputDir]
 *
 * Requires Playwright's Chromium (dev-only; not shipped with the extension).
 */
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || join(root, '.smoke');
mkdirSync(outDir, { recursive: true });

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'critter-')), {
  headless: true,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox'
  ]
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = new URL(worker.url()).host;
console.log(`extension id: ${extensionId}\n`);

/* ------------------------------------------------ 1. preview page + model */

const preview = await context.newPage();
const previewErrors = [];
preview.on('pageerror', (e) => previewErrors.push(e.message));
preview.on('console', (m) => { if (m.type() === 'error') previewErrors.push(m.text()); });

await preview.goto(`chrome-extension://${extensionId}/src/preview/preview.html`);
await preview.getByRole('button', { name: 'Start camera' }).click();

// The detector downloads ~15 MB of wasm and model on first run.
let detectorState = 'unknown';
for (let i = 0; i < 60; i++) {
  detectorState = await preview.evaluate(() => document.getElementById('statusText').textContent);
  if (/Tracking your face|No face found|failed|blocked/i.test(detectorState)) break;
  await preview.waitForTimeout(500);
}
check('preview page has no script errors', previewErrors.length === 0, previewErrors[0]);
check('face detector reaches a running state', /Tracking your face|No face found/.test(detectorState), detectorState);

// Tracking has to keep pumping frames, not just complete one. Software GL in
// headless runs inference far slower than real hardware, so allow plenty of time.
const readStatus = () => preview.evaluate(() => globalThis.__CritterCam.previewDetector.getStatus());
let status = await readStatus();
for (let i = 0; i < 40 && status.processed < 3; i++) {
  await preview.waitForTimeout(1000);
  status = await readStatus();
}
check('detector processes frames end to end', status.processed > 0,
  `${status.processed} frames, ${Math.round(status.cost)} ms each on ${status.delegate}`);
check('detector keeps pumping', status.processed >= 3, `${status.processed} frames`);

// Pin the head so the compositor draws something over the fake camera pattern.
await preview.evaluate(() => document.getElementById('manual').click());
await preview.waitForTimeout(700);
await preview.locator('.viewport').screenshot({ path: join(outDir, 'preview.png') });

const painted = await preview.evaluate(() => {
  const canvas = document.getElementById('output');
  const ctx = canvas.getContext('2d');
  return { width: canvas.width, height: canvas.height };
});
check('preview canvas has camera frames', painted.width >= 320, `${painted.width}×${painted.height}`);

/* -------------------------------------- 2. getUserMedia patch on a real host */

const meet = await context.newPage();
const meetErrors = [];
meet.on('pageerror', (e) => meetErrors.push(e.message));
await meet.route('https://meet.google.com/**', (route) => route.fulfill({
  status: 200,
  contentType: 'text/html',
  body: '<!doctype html><meta charset="utf-8"><title>meet stand-in</title>' +
        '<body style="margin:0;background:#111"><video id="v" autoplay playsinline muted ' +
        'style="width:640px;height:480px"></video>'
}));
await meet.goto('https://meet.google.com/abc-defg-hij');

const result = await meet.evaluate(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  const track = stream.getVideoTracks()[0];
  const video = document.getElementById('v');
  video.srcObject = stream;
  await video.play();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    patched: navigator.mediaDevices.getUserMedia.toString().includes('native code'),
    trackLabel: track.label,
    settings: track.getSettings(),
    sourceElements: document.querySelectorAll('[data-crittercam]').length,
    videoSize: [video.videoWidth, video.videoHeight]
  };
});

check('getUserMedia is intercepted', result.sourceElements === 2, `${result.sourceElements} helper elements`);
check('track keeps the camera label', !!result.trackLabel, JSON.stringify(result.trackLabel));
check('filtered stream plays', result.videoSize[0] > 0, result.videoSize.join('×'));
check('host page has no script errors', meetErrors.length === 0, meetErrors[0]);

// Pin the head and confirm it lands in the outgoing stream, not just the preview.
await context.backgroundPages();
await preview.evaluate(() => chrome.storage.sync.set({
  settings: { enabled: true, manual: true, animal: 'panda', size: 1.9 }
}));
await meet.waitForTimeout(1500);
await meet.locator('#v').screenshot({ path: join(outDir, 'meet-output.png') });

console.log(`\nscreenshots in ${outDir}`);
await context.close();
process.exit(failures.length ? 1 : 0);
