/*
 * Renders one model sheet per character into docs/ip/, for use as the work
 * sample in a copyright registration.
 *
 *   node tools/make-character-sheets.mjs
 *
 * A registration wants the character shown clearly enough that someone can
 * tell a copy from a coincidence, so each sheet carries five views — front,
 * both three-quarters, mouth open, eyes closed — on a plain ground, with the
 * name and the SHA-256 of the model file it came from printed underneath.
 *
 * The hash matters more than it looks. It ties the picture on the form to one
 * exact file in the repository, and the repository's history says when that
 * file first existed. A sheet that cannot be tied back to a dated file proves
 * only that someone drew something.
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'ip');
mkdirSync(out, { recursive: true });

// The Chinese names are the ones the characters were named with; the picker
// shows the Latin transcription. A filing should carry both, or it protects
// only half of what is in use.
const CHINESE = {
  niulai: '牛来', baola: '豹拉', wolfwolf: '狼狼',
  niumama: '牛妈妈', niubaba: '牛爸爸', xiaoniao: '小鸟'
};

const registry = JSON.parse(readFileSync(join(root, 'models/avatars/index.json'), 'utf8'));
const models = registry.map((entry) => {
  const bytes = readFileSync(join(root, 'models/avatars', entry.file));
  return {
    entry,
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    // Committed date of the commit that added the file — the earliest point
    // the repository can show the work existing in this form.
    firstSeen: execFileSync('git', ['log', '--diff-filter=A', '--format=%aI', '-1',
      '--', `models/avatars/${entry.file}`], { cwd: root }).toString().trim()
  };
});

const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined
});
const page = await browser.newPage();
for (const file of ['vendor/three/three.iife.js', 'src/core/animals.js',
                    'src/core/model-loader.js', 'src/core/animals3d.js']) {
  await page.addScriptTag({ content: readFileSync(join(root, file), 'utf8') });
}

const sheets = await page.evaluate(async ({ models, chinese }) => {
  const NS = globalThis.__CritterCam;
  NS.avatarModels.registerAll(models.map((m) => m.entry));
  for (const model of models) {
    const bytes = Uint8Array.from(atob(model.base64), (c) => c.charCodeAt(0)).buffer;
    NS.avatarModels.provide(model.entry.id, bytes);
    await NS.avatarModels.parse(bytes, model.entry);
  }

  const renderer = NS.avatar3d.createRenderer();
  const FONT = '"Liberation Sans", "Noto Sans CJK SC", "DejaVu Sans", system-ui, sans-serif';
  /*
   * yaw is expressed in units of the renderer's 34-degree tracking limit,
   * which exists to stop a tracked head swinging further than a real one. A
   * turnaround is not tracking and wants the actual angles, so these go past
   * it deliberately: 1.32 is 45 degrees, 2.65 is a full profile.
   */
  const VIEWS = [
    { label: 'Front', params: {} },
    { label: 'Three-quarter (45°)', params: { yaw: -1.32 } },
    { label: 'Profile (90°)', params: { yaw: -2.65 } },
    { label: 'Mouth open', params: { jawOpen: 1 } },
    { label: 'Eyes closed', params: { blinkL: 1, blinkR: 1, smile: 0.5 } }
  ];

  const result = {};
  for (const model of models) {
    const spec = NS.animals.list().find((s) => s.id === model.entry.id);
    // Framed smaller than the tiles are, and with air between the panels: a
    // head turned 90 degrees is wider than the same head facing forward, and
    // a view clipped by its own panel edge is no use as a record of a shape.
    const cell = 420, pad = 40, head = 132, foot = 92, gap = 14;
    const W = pad * 2 + VIEWS.length * cell + (VIEWS.length - 1) * gap;
    const H = head + cell + 40 + foot;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `700 46px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${chinese[model.entry.id] || ''} ${model.entry.name}`.trim(), pad, 68);
    ctx.fillStyle = '#666';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText('Character design — Critter Cam', pad, 100);

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, head - 16); ctx.lineTo(W - pad, head - 16); ctx.stroke();

    const scaleFor = spec.thumbScale ? spec.thumbScale * 0.78 : 0.46;
    VIEWS.forEach((view, index) => {
      const x = pad + index * (cell + gap);
      const layer = renderer.render(spec,
        { x: cell / 2, y: cell * 0.52, size: cell * scaleFor * 1.02, roll: 0 },
        Object.assign({ jawOpen: 0, blinkL: 0, blinkR: 0, smile: 0, brow: 0, yaw: 0, pitch: 0 }, view.params),
        cell, cell);
      if (layer) ctx.drawImage(layer, x, head, cell, cell);
      ctx.fillStyle = '#888';
      ctx.font = `400 20px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(view.label, x + cell / 2, head + cell + 28);
    });

    // Provenance
    ctx.textAlign = 'left';
    ctx.fillStyle = '#666';
    ctx.font = `400 19px ${FONT}`;
    const base = head + cell + 68;
    ctx.fillText(`Source file: models/avatars/${model.entry.file}`, pad, base);
    ctx.fillText(`SHA-256: ${model.sha256}`, pad, base + 28);
    ctx.fillText(`First recorded in version control: ${model.firstSeen}`, pad, base + 56);

    result[model.entry.id] = canvas.toDataURL('image/png');
  }
  return result;
}, { models: models.map(({ entry, base64, sha256, firstSeen }) => ({ entry, base64, sha256, firstSeen })), chinese: CHINESE });

for (const [id, url] of Object.entries(sheets)) {
  writeFileSync(join(out, `${id}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`docs/ip/${id}.png`);
}

// A machine-readable copy of the same facts, so the filing paperwork and the
// repository cannot quietly disagree with each other.
writeFileSync(join(out, 'inventory.json'), JSON.stringify({
  generated: new Date().toISOString(),
  characters: models.map((m) => ({
    id: m.entry.id,
    name: m.entry.name,
    nameChinese: CHINESE[m.entry.id] || null,
    file: `models/avatars/${m.entry.file}`,
    sha256: m.sha256,
    firstCommitted: m.firstSeen,
    sheet: `docs/ip/${m.entry.id}.png`
  }))
}, null, 2) + '\n');
console.log('docs/ip/inventory.json');
await browser.close();
