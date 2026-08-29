/*
 * Checks a .glb / .gltf against docs/AVATAR-MODELS.md and prints a report.
 *
 *   node tools/validate-avatar.mjs path/to/head.glb
 *
 * Pure Node — it parses the container directly rather than loading Three, so
 * it runs anywhere and can be handed to whoever is producing the model.
 * Exits non-zero if anything would stop the extension using the file.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/validate-avatar.mjs <model.glb>');
  process.exit(2);
}

const LIMITS = {
  fileBytes: 8 * 1024 * 1024,
  fileBytesWarn: 4 * 1024 * 1024,
  triangles: 150000,
  trianglesWarn: 40000,
  texture: 2048,
  textureWarn: 1024,
  materials: 8
};

const CHANNELS = {
  jawOpen: ['jawopen', 'mouthopen', 'jaw', 'visemeaa', 'aa', 'mouthjawopen'],
  blinkLeft: ['eyeblinkleft', 'eyeblinkl', 'blinkleft', 'blinkl', 'eyesclosedl'],
  blinkRight: ['eyeblinkright', 'eyeblinkr', 'blinkright', 'blinkr', 'eyesclosedr'],
  brow: ['browinnerup', 'browup', 'browsup', 'browraise', 'eyebrowup'],
  smile: ['mouthsmile', 'mouthsmileleft', 'mouthsmileright', 'smile', 'happy']
};

const findings = [];
const note = (level, message, detail) => findings.push({ level, message, detail });

/* ------------------------------------------------------------- container */

const bytes = readFileSync(file);
const size = statSync(file).size;
let json;
let binChunk = null;

if (bytes.length >= 12 && bytes.readUInt32LE(0) === 0x46546c67) {
  const version = bytes.readUInt32LE(4);
  if (version !== 2) note('fail', `glTF version ${version}; the extension needs glTF 2.0`);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) binChunk = data;
    offset += 8 + length;
  }
} else {
  try {
    json = JSON.parse(bytes.toString('utf8'));
    note('warn', '.gltf rather than .glb', 'a single .glb file is preferred; embedded buffers are required either way');
  } catch (error) {
    note('fail', 'not a readable glTF or GLB file');
  }
}

if (!json) {
  report();
  process.exit(1);
}

/* ---------------------------------------------------------- requirements */

const required = json.extensionsRequired || [];
const blocked = required.filter((ext) => /draco|meshopt/i.test(ext));
if (blocked.length) {
  note('fail', `compressed with ${blocked.join(', ')}`, 'no decoder is bundled — re-export with compression off');
}

const externalBuffers = (json.buffers || []).filter((b) => b.uri && !b.uri.startsWith('data:'));
if (externalBuffers.length) {
  note('fail', `${externalBuffers.length} external buffer file(s)`, externalBuffers.map((b) => b.uri).join(', '));
}
const externalImages = (json.images || []).filter((i) => i.uri && !i.uri.startsWith('data:'));
if (externalImages.length) {
  note('fail', `${externalImages.length} external texture file(s)`, 'embed images in the model');
}

/* ------------------------------------------------------------- geometry */

let triangles = 0;
let hasNormals = false;
let hasUVs = false;
let primitiveCount = 0;
let unmaterialised = 0;
const accessors = json.accessors || [];
for (const mesh of json.meshes || []) {
  for (const prim of mesh.primitives || []) {
    if (prim.mode !== undefined && prim.mode !== 4) continue;   // triangles only
    primitiveCount++;
    if (prim.attributes?.NORMAL !== undefined) hasNormals = true;
    if (prim.attributes?.TEXCOORD_0 !== undefined) hasUVs = true;
    if (prim.material === undefined) unmaterialised++;
    if (prim.indices !== undefined) triangles += (accessors[prim.indices]?.count || 0) / 3;
    else triangles += (accessors[prim.attributes?.POSITION]?.count || 0) / 3;
  }
}
triangles = Math.round(triangles);

// Overall bounds, from POSITION accessor min/max combined across primitives.
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const mesh of json.meshes || []) {
  for (const prim of mesh.primitives || []) {
    const acc = accessors[prim.attributes?.POSITION];
    if (!acc?.min || !acc?.max) continue;
    for (let i = 0; i < 3; i++) {
      bounds.min[i] = Math.min(bounds.min[i], acc.min[i]);
      bounds.max[i] = Math.max(bounds.max[i], acc.max[i]);
    }
  }
}
const hasBounds = Number.isFinite(bounds.min[0]);
const dims = hasBounds
  ? [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]]
  : null;

/* ------------------------------------------------------------ morph rig */

const morphNames = new Set();
for (const mesh of json.meshes || []) {
  const names = mesh.extras?.targetNames || mesh.primitives?.[0]?.extras?.targetNames || [];
  names.forEach((n) => morphNames.add(n));
}
const nodeNames = (json.nodes || []).map((n) => n.name).filter(Boolean);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const matched = {};
for (const [channel, aliases] of Object.entries(CHANNELS)) {
  matched[channel] = [...morphNames].filter((n) => aliases.some((a) => norm(n) === a || norm(n).includes(a)));
}
const jawNode = nodeNames.find((n) => ['jaw', 'lowerjaw', 'jawbone', 'chin'].some((a) => norm(n).includes(a)));

/* -------------------------------------------------------------- verdict */

if (size > LIMITS.fileBytes) note('fail', `file is ${(size / 1048576).toFixed(1)} MB`, `ceiling is ${LIMITS.fileBytes / 1048576} MB`);
else if (size > LIMITS.fileBytesWarn) note('warn', `file is ${(size / 1048576).toFixed(1)} MB`, 'under 4 MB is recommended');

if (triangles > LIMITS.triangles) note('fail', `${triangles.toLocaleString()} triangles`, `ceiling is ${LIMITS.triangles.toLocaleString()}`);
else if (triangles > LIMITS.trianglesWarn) note('warn', `${triangles.toLocaleString()} triangles`, 'this runs every frame beside face tracking; 5k–40k is the target');

if ((json.materials || []).length > LIMITS.materials) {
  note('warn', `${json.materials.length} materials`, `${LIMITS.materials} or fewer is recommended`);
}

if (!hasBounds) {
  note('warn', 'could not read POSITION bounds', 'accessors are missing min/max');
} else {
  const [w, h, d] = dims;
  if (d > w * 2) note('warn', 'much deeper than wide', 'the model may be exported Z-up — try "rotation": [-90, 0, 0]');
  if (h > w * 2.2) note('warn', 'much taller than wide', 'looks like a body rather than a head; the fit scales by width, so a body makes the head tiny');
  if (w > h * 1.6) note('warn', 'much wider than tall', 'a head is roughly as wide as it is tall — this looks like several figures side by side, or a turnaround baked into geometry');
  const centre = [0, 1, 2].map((i) => (bounds.max[i] + bounds.min[i]) / 2);
  const offCentre = Math.max(...centre.map((c, i) => Math.abs(c) / (dims[i] || 1)));
  if (offCentre > 1.5) note('warn', 'origin far from the head', 'harmless — the loader re-centres — but check the export');
}

if (primitiveCount && !hasNormals) {
  note('warn', 'no NORMAL attribute', 'normals are computed on load, but the export will look faceted — enable normals on export');
}
if ((json.materials || []).length === 0) {
  note('warn', 'no materials', 'the model will render untextured white; this is usually an untextured draft from a generator');
} else if (unmaterialised) {
  note('warn', `${unmaterialised} primitive(s) with no material`);
}
if ((json.materials || []).length && !hasUVs && (json.textures || []).length) {
  note('warn', 'textures present but no TEXCOORD_0', 'the textures cannot be applied without UVs');
}

if (matched.jawOpen.length === 0 && !jawNode) {
  note('warn', 'no jawOpen morph target and no jaw node', 'the mouth will not move; see the naming table in docs/AVATAR-MODELS.md');
}
if (matched.blinkLeft.length === 0 || matched.blinkRight.length === 0) {
  note('warn', 'no blink morph targets', 'the eyes will not blink');
}

function report() {
  const fails = findings.filter((f) => f.level === 'fail');
  const warns = findings.filter((f) => f.level === 'warn');

  console.log(`\n${basename(file)}  ${(size / 1024).toFixed(0)} KB`);
  if (dims) {
    console.log(`  bounds      ${dims.map((v) => v.toFixed(3)).join(' x ')}  (width x height x depth)`);
    console.log(`  after fit   width becomes 1.000, height ${(dims[1] / dims[0]).toFixed(3)}, depth ${(dims[2] / dims[0]).toFixed(3)}`);
  }
  console.log(`  triangles   ${triangles.toLocaleString()}`);
  console.log(`  materials   ${(json.materials || []).length}`);
  console.log(`  morphs      ${morphNames.size ? [...morphNames].join(', ') : 'none'}`);
  console.log('  channels    ' + Object.entries(matched)
    .map(([k, v]) => `${k}:${v.length ? v.join('/') : '—'}`).join('  '));
  if (jawNode) console.log(`  jaw node    ${jawNode}`);

  if (fails.length) {
    console.log('\nBLOCKING');
    fails.forEach((f) => console.log(`  ✗ ${f.message}${f.detail ? `\n      ${f.detail}` : ''}`));
  }
  if (warns.length) {
    console.log('\nWORTH FIXING');
    warns.forEach((f) => console.log(`  ! ${f.message}${f.detail ? `\n      ${f.detail}` : ''}`));
  }
  if (!fails.length && !warns.length) console.log('\n  ✓ conforms to docs/AVATAR-MODELS.md');
  else if (!fails.length) console.log('\n  ✓ usable — the warnings above are quality, not blockers');
  console.log('');
}

report();
process.exit(findings.some((f) => f.level === 'fail') ? 1 : 0);
