// publish.mjs — sync a composed build into a deploy repo (won-theme-generic or a
// client fork) WITHOUT trampling anything the theme editor owns.
//
//   node themes/build/publish.mjs --repo ../won-theme-generic            # dry run
//   node themes/build/publish.mjs --repo ../won-theme-generic --apply
//
// Why this exists: compose.mjs step 1 is `rmSync(outDir)` — pointing it straight at
// a connected deploy repo would delete every merchant customization Shopify committed
// back. So compose stays a pure builder writing to themes/dist, and this script does
// the reconciliation, driven entirely by the manifest compose emitted.
//
// Ownership rules (themes/build/layers.mjs is the source of truth):
//   owner 'compose'  -> mirrored: created, updated, and DELETED when it leaves the build
//   owner 'merchant' -> seeded only when absent; never updated, never deleted
//                       (--reseed-demo refreshes the ones still untouched since the
//                        last publish — for the GENERIC upstream, which has no merchant)
//   owner 'mixed'    -> storefront locales: additive key merge, merchant values win
//   unknown paths    -> client code; left alone and reported
//
// On top of the file rules, won_* GLOBAL settings are reconciled key-by-key into an
// existing config/settings_data.json: missing ones get the schema default, existing
// ones are never touched. Without it a setting added after the first publish stays
// invisible on every live store.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { MANIFEST_FILE } from './layers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const themesRoot = resolve(here, '..');

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const apply = argv.includes('--apply');
// Merchant-owned demo data (templates/*.json, settings_data, section groups) is
// seeded once and then belongs to the store. But the GENERIC upstream repo has no
// merchant — its templates are the starter data, and leaving them frozen at the
// first publish means a fork inherits a PDP from months ago while the code around
// it moved on. --reseed-demo refreshes them, and only where the repo copy is still
// byte-identical to what the previous publish put there. One edit in the repo and
// that file is reported as drifted and left alone, exactly like a conflict.
const reseedDemo = argv.includes('--reseed-demo');
const base = opt('base', 'horizon');
const repoArg = opt('repo');
const buildArg = opt('build', join(themesRoot, 'dist', `${base}-generic`));

if (!repoArg) {
  console.error('usage: node themes/build/publish.mjs --repo <deploy-repo-path> [--base horizon] [--build <dir>] [--reseed-demo] [--apply]');
  process.exit(1);
}
const repoDir = resolve(process.cwd(), repoArg);
const buildDir = resolve(process.cwd(), buildArg);

for (const [label, dir] of [['build', buildDir], ['repo', repoDir]]) {
  if (!existsSync(dir)) { console.error(`${label} directory not found: ${dir}`); process.exit(1); }
}
const newManifestPath = join(buildDir, MANIFEST_FILE);
if (!existsSync(newManifestPath)) {
  console.error(`build has no ${MANIFEST_FILE} — run compose first:\n  node themes/build/compose.mjs ${base} --out ${relative(process.cwd(), buildDir)}`);
  process.exit(1);
}
const newManifest = JSON.parse(readFileSync(newManifestPath, 'utf8'));
const oldManifest = existsSync(join(repoDir, MANIFEST_FILE))
  ? JSON.parse(readFileSync(join(repoDir, MANIFEST_FILE), 'utf8'))
  : { files: {} };

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const listFiles = (root, rel = '.', out = []) => {
  for (const entry of readdirSync(join(root, rel))) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const childRel = rel === '.' ? entry : `${rel}/${entry}`;
    if (statSync(join(root, childRel)).isDirectory()) listFiles(root, childRel, out);
    else out.push(childRel);
  }
  return out;
};

// Additive deep merge: only keys ABSENT from the target are added. A merchant string
// already in the repo always wins — the Shopify Language Editor owns storefront locales.
function mergeMissing(target, incoming) {
  let added = 0;
  for (const key of Object.keys(incoming)) {
    const v = incoming[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      added += mergeMissing(target[key], v);
    } else if (!(key in target)) {
      target[key] = v;
      added += 1;
    }
  }
  return added;
}

// Scaffold: the deploy-repo starter kit (AGENTS.md, README, hook, repo memory).
// It is not theme code — Shopify ignores everything outside the eight theme
// directories — but it is what makes a cloned repo self-explaining to the next
// agent, so it ships with every publish and is versioned in the monorepo.
const scaffoldDir = join(themesRoot, 'build', 'deploy-repo');
// Seeded once, then it is the client's: it is meant to be filled in per store.
const SCAFFOLD_SEED_ONLY = new Set(['.agents/memory/theme-map.md']);
const scaffoldFiles = existsSync(scaffoldDir) ? listFiles(scaffoldDir) : [];
// Scaffold paths are owned by the starter kit, full stop. The pristine base ships its
// own README.md at the root, so without this the two would fight every publish.
const scaffoldPaths = new Set(scaffoldFiles);

const repoFiles = new Set(listFiles(repoDir));
const plan = { write: [], seed: [], reseed: [], mergeLocale: [], delete: [], keepMerchant: [], conflict: [], clientOnly: [], scaffold: [] };

// Scaffold entries go into the manifest too, so promote.mjs can carry an improved
// AGENTS.md back into themes/build/deploy-repo/ instead of it rotting per-client.
const scaffoldMeta = {};
for (const rel of scaffoldFiles) {
  const src = join(scaffoldDir, rel);
  const seedOnly = SCAFFOLD_SEED_ONLY.has(rel);
  scaffoldMeta[rel] = { owner: seedOnly ? 'merchant' : 'compose', layer: seedOnly ? 'data' : 'meta', sha: sha(readFileSync(src)) };
  const exists = repoFiles.has(rel);
  if (seedOnly) { (exists ? plan.keepMerchant : plan.seed).push(rel); continue; }
  if (!exists || sha(readFileSync(join(repoDir, rel))) !== scaffoldMeta[rel].sha) plan.scaffold.push(rel);
}

for (const [rel, meta] of Object.entries(newManifest.files)) {
  if (scaffoldPaths.has(rel)) continue; // the starter kit wins over a same-named base file
  const src = join(buildDir, rel);
  const dst = join(repoDir, rel);
  const exists = repoFiles.has(rel);
  const buildSha = meta.sha ?? sha(readFileSync(src));

  if (meta.owner === 'merchant') {
    if (!exists) { plan.seed.push(rel); continue; }
    const repoSha = sha(readFileSync(dst));
    if (repoSha === buildSha) continue; // already in sync
    const prevSeeded = oldManifest.files?.[rel]?.sha;
    if (reseedDemo && prevSeeded && prevSeeded === repoSha) plan.reseed.push(rel);
    else plan.keepMerchant.push(rel);
    continue;
  }
  if (meta.owner === 'mixed') {
    plan.mergeLocale.push(rel);
    continue;
  }
  // owner === 'compose'
  if (!exists) { plan.write.push(rel); continue; }
  const repoSha = sha(readFileSync(dst));
  if (repoSha === buildSha) continue; // already in sync
  const prev = oldManifest.files?.[rel];
  if (prev && prev.sha && prev.sha !== repoSha) {
    // The repo copy drifted from what the LAST publish produced: somebody edited a
    // compose-owned file inside the deploy repo. Overwriting would silently destroy it.
    plan.conflict.push({ rel, layer: meta.layer });
    continue;
  }
  plan.write.push(rel);
}

// Compose-owned files that were published before and have now left the build.
for (const [rel, meta] of Object.entries(oldManifest.files || {})) {
  if (newManifest.files[rel] || scaffoldPaths.has(rel)) continue;
  if (meta.owner !== 'compose') continue;
  if (repoFiles.has(rel)) plan.delete.push(rel);
}

// Anything in the repo that neither manifest knows about is client code — untouched.
for (const rel of repoFiles) {
  if (rel === MANIFEST_FILE) continue;
  if (newManifest.files[rel] || oldManifest.files?.[rel] || scaffoldMeta[rel]) continue;
  plan.clientOnly.push(rel);
}

// ---- execute / report -------------------------------------------------------
let localeAdded = 0;
const localeDetail = [];
for (const rel of plan.mergeLocale) {
  const incoming = JSON.parse(readFileSync(join(buildDir, rel), 'utf8'));
  const dst = join(repoDir, rel);
  if (!repoFiles.has(rel)) {
    if (apply) { mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, JSON.stringify(incoming, null, 2) + '\n'); }
    localeDetail.push(`${rel} (new file)`);
    continue;
  }
  const target = JSON.parse(readFileSync(dst, 'utf8'));
  const added = mergeMissing(target, incoming);
  if (added > 0) {
    if (apply) writeFileSync(dst, JSON.stringify(target, null, 2) + '\n');
    localeAdded += added;
    localeDetail.push(`${rel} (+${added} keys)`);
  }
}

if (apply) {
  for (const rel of [...plan.write, ...plan.seed, ...plan.reseed]) {
    const from = scaffoldMeta[rel] ? join(scaffoldDir, rel) : join(buildDir, rel);
    const dst = join(repoDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(from));
  }
  for (const rel of plan.scaffold) {
    const dst = join(repoDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(join(scaffoldDir, rel)));
  }
  for (const rel of plan.delete) rmSync(join(repoDir, rel), { force: true });
  writeFileSync(
    join(repoDir, MANIFEST_FILE),
    JSON.stringify({ ...newManifest, files: { ...newManifest.files, ...scaffoldMeta } }, null, 2) + '\n'
  );
}

// Global Won settings that a store does not have yet.
//
// config/settings_data.json is owner:merchant — seeded only when absent, because the
// theme editor writes it back. Correct, and it has a hole: a global setting the theme
// adds LATER never reaches a store that already has the file, and a schema `default`
// only applies to keys MISSING from the file the storefront reads. Every won_* global
// shipped since the first publish was therefore invisible on existing stores — the
// unit-price rules would have switched unit prices off everywhere.
//
// So: add the won globals the store does not have, with the default the schema
// declares, and never touch a value that is already there. Runs last on purpose —
// after a --reseed-demo rewrite, which already brings the full build defaults.
const settingsRel = 'config/settings_data.json';
const settingsDst = join(repoDir, settingsRel);
const schemaSrc = join(buildDir, 'config', 'settings_schema.json');
const globalsAdded = [];
let globalsSkipped = null;
if (existsSync(settingsDst) && existsSync(schemaSrc)) {
  const declared = {};
  for (const group of JSON.parse(readFileSync(schemaSrc, 'utf8'))) {
    for (const s of group?.settings ?? []) {
      if (typeof s?.id === 'string' && s.id.startsWith('won_') && s.default !== undefined) declared[s.id] = s.default;
    }
  }
  // Horizon prefixes this file with a comment block; JSON starts at the first brace.
  const raw = readFileSync(settingsDst, 'utf8');
  const at = raw.indexOf('{');
  if (at < 0) {
    globalsSkipped = `${settingsRel} has no JSON body`;
  } else {
    const head = raw.slice(0, at);
    const data = JSON.parse(raw.slice(at));
    // `current` is an object in Horizon; a theme using a named preset string has no
    // per-key values to extend, so leave it alone rather than guess.
    if (!data.current || typeof data.current !== 'object' || Array.isArray(data.current)) {
      globalsSkipped = `${settingsRel} "current" is not a settings object`;
    } else {
      for (const [id, value] of Object.entries(declared)) {
        if (id in data.current) continue;
        data.current[id] = value;
        globalsAdded.push(id);
      }
      if (globalsAdded.length && apply) {
        writeFileSync(settingsDst, head + JSON.stringify(data, null, 2) + '\n');
      }
    }
  }
}

const line = (label, arr) => console.log(`  ${label.padEnd(28)} ${arr.length}`);
console.log(`\n${apply ? 'PUBLISH' : 'DRY RUN'}  ${relative(process.cwd(), buildDir)} -> ${relative(process.cwd(), repoDir)}  (base: ${newManifest.base}, demo overlay: ${newManifest.demoOverlay})`);
line('write (compose-owned)', plan.write);
line('delete (left the build)', plan.delete);
line('seed (merchant, missing)', plan.seed);
line('reseed (demo, untouched)', plan.reseed);
line('keep (merchant, theirs)', plan.keepMerchant);
console.log(`  ${'locale merge (additive)'.padEnd(28)} ${localeDetail.length} file(s), +${localeAdded} keys`);
console.log(`  ${'won globals (additive)'.padEnd(28)} +${globalsAdded.length} keys`);
line('scaffold (AGENTS.md et al.)', plan.scaffold);
line('client-only (untouched)', plan.clientOnly);
line('CONFLICT (edited in repo)', plan.conflict);

if (plan.reseed.length) console.log('\n  reseeding demo data (still identical to the last publish):\n' + plan.reseed.map((r) => `    ~ ${r}`).join('\n'));
if (!reseedDemo && plan.keepMerchant.length) {
  console.log('\n  merchant-owned files kept as they are in the repo. If this is the GENERIC');
  console.log('  upstream and its demo data should follow the build, re-run with --reseed-demo.');
}
if (localeDetail.length) console.log('\n  locales: ' + localeDetail.join(', '));
if (globalsAdded.length) console.log('\n  won globals added to ' + settingsRel + ' (merchant values untouched):\n' + globalsAdded.map((k) => `    + ${k}`).join('\n'));
if (globalsSkipped) console.log(`\n  won globals NOT reconciled: ${globalsSkipped}`);
if (plan.delete.length) console.log('\n  deleting:\n' + plan.delete.map((r) => `    - ${r}`).join('\n'));
if (plan.conflict.length) {
  console.log('\n  CONFLICT — these compose-owned files were edited inside the deploy repo:');
  for (const c of plan.conflict) console.log(`    ! ${c.rel}  [layer: ${c.layer}]`);
  console.log('  They were NOT overwritten. In a client repo this is what promote.mjs is for:');
  console.log('    node themes/build/promote.mjs --repo <repo>');
}
if (!apply) console.log('\nNothing was written. Re-run with --apply to publish.');
console.log('');
process.exit(plan.conflict.length && apply ? 2 : 0);
