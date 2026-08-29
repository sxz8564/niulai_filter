/*
 * Builds the Chrome Web Store upload: dist/critter-cam-<version>.zip
 *
 *   node tools/package.mjs
 *
 * Ships only what the extension runs on. The repository's tooling, tests,
 * reference art and node_modules stay out — a reviewer reads what you upload,
 * and every extra file is something to explain.
 *
 * It refuses to build on anything that fails review rather than letting you
 * find out days later: over-long name or description, a missing icon, a
 * web_accessible_resources entry that matches nothing, a manifest file that
 * is not in the package.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

// Everything the extension loads at runtime, and the licences that must
// travel with the third-party code inside it.
const SHIP = [
  'manifest.json',
  'src',
  'vendor',
  'models',
  'icons',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'PRIVACY.md'
];

const problems = [];
const notes = [];

/* ------------------------------------------------------------- manifest */

// Store limits, which are enforced at upload rather than explained.
if ((manifest.name || '').length > 45) problems.push(`name is ${manifest.name.length} characters; the limit is 45`);
if ((manifest.description || '').length > 132) problems.push(`description is ${manifest.description.length} characters; the limit is 132`);
if (!manifest.description) problems.push('no description — the listing needs one');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) problems.push(`version "${manifest.version}" is not 1-4 dot-separated integers`);
for (const size of ['16', '48', '128']) {
  if (!manifest.icons || !manifest.icons[size]) problems.push(`no ${size}px icon; the store requires 16, 48 and 128`);
}

/** Every path the manifest names has to exist, or the extension breaks quietly. */
function declaredFiles() {
  const files = [];
  for (const entry of manifest.content_scripts || []) files.push(...(entry.js || []), ...(entry.css || []));
  for (const path of Object.values(manifest.icons || {})) files.push(path);
  if (manifest.action?.default_popup) files.push(manifest.action.default_popup);
  if (manifest.action?.default_icon) {
    const icon = manifest.action.default_icon;
    files.push(...(typeof icon === 'string' ? [icon] : Object.values(icon)));
  }
  if (manifest.background?.service_worker) files.push(manifest.background.service_worker);
  return files;
}
for (const file of declaredFiles()) {
  if (!existsSync(join(root, file))) problems.push(`manifest names ${file}, which does not exist`);
}

// A glob in web_accessible_resources that matches nothing is usually a
// leftover from a directory that no longer ships.
for (const group of manifest.web_accessible_resources || []) {
  for (const pattern of group.resources || []) {
    const base = pattern.replace(/\/?\*.*$/, '');
    if (!existsSync(join(root, base))) {
      problems.push(`web_accessible_resources lists ${pattern}, but ${base} does not exist`);
    }
  }
}

if (!existsSync(join(root, 'PRIVACY.md'))) {
  problems.push('no PRIVACY.md — an extension that reads the camera needs a privacy policy to link');
}

/* -------------------------------------------------------------- package */

const dist = join(root, 'dist');
const staging = join(dist, 'unpacked');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

for (const entry of SHIP) {
  const from = join(root, entry);
  if (!existsSync(from)) { problems.push(`${entry} is missing`); continue; }
  cpSync(from, join(staging, entry), { recursive: true });
}

// Nothing dev-only should have ridden along inside a shipped directory.
const STRAY = /(^|\/)(node_modules|\.git|\.smoke|dist)(\/|$)|\.(test|spec)\./;
function walk(dir, prefix = '') {
  let found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) found = found.concat(walk(path, rel));
    else found.push(rel);
  }
  return found;
}
const shipped = walk(staging);
for (const file of shipped) if (STRAY.test(file)) problems.push(`${file} should not ship`);

if (problems.length) {
  console.error('Not packaging:\n' + problems.map((p) => '  ✗ ' + p).join('\n'));
  process.exit(1);
}

const zipPath = join(dist, `critter-cam-${manifest.version}.zip`);
rmSync(zipPath, { force: true });
execFileSync('zip', ['-q', '-r', '-X', zipPath, '.'], { cwd: staging });

const bytes = statSync(zipPath).size;
const biggest = shipped
  .map((f) => ({ f, size: statSync(join(staging, f)).size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 4);

console.log(`${zipPath}`);
console.log(`  ${shipped.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB zipped`);
console.log(`  version ${manifest.version} — "${manifest.name}"`);
for (const item of biggest) console.log(`  ${(item.size / 1024 / 1024).toFixed(1)} MB  ${item.f}`);
if (notes.length) console.log(notes.map((n) => '  · ' + n).join('\n'));
