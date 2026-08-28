/*
 * Checks the landmark → head-pose geometry in src/core/detector.worker.js with
 * synthetic faces, so sign errors (a head that turns the wrong way) are caught
 * without needing a camera.
 *
 *   node tools/pose-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/core/detector.worker.js'), 'utf8');

// Run the worker with MediaPipe and the worker globals stubbed out.
const sandbox = { performance, console, URL };
sandbox.self = sandbox;
sandbox.importScripts = () => { sandbox.Vision = { FilesetResolver: {}, FaceLandmarker: {} }; };
sandbox.location = { href: 'https://example.invalid/src/core/detector.worker.js' };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { poseFromLandmarks, resetBaseline } = sandbox.__critterCamInternals;

const W = 640;
const H = 480;

/** Builds a canonical frontal face, then rotates / shifts it as asked. */
function makeFace({ centerX = 0.5, centerY = 0.5, scale = 1, roll = 0, noseX = 0, noseY = 0 } = {}) {
  const halfHeight = 0.2 * scale;
  const halfWidth = 0.16 * scale;
  const foreheadY = centerY - halfHeight;
  const chinY = centerY + halfHeight;
  const eyeY = foreheadY + 0.353 * (2 * halfHeight);
  const noseBaseY = foreheadY + 0.553 * (2 * halfHeight);

  const points = {
    10: [centerX, foreheadY],
    152: [centerX, chinY],
    1: [centerX + noseX * halfWidth, noseBaseY + noseY * halfHeight],
    33: [centerX - 0.11 * scale, eyeY],
    263: [centerX + 0.11 * scale, eyeY],
    234: [centerX - halfWidth, centerY],
    454: [centerX + halfWidth, centerY]
  };

  // Rotate in pixel space so the aspect ratio is handled the way the real
  // detector sees it.
  const marks = [];
  for (let i = 0; i < 478; i++) marks[i] = { x: centerX, y: centerY, z: 0 };
  for (const [index, [x, y]] of Object.entries(points)) {
    const px = x * W - centerX * W;
    const py = y * H - centerY * H;
    const rx = px * Math.cos(roll) - py * Math.sin(roll);
    const ry = px * Math.sin(roll) + py * Math.cos(roll);
    marks[index] = { x: (rx + centerX * W) / W, y: (ry + centerY * H) / H, z: 0 };
  }
  return marks;
}

let failures = 0;
function expect(name, actual, low, high) {
  const ok = actual >= low && actual <= high;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} = ${actual.toFixed(3)} (want ${low}..${high})`);
}

resetBaseline();
const frontal = poseFromLandmarks(makeFace(), W, H);
expect('frontal centre x', frontal.cx, 0.47, 0.53);
expect('frontal centre y', frontal.cy, 0.47, 0.53);
expect('frontal width', frontal.w, 0.28, 0.36);
expect('frontal roll', frontal.roll, -0.05, 0.05);
expect('frontal yaw', frontal.yaw, -0.1, 0.1);
expect('frontal pitch', frontal.pitch, -0.15, 0.15);

resetBaseline();
const tilted = poseFromLandmarks(makeFace({ roll: 0.26 }), W, H);
expect('roll follows a 15° tilt', tilted.roll, 0.2, 0.32);
expect('tilt does not leak into yaw', Math.abs(tilted.yaw), 0, 0.15);
expect('tilt does not leak into pitch', Math.abs(tilted.pitch), 0, 0.2);

resetBaseline();
const turnedRight = poseFromLandmarks(makeFace({ noseX: 0.5 }), W, H);
expect('nose toward image right gives positive yaw', turnedRight.yaw, 0.3, 1);

resetBaseline();
const turnedLeft = poseFromLandmarks(makeFace({ noseX: -0.5 }), W, H);
expect('nose toward image left gives negative yaw', turnedLeft.yaw, -1, -0.3);

resetBaseline();
const lookingDown = poseFromLandmarks(makeFace({ noseY: 0.45 }), W, H);
expect('nose dropping toward the chin gives positive pitch', lookingDown.pitch, 0.2, 1);

resetBaseline();
const lookingUp = poseFromLandmarks(makeFace({ noseY: -0.45 }), W, H);
expect('nose rising toward the eyes gives negative pitch', lookingUp.pitch, -1, -0.2);

resetBaseline();
const small = poseFromLandmarks(makeFace({ scale: 0.5 }), W, H);
expect('half-size face reports half the width', small.w / frontal.w, 0.45, 0.55);

resetBaseline();
const offset = poseFromLandmarks(makeFace({ centerX: 0.3, centerY: 0.65 }), W, H);
expect('off-centre face x', offset.cx, 0.27, 0.33);
expect('off-centre face y', offset.cy, 0.62, 0.68);

console.log(failures ? `\n${failures} failing check(s)` : '\nall pose checks passed');
process.exit(failures ? 1 : 0);
