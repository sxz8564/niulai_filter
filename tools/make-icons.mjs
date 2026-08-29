/*
 * Regenerates icons/*.png from the default avatar, drawn by the same renderer
 * the filter uses, so the icon never drifts from what people actually see.
 *
 *   node tools/make-icons.mjs
 *
 * Requires Playwright's Chromium (dev-only dependency; not shipped).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];
const DEFAULT_ID = 'niulai';

const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined
});
const page = await browser.newPage();
await page.addScriptTag({ content: readFileSync(join(root, 'vendor/three/three.iife.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/model-loader.js'), 'utf8') });
await page.addScriptTag({ content: readFileSync(join(root, 'src/core/animals3d.js'), 'utf8') });

// The icon is whichever avatar the extension ships as its default, which is an
// imported model: register it and hand over its bytes as the page would.
const registry = JSON.parse(readFileSync(join(root, 'models/avatars/index.json'), 'utf8'));
const entry = registry.find((e) => e.id === DEFAULT_ID) || registry[0];
if (!entry) throw new Error('models/avatars/index.json is empty — nothing to draw the icon from');
const modelBase64 = readFileSync(join(root, 'models/avatars', entry.file)).toString('base64');

const icons = await page.evaluate(async ({ sizes, entry, modelBase64 }) => {
  const NS = globalThis.__CritterCam;
  NS.avatarModels.registerAll([entry]);
  const bytes = Uint8Array.from(atob(modelBase64), (c) => c.charCodeAt(0));
  NS.avatarModels.provide(entry.id, bytes.buffer);

  // buildHead fills its group once the model parses, so wait for the geometry
  // rather than capturing an empty plate.
  const spec = NS.animals.get(entry.id);
  const renderer = NS.avatar3d.sharedRenderer();
  /*
   * How many pixels one unit is worth depends on the avatar's own `scale`, so
   * a fixed framing constant has to be retuned every time a model changes.
   * Render once at a trial size, measure what was actually painted, and derive
   * the framing from that instead.
   */
  const PROBE = 256;
  const TRIAL = 120;
  let fit = { perUnit: 0.6, dx: 0, dy: 0 };
  if (renderer) {
    const probe = document.createElement('canvas');
    probe.width = probe.height = PROBE;
    const probeCtx = probe.getContext('2d');
    for (let i = 0; i < 100; i++) {
      const layer = renderer.render(spec, { x: PROBE / 2, y: PROBE / 2, size: TRIAL, roll: 0 }, {}, PROBE, PROBE);
      probeCtx.clearRect(0, 0, PROBE, PROBE);
      if (layer) probeCtx.drawImage(layer, 0, 0, PROBE, PROBE);
      const pixels = probeCtx.getImageData(0, 0, PROBE, PROBE).data;
      let count = 0, minX = PROBE, maxX = 0, minY = PROBE, maxY = 0;
      for (let y = 0; y < PROBE; y++) {
        for (let x = 0; x < PROBE; x++) {
          if (pixels[(y * PROBE + x) * 4 + 3] <= 8) continue;
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (count > 400) {
        /*
         * Everything is converted to units — pose.size is pixels per unit —
         * so the same numbers work at any plate size. The head is `spanUnits`
         * across and sits `centre` away from the point it was rendered at.
         */
        const spanUnits = Math.max(maxX - minX, maxY - minY) / TRIAL;
        fit = {
          perUnit: 0.86 / spanUnits,
          dx: ((minX + maxX) / 2 - PROBE / 2) / TRIAL,
          dy: ((minY + maxY) / 2 - PROBE / 2) / TRIAL
        };
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const out = {};
  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Warm rounded-square plate behind the head.
    const radius = size * 0.23;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#ffd9a8');
    bg.addColorStop(1, '#f0a35c');
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.clip();
    if (renderer) {
      // Fill the plate, using the framing measured above.
      const perUnit = size * fit.perUnit;
      const layer = renderer.render(spec, {
        x: size / 2 - fit.dx * perUnit,
        y: size / 2 - fit.dy * perUnit,
        size: perUnit,
        roll: 0
      }, {}, size, size);
      ctx.drawImage(layer, 0, 0, size, size);
    } else {
      ctx.translate(size / 2, size * 0.56);
      const scale = size * (size <= 32 ? 0.66 : 0.60);
      ctx.scale(scale, scale);
      NS.animals.draw(ctx, spec, { jawOpen: 0.1 });
    }
    ctx.restore();

    out[size] = canvas.toDataURL('image/png');
  }
  return out;
}, { sizes: SIZES, entry, modelBase64 });

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of SIZES) {
  const base64 = icons[size].split(',')[1];
  writeFileSync(join(root, `icons/icon${size}.png`), Buffer.from(base64, 'base64'));
  console.log(`icons/icon${size}.png`);
}
await browser.close();
