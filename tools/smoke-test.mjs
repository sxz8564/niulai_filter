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

/*
 * CRITTER_EXTENSION_DIR points the run at an unpacked store build instead of
 * the repository, which is the only way to find out whether the zip you are
 * about to upload actually contains everything the extension loads.
 */
const root = process.env.CRITTER_EXTENSION_DIR || join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || join(root, '.smoke');
mkdirSync(outDir, { recursive: true });

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

// PLAYWRIGHT_CHROMIUM points at a Chromium already on disk, for environments
// where Playwright cannot download its own.
const chromePath = process.env.PLAYWRIGHT_CHROMIUM;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'critter-')), {
  headless: true,
  ...(chromePath ? { executablePath: chromePath } : { channel: 'chromium' }),
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--enable-unsafe-swiftshader'
  ]
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = new URL(worker.url()).host;
console.log(`extension id: ${extensionId}\n`);

/* ------------------------------------------------ 1. preview page + model */

/*
 * A rigged model to exercise the loader with. The repository has a purpose-made
 * one under docs/; a store build ships only the avatars, so fall back to those.
 */
const SAMPLE_MODEL = `async function loadSampleModel() {
  for (const path of ['../../docs/reference/example-head.glb', '../../models/avatars/niulai.glb']) {
    try {
      // A missing chrome-extension:// URL rejects rather than returning a 404.
      const response = await fetch(path);
      if (response.ok) return await response.arrayBuffer();
    } catch (error) { /* try the next one */ }
  }
  throw new Error('no sample model to load');
}`;

const preview = await context.newPage();
const previewErrors = [];
/*
 * MediaPipe's wasm runtime announces its delegate through console.error —
 * "INFO: Created TensorFlow Lite XNNPACK delegate for CPU." is a startup note,
 * not a failure, and counting it as one makes this check depend on whether the
 * detector happens to start before the page settles.
 */
const isNoise = (text) => /^INFO:/.test(text);
preview.on('pageerror', (e) => previewErrors.push(e.message));
preview.on('console', (m) => {
  if (m.type() === 'error' && !isNoise(m.text())) previewErrors.push(m.text());
});

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

const avatar3d = await preview.evaluate(() => ({
  supported: !!(globalThis.__CritterCam.avatar3d && globalThis.__CritterCam.avatar3d.isSupported()),
  renderer: !!(globalThis.__CritterCam.avatar3d && globalThis.__CritterCam.avatar3d.sharedRenderer())
}));
check('3D avatar renderer starts', avatar3d.supported && avatar3d.renderer,
  `webgl ${avatar3d.supported}, renderer ${avatar3d.renderer}`);

// Imported models: the preview page can read the extension's own files, so the
// committed example exercises parsing, fitting and rig detection.
const modelReport = await preview.evaluate(async (helper) => {
  eval(helper);
  const NS = globalThis.__CritterCam;
  const buffer = await loadSampleModel();
  const built = await NS.avatarModels.parse(buffer, { id: 'smoke-example' });
  return built.report;
}, SAMPLE_MODEL).catch((error) => ({ error: String(error.message || error) }));

check('glTF model imports and fits', !modelReport.error && modelReport.measured &&
  modelReport.measured.width > 0,
  modelReport.error || `${modelReport.measured?.width} x ${modelReport.measured?.height}`);
check('model rig is detected by name', !modelReport.error && modelReport.channels?.jawOpen > 0,
  modelReport.error || `jawOpen targets: ${modelReport.channels?.jawOpen}`);

// Detecting the rig is not the same as driving it: the renderer once posed
// imported heads without ever calling their animate(), so nothing moved.
const driven = await preview.evaluate(async (helper) => {
  eval(helper);
  const NS = globalThis.__CritterCam;
  const buffer = await loadSampleModel();
  const built = await NS.avatarModels.parse(buffer, { id: 'smoke-driven' });
  built.parts.animate({ jawOpen: 1 });
  let open = 0;
  built.group.traverse((node) => {
    if (node.morphTargetInfluences) open = Math.max(open, ...node.morphTargetInfluences);
  });
  built.parts.animate({ jawOpen: 0 });
  let shut = 0;
  built.group.traverse((node) => {
    if (node.morphTargetInfluences) shut = Math.max(shut, ...node.morphTargetInfluences);
  });
  return { open, shut };
}, SAMPLE_MODEL).catch((error) => ({ error: String(error.message || error) }));
check('expression params reach the model', driven.open === 1 && driven.shut === 0,
  driven.error || `influence ${driven.shut} -> ${driven.open}`);

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

/*
 * Pin the head and confirm it lands in the outgoing stream, not just the
 * preview. The default avatar is an imported model, so this also covers the
 * path nothing else does: the content script reads the registry and the .glb
 * from extension storage and hands the bytes to the page, which parses and
 * renders them in a world with no chrome.* at all.
 */
await context.backgroundPages();
await preview.evaluate(() => chrome.storage.sync.set({
  settings: { enabled: true, manual: true, animal: 'niulai', size: 1.9 }
}));

// Software GL plus a 500 KB model with textures: give it room, but stop as
// soon as the head is painted.
let outgoing = { avatar: 0, total: 0 };
for (let i = 0; i < 30; i++) {
  await meet.waitForTimeout(500);
  outgoing = await meet.evaluate(() => {
    const video = document.getElementById('v');
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let avatar = 0;
    for (let p = 0; p < data.length; p += 4) {
      const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
      // The fake camera is saturated green; the avatar is orange fur.
      if (r > 110 && r > g * 1.3 && g > b) avatar++;
    }
    return { avatar, total: (canvas.width * canvas.height) };
  });
  if (outgoing.avatar > 300) break;
}
check('imported model reaches the outgoing stream', outgoing.avatar > 300,
  `${outgoing.avatar} avatar pixels of ${outgoing.total}`);

/*
 * Face tracking on a *host* page, which is a different problem from tracking
 * on the preview page and was broken for far longer: an isolated world builds
 * workers against the page's origin, so a chrome-extension:// worker script is
 * refused outright on every real site. The preview page proves nothing here.
 * The stand-in carries a strict policy for the same reason.
 */
// The head was pinned for the check above; tracking has to be back on.
await preview.evaluate(() => chrome.storage.sync.set({
  settings: { enabled: true, manual: false, animal: 'niulai' }
}));

const guarded = await context.newPage();
await guarded.route('https://meet.google.com/**', (route) => route.fulfill({
  status: 200,
  contentType: 'text/html',
  headers: {
    'content-security-policy': "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
      "worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'"
  },
  body: '<!doctype html><meta charset="utf-8"><title>meet stand-in</title>' +
        '<body style="margin:0"><video id="v" autoplay playsinline muted></video>'
}));
await guarded.goto('https://meet.google.com/csp-check');
await guarded.evaluate(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  const video = document.getElementById('v');
  video.srcObject = stream;
  await video.play();
});

let hostDetector = { state: 'unknown', processed: 0 };
for (let i = 0; i < 40; i++) {
  await preview.waitForTimeout(500);
  const reply = await preview.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/csp-check' });
    if (!tabs.length) return null;
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'crittercam:getStatus' }, (r) => {
        resolve(chrome.runtime.lastError ? null : r);
      });
    });
  });
  if (reply && reply.detector) hostDetector = reply.detector;
  if (hostDetector.state === 'error' || hostDetector.processed > 0) break;
}
check('face detector runs on a host page', hostDetector.state === 'ready' && hostDetector.processed > 0,
  hostDetector.error || `${hostDetector.state}, ${hostDetector.processed} frames on ${hostDetector.delegate}`);
await meet.locator('#v').screenshot({ path: join(outDir, 'meet-output.png') });

console.log(`\nscreenshots in ${outDir}`);
await context.close();
process.exit(failures.length ? 1 : 0);
