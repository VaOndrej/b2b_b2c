// promote.mjs — carry an improvement made in a deploy repo back UP into the
// monorepo's Won IP layer (themes/won-base/**), where every other client gets it.
//
//   node themes/build/promote.mjs --repo ../won-theme-acme            # dry run
//   node themes/build/promote.mjs --repo ../won-theme-acme --apply
//
// What makes this mechanical instead of guesswork: the deploy repo carries
// .won-manifest.json, so every changed file already knows its layer, and the
// manifest's sha tells us exactly which files the client changed since the last
// publish. No diff reading, no archaeology.
//
// The subtlety the naive "git format-patch | git apply --directory" plan misses:
// a Won section in a deploy repo is NOT its won-base source. compose step 2d
// injects the shared style controls into its schema, swaps `won-spacing` for
// `won-style-vars` and wires `won-guard`. Patching the source with a diff taken
// against the COMPOSED file would import build output into the source.
//
// So promotion is a three-way merge with the composed file as the merge base:
//
//     ours   = themes/won-base/<path>        (the source, may have moved on)
//     base   = themes/dist/<base>-generic/<path>   (what the client started from)
//     theirs = <repo>/<path>                 (the client's edited file)
//
// Client edits sit outside the injected regions, so they land cleanly. An edit
// INSIDE an injected region conflicts — correctly, because that content is owned
// by themes/build/won-style-controls.json and editing it per-client is the bug.
//
// Refused, always, loudly: vendor base files (an override is what breaks
// portability to track B / Skeleton) and merchant data (it belongs to the client).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { MANIFEST_FILE } from './layers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const themesRoot = resolve(here, '..');
const repoRoot = resolve(themesRoot, '..');
const wonBase = join(themesRoot, 'won-base');
const scaffoldDir = join(themesRoot, 'build', 'deploy-repo');

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const optAll = (n) => argv.reduce((acc, a, i) => (a === `--${n}` && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const apply = argv.includes('--apply');
const runTests = apply && !argv.includes('--no-test');
const repoArg = opt('repo');
const include = new Set(optAll('include'));

if (!repoArg) {
  console.error('usage: node themes/build/promote.mjs --repo <deploy-repo-path> [--include <path>]... [--apply] [--no-test]');
  process.exit(1);
}
const repoDir = resolve(process.cwd(), repoArg);
const manifestPath = join(repoDir, MANIFEST_FILE);
if (!existsSync(manifestPath)) {
  console.error(`${repoDir} has no ${MANIFEST_FILE} — it was not produced by publish.mjs, so its layers are unknown.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const base = opt('base', manifest.base || 'horizon');

// Rebuild the merge base: exactly what the client's repo was published from.
const genericDir = join(themesRoot, 'dist', `${base}-generic`);
console.log(`recomposing merge base: ${relative(repoRoot, genericDir)}`);
execFileSync('node', [join(themesRoot, 'build', 'compose.mjs'), base, '--out', genericDir], { stdio: 'pipe' });

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

const changed = [];
for (const [rel, meta] of Object.entries(manifest.files)) {
  // 'merchant' files are the client's data and never promote. 'mixed' (storefront
  // locales) DO get scanned: a client may have improved a Won string there, and
  // promoteLocale refuses everything outside the Won namespace anyway.
  if (meta.owner === 'merchant') continue;
  const inRepo = join(repoDir, rel);
  if (!existsSync(inRepo)) continue;
  if (meta.sha && sha(inRepo) === meta.sha) continue;
  changed.push({ rel, ...meta });
}
for (const rel of include) {
  if (manifest.files[rel]) continue;
  if (!existsSync(join(repoDir, rel))) { console.error(`--include ${rel}: not in the repo`); process.exit(1); }
  changed.push({ rel, owner: 'compose', layer: 'won', isNew: true });
}

const promoted = [];
const conflicts = [];
const refused = [];

// --- locale promotion is key-level, not patch-level -------------------------
// The deploy-repo locale file is base + won fragment merged. Only leaves that live
// in a namespace the fragment owns may go back into the fragment; a changed vendor
// string is an override and is refused.
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
}

function promoteLocale(rel) {
  const fragPath = join(wonBase, rel);
  if (!existsSync(fragPath)) { refused.push({ rel, why: 'no won fragment owns this locale file' }); return; }
  const fragment = JSON.parse(readFileSync(fragPath, 'utf8'));
  const ownedRoots = new Set(Object.keys(fragment));
  const flatFrag = flatten(fragment);
  const before = flatten(JSON.parse(readFileSync(join(genericDir, rel), 'utf8')));
  const after = flatten(JSON.parse(readFileSync(join(repoDir, rel), 'utf8')));

  const take = [];
  const skip = [];
  for (const [key, value] of Object.entries(after)) {
    if (before[key] === value) continue;
    const root = key.split('.')[0];
    if (key in flatFrag || (ownedRoots.has(root) && root === 'won')) take.push([key, value]);
    else skip.push(key);
  }
  if (skip.length) refused.push({ rel, why: `${skip.length} changed key(s) outside the Won namespace: ${skip.slice(0, 5).join(', ')}${skip.length > 5 ? ' …' : ''}` });
  if (!take.length) return;
  const next = JSON.parse(JSON.stringify(fragment));
  for (const [key, value] of take) setPath(next, key, value);
  const body = JSON.stringify(next, null, 2) + '\n';
  if (apply) writeFileSync(fragPath, body);
  promoted.push({ rel, target: relative(repoRoot, fragPath), detail: `${take.length} translation key(s)` });
}

// --- won code promotion: three-way merge ------------------------------------
function promoteWon(entry, targetRoot = wonBase, mergeBaseRoot = genericDir) {
  const { rel, isNew } = entry;
  const target = join(targetRoot, rel);
  const theirs = join(repoDir, rel);

  if (isNew || !existsSync(target)) {
    if (apply) { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(theirs)); }
    promoted.push({ rel, target: relative(repoRoot, target), detail: 'new file, copied' });
    return;
  }
  const mergeBase = join(mergeBaseRoot, rel);
  if (!existsSync(mergeBase)) { refused.push({ rel, why: 'no composed merge base — recompose first' }); return; }
  try {
    const out = execFileSync('git', ['merge-file', '-p', '--diff3', target, mergeBase, theirs], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (apply) writeFileSync(target, out);
    promoted.push({ rel, target: relative(repoRoot, target), detail: 'three-way merge, clean' });
  } catch (err) {
    // git merge-file exits with the number of conflicts.
    conflicts.push({ rel, hunks: typeof err.status === 'number' ? err.status : '?' });
  }
}

for (const entry of changed) {
  if (entry.layer === 'won') promoteWon(entry);
  else if (entry.layer === 'locale') promoteLocale(entry.rel);
  // The deploy-repo scaffold (AGENTS.md, README, the SessionStart hook). An improved
  // AGENTS.md written while working on one client is exactly the kind of thing that
  // must not rot in that client's repo — it goes back to the shared starter kit.
  else if (entry.layer === 'meta') promoteWon(entry, scaffoldDir, scaffoldDir);
  else refused.push({ rel: entry.rel, why: `layer '${entry.layer}' never promotes — an override here breaks portability` });
}

// --- report ------------------------------------------------------------------
console.log(`\n${apply ? 'PROMOTE' : 'DRY RUN'}  ${relative(process.cwd(), repoDir)} -> themes/won-base  (base: ${base})`);
console.log(`  changed since last publish: ${changed.length}`);
console.log(`  promoted:                   ${promoted.length}`);
console.log(`  conflicts:                  ${conflicts.length}`);
console.log(`  refused:                    ${refused.length}`);

if (promoted.length) {
  console.log('\n  promoted:');
  for (const p of promoted) console.log(`    + ${p.rel}\n        -> ${p.target}  (${p.detail})`);
}
if (conflicts.length) {
  console.log('\n  CONFLICT — the edit overlaps content the build owns, so it cannot be promoted as-is:');
  for (const c of conflicts) console.log(`    ! ${c.rel}  (${c.hunks} conflicting hunk(s))`);
  console.log('    Shared style controls live in themes/build/won-style-controls.json — change them there,');
  console.log('    not per-client. Otherwise re-apply the edit by hand in themes/won-base/.');
}
if (refused.length) {
  console.log('\n  REFUSED — these stay with the client:');
  for (const r of refused) console.log(`    x ${r.rel}\n        ${r.why}`);
}

if (!apply) { console.log('\nNothing was written. Re-run with --apply to promote.\n'); process.exit(conflicts.length ? 1 : 0); }

if (runTests) {
  console.log('\nverifying: compose both targets + the no-server smoke gates');
  execFileSync('node', [join(themesRoot, 'build', 'compose.mjs'), 'horizon'], { stdio: 'inherit' });
  execFileSync('node', [join(themesRoot, 'build', 'compose.mjs'), 'skeleton'], { stdio: 'inherit' });
  execFileSync('npx', ['playwright', 'test',
    'tests/smoke/won-settings-coverage.spec.ts',
    'tests/smoke/won-category-labels.spec.ts',
    'tests/smoke/won-hidden-natives.spec.ts',
    'tests/smoke/won-cta-invariants.spec.ts',
    '--project=desktop'], { stdio: 'inherit', cwd: repoRoot });
  console.log('\nStatic gates pass. Behavioural smoke still needs a live server:');
  console.log('  shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292');
  console.log('  npm run test:smoke');
}
console.log('');
process.exit(conflicts.length ? 1 : 0);
