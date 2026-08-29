/*
 * Adds expression morph targets to a head that has none, by moving vertices.
 *
 *   node tools/rig-avatar.mjs in.glb out.glb [options]
 *
 *     --jaw <deg>     how far the jaw swings at full open (default 26)
 *     --blink <f>     how far the eye squashes shut, 0..1 (default 1)
 *     --brow <f>      how far the brow lifts, in head widths (default 0.035)
 *     --smile <f>     how far the mouth corners lift (default 1.1)
 *     --hinge <f>     jaw pivot: 0 on the mouth line, 1 at eye level (default
 *                     0.05). Higher swings the whole muzzle, which reads as a
 *                     lengthening face rather than an opening mouth
 *     --band <f>      how far up the head the jaw rotation fades (default 0.22)
 *     --head <f>      fraction of the model's height, from the top, that is
 *                     head. 1 for a head-only crop; on a bust, the share above
 *                     the shoulders. Everything below it holds still
 *     --report        print what was found and where, and write nothing
 *
 * Generators return sculpted heads with no rig at all, and a face that never
 * moves reads as a mask. The shapes here are deformations of the mesh that is
 * already there, not new geometry:
 *
 *   jawOpen     the lower face hinges about a pivot behind the muzzle, with a
 *               smooth falloff so nothing tears
 *   eyeBlink*   the eye region squashes vertically about its own centre; on a
 *               head whose eyes are painted rather than modelled, that is what
 *               closing them looks like
 *   browInnerUp the brow band lifts
 *   mouthSmile  the mouth corners lift and widen
 *
 * The eyes, brows and muzzle are found by reading the base-colour texture:
 * every vertex is sampled at its own UV, and the dark pixels are the eyes and
 * brows, the pale ones the muzzle. That is far more reliable than guessing
 * from the silhouette, which is why this needs a textured model. Decoding
 * happens in headless Chromium; set PLAYWRIGHT_CHROMIUM if Playwright has no
 * browser of its own.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const [input, output] = args;
const reportOnly = args.includes('--report');
if (!input || (!output && !reportOnly)) {
  console.error('usage: node tools/rig-avatar.mjs in.glb out.glb [--jaw 17] [--blink 0.72] [--brow 0.02] [--smile 0.5] [--report]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const jawDegrees = opt('jaw', 26);
// 0 puts the hinge on the mouth line, 1 up at eye level. Low keeps the drop in
// the chin; high swings the whole muzzle, which reads as a lengthening face.
const hingeFraction = opt('hinge', 0.05);
const bandFraction = opt('band', 0.22);
const blinkAmount = opt('blink', 1);
const browLift = opt('brow', 0.035);
const smileAmount = opt('smile', 1.1);
/*
 * A head sculpted with its mouth open is the better starting point: it has a
 * real cavity, which no amount of deforming a closed surface will invent. With
 * --close the jaw is swung shut to make the resting pose, and jawOpen returns
 * the mesh to the shape the sculptor actually modelled.
 */
const closeDegrees = opt('close', 0);

/* ------------------------------------------------------------ read glTF */

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

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(index) {
  const acc = json.accessors[index];
  const Type = COMPONENT[acc.componentType];
  const per = COUNT[acc.type];
  const out = new Type(acc.count * per);
  if (acc.bufferView === undefined) return out;
  const view = json.bufferViews[acc.bufferView];
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const width = per * Type.BYTES_PER_ELEMENT;
  const stride = view.byteStride || width;
  for (let e = 0; e < acc.count; e++) {
    const slice = Buffer.from(bin.subarray(base + e * stride, base + e * stride + width));
    out.set(new Type(slice.buffer, slice.byteOffset, per), e * per);
  }
  return out;
}

/* ------------------------------------------------- read the surface colour */

const primitives = [];
for (const mesh of json.meshes || []) {
  for (const prim of mesh.primitives || []) {
    if (prim.attributes?.POSITION === undefined) continue;
    primitives.push({ mesh, prim, position: readAccessor(prim.attributes.POSITION) });
  }
}
if (!primitives.length) { console.error('no geometry'); process.exit(1); }

/** Decodes each base-colour texture once, at a size big enough to classify by. */
async function sampleColours() {
  const SIZE = 512;
  const decoded = new Map();
  const needed = new Set();
  for (const entry of primitives) {
    const material = json.materials?.[entry.prim.material];
    const texture = material?.pbrMetallicRoughness?.baseColorTexture;
    if (texture && entry.prim.attributes.TEXCOORD_0 !== undefined) {
      entry.textureIndex = texture.index;
      needed.add(texture.index);
    }
  }
  if (!needed.size) return decoded;

  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const page = await browser.newPage();
  for (const index of needed) {
    const image = json.images[json.textures[index].source];
    if (image.bufferView === undefined) continue;
    const view = json.bufferViews[image.bufferView];
    const data = Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    const pixels = await page.evaluate(async ({ dataUrl, SIZE }) => {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
      return [...ctx.getImageData(0, 0, SIZE, SIZE).data];
    }, { dataUrl: `data:${image.mimeType || 'image/png'};base64,${data.toString('base64')}`, SIZE });
    decoded.set(index, { size: SIZE, pixels });
  }
  await browser.close();
  return decoded;
}

const textures = await sampleColours();

/*
 * Every vertex is tagged from the colour painted on it. Orange fur is neither
 * pale nor dark, so the two interesting sets fall out cleanly.
 */
const PALE = 'pale', DARK = 'dark';
const all = [];       // { entry, index, p: [x,y,z], tag }
for (const entry of primitives) {
  const uv = entry.prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(entry.prim.attributes.TEXCOORD_0) : null;
  const texture = textures.get(entry.textureIndex);
  const count = entry.position.length / 3;
  entry.tags = new Array(count).fill(null);
  for (let i = 0; i < count; i++) {
    const p = [entry.position[i * 3], entry.position[i * 3 + 1], entry.position[i * 3 + 2]];
    let tag = null;
    if (uv && texture) {
      const u = uv[i * 2], v = uv[i * 2 + 1];
      const px = Math.min(texture.size - 1, Math.max(0, Math.round((u - Math.floor(u)) * (texture.size - 1))));
      const py = Math.min(texture.size - 1, Math.max(0, Math.round((v - Math.floor(v)) * (texture.size - 1))));
      const o = (py * texture.size + px) * 4;
      const [r, g, b] = [texture.pixels[o], texture.pixels[o + 1], texture.pixels[o + 2]];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const lightness = mx / 255;
      const saturation = mx ? (mx - mn) / mx : 0;
      if (lightness > 0.62 && saturation < 0.28) tag = PALE;
      else if (lightness < 0.38) tag = DARK;
    }
    entry.tags[i] = tag;
    all.push({ entry, index: i, p, tag });
  }
}

/* ------------------------------------------------------- locate the face */

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const v of all) for (let a = 0; a < 3; a++) {
  bounds.min[a] = Math.min(bounds.min[a], v.p[a]);
  bounds.max[a] = Math.max(bounds.max[a], v.p[a]);
}
const fullSize = [0, 1, 2].map((a) => bounds.max[a] - bounds.min[a]);

/*
 * A crop may be a bare head or a bust with neck and shoulders, and every
 * measurement below — eye height, jaw hinge, how far a brow lifts — is in head
 * widths, not model widths. Where the head ends is not something to guess at:
 * a muzzled character has no pinch at the neck, and its narrowest slice is the
 * snout, so a width scan puts the neck through the middle of the face. Say it
 * outright with --head instead; the default treats the whole crop as head,
 * which is what a head-only crop is.
 */
const headFraction = opt('head', 1);
const neckY = bounds.max[1] - fullSize[1] * headFraction;

const headMin = [bounds.min[0], neckY, bounds.min[2]];
const headMax = bounds.max.slice();
{
  // Measure the head on its own vertices, not on the shoulders below it.
  const above = all.filter((v) => v.p[1] >= neckY);
  for (let a = 0; a < 3; a++) {
    headMin[a] = Math.min(...above.map((v) => v.p[a]));
    headMax[a] = Math.max(...above.map((v) => v.p[a]));
  }
  headMin[1] = Math.min(headMin[1], neckY);
}
const head = { min: headMin, max: headMax, size: [0, 1, 2].map((a) => headMax[a] - headMin[a]) };
const size = head.size;
const unit = size[0];   // one head width, the scale everything else is in

const centroid = (list) => [0, 1, 2].map((a) => list.reduce((s, v) => s + v.p[a], 0) / list.length);

// The face is the front half; anything behind that is skull, ears and neck.
const frontOf = (list, depth) => list.filter((v) => v.p[2] > head.min[2] + size[2] * depth);
// An open mouth is dark too, so eyes are looked for in the upper face only.
const upper = head.min[1] + size[1] * 0.45;
const darkFront = frontOf(all.filter((v) => v.tag === DARK && v.p[1] > upper), 0.55);
const paleFront = frontOf(all.filter((v) => v.tag === PALE), 0.55);

/*
 * Eyes and brows are one dark band per side; the brow is its upper third.
 * A head faces +Z, so its own left is +X — the side a viewer sees on the
 * right. eyeBlinkLeft means the head's left eye, as ARKit and MediaPipe both
 * mean it, not the one on the left of the picture.
 */
const sides = [darkFront.filter((v) => v.p[0] > 0), darkFront.filter((v) => v.p[0] < 0)];
const eyes = sides.map((side) => {
  if (side.length < 6) return null;
  const ys = side.map((v) => v.p[1]).sort((a, b) => a - b);
  const browLine = ys[Math.floor(ys.length * 0.62)];
  const lids = side.filter((v) => v.p[1] <= browLine);
  const brows = side.filter((v) => v.p[1] > browLine);
  const centre = centroid(lids.length ? lids : side);
  const xs = side.map((v) => v.p[0]);
  return {
    centre,
    brows,
    radius: Math.max(0.05 * unit, (Math.max(...xs) - Math.min(...xs)) * 0.75)
  };
});

/*
 * Faces are symmetric even when the texture is not: one eye can be caught in
 * shadow and come back smaller, which would then blink less than the other.
 * Mirror-average the pair so both close by the same amount.
 */
if (eyes[0] && eyes[1]) {
  const x = (Math.abs(eyes[0].centre[0]) + Math.abs(eyes[1].centre[0])) / 2;
  const y = (eyes[0].centre[1] + eyes[1].centre[1]) / 2;
  const z = (eyes[0].centre[2] + eyes[1].centre[2]) / 2;
  const radius = Math.max(eyes[0].radius, eyes[1].radius);
  eyes[0].centre = [x, y, z];
  eyes[1].centre = [-x, y, z];
  eyes[0].radius = eyes[1].radius = radius;
}

const muzzle = paleFront.length > 20 ? {
  centre: centroid(paleFront),
  top: Math.max(...paleFront.map((v) => v.p[1])),
  bottom: Math.min(...paleFront.map((v) => v.p[1])),
  halfWidth: Math.max(...paleFront.map((v) => Math.abs(v.p[0])))
} : null;

// The jaw hinges behind the muzzle at about eye height, which is where a real
// one sits; without eyes to go by, fall back to the middle of the head.
const eyeLevel = eyes.filter(Boolean).length
  ? eyes.filter(Boolean).reduce((s, e) => s + e.centre[1], 0) / eyes.filter(Boolean).length
  : head.min[1] + size[1] * 0.6;
const mouthLine = muzzle
  ? muzzle.bottom + (muzzle.top - muzzle.bottom) * 0.30
  : eyeLevel - size[1] * 0.35;
const hinge = {
  y: mouthLine + (eyeLevel - mouthLine) * hingeFraction,
  z: head.min[2] + size[2] * 0.35,
  band: size[1] * bandFraction
};

if (reportOnly || process.env.RIG_VERBOSE) {
  const f = (v) => (Array.isArray(v) ? v.map((n) => n.toFixed(3)).join(', ') : v.toFixed(3));
  console.log(`vertices     ${all.length}`);
  console.log(`bounds       ${f(fullSize)}  (w x h x d)`);
  console.log(`head         ${f(size)}  above y ${f(neckY)}`);
  console.log(`dark / pale  ${all.filter((v) => v.tag === DARK).length} / ${all.filter((v) => v.tag === PALE).length}`);
  eyes.forEach((eye, i) => console.log(`eye ${i === 0 ? "left " : 'right'}    ${eye ? f(eye.centre) + `  radius ${f(eye.radius)}, ${eye.brows.length} brow verts` : 'not found'}`));
  console.log(`muzzle       ${muzzle ? f(muzzle.centre) + `  y ${f(muzzle.bottom)}..${f(muzzle.top)}` : 'not found'}`);
  console.log(`mouth line   y ${f(mouthLine)}`);
  console.log(`hinge        y ${f(hinge.y)}  z ${f(hinge.z)}  band ${f(hinge.band)}`);
  if (reportOnly) process.exit(0);
}

/* ---------------------------------------------------------- the shapes */

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How much of the jaw rotation a vertex takes: 1 on the chin, 0 on the skull. */
function jawWeight(p) {
  const below = smoothstep(hinge.y, hinge.y - hinge.band, p[1]);
  // Leave the back of the head alone; this is a muzzle drop, not a neck bend.
  const front = smoothstep(head.min[2] + size[2] * 0.15, head.min[2] + size[2] * 0.55, p[2]);
  // A bust has a body under the jaw; it stays where it is.
  const aboveNeck = smoothstep(neckY - size[1] * 0.12, neckY + size[1] * 0.04, p[1]);
  return below * front * aboveNeck;
}

/** Rotates the lower face about the hinge, weighted so it blends into the skull. */
function jawOpen(p) {
  const weight = jawWeight(p);
  if (weight <= 0) return [0, 0, 0];
  const angle = (jawDegrees * Math.PI / 180) * weight;
  const dy = p[1] - hinge.y;
  const dz = p[2] - hinge.z;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [0, (hinge.y + dy * c - dz * s) - p[1], (hinge.z + dy * s + dz * c) - p[2]];
}

/** Squashes one eye shut about its own centre. */
function blink(p, eye) {
  if (!eye) return [0, 0, 0];
  const d = [
    (p[0] - eye.centre[0]) / eye.radius,
    (p[1] - eye.centre[1]) / (eye.radius * 0.85),
    (p[2] - eye.centre[2]) / (eye.radius * 1.4)
  ];
  const distance = Math.hypot(d[0], d[1], d[2]);
  const weight = 1 - smoothstep(0.45, 1.15, distance);
  if (weight <= 0) return [0, 0, 0];
  // Pull the lid down harder than the lower lid comes up, as a real one closes.
  const above = p[1] > eye.centre[1] ? 1 : 0.45;
  return [0, -(p[1] - eye.centre[1]) * blinkAmount * weight * above, 0];
}

/** Lifts the brow band. */
function brow(p, eye) {
  if (!eye || !eye.brows.length) return [0, 0, 0];
  const centre = centroid(eye.brows);
  const radius = eye.radius * 1.1;
  const d = Math.hypot((p[0] - centre[0]) / radius, (p[1] - centre[1]) / (radius * 0.8), (p[2] - centre[2]) / (radius * 1.4));
  const weight = 1 - smoothstep(0.5, 1.2, d);
  return [0, browLift * unit * weight, 0];
}

/** Lifts and widens the mouth corners. */
function smile(p) {
  if (!muzzle) return [0, 0, 0];
  const nearMouth = 1 - smoothstep(size[1] * 0.06, size[1] * 0.18, Math.abs(p[1] - mouthLine));
  const corner = smoothstep(muzzle.halfWidth * 0.25, muzzle.halfWidth * 0.95, Math.abs(p[0]));
  const front = smoothstep(head.min[2] + size[2] * 0.45, head.min[2] + size[2] * 0.75, p[2]);
  const weight = nearMouth * corner * front * smileAmount;
  if (weight <= 0) return [0, 0, 0];
  return [Math.sign(p[0]) * unit * 0.03 * weight, unit * 0.05 * weight, 0];
}

/*
 * Swinging the jaw shut to make a resting pose. The authored positions become
 * the jawOpen target, so opening the mouth restores the sculpted cavity rather
 * than stretching a closed surface over it.
 */
function closeJaw() {
  for (const entry of primitives) {
    const count = entry.position.length / 3;
    const authored = Float32Array.from(entry.position);
    const normal = entry.prim.attributes.NORMAL !== undefined ? readAccessor(entry.prim.attributes.NORMAL) : null;
    for (let i = 0; i < count; i++) {
      const p = [authored[i * 3], authored[i * 3 + 1], authored[i * 3 + 2]];
      const weight = jawWeight(p);
      if (weight <= 0) continue;
      const angle = -(closeDegrees * Math.PI / 180) * weight;
      const c = Math.cos(angle), sn = Math.sin(angle);
      const dy = p[1] - hinge.y, dz = p[2] - hinge.z;
      entry.position[i * 3 + 1] = hinge.y + dy * c - dz * sn;
      entry.position[i * 3 + 2] = hinge.z + dy * sn + dz * c;
      // Rotate the normals with the surface; the deformation is near-rigid
      // within the jaw, so this is right where it matters and small where not.
      if (normal) {
        const ny = normal[i * 3 + 1], nz = normal[i * 3 + 2];
        normal[i * 3 + 1] = ny * c - nz * sn;
        normal[i * 3 + 2] = ny * sn + nz * c;
      }
    }
    entry.authored = authored;
    entry.newNormal = normal;
  }
}
if (closeDegrees) closeJaw();

const SHAPES = [
  { name: 'jawOpen', fn: (p) => jawOpen(p), authored: !!closeDegrees },
  { name: 'eyeBlinkLeft', fn: (p) => blink(p, eyes[0]) },
  { name: 'eyeBlinkRight', fn: (p) => blink(p, eyes[1]) },
  { name: 'browInnerUp', fn: (p) => [0, 1].reduce((acc, i) => {
      const d = brow(p, eyes[i]);
      return [acc[0] + d[0], acc[1] + d[1], acc[2] + d[2]];
    }, [0, 0, 0]) },
  { name: 'mouthSmile', fn: (p) => smile(p) }
];

/* -------------------------------------------------------- write the file */

const parts = [bin];
let cursor = bin.length;
const pad0 = (4 - (cursor % 4)) % 4;
if (pad0) { parts.push(Buffer.alloc(pad0)); cursor += pad0; }

function addAccessor(typed, min, max) {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  json.bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: buf.length, target: 34962 });
  parts.push(buf);
  cursor += buf.length;
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); cursor += pad; }
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType: 5126,
    count: typed.length / 3,
    type: 'VEC3',
    min, max
  });
  return json.accessors.length - 1;
}

/*
 * A deformed base has to go back into the file. Generator exports are tightly
 * packed and non-interleaved, so the view can be overwritten in place; anything
 * shared or strided gets a fresh view instead of being corrupted.
 */
const replacedViews = new Map();
function replaceAttribute(accessorIndex, typed) {
  const acc = json.accessors[accessorIndex];
  const view = json.bufferViews[acc.bufferView];
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const exclusive = !view.byteStride && !(acc.byteOffset || 0) && view.byteLength === buf.length;
  if (exclusive) {
    replacedViews.set(acc.bufferView, buf);
  } else {
    json.bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: buf.length, target: 34962 });
    parts.push(buf);
    cursor += buf.length;
    const pad = (4 - (cursor % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); cursor += pad; }
    acc.bufferView = json.bufferViews.length - 1;
    acc.byteOffset = 0;
  }
  if (acc.type === 'VEC3') {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < typed.length; i += 3) {
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], typed[i + a]); max[a] = Math.max(max[a], typed[i + a]); }
    }
    acc.min = min; acc.max = max;
  }
}

const moved = SHAPES.map(() => 0);
for (const entry of primitives) {
  const count = entry.position.length / 3;
  const targets = [];
  SHAPES.forEach((shape, s) => {
    const delta = new Float32Array(count * 3);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const p = [entry.position[i * 3], entry.position[i * 3 + 1], entry.position[i * 3 + 2]];
      // With --close, jawOpen is not a guess: it is the distance back to the
      // positions the sculptor authored.
      const d = shape.authored && entry.authored
        ? [0, 1, 2].map((a) => entry.authored[i * 3 + a] - p[a])
        : shape.fn(p);
      delta.set(d, i * 3);
      if (Math.hypot(d[0], d[1], d[2]) > 1e-6) moved[s]++;
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], d[a]); max[a] = Math.max(max[a], d[a]); }
    }
    targets.push({ POSITION: addAccessor(delta, min, max) });
  });
  if (entry.authored) {
    replaceAttribute(entry.prim.attributes.POSITION, entry.position);
    if (entry.newNormal && entry.prim.attributes.NORMAL !== undefined) {
      replaceAttribute(entry.prim.attributes.NORMAL, entry.newNormal);
    }
  }
  entry.prim.targets = targets;
  entry.mesh.weights = SHAPES.map(() => 0);
  entry.mesh.extras = { ...(entry.mesh.extras || {}), targetNames: SHAPES.map((s) => s.name) };
}

// Splice any in-place attribute replacements into the original chunk.
if (replacedViews.size) {
  const patched = Buffer.from(bin);
  for (const [index, buf] of replacedViews) {
    buf.copy(patched, json.bufferViews[index].byteOffset || 0);
  }
  parts[0] = patched;
}

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
writeFileSync(output, Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binOut, 0x004e4942)]));

console.log(output);
SHAPES.forEach((shape, i) => console.log(`  ${shape.name.padEnd(14)} ${moved[i]} vertices move`));
console.log(`  ${(bytes.length / 1024).toFixed(0)}KB -> ${(Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(binOut, 0x004e4942)]).length / 1024).toFixed(0)}KB`);
