/*
 * Renders the Chrome Web Store graphics into dist/store/.
 *
 *   node tools/make-promo.mjs
 *
 *   icon-128.png        store icon,        128 x 128
 *   promo-440x280.png   small promo tile,  440 x 280
 *   promo-1400x560.png  marquee promo tile, 1400 x 560
 *
 * The avatar in them is rendered by the extension's own renderer rather than
 * drawn separately, so the artwork cannot drift from what the product shows.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'store');
mkdirSync(out, { recursive: true });

const registry = JSON.parse(readFileSync(join(root, 'models/avatars/index.json'), 'utf8'));
const entry = registry.find((e) => e.id === 'niulai') || registry[0];
const modelBase64 = readFileSync(join(root, 'models/avatars', entry.file)).toString('base64');

const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined
});
const page = await browser.newPage();
for (const file of ['vendor/three/three.iife.js', 'src/core/animals.js', 'src/core/model-loader.js', 'src/core/animals3d.js']) {
  await page.addScriptTag({ content: readFileSync(join(root, file), 'utf8') });
}

const images = await page.evaluate(async ({ entry, modelBase64 }) => {
  const NS = globalThis.__CritterCam;
  NS.avatarModels.registerAll([entry]);
  const bytes = Uint8Array.from(atob(modelBase64), (c) => c.charCodeAt(0)).buffer;
  NS.avatarModels.provide(entry.id, bytes);
  // Parse it here rather than waiting on `ready`: nothing else has asked for
  // the model yet, so nothing would ever resolve. The result is cached, so the
  // renders below get the built head straight away.
  await NS.avatarModels.parse(bytes, entry);

  const renderer = NS.avatar3d.sharedRenderer();
  const FONT = '"Liberation Sans", "DejaVu Sans", system-ui, sans-serif';
  const INK = '#33261d';
  const MUTED = '#7a6555';

  /** One head on a transparent canvas, drawn at twice the size it is used. */
  function head(id, size, params) {
    const spec = NS.animals.get(id);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    const layer = renderer.render(spec,
      { x: size, y: size * 1.02, size: size * 1.30, roll: 0 },
      Object.assign({ jawOpen: 0, blinkL: 0, blinkR: 0, smile: 0, brow: 0, yaw: 0, pitch: 0 }, params || {}),
      size * 2, size * 2);
    if (layer) ctx.drawImage(layer, 0, 0);
    return canvas;
  }

  function plate(ctx, w, h) {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#fdf4e6');
    bg.addColorStop(0.55, '#f9e3c4');
    bg.addColorStop(1, '#f2c391');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // A soft warm bloom behind the avatar, so the head is not floating on flat paper.
    const glow = ctx.createRadialGradient(w * 0.76, h * 0.5, 0, w * 0.76, h * 0.5, h * 0.72);
    glow.addColorStop(0, 'rgba(255,255,255,0.55)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  function drawHead(ctx, canvas, cx, cy, size) {
    ctx.save();
    ctx.shadowColor = 'rgba(90,55,20,0.28)';
    ctx.shadowBlur = size * 0.10;
    ctx.shadowOffsetY = size * 0.045;
    ctx.drawImage(canvas, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }

  const result = {};

  /* ----------------------------------------------- small tile, 440 x 280 */
  {
    const W = 440, H = 280;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    plate(ctx, W, H);
    drawHead(ctx, head('niulai', 190, { smile: 0.35 }), W * 0.815, H * 0.60, 218);

    ctx.fillStyle = INK;
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText('Critter Cam', 28, 116);
    ctx.fillStyle = MUTED;
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText('An animal head on', 28, 150);
    ctx.fillText('your webcam — live,', 28, 172);
    ctx.fillText('in the meeting itself.', 28, 194);
    result.small = canvas.toDataURL('image/png');
  }

  /* -------------------------------------------------- marquee, 1400 x 560 */
  {
    const W = 1400, H = 560;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    plate(ctx, W, H);
    drawHead(ctx, head('niulai', 440, { smile: 0.3 }), W * 0.775, H * 0.585, 505);

    ctx.fillStyle = INK;
    ctx.font = `700 92px ${FONT}`;
    ctx.fillText('Critter Cam', 86, 232);
    ctx.fillStyle = MUTED;
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText('An animal head on your webcam, tracked to your face —', 86, 288);
    ctx.fillText('and everyone on the call sees it, not just you.', 86, 332);

    // A few of the other heads, to show this is a set rather than one avatar.
    const others = ['shiba', 'fox', 'panda', 'tiger', 'frog'];
    others.forEach((id, i) => {
      const size = 74;
      const x = 100 + i * 92;
      const y = 430;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.roundRect(x - size / 2 - 7, y - size / 2 - 7, size + 14, size + 14, 18);
      ctx.fill();
      ctx.restore();
      ctx.drawImage(head(id, size, {}), x - size / 2, y - size / 2, size, size);
    });
    result.marquee = canvas.toDataURL('image/png');
  }

  return result;
}, { entry, modelBase64 });

await browser.close();

const write = (name, dataUrl) => {
  writeFileSync(join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('  ' + name);
};
console.log(out);
writeFileSync(join(out, 'icon-128.png'), readFileSync(join(root, 'icons/icon128.png')));
console.log('  icon-128.png');
write('promo-440x280.png', images.small);
write('promo-1400x560.png', images.marquee);
