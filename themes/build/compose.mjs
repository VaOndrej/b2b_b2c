// compose.mjs — overlay the base-agnostic won-base IP layer onto a pristine base
// theme (Horizon for client track, Skeleton for product track) and deep-merge the
// won locale fragments into the base locale files. Produces a full, uploadable theme.
//
//   node themes/build/compose.mjs horizon   -> themes/dist/horizon-dev
//   node themes/build/compose.mjs skeleton  -> themes/dist/skeleton-dev
//
// won-base owns CODE only. Merchant settings (settings_data.json, templates/*.json)
// belong to each client theme and are pulled from the live store, never from here.

import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const themesRoot = resolve(here, '..');

const target = process.argv[2] || 'horizon';
const baseDir = join(themesRoot, 'bases', target);
const wonBase = join(themesRoot, 'won-base');
const outDir = join(themesRoot, 'dist', `${target}-dev`);

if (!existsSync(baseDir)) {
  console.error(`Base theme not found: ${baseDir}`);
  process.exit(1);
}

// 1. Fresh copy of the pristine base (drop VCS metadata).
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(baseDir, outDir, { recursive: true });
rmSync(join(outDir, '.git'), { recursive: true, force: true });

// 2. Overlay won-base code directories (additive; never touches base files by name
//    unless a won-* file intentionally shadows one, which it never does).
const codeDirs = ['blocks', 'sections', 'snippets', 'assets'];
let overlaid = 0;
for (const dir of codeDirs) {
  const src = join(wonBase, dir);
  if (!existsSync(src)) continue;
  const dest = join(outDir, dir);
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    if (statSync(join(src, file)).isFile()) {
      cpSync(join(src, file), join(dest, file));
      overlaid++;
    }
  }
}

// 3. Deep-merge won locale fragments into the matching base locale files.
// Base locale files can carry a /* ... */ header comment (Horizon) or trailing
// commas (Skeleton) — neither is strict JSON. Tolerate both before parsing.
function readJson(path) {
  const raw = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

function deepMerge(base, extra) {
  for (const key of Object.keys(extra)) {
    if (extra[key] && typeof extra[key] === 'object' && !Array.isArray(extra[key])) {
      base[key] = deepMerge(base[key] && typeof base[key] === 'object' ? base[key] : {}, extra[key]);
    } else {
      base[key] = extra[key];
    }
  }
  return base;
}

const wonLocales = join(wonBase, 'locales');
let mergedLocales = 0;
if (existsSync(wonLocales)) {
  for (const file of readdirSync(wonLocales)) {
    if (!file.endsWith('.json')) continue;
    const fragment = readJson(join(wonLocales, file));
    const target = join(outDir, 'locales', file);
    const base = existsSync(target) ? readJson(target) : {};
    writeFileSync(target, JSON.stringify(deepMerge(base, fragment), null, 2) + '\n');
    mergedLocales++;
  }
}

console.log(`composed ${target}: ${overlaid} code files overlaid, ${mergedLocales} locale files merged -> ${outDir}`);
