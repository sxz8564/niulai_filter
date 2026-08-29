// Render a .glb head from four angles to a PNG contact sheet, so you can see
// what a model actually looks like before wiring it into the extension.
//
//   node tools/render-avatar.mjs models/avatars/head.glb out.png
//
// Uses the same vendored three.js the extension ships, in headless Chromium.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const rigMode = argv.includes('--rig');
const [inGlb, outPng] = argv.filter((a) => a !== '--rig');
if (!inGlb || !outPng) {
  console.error('usage: node tools/render-avatar.mjs <model.glb> <out.png> [--rig]');
  process.exit(2);
}
const glb = readFileSync(path.resolve(inGlb));

const VIEWS = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#5a83a8}canvas{display:block}</style>
<canvas id="out" width="1000" height="300"></canvas>
<script src="/vendor/three/three.iife.js"></script>
<script>
(async () => {
  const ctx = document.getElementById('out').getContext('2d');
  const buf = await (await fetch('/__model.glb')).arrayBuffer();
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, '', res, rej));
  const canvas = document.createElement('canvas');
  const R = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, preserveDrawingBuffer:true});
  R.setSize(1000,300,false); R.setClearColor(0,0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x555555,1.1));
  const k = new THREE.DirectionalLight(0xffffff,1.4); k.position.set(-0.5,0.8,1); scene.add(k);
  const cam = new THREE.OrthographicCamera(-500,500,150,-150,-2000,2000);
  [0, Math.PI/2, Math.PI, -Math.PI/2].forEach((a,i) => {
    const obj = gltf.scene.clone(true);
    obj.traverse(n => {
      if (!n.isMesh) return;
      if (n.geometry && !n.geometry.attributes.normal) n.geometry.computeVertexNormals();
      if (!n.material || !n.material.map) n.material = new THREE.MeshStandardMaterial({color:0xcccccc, roughness:0.8});
    });
    const holder = new THREE.Group(); holder.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c);
    holder.scale.setScalar(200 / Math.max(size.x,size.y,size.z));
    holder.rotation.y = a;
    holder.position.x = -375 + i*250;
    scene.add(holder);
  });
  R.render(scene,cam);
  ctx.drawImage(canvas,0,0);
  document.title = 'rendered';
})().catch(e => { document.title = 'error: ' + e.message; });
</script>`;

/*
 * Rig sheet: one row per morph target, at rest, half and full, so a shape can
 * be judged by what it does rather than by its name.
 */
const RIG = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#5a83a8;font:13px system-ui,sans-serif;color:#fff}
canvas{display:block}</style>
<canvas id="out"></canvas>
<script src="/vendor/three/three.iife.js"></script>
<script>
(async () => {
  const buf = await (await fetch('/__model.glb')).arrayBuffer();
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, '', res, rej));

  let names = [];
  gltf.scene.traverse(n => {
    if (n.isMesh && n.morphTargetDictionary) names = Object.keys(n.morphTargetDictionary);
  });
  if (!names.length) { document.title = 'error: no morph targets'; return; }

  const CELL = 240, STEPS = [0, 0.5, 1];
  const out = document.getElementById('out');
  out.width = CELL * STEPS.length + 140;
  out.height = CELL * names.length;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#5a83a8'; ctx.fillRect(0, 0, out.width, out.height);

  const canvas = document.createElement('canvas');
  const R = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, preserveDrawingBuffer:true});
  R.setSize(CELL, CELL, false); R.setClearColor(0,0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x555555,1.1));
  const key = new THREE.DirectionalLight(0xffffff,1.4); key.position.set(-0.5,0.8,1); scene.add(key);
  const cam = new THREE.OrthographicCamera(-CELL/2, CELL/2, CELL/2, -CELL/2, -2000, 2000);

  const holder = new THREE.Group();
  holder.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  gltf.scene.position.sub(centre);
  holder.scale.setScalar(CELL * 0.8 / Math.max(size.x, size.y, size.z));
  scene.add(holder);

  const meshes = [];
  gltf.scene.traverse(n => { if (n.isMesh && n.morphTargetInfluences) meshes.push(n); });

  for (let row = 0; row < names.length; row++) {
    for (let col = 0; col < STEPS.length; col++) {
      meshes.forEach(m => m.morphTargetInfluences.fill(0));
      meshes.forEach(m => {
        const index = m.morphTargetDictionary[names[row]];
        if (index !== undefined) m.morphTargetInfluences[index] = STEPS[col];
      });
      R.render(scene, cam);
      ctx.drawImage(canvas, 140 + col * CELL, row * CELL);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(names[row], 12, row * CELL + CELL / 2);
  }
  document.title = 'rendered';
})().catch(e => { document.title = 'error: ' + e.message; });
</script>`;

const PAGE = rigMode ? RIG : VIEWS;

const types = { '.html':'text/html', '.js':'text/javascript', '.glb':'model/gltf-binary', '.json':'application/json' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(200, {'content-type':'text/html'}); return res.end(PAGE); }
  if (url === '/__model.glb') { res.writeHead(200, {'content-type':'model/gltf-binary'}); return res.end(glb); }
  const p = path.join(root, url);
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  let body;
  try { body = readFileSync(p); } catch { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

// PLAYWRIGHT_CHROMIUM is an escape hatch for environments where Playwright's
// own download is unavailable but a Chromium build is present on disk.
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => document.title !== '', null, { timeout: 30000 }).catch(() => {});
const title = await page.title();
await page.locator('#out').screenshot({ path: outPng });
await browser.close();
server.close();
if (title.startsWith('error') || errs.length) {
  console.error(title, errs.join('\n'));
  process.exit(1);
}
console.log(outPng + (rigMode ? '  (rest, half, full per shape)' : '  (front, left, back, right)'));
