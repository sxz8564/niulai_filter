/*
 * Cuts a head out of a glTF/GLB that contains more than one — a full body, or
 * several figures side by side, which is what 3D generators often return.
 *
 *   node tools/crop-avatar.mjs input.glb output.glb [options]
 *
 *     --figure <n>   which figure, left to right (default 0)
 *     --top <f>      fraction of the figure's height to keep (default 0.30)
 *     --box x0,y0,z0,x1,y1,z1   explicit bounds instead of the auto crop
 *     --slim         keep only the base colour texture, dropping the
 *                    metallic-roughness, normal, occlusion and emissive maps
 *     --list         report the figures found and exit
 *
 * Triangles are kept when their centroid falls inside the region, so the cut
 * follows the mesh rather than slicing through faces. Node transforms are
 * baked, and normals, UVs, vertex colours and the material — textures and all
 * — come across with the geometry. A source without normals gets smooth ones,
 * since a position-only mesh otherwise shades every face flat.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];
if (!input || (!output && !args.includes('--list'))) {
  console.error('usage: node tools/crop-avatar.mjs input.glb output.glb [--figure n] [--top f] [--box ...] [--slim] [--list]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};
const slim = args.includes('--slim');

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

/** Reads an accessor into a tight typed array, de-interleaving if it has to. */
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
    // Copy rather than view: an element offset need not be aligned.
    const slice = Buffer.from(bin.subarray(base + e * stride, base + e * stride + width));
    out.set(new Type(slice.buffer, slice.byteOffset, per), e * per);
  }
  return out;
}

/** Vertex colours arrive as bytes, shorts or floats; the output is always float RGBA. */
function readColour(index) {
  const acc = json.accessors[index];
  const raw = readAccessor(index);
  const per = COUNT[acc.type];
  const divisor = acc.componentType === 5121 ? 255 : acc.componentType === 5123 ? 65535 : 1;
  const out = new Float32Array(acc.count * 4);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = raw[i * per + c] / divisor;
    out[i * 4 + 3] = per === 4 ? raw[i * per + 3] / divisor : 1;
  }
  return out;
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
/** Directions ignore translation; renormalised, which covers uniform scale. */
function applyDirection(m, p) {
  const v = [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2]
  ];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/*
 * Every primitive in the file becomes a `source`: its attributes read out
 * once, plus the world matrix its node sits under. Triangles then reference a
 * source and three of its vertices, so nothing about a vertex is lost on the
 * way through — UVs and colours ride along with the position.
 */
const sources = [];
const tris = [];   // { source, v: [i, j, k], centroid: [x, y, z] }

function walk(nodeIndex, parent) {
  const node = json.nodes[nodeIndex];
  const world = multiply(parent, trs(node));
  if (node.mesh !== undefined) {
    for (const prim of json.meshes[node.mesh].primitives || []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const attributes = prim.attributes || {};
      if (attributes.POSITION === undefined) continue;

      const position = readAccessor(attributes.POSITION);
      const count = position.length / 3;
      const world3 = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        const p = apply(world, [position[v * 3], position[v * 3 + 1], position[v * 3 + 2]]);
        world3.set(p, v * 3);
      }

      let normal = null;
      if (attributes.NORMAL !== undefined) {
        const raw = readAccessor(attributes.NORMAL);
        normal = new Float32Array(count * 3);
        for (let v = 0; v < count; v++) {
          normal.set(applyDirection(world, [raw[v * 3], raw[v * 3 + 1], raw[v * 3 + 2]]), v * 3);
        }
      }

      const source = {
        material: prim.material === undefined ? -1 : prim.material,
        position: world3,
        normal: normal,
        uv: attributes.TEXCOORD_0 !== undefined ? readAccessor(attributes.TEXCOORD_0) : null,
        colour: attributes.COLOR_0 !== undefined ? readColour(attributes.COLOR_0) : null
      };
      sources.push(source);

      const indices = prim.indices !== undefined ? readAccessor(prim.indices) : null;
      const faces = indices ? indices.length : count;
      for (let i = 0; i < faces; i += 3) {
        const v = [0, 1, 2].map((k) => (indices ? indices[i + k] : i + k));
        const centroid = [0, 1, 2].map((axis) =>
          (world3[v[0] * 3 + axis] + world3[v[1] * 3 + axis] + world3[v[2] * 3 + axis]) / 3);
        tris.push({ source, v, centroid });
      }
    }
  }
  for (const child of node.children || []) walk(child, world);
}
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
for (const n of (json.scenes?.[json.scene ?? 0]?.nodes) || []) walk(n, identity);
if (!tris.length) { console.error('no triangles found'); process.exit(1); }

/* --------------------------------------------- split into figures on X */

const xs = tris.map((t) => t.centroid[0]).sort((a, b) => a - b);
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
  const inFigure = tris.filter((t) => t.centroid[0] >= fig[0] - 1e-6 && t.centroid[0] <= fig[1] + 1e-6);
  const ys = inFigure.map((t) => t.centroid[1]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const topFraction = Number(opt('top', 0.30));
  box = {
    min: [fig[0] - 1e-3, yMax - (yMax - yMin) * topFraction, -Infinity],
    max: [fig[1] + 1e-3, Infinity, Infinity]
  };
}

const kept = tris.filter((t) => t.centroid.every((v, i) => v >= box.min[i] && v <= box.max[i]));
if (!kept.length) { console.error('the crop region contains no triangles'); process.exit(1); }

/* --------------------------------------------------- rebuild and write */

/*
 * One output primitive per source material, so a model painted with several
 * materials keeps them. Vertices are shared only when they were shared in the
 * source, which is what keeps UV seams intact.
 */
const groups = new Map();
for (const t of kept) {
  const key = t.source.material;
  let group = groups.get(key);
  if (!group) {
    group = {
      material: key,
      hasNormal: true, hasUv: true, hasColour: true,
      lookup: new Map(),
      position: [], normal: [], uv: [], colour: [], indices: []
    };
    groups.set(key, group);
  }
  // An attribute is only written when every contributing primitive has it.
  if (!t.source.normal) group.hasNormal = false;
  if (!t.source.uv) group.hasUv = false;
  if (!t.source.colour) group.hasColour = false;

  for (const v of t.v) {
    const id = sources.indexOf(t.source) + ':' + v;
    let index = group.lookup.get(id);
    if (index === undefined) {
      index = group.position.length / 3;
      group.lookup.set(id, index);
      group.position.push(t.source.position[v * 3], t.source.position[v * 3 + 1], t.source.position[v * 3 + 2]);
      if (t.source.normal) group.normal.push(t.source.normal[v * 3], t.source.normal[v * 3 + 1], t.source.normal[v * 3 + 2]);
      if (t.source.uv) group.uv.push(t.source.uv[v * 2], t.source.uv[v * 2 + 1]);
      if (t.source.colour) group.colour.push(...t.source.colour.slice(v * 4, v * 4 + 4));
    }
    group.indices.push(index);
  }
}
const built = [...groups.values()];

// Centre the crop on the origin, measuring across every group together.
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const g of built) {
  for (let i = 0; i < g.position.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], g.position[i + a]);
      max[a] = Math.max(max[a], g.position[i + a]);
    }
  }
}
const centre = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
for (const g of built) {
  for (let i = 0; i < g.position.length; i += 3) {
    for (let a = 0; a < 3; a++) g.position[i + a] -= centre[a];
  }
}
const size = [0, 1, 2].map((a) => max[a] - min[a]);

/** Smooth normals for a group whose source had none. */
function smoothNormals(g) {
  const normals = new Float32Array(g.position.length);
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
    const p = (n) => [g.position[n * 3], g.position[n * 3 + 1], g.position[n * 3 + 2]];
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
  return normals;
}

/* ------------------------------------------------------- assemble glTF */

const parts = [];
let offset = 0;
function pushBuffer(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  const view = { byteOffset: offset, byteLength: buf.length };
  parts.push(buf);
  if (pad) parts.push(Buffer.alloc(pad));
  offset += buf.length + pad;
  return view;
}
const out = {
  asset: { version: '2.0', generator: 'Critter Cam crop-avatar' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Head', mesh: 0 }],
  meshes: [{ name: 'Head', primitives: [] }],
  accessors: [],
  bufferViews: [],
  buffers: [{ byteLength: 0 }]
};
function addView(typed, target) {
  const view = pushBuffer(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength));
  out.bufferViews.push({ buffer: 0, byteOffset: view.byteOffset, byteLength: view.byteLength, ...(target ? { target } : {}) });
  return out.bufferViews.length - 1;
}
function addAccessor(typed, type, componentType, extra) {
  const view = addView(typed, componentType === 5125 || componentType === 5123 ? 34963 : 34962);
  out.accessors.push({ bufferView: view, componentType, count: typed.length / COUNT[type], type, ...(extra || {}) });
  return out.accessors.length - 1;
}

/*
 * Materials, textures, samplers and images are copied on demand, so the
 * output carries only what the kept triangles actually reference.
 */
const DROP_WHEN_SLIM = ['metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture'];
const materialMap = new Map();
const textureMap = new Map();
const imageMap = new Map();
let droppedMaps = 0;

function copyImage(index) {
  if (imageMap.has(index)) return imageMap.get(index);
  const image = json.images[index];
  const copy = { ...image };
  if (image.bufferView !== undefined) {
    const view = json.bufferViews[image.bufferView];
    const data = Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    const written = pushBuffer(data);
    out.bufferViews.push({ buffer: 0, byteOffset: written.byteOffset, byteLength: written.byteLength });
    copy.bufferView = out.bufferViews.length - 1;
  }
  (out.images = out.images || []).push(copy);
  const id = out.images.length - 1;
  imageMap.set(index, id);
  return id;
}
function copyTexture(index) {
  if (textureMap.has(index)) return textureMap.get(index);
  const texture = json.textures[index];
  const copy = { ...texture };
  if (texture.source !== undefined) copy.source = copyImage(texture.source);
  if (texture.sampler !== undefined) {
    (out.samplers = out.samplers || []).push({ ...json.samplers[texture.sampler] });
    copy.sampler = out.samplers.length - 1;
  }
  (out.textures = out.textures || []).push(copy);
  const id = out.textures.length - 1;
  textureMap.set(index, id);
  return id;
}
function copyTextureRefs(node) {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (!value || typeof value !== 'object') continue;
    if (key.endsWith('Texture') || key === 'baseColorTexture') {
      if (slim && DROP_WHEN_SLIM.includes(key)) { delete node[key]; droppedMaps++; continue; }
      if (value.index !== undefined) value.index = copyTexture(value.index);
    } else {
      copyTextureRefs(value);
    }
  }
}
function copyMaterial(index) {
  if (index === -1) {
    if (!materialMap.has(-1)) {
      (out.materials = out.materials || []).push({
        name: 'Surface',
        pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1], metallicFactor: 0, roughnessFactor: 0.85 }
      });
      materialMap.set(-1, out.materials.length - 1);
    }
    return materialMap.get(-1);
  }
  if (materialMap.has(index)) return materialMap.get(index);
  const copy = JSON.parse(JSON.stringify(json.materials[index]));
  copyTextureRefs(copy);
  (out.materials = out.materials || []).push(copy);
  const id = out.materials.length - 1;
  materialMap.set(index, id);
  return id;
}

let computedNormals = 0;
for (const g of built) {
  const position = new Float32Array(g.position);
  const half = [0, 1, 2].map((a) => size[a] / 2);
  const attributes = {
    POSITION: addAccessor(position, 'VEC3', 5126, { min: half.map((v) => -v), max: half.slice() })
  };
  const normal = g.hasNormal ? new Float32Array(g.normal) : (computedNormals++, smoothNormals(g));
  attributes.NORMAL = addAccessor(normal, 'VEC3', 5126);
  if (g.hasUv) attributes.TEXCOORD_0 = addAccessor(new Float32Array(g.uv), 'VEC2', 5126);
  if (g.hasColour) attributes.COLOR_0 = addAccessor(new Float32Array(g.colour), 'VEC4', 5126);

  const large = position.length / 3 > 65535;
  const indices = addAccessor(large ? new Uint32Array(g.indices) : new Uint16Array(g.indices), 'SCALAR', large ? 5125 : 5123);
  out.meshes[0].primitives.push({ attributes, indices, material: copyMaterial(g.material) });
}

const binOut = Buffer.concat(parts);
out.buffers[0].byteLength = binOut.length;

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

const carried = [
  built.every((g) => g.hasUv) && (out.textures || []).length ? `${out.textures.length} texture(s)` : null,
  built.some((g) => g.hasColour) ? 'vertex colours' : null,
  computedNormals ? 'normals computed' : 'normals'
].filter(Boolean);

console.log(`${output}`);
console.log(`  kept ${kept.length.toLocaleString()} of ${tris.length.toLocaleString()} triangles from figure ${opt('figure', 0)}`);
console.log(`  size ${size.map((v) => v.toFixed(3)).join(' x ')}  (w x h x d), centred on origin`);
console.log(`  carried ${carried.join(', ')}${droppedMaps ? `, dropped ${droppedMaps} map(s) for --slim` : ''}`);
