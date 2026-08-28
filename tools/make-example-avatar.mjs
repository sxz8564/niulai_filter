/*
 * Writes docs/reference/example-head.glb — a minimal model that conforms to
 * docs/AVATAR-MODELS.md. It is deliberately crude geometry: its job is to show
 * the required orientation, scale, origin and morph-target naming, and to give
 * the loader something to exercise in tests.
 *
 *   node tools/make-example-avatar.mjs [outputPath]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'docs/reference/example-head.glb');

/** A UV sphere, slightly taller than wide, standing in for a head. */
function buildHead(segments = 24, rings = 16) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const u = s / segments;
      const theta = u * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      normals.push(x, y, z);
      positions.push(x * 0.5, y * 0.58, z * 0.46);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, indices };
}

const head = buildHead();

// Morph target: the jaw drops, so vertices below the midline move down.
const jawDelta = [];
for (let i = 0; i < head.positions.length; i += 3) {
  const y = head.positions[i + 1];
  const amount = y < -0.05 ? Math.min(1, (-0.05 - y) / 0.5) : 0;
  jawDelta.push(0, -0.16 * amount, 0.02 * amount);
}

function minMax(arr, stride) {
  const min = new Array(stride).fill(Infinity);
  const max = new Array(stride).fill(-Infinity);
  for (let i = 0; i < arr.length; i += stride) {
    for (let c = 0; c < stride; c++) {
      min[c] = Math.min(min[c], arr[i + c]);
      max[c] = Math.max(max[c], arr[i + c]);
    }
  }
  return { min, max };
}

// --- pack the binary chunk -------------------------------------------------
const parts = [];
let offset = 0;
function push(typedArray) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  const view = { byteOffset: offset, byteLength: bytes.length };
  parts.push(bytes);
  if (pad) parts.push(Buffer.alloc(pad));
  offset += bytes.length + pad;
  return view;
}

const posView = push(new Float32Array(head.positions));
const norView = push(new Float32Array(head.normals));
const idxView = push(new Uint16Array(head.indices));
const morphView = push(new Float32Array(jawDelta));
const bin = Buffer.concat(parts);

const posRange = minMax(head.positions, 3);
const morphRange = minMax(jawDelta, 3);
const vertexCount = head.positions.length / 3;

const gltf = {
  asset: { version: '2.0', generator: 'Critter Cam example avatar' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Head', mesh: 0 }],
  meshes: [{
    name: 'Head',
    weights: [0],
    extras: { targetNames: ['jawOpen'] },
    primitives: [{
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2,
      material: 0,
      targets: [{ POSITION: 3 }],
      extras: { targetNames: ['jawOpen'] }
    }]
  }],
  materials: [{
    name: 'Fur',
    pbrMetallicRoughness: {
      baseColorFactor: [0.98, 0.40, 0.06, 1],
      metallicFactor: 0,
      roughnessFactor: 0.8
    }
  }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min: posRange.min, max: posRange.max },
    { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: head.indices.length, type: 'SCALAR' },
    { bufferView: 3, componentType: 5126, count: vertexCount, type: 'VEC3', min: morphRange.min, max: morphRange.max }
  ],
  bufferViews: [
    { buffer: 0, byteOffset: posView.byteOffset, byteLength: posView.byteLength, target: 34962 },
    { buffer: 0, byteOffset: norView.byteOffset, byteLength: norView.byteLength, target: 34962 },
    { buffer: 0, byteOffset: idxView.byteOffset, byteLength: idxView.byteLength, target: 34963 },
    { buffer: 0, byteOffset: morphView.byteOffset, byteLength: morphView.byteLength }
  ],
  buffers: [{ byteLength: bin.length }]
};

// --- wrap as GLB ------------------------------------------------------------
const jsonText = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = (4 - (jsonText.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPad, 0x20)]);

const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);

function chunk(data, type) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
}

const glb = Buffer.concat([
  header,
  chunk(jsonChunk, 0x4e4f534a),   // JSON
  chunk(bin, 0x004e4942)          // BIN
]);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
console.log(`${out}  ${(glb.length / 1024).toFixed(1)} KB  ${vertexCount} vertices, 1 morph target (jawOpen)`);
