/*
 * Cuts a head out of a glTF/GLB that contains more than one — a full body, or
 * several figures side by side, which is what 3D generators often return.
 *
 *   node tools/crop-avatar.mjs input.glb output.glb [options]
 *
 *     --figure <n>   which figure, left to right (default 0)
 *     --top <f>      fraction of the figure's height to keep (default 0.30)
 *     --box x0,y0,z0,x1,y1,z1   explicit bounds instead of the auto crop
 *     --list         report the figures found and exit
 *
 * Triangles are kept when their centroid falls inside the region, so the cut
 * follows the mesh rather than slicing through faces. Node transforms are
 * baked, and a plain material is attached if the source had none.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];
if (!input || (!output && !args.includes('--list'))) {
  console.error('usage: node tools/crop-avatar.mjs input.glb output.glb [--figure n] [--top f] [--box ...] [--list]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};

/* ------------------------------------------------------------ read glTF */

const bytes = readFileSync(input);
let json;
let bin = Buffer.alloc(0);
if (bytes.readUInt32LE(0) === 0x46546c67) {
  let off = 12;
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32LE(off);
    const type = bytes.readUInt32LE(off + 4);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
} else {
  json = JSON.parse(bytes.toString('utf8'));
}
if (!json) { console.error('not a readable glTF/GLB'); process.exit(1); }

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const Type = COMPONENT[acc.componentType];
  const per = COUNT[acc.type];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  // Copy rather than view: byteOffset need not be aligned for the typed array.
  const slice = Buffer.from(bin.subarray(start, start + acc.count * per * Type.BYTES_PER_ELEMENT));
  return new Type(slice.buffer, slice.byteOffset, acc.count * per);
}

/* ------------------------------------------- flatten to world triangles */

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
}
function trs(node) {
  if (node.matrix) return node.matrix.slice();
  const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const s = node.scale || [1, 1, 1];
  const t = node.translation || [0, 0, 0];
  const q = node.rotation || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const rot = [
    1-2*(y*y+z*z), 2*(x*y+z*w),   2*(x*z-y*w),
    2*(x*y-z*w),   1-2*(x*x+z*z), 2*(y*z+x*w),
    2*(x*z+y*w),   2*(y*z-x*w),   1-2*(x*x+y*y)
  ];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = rot[c * 3 + r] * s[c];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
function apply(m, p) {
  return [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2]  + m[12],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2]  + m[13],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]
  ];
}

const tris = [];   // flat list of [ax,ay,az, bx,by,bz, cx,cy,cz]
function walk(nodeIndex, parent) {
  const node = json.nodes[nodeIndex];
  const world = multiply(parent, trs(node));
  if (node.mesh !== undefined) {
    for (const prim of json.meshes[node.mesh].primitives || []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const pos = readAccessor(prim.attributes.POSITION);
      const idx = prim.indices !== undefined
        ? readAccessor(prim.indices)
        : { length: pos.length / 3, [Symbol.iterator]: null };
      const count = prim.indices !== undefined ? idx.length : pos.length / 3;
      for (let i = 0; i < count; i += 3) {
        const face = [];
        for (let v = 0; v < 3; v++) {
          const vi = prim.indices !== undefined ? idx[i + v] : i + v;
          face.push(...apply(world, [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]]));
        }
        tris.push(face);
      }
    }
  }
  for (const child of node.children || []) walk(child, world);
}
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
for (const n of (json.scenes?.[json.scene ?? 0]?.nodes) || []) walk(n, identity);
if (!tris.length) { console.error('no triangles found'); process.exit(1); }

/* --------------------------------------------- split into figures on X */

const xs = tris.map((t) => (t[0] + t[3] + t[6]) / 3).sort((a, b) => a - b);
const spanX = xs[xs.length - 1] - xs[0];
const gapThreshold = spanX * 0.04;
const figures = [];
let start = xs[0];
for (let i = 1; i < xs.length; i++) {
  if (xs[i] - xs[i - 1] > gapThreshold) {
    figures.push([start, xs[i - 1]]);
    start = xs[i];
  }
}
figures.push([start, xs[xs.length - 1]]);

if (args.includes('--list')) {
  console.log(`${tris.length.toLocaleString()} triangles, ${figures.length} figure(s) along X:`);
  figures.forEach((f, i) => console.log(`  [${i}] x ${f[0].toFixed(3)} .. ${f[1].toFixed(3)}  (width ${(f[1] - f[0]).toFixed(3)})`));
  process.exit(0);
}

/* ------------------------------------------------------------ the crop */

let box;
if (opt('box')) {
  const v = opt('box').split(',').map(Number);
  box = { min: v.slice(0, 3), max: v.slice(3, 6) };
} else {
  const which = Number(opt('figure', 0));
  const fig = figures[Math.min(which, figures.length - 1)];
  const inFigure = tris.filter((t) => {
    const cx = (t[0] + t[3] + t[6]) / 3;
    return cx >= fig[0] - 1e-6 && cx <= fig[1] + 1e-6;
  });
  const ys = inFigure.map((t) => (t[1] + t[4] + t[7]) / 3);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const topFraction = Number(opt('top', 0.30));
  box = {
    min: [fig[0] - 1e-3, yMax - (yMax - yMin) * topFraction, -Infinity],
    max: [fig[1] + 1e-3, Infinity, Infinity]
  };
}

const kept = tris.filter((t) => {
  const c = [0, 1, 2].map((axis) => (t[axis] + t[axis + 3] + t[axis + 6]) / 3);
  return c.every((v, i) => v >= box.min[i] && v <= box.max[i]);
});
if (!kept.length) { console.error('the crop region contains no triangles'); process.exit(1); }

/* --------------------------------------------------- rebuild and write */

const positions = [];
const indices = [];
const lookup = new Map();
for (const t of kept) {
  for (let v = 0; v < 3; v++) {
    const p = [t[v * 3], t[v * 3 + 1], t[v * 3 + 2]];
    const key = p.map((n) => n.toFixed(5)).join(',');
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      positions.push(p[0], p[1], p[2]);
      lookup.set(key, index);
    }
    indices.push(index);
  }
}

// Centre on the crop so the head sits at the origin.
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], positions[i + a]);
    max[a] = Math.max(max[a], positions[i + a]);
  }
}
const centre = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) positions[i + a] -= centre[a];
}
const size = [0, 1, 2].map((a) => max[a] - min[a]);
const half = size.map((v) => v / 2);

// Smooth normals over the welded vertices. The source is often position-only,
// and without normals a viewer shades every face flat.
const normals = new Float32Array(positions.length);
for (let i = 0; i < indices.length; i += 3) {
  const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
  const p = (n) => [positions[n * 3], positions[n * 3 + 1], positions[n * 3 + 2]];
  const [pa, pb, pc] = [p(a), p(b), p(c)];
  const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
  // Un-normalised cross product, so bigger faces weigh more.
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  for (const vi of [a, b, c]) for (let axis = 0; axis < 3; axis++) normals[vi * 3 + axis] += n[axis];
}
for (let i = 0; i < normals.length; i += 3) {
  const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
  for (let a = 0; a < 3; a++) normals[i + a] /= len;
}

const posArray = new Float32Array(positions);
const idxArray = positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

const parts = [];
let offset = 0;
function push(typed) {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  const view = { byteOffset: offset, byteLength: buf.length };
  parts.push(buf);
  if (pad) parts.push(Buffer.alloc(pad));
  offset += buf.length + pad;
  return view;
}
const posView = push(posArray);
const nrmView = push(normals);
const idxView = push(idxArray);
const binOut = Buffer.concat(parts);

const source = json.materials?.[0];
const out = {
  asset: { version: '2.0', generator: 'Critter Cam crop-avatar' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Head', mesh: 0 }],
  meshes: [{ name: 'Head', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [source || {
    name: 'Surface',
    pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1], metallicFactor: 0, roughnessFactor: 0.85 }
  }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: posArray.length / 3, type: 'VEC3',
      min: half.map((v) => -v), max: half.slice() },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: idxArray.BYTES_PER_ELEMENT === 4 ? 5125 : 5123, count: idxArray.length, type: 'SCALAR' }
  ],
  bufferViews: [
    { buffer: 0, byteOffset: posView.byteOffset, byteLength: posView.byteLength, target: 34962 },
    { buffer: 0, byteOffset: nrmView.byteOffset, byteLength: nrmView.byteLength, target: 34962 },
    { buffer: 0, byteOffset: idxView.byteOffset, byteLength: idxView.byteLength, target: 34963 }
  ],
  buffers: [{ byteLength: binOut.length }]
};

const jsonText = Buffer.from(JSON.stringify(out), 'utf8');
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

console.log(`${output}`);
console.log(`  kept ${kept.length.toLocaleString()} of ${tris.length.toLocaleString()} triangles from figure ${opt('figure', 0)}`);
console.log(`  size ${size.map((v) => v.toFixed(3)).join(' x ')}  (w x h x d), centred on origin`);
