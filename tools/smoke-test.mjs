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

// The picker paints each thumbnail once, and a model's bytes arrive after
// that. Without a repaint when they land, every square stays empty.
const thumbs = await preview.evaluate(() => {
  const out = [];
  for (const canvas of document.querySelectorAll('.animal canvas')) {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++;
    out.push({ id: canvas.parentElement.dataset.animal, lit: lit / (data.length / 4) });
  }
  return out;
});
const blank = thumbs.filter((t) => t.lit < 0.05);
check('every picker thumbnail is drawn', thumbs.length > 0 && blank.length === 0,
  blank.length ? `${blank.length} of ${thumbs.length} empty: ${blank.map((t) => t.id).join(', ')}`
    : `${thumbs.length} thumbnails`);

/*
 * The compositor is running by now, so it holds the selected model's group —
 * and a three.js object has one parent, so adding it to that scene takes it
 * out of the picker's renderer. The picker then draws an empty scene for the
 * one animal the user is actually wearing: it appears on click and vanishes on
 * the next repaint.
 */
const paintOne = `(spec) => {
  const NS = globalThis.__CritterCam;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  NS.avatar3d.paintThumb(ctx, spec, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n / 4096;
}`;
const shared = await preview.evaluate((body) => {
  const NS = globalThis.__CritterCam;
  const paint = eval(body);
  const selected = NS.animals.get(document.querySelector('.animal[aria-pressed="true"]').dataset.animal);
  return { id: selected.id, before: paint(selected), after: paint(selected) };
}, paintOne);
check('the picker still draws the head the compositor is using',
  shared.before > 0.05 && shared.after > 0.05,
  `${shared.id}: ${(shared.before * 100).toFixed(0)}% then ${(shared.after * 100).toFixed(0)}%`);

/*
 * A lost WebGL context does not throw — draw calls quietly do nothing — so a
 * renderer kept after one goes on painting blank squares for the rest of the
 * session. Browsers drop contexts under memory pressure and when the GPU
 * process restarts, which is not rare with several meeting tabs open.
 */
const recovered = await preview.evaluate(async (body) => {
  const NS = globalThis.__CritterCam;
  const paint = eval(body);
  const spec = NS.animals.list()[0];
  const before = paint(spec);
  const layer = NS.avatar3d.sharedRenderer().thumbnail(spec, 64);
  const gl = layer.getContext('webgl2') || layer.getContext('webgl');
  gl.getExtension('WEBGL_lose_context').loseContext();
  await new Promise((r) => setTimeout(r, 200));
  return { before, after: paint(spec) };
}, paintOne);
check('a lost WebGL context does not empty the picker',
  recovered.before > 0.05 && recovered.after > 0.05,
  `${(recovered.before * 100).toFixed(0)}% before, ${(recovered.after * 100).toFixed(0)}% after`);

/*
 * Backgrounds. The segmenter's own judgement cannot be exercised here — the
 * fake camera is a colour pattern, and the model calls the whole of it a
 * person — so these check everything around it: that the scenes load, that
 * the compositing puts the scene exactly where the mask says the room is, and
 * that none of it runs when no scene is chosen.
 */
const scenes = await preview.evaluate(() => {
  const NS = globalThis.__CritterCam;
  const list = NS.backgrounds.list();
  return {
    tiles: document.querySelectorAll('.scene').length,
    decoded: list.filter((e) => NS.backgrounds.ready(e.id)).length,
    total: list.length
  };
});
check('scenes load and decode', scenes.total > 0 && scenes.decoded === scenes.total &&
  scenes.tiles === scenes.total + 1,
  `${scenes.decoded}/${scenes.total} decoded, ${scenes.tiles} tiles including None`);

/*
 * A mask made here rather than by the model: opaque on the left, clear on the
 * right. The left half of the output should then still be the camera and the
 * right half the scene. Anything else means the composite is wrong, whatever
 * the segmenter thinks.
 */
const composed = await preview.evaluate(async () => {
  const NS = globalThis.__CritterCam;
  const first = NS.backgrounds.list()[0];
  document.querySelector(`[data-background="${first.id}"]`).click();
  await new Promise((r) => setTimeout(r, 400));

  // Stop the pump and let any result already in flight land, or its mask —
  // which on a fake camera says the whole frame is a person — replaces ours
  // and the scene never gets a chance to show.
  NS.previewDetector.detach();
  await new Promise((r) => setTimeout(r, 900));

  const m = document.createElement('canvas');
  m.width = 320; m.height = 180;
  const mg = m.getContext('2d');
  mg.clearRect(0, 0, 320, 180);
  mg.fillStyle = '#fff';
  mg.fillRect(0, 0, 160, 180);
  NS.previewCompositor.setMask(await createImageBitmap(m));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const out = document.getElementById('output');
  const ctx = out.getContext('2d');
  const sample = (fx) => {
    const d = ctx.getImageData(Math.round(out.width * fx), Math.round(out.height * 0.5), 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  };
  const camera = sample(0.25);
  const scene = sample(0.75);
  const isFakeCamera = (p) => p.g > 90 && p.g > p.r * 1.6 && p.g > p.b * 1.6;
  return { id: first.id, camera, scene, keptCamera: isFakeCamera(camera), replacedRoom: !isFakeCamera(scene) };
});
check('a scene replaces the room and leaves you alone',
  composed.keptCamera && composed.replacedRoom,
  `${composed.id}: masked-in rgb(${composed.camera.r},${composed.camera.g},${composed.camera.b}), ` +
  `masked-out rgb(${composed.scene.r},${composed.scene.g},${composed.scene.b})`);

// Segmentation is a second model per frame. Nobody should pay for it while
// their background is set to None.
const idle = await preview.evaluate(async () => {
  const NS = globalThis.__CritterCam;
  document.querySelector('[data-background="none"]').click();
  NS.previewCompositor.setMask(null);
  let masks = 0;
  NS.previewDetector.detach();
  NS.previewDetector.attach(document.getElementById('camera'));
  const seen = [];
  const original = NS.previewCompositor.setMask;
  NS.previewCompositor.setMask = function (bitmap) { if (bitmap) masks++; return original.call(this, bitmap); };
  await new Promise((r) => setTimeout(r, 3000));
  NS.previewCompositor.setMask = original;
  return { masks };
});
check('no scene means no segmentation', idle.masks === 0, `${idle.masks} masks while set to None`);

/*
 * The popup and the preview edit the same stored settings, so a setting that
 * reaches only one of them is a setting half the users cannot change. This is
 * how the forward/back slider arrived: added to one view, missing from the
 * other until someone noticed.
 */
const describeControls = () => {
  const NS = globalThis.__CritterCam;
  const rows = {};
  for (const key of Object.keys(NS.DEFAULTS)) {
    const el = document.getElementById(key);
    if (!el) {
      // Some settings are chosen from a grid of tiles, not a named input.
      const grid = document.querySelector(`[data-setting="${key}"]`);
      rows[key] = grid ? `grid of ${grid.children.length}` : 'missing';
      continue;
    }
    rows[key] = el.type === 'range' ? `range ${el.min}..${el.max}/${el.step}`
      : el.tagName === 'SELECT' ? 'select ' + Array.from(el.options).map((o) => o.value).join('/')
      : el.type;
  }
  return rows;
};
const previewControls = await preview.evaluate(describeControls);
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
await popup.waitForTimeout(1500);
const popupControls = await popup.evaluate(describeControls);
await popup.close();
const outOfStep = Object.keys(previewControls).filter(
  (key) => previewControls[key] !== popupControls[key] || previewControls[key] === 'missing');
check('popup and preview offer the same settings', outOfStep.length === 0,
  outOfStep.length
    ? outOfStep.map((k) => `${k}: preview ${previewControls[k]} vs popup ${popupControls[k]}`).join('; ')
    : `${Object.keys(previewControls).length} settings in both`);

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
meet.on('console', (m) => { if (m.text().includes('CRITTER')) console.log('  [meet]', m.text()); });
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

/*
 * The bridge path for scenes, which nothing else covers: a host page cannot
 * read chrome-extension:// URLs of its own, so the content script fetches the
 * registry and the image and hands the bytes across, and every mask has to
 * cross the same boundary as a transferable rather than a copy.
 */
await preview.evaluate(() => chrome.storage.sync.set({
  settings: { enabled: true, manual: true, animal: 'niulai', size: 1.9, background: 'orchard-day' }
}));
await meet.evaluate(() => {
  window.__masks = { results: 0, withMask: 0, size: null };
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || m.dir !== 'ext' || m.type !== 'face') return;
    window.__masks.results++;
    if (m.mask) {
      window.__masks.withMask++;
      window.__masks.size = m.mask.width + 'x' + m.mask.height;
    }
  });
});
let crossed = { ready: false, masks: { results: 0, withMask: 0, size: null } };
// Building the segmenter means loading a model and compiling shaders, which
// software GL does in seconds rather than milliseconds.
for (let i = 0; i < 140; i++) {
  await meet.waitForTimeout(500);
  if (i % 20 === 19) console.log(`      … ${((i + 1) / 2).toFixed(0)}s: ${crossed.masks.withMask}/${crossed.masks.results} masked`);
  crossed = await meet.evaluate(() => ({
    ready: !!(globalThis.__CritterCam.backgrounds &&
      globalThis.__CritterCam.backgrounds.ready('orchard-day')),
    masks: window.__masks
  }));
  if (crossed.ready && crossed.masks.withMask >= 3) break;
}
check('a scene crosses into the host page', crossed.ready,
  crossed.ready ? 'orchard-day decoded in the page' : 'never decoded');
check('masks reach the host page with the pose', crossed.masks.withMask >= 3,
  `${crossed.masks.withMask} of ${crossed.masks.results} results carried a ${crossed.masks.size} mask`);
await meet.locator('#v').screenshot({ path: join(outDir, 'meet-output.png') });

console.log(`\nscreenshots in ${outDir}`);
await context.close();
process.exit(failures.length ? 1 : 0);
