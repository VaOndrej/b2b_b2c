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

// 2c. De-clutter the "Add section" picker (task: generic-theme non-won sections).
// Native base sections that duplicate a Won equivalent are hidden by stripping
// their `presets` — the SAME mechanism the repo uses to deprecate legacy won-*
// sections (theme-map): the file still renders wherever it is already referenced
// (page mains, existing templates), it just no longer appears in "Add section",
// so a merchant picks the Won version instead of choosing between two near-
// identical heroes. Centralised here (not per-section overlays) so it stays
// upgrade-safe and reversible — edit the list, re-compose. Operates on dist only.
const HIDE_NATIVE_SECTIONS = [
  'hero',            // -> won-hero
  'carousel',        // -> won-carousel
  'marquee',         // -> won-marquee
  'slideshow',       // -> won-hero-carousel
  'layered-slideshow', // -> won-hero-carousel / won-hero-grid
  'media-with-content', // -> won-band
  'collection-list', // -> won-collection / won-collection-tiles
  'collection-links', // -> won-collection-tiles
];
let prunedNative = 0;
for (const name of HIDE_NATIVE_SECTIONS) {
  const file = join(outDir, 'sections', `${name}.liquid`);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  const m = src.match(/(\{%-?\s*schema\s*-?%\})([\s\S]*?)(\{%-?\s*endschema\s*-?%\})/);
  if (!m) { console.warn(`2c: ${name}.liquid has no schema block — left in picker`); continue; }
  let obj;
  try { obj = JSON.parse(m[2]); } catch { console.warn(`2c: ${name}.liquid schema is not strict JSON — left in picker`); continue; }
  if (!('presets' in obj)) continue;
  delete obj.presets;
  const rebuilt = `${m[1]}\n${JSON.stringify(obj, null, 2)}\n${m[3]}`;
  // Function replacer: `rebuilt` is JSON and may contain `$` sequences a future
  // Horizon upgrade could introduce; a string replacement would mis-interpret
  // them ($&, $1, $$…). A function replacer inserts it literally.
  writeFileSync(file, src.replace(m[0], () => rebuilt));
  prunedNative++;
}

// 2d. Universal Customization Layer (W3-b) — inject the shared Tier-1 style
// controls (themes/build/won-style-controls.json) into each allow-listed won-*
// section, replacing the 26 hand-copied padding/accent settings with one source,
// and swap the section root's `won-spacing` render for the superset
// `won-style-vars`. Same idempotent schema-parse mechanism as 2c; operates on the
// dist copies only (won-base source is never mutated — dist is rebuilt from
// pristine every run). Curated per-section defaults are PRESERVED so an untouched
// section renders identically. Roll Tier 1 out incrementally by widening
// WON_STYLE_SECTIONS: pilot (2-3) -> all 26 (won-sticky-atc is excluded — it is a
// floating widget with its own model and no won-spacing root).
const styleFragment = JSON.parse(readFileSync(join(themesRoot, 'build', 'won-style-controls.json'), 'utf8'));
const WON_STYLE_SECTIONS = [
  // All won-* sections except won-sticky-atc (floating widget, own model, no
  // won-spacing root). A section whose schema isn't strict JSON or lacks a
  // settings array is warned-and-skipped by the loop below (never breaks the build).
  'won-accordion', 'won-announcement-bar', 'won-app-slot', 'won-articles',
  'won-band', 'won-carousel', 'won-collection', 'won-collection-tiles',
  'won-comparison', 'won-contact', 'won-features', 'won-footer', 'won-grid',
  'won-hero', 'won-hero-carousel', 'won-hero-grid', 'won-marquee',
  'won-media-compare', 'won-newsletter', 'won-page-header', 'won-panels',
  'won-shoppable-image', 'won-stats', 'won-tabbed-rail', 'won-tabs',
  'won-variant-picker',
];
let styledSections = 0;
for (const name of WON_STYLE_SECTIONS) {
  const file = join(outDir, 'sections', `${name}.liquid`);
  if (!existsSync(file)) { console.warn(`2d: ${name}.liquid not found — skipped`); continue; }
  let src = readFileSync(file, 'utf8');
  const m = src.match(/(\{%-?\s*schema\s*-?%\})([\s\S]*?)(\{%-?\s*endschema\s*-?%\})/);
  if (!m) { console.warn(`2d: ${name}.liquid has no schema block — skipped`); continue; }
  let obj;
  try { obj = JSON.parse(m[2]); } catch { console.warn(`2d: ${name}.liquid schema is not strict JSON — skipped`); continue; }
  if (!Array.isArray(obj.settings)) { console.warn(`2d: ${name}.liquid schema has no settings array — skipped`); continue; }

  // Capture each section's original setting for the migrated ids, so the shared
  // control keeps its curated look. For range settings we preserve the WHOLE
  // geometry (min/max/step/default) — a compact section (announcement bar,
  // marquee) uses a tighter range + finer step, and forcing the template's
  // step would make its preserved default fall off the grid, which Shopify's
  // upload parser rejects ("default must represent a step in the range").
  const captured = {};
  for (const setting of obj.settings) {
    if (setting && setting.id && styleFragment.preserveDefaultIds.includes(setting.id)) {
      captured[setting.id] = setting;
    }
  }

  // Strip every fragment-owned id and the migrated headers (dedupe, not add-beside).
  const removeIds = new Set(styleFragment.removeIds);
  const removeHeaders = new Set(styleFragment.removeHeaders);
  const hadAppearanceHeader = obj.settings.some(
    (x) => x && x.type === 'header' && x.content === 't:won.headers.appearance'
  );
  obj.settings = obj.settings.filter((x) => {
    if (!x) return false;
    if (x.type === 'header') return !removeHeaders.has(x.content);
    return !removeIds.has(x.id);
  });

  // Append the shared block (Tier 1 appearance + Tier 2 type/motion + Tier 3
  // advanced), applying captured defaults over the template.
  const block = [
    ...styleFragment.tier1,
    ...(styleFragment.tier2 || []),
    ...(styleFragment.tier3 || []),
  ].map((setting) => {
    const orig = setting.id ? captured[setting.id] : undefined;
    if (!orig) return { ...setting };
    const merged = { ...setting };
    if (setting.type === 'range') {
      // Keep the section's curated range geometry.
      for (const k of ['min', 'max', 'step', 'default']) {
        if (k in orig) merged[k] = orig[k];
      }
      // Safety snap: guarantee the default lands on the (min, step) grid within
      // [min, max], whatever combination of template/original values we ended up
      // with — otherwise the theme upload parser rejects the section.
      const min = merged.min ?? 0;
      const step = merged.step || 1;
      const max = merged.max ?? min;
      let d = merged.default ?? min;
      d = min + Math.round((d - min) / step) * step;
      merged.default = Math.min(max, Math.max(min, d));
    } else if ('default' in orig) {
      merged.default = orig.default;
    }
    return merged;
  });
  // Device visibility (hide_mobile/hide_desktop) is authored in the tier1
  // fragment for one source of truth, but the canonical won- editor language
  // puts it at the TOP under a Visibility header (a section-level on/off is the
  // first decision, not an Appearance detail). Lift those two controls out of
  // the appended Appearance block and prepend them as their own group — after a
  // leading About paragraph if the section has one.
  const VIS_IDS = new Set(['hide_mobile', 'hide_desktop']);
  const visControls = block.filter((x) => x && VIS_IDS.has(x.id));
  const appendBlock = block.filter((x) => !(x && VIS_IDS.has(x.id)));
  if (visControls.length) {
    const visGroup = [{ type: 'header', content: 't:won.headers.visibility' }, ...visControls];
    const insertAt = obj.settings[0] && obj.settings[0].type === 'paragraph' ? 1 : 0;
    obj.settings.splice(insertAt, 0, ...visGroup);
  }
  if (!hadAppearanceHeader) {
    appendBlock.unshift({ type: 'header', content: 't:won.headers.appearance' });
  }
  obj.settings.push(...appendBlock);

  const rebuilt = `${m[1]}\n${JSON.stringify(obj, null, 2)}\n${m[3]}`;
  src = src.replace(m[0], () => rebuilt);
  // Swap the root style helper for the superset (won-style-vars reads the same
  // ids plus the new ones). Idempotent; a no-op if a section never used won-spacing.
  src = src.replace(/render 'won-spacing'/g, "render 'won-style-vars'");
  // Wire the merchant coaching layer (won-guard): an editor-only, non-blocking set
  // of soft warnings rendered right after the section root's opening tag. Capture
  // the settings var from the (just-swapped) root style render and reuse it. Injected
  // once; skipped (with a warning) if the root tag can't be matched, so a section is
  // never broken.
  const rootTag = src.match(/render 'won-style-vars', settings: ([\w.]+) %\}"[^>]*>/);
  if (rootTag && !src.includes("render 'won-guard'")) {
    src = src.replace(
      rootTag[0],
      `${rootTag[0]}\n  {% render 'won-guard', settings: ${rootTag[1]} %}`
    );
  } else if (!rootTag) {
    console.warn(`2d: ${name}.liquid root tag not matched — coaching guard not wired`);
  }
  writeFileSync(file, src);
  styledSections++;
}

// 2e. Inject the Won global settings group (theme-wide animation defaults) into
// the base config/settings_schema.json. This is the "advanced" tier: a merchant
// sets the default count-up duration ONCE here, and every won-stats section with
// its own duration left at 0 inherits it (section value != 0 overrides). Same
// build-fragment-into-dist philosophy as 2b/2d; idempotent (skipped if the group
// already exists) and never mutates the pristine base source.
const animFragment = JSON.parse(readFileSync(join(themesRoot, 'build', 'won-animation-settings.json'), 'utf8'));
const schemaFile = join(outDir, 'config', 'settings_schema.json');
if (existsSync(schemaFile)) {
  const schema = readJson(schemaFile);
  if (Array.isArray(schema)) {
    const already = schema.some((g) => g && g.name === animFragment.name);
    if (!already) {
      schema.push(animFragment);
      writeFileSync(schemaFile, JSON.stringify(schema, null, 2) + '\n');
      console.log(`2e: injected Won animation settings group into ${target} settings_schema.json`);
    }
  } else {
    console.warn('2e: config/settings_schema.json is not an array — Won animation group not injected');
  }
} else {
  console.warn('2e: config/settings_schema.json not found — Won animation group not injected');
}

// 2b. Wire the shared won token/utility stylesheet into the base layout <head>.
// won-tokens.css holds the global :root design tokens and shared classes
// (.won-container, .won-section, .won-heading, .won-btn) that every won section
// depends on. Per Shopify guidance, global utility CSS is loaded once via
// stylesheet_tag in the layout. won-base source never edits vendor files, so this
// integration happens here at compose time. Idempotent; targets both bases.
const wonHead = [
  "{{ 'won-tokens.css' | asset_url | stylesheet_tag }}",
  "<script src=\"{{ 'won-cart.js' | asset_url }}\" defer></script>",
].join('\n  ');
const layoutFile = join(outDir, 'layout', 'theme.liquid');
if (existsSync(layoutFile)) {
  let layout = readFileSync(layoutFile, 'utf8');
  if (!layout.includes('won-tokens.css')) {
    layout = layout.replace(/<\/head>/i, `  ${wonHead}\n  </head>`);
    writeFileSync(layoutFile, layout);
  }
} else {
  console.warn('warning: layout/theme.liquid not found; won assets not wired');
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

// 4. Demo overlay (dev only): apply curated merchant data for our demo store —
//    templates/*.json, section groups (header/footer), config/settings_data.json.
//    Real client themes pull this from their live store; for the -dev demo build we
//    keep it reproducible in themes/demo/<base>/ so a fresh compose never wipes the
//    curated homepage/PDP/footer again. Copies over the pristine base data files.
const demoDir = join(themesRoot, 'demo', target);
let demoFiles = 0;
if (existsSync(demoDir)) {
  const walk = (rel) => {
    const abs = join(demoDir, rel);
    for (const entry of readdirSync(abs)) {
      const childRel = join(rel, entry);
      if (statSync(join(abs, entry)).isDirectory()) {
        walk(childRel);
      } else {
        const dest = join(outDir, childRel);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(join(demoDir, childRel), dest);
        demoFiles++;
      }
    }
  };
  walk('.');
}

console.log(`composed ${target}: ${overlaid} code files overlaid, ${prunedNative} native duplicate sections hidden from picker, ${styledSections} sections given the shared style controls, ${mergedLocales} locale files merged, ${demoFiles} demo data files applied -> ${outDir}`);
