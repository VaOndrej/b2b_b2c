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
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { classify, MANIFEST_FILE } from './layers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const themesRoot = resolve(here, '..');

// Args: <base> [--no-demo] [--out <dir>]
//   --no-demo  skip step 4 (the curated demo merchant data). Required for the
//              generic/deploy build: merchant data belongs to each client store,
//              not to the shared template.
//   --out      write somewhere other than themes/dist/<base>-dev.
const argv = process.argv.slice(2);
const flags = new Set();
const positional = [];
let outOverride = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') {
    outOverride = argv[++i];
    if (!outOverride) { console.error('--out needs a directory'); process.exit(1); }
  } else if (a.startsWith('--')) {
    flags.add(a);
  } else {
    positional.push(a);
  }
}
const target = positional[0] || 'horizon';
const applyDemo = !flags.has('--no-demo');
const baseDir = join(themesRoot, 'bases', target);
const wonBase = join(themesRoot, 'won-base');
const finalDir = outOverride ? resolve(process.cwd(), outOverride) : join(themesRoot, 'dist', `${target}-dev`);
// Compose builds into a staging directory and syncs only what actually changed
// into `finalDir` (step 6). Wiping and re-copying the destination gives all ~550
// files a new mtime; `shopify theme dev` watches mtimes, not content, so one
// compose queues ~550 uploads, Shopify answers THROTTLED on `themeFilesUpsert`,
// and the dev server then serves "Failed to Upload Theme Files" until it is
// restarted. Every step below still writes to `outDir` and knows nothing about this.
const outDir = `${finalDir}.staging`;

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
  'product-list',    // -> won-carousel (layout: grid, source: collection)
  'featured-blog-posts', // -> won-grid (source: articles)
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

// 2e. Inject every Won global settings group into the base config/settings_schema.json.
// This is the "advanced" tier: a merchant sets a theme-wide default ONCE (count-up
// duration, return policy, …) and won sections inherit it. Each group is authored as a
// build fragment `won-*-settings.json` in themes/build/ and injected here — same
// build-fragment-into-dist philosophy as 2b/2d; idempotent (skipped if a group of that
// name already exists) and never mutates the pristine base source. Add a new global
// group by dropping another `won-*-settings.json` fragment in — no compose edit needed.
const schemaFile = join(outDir, 'config', 'settings_schema.json');
const globalFragments = readdirSync(join(themesRoot, 'build'))
  .filter((f) => /^won-.*-settings\.json$/.test(f))
  .sort();
if (existsSync(schemaFile)) {
  const schema = readJson(schemaFile);
  if (Array.isArray(schema)) {
    let injected = 0;
    for (const frag of globalFragments) {
      const group = JSON.parse(readFileSync(join(themesRoot, 'build', frag), 'utf8'));
      if (!schema.some((g) => g && g.name === group.name)) {
        schema.push(group);
        injected++;
      }
    }
    if (injected > 0) {
      writeFileSync(schemaFile, JSON.stringify(schema, null, 2) + '\n');
      console.log(`2e: injected ${injected} Won global settings group(s) into ${target} settings_schema.json`);
    }
  } else {
    console.warn('2e: config/settings_schema.json is not an array — Won global groups not injected');
  }
} else {
  console.warn('2e: config/settings_schema.json not found — Won global groups not injected');
}

// 2f. Header search — hand the base header's search slot to won-search.
// HP-004 / SRH-004 want a field a shopper can type into, not a magnifier that
// opens a dialog; Horizon hardcodes `search_style = 'modal'`. Rather than
// shadowing `snippets/search.liquid` (forbidden by convention C7), compose
// re-points the two call sites at `won-search`, which either renders the field
// or renders Horizon's own snippet back. In field mode the modal would be a
// second, redundant search on the page — and would duplicate
// `#predictive-search-results` — so its render in the layout is gated too.
// Idempotent; both anchors must match or the build fails loudly rather than
// silently shipping an icon-only header.
const headerFile = join(outDir, 'sections', 'header.liquid');
if (!existsSync(headerFile)) {
  console.warn('2f: sections/header.liquid not found — header search left as the base has it');
} else {
  let header = readFileSync(headerFile, 'utf8');
  const swaps = [
    [
      "render 'search', style: search_style, class: search_class",
      "render 'won-search', style: search_style, class: search_class, uid: 'desktop'",
    ],
    [
      "render 'search', class: 'desktop:hidden', style: search_style",
      "render 'won-search', class: 'desktop:hidden', style: search_style, uid: 'mobile'",
    ],
  ];
  let swapped = 0;
  for (const [from, to] of swaps) {
    if (header.includes(to)) { swapped++; continue; }
    if (!header.includes(from)) {
      throw new Error(`2f: header.liquid no longer contains "${from}" — the base search wiring moved; re-derive the patch`);
    }
    header = header.replace(from, () => to);
    swapped++;
  }
  writeFileSync(headerFile, header);
  console.log(`2f: routed ${swapped} header search call site(s) through won-search`);

  const layoutSearch = join(outDir, 'layout', 'theme.liquid');
  if (existsSync(layoutSearch)) {
    let l = readFileSync(layoutSearch, 'utf8');
    const modal = "{% render 'search-modal' %}";
    const gated = "{% unless settings.won_header_search_style == 'field' %}{% render 'search-modal' %}{% endunless %}";
    if (!l.includes(gated)) {
      if (!l.includes(modal)) {
        throw new Error('2f: layout/theme.liquid no longer renders search-modal — re-derive the gate');
      }
      l = l.replace(modal, () => gated);
      writeFileSync(layoutSearch, l);
    }
  }
}

// 2g. Search results — same card as every other listing.
// `sections/search-results.liquid` renders Horizon's own tile
// (`content_for 'block', type: '_product-card'`), while collections go through
// won-collection -> won-product-card. That leaves the shopper who typed a product
// name — the one with the clearest intent — on the poorest card: no rating, no
// price per unit, no add without a page load. Only the tile is swapped; Horizon
// keeps filters, pagination and infinite scroll, and `ref="cards[]"` on the <li>
// (which results-list.js counts) is untouched.
const searchResultsFile = join(outDir, 'sections', 'search-results.liquid');
if (!existsSync(searchResultsFile)) {
  console.warn('2g: sections/search-results.liquid not found — search keeps the base card');
} else {
  let sr = readFileSync(searchResultsFile, 'utf8');
  const nativeCard = "{% content_for 'block', type: '_product-card', id: 'product-card', closest.product: product %}";
  const wonCard = "{% render 'won-product-card', product: product, aspect: 'portrait', show_ppu: true %}";
  if (!sr.includes(wonCard)) {
    if (!sr.includes(nativeCard)) {
      throw new Error('2g: search-results.liquid no longer renders the _product-card block — re-derive the swap');
    }
    sr = sr.replace(nativeCard, () => wonCard);
    writeFileSync(searchResultsFile, sr);
    console.log('2g: search results now render won-product-card');
  }
}

// 2h. One search box per page. `sections/search-header.liquid` renders the
// `_search-input` block statically, so with a field already in the sticky header
// the search page paints two identical boxes 150px apart — on the one page where
// the shopper is already hunting. Gated on the same setting as the modal: in
// `icon` mode the page field is the only way to search and must stay.
const searchHeaderFile = join(outDir, 'sections', 'search-header.liquid');
if (!existsSync(searchHeaderFile)) {
  console.warn('2h: sections/search-header.liquid not found — search page keeps its own field');
} else {
  let sh = readFileSync(searchHeaderFile, 'utf8');
  const pageField = "{% content_for 'block', id: 'search', type: '_search-input' %}";
  const gatedField =
    "{% unless settings.won_header_search_style == 'field' %}" + pageField + '{% endunless %}';
  if (!sh.includes(gatedField)) {
    if (!sh.includes(pageField)) {
      throw new Error('2h: search-header.liquid no longer renders the _search-input block — re-derive the gate');
    }
    sh = sh.replace(pageField, () => gatedField);
    writeFileSync(searchHeaderFile, sh);
    console.log('2h: search page field gated behind the icon-only header');
  }
}

// 2i. Every search form must ask for partial words. Storefront `/search` matches
// whole tokens unless `options[prefix]=last` is in the query, and
// `assets/search-page-input.js` only handles Escape — Enter is a plain native
// submit. Without this the page field answers "krea" with nothing while the
// header field finds Kreatin: same query, same shop, two answers.
const searchInputBlock = join(outDir, 'blocks', '_search-input.liquid');
if (!existsSync(searchInputBlock)) {
  console.warn('2i: blocks/_search-input.liquid not found — page search keeps whole-token matching');
} else {
  let si = readFileSync(searchInputBlock, 'utf8');
  const typeInput = '      name="type"\n      value="product"\n      type="hidden"\n    >';
  const withPrefix = typeInput + '\n    <input\n      name="options[prefix]"\n      value="last"\n      type="hidden"\n    >';
  if (!si.includes('options[prefix]')) {
    if (!si.includes(typeInput)) {
      throw new Error('2i: _search-input.liquid no longer carries the hidden type input — re-derive the patch');
    }
    si = si.replace(typeInput, () => withPrefix);
    writeFileSync(searchInputBlock, si);
    console.log('2i: page search form now asks for partial-word matching');
  }
}

// 2b. Wire the shared won token/utility stylesheet into the base layout <head>.
// won-tokens.css holds the global :root design tokens and shared classes
// (.won-container, .won-section, .won-heading, .won-btn) that every won section
// depends on. Per Shopify guidance, global utility CSS is loaded once via
// stylesheet_tag in the layout. won-base source never edits vendor files, so this
// integration happens here at compose time. Idempotent; targets both bases.
const wonHead = [
  "{{ 'won-tokens.css' | asset_url | stylesheet_tag }}",
  "{{ 'won-toast.css' | asset_url | stylesheet_tag }}",
  "<script src=\"{{ 'won-cart.js' | asset_url }}\" defer></script>",
  "<script src=\"{{ 'won-toast.js' | asset_url }}\" defer></script>",
  "{% render 'won-site-schema' %}",
].join('\n  ');
const layoutFile = join(outDir, 'layout', 'theme.liquid');
if (existsSync(layoutFile)) {
  let layout = readFileSync(layoutFile, 'utf8');
  if (!layout.includes('won-tokens.css')) {
    layout = layout.replace(/<\/head>/i, `  ${wonHead}\n  </head>`);
  }
  // The toast region is fixed-positioned but still has to live in the body, and
  // it belongs to the layout rather than to a section: `sections/header-group.json`
  // is owner: merchant / layer: data, so publish never rewrites it — a toast added
  // there would never reach an existing storefront, and a merchant could delete it
  // by accident. The snippet renders nothing when toasts are switched off, so the
  // unconditional render costs an off storefront one no-op include.
  if (!layout.includes('won-toast-config')) {
    layout = layout.replace(/<\/body>/i, `  {% render 'won-toast-config' %}\n  </body>`);
  }
  writeFileSync(layoutFile, layout);
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
if (applyDemo && existsSync(demoDir)) {
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

// 5. Manifest — the ownership/layer classification of every file in the build,
// shipped INSIDE the build so a deploy repo carries it and publish/promote only
// have to read it (no archaeology, no diff reading). Root dotfile: Shopify ignores
// anything outside the eight theme directories, and the pristine base itself ships
// LICENSE.md / README.md / release-notes.md at the root.
const wonBaseFiles = new Set();
{
  const walkRel = (root, rel = '.') => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs)) {
      const childRel = rel === '.' ? entry : `${rel}/${entry}`;
      if (statSync(join(abs, entry)).isDirectory()) walkRel(root, childRel);
      else wonBaseFiles.add(childRel);
    }
  };
  walkRel(wonBase);
}
const manifestFiles = {};
{
  const walkOut = (rel = '.') => {
    const abs = join(outDir, rel);
    for (const entry of readdirSync(abs)) {
      if (entry === MANIFEST_FILE || entry === '.git') continue;
      const childRel = rel === '.' ? entry : `${rel}/${entry}`;
      if (statSync(join(abs, entry)).isDirectory()) walkOut(childRel);
      else {
        manifestFiles[childRel] = {
          ...classify(childRel, wonBaseFiles),
          // Hash of what compose produced. publish.mjs compares it against the
          // deploy repo to tell "not published yet" apart from "somebody edited a
          // compose-owned file in the repo" — the second is a conflict in the
          // generic repo and a promotion candidate in a client repo.
          sha: createHash('sha256').update(readFileSync(join(abs, entry))).digest('hex').slice(0, 16),
        };
      }
    }
  };
  walkOut();
}
writeFileSync(
  join(outDir, MANIFEST_FILE),
  JSON.stringify(
    {
      // Generated by themes/build/compose.mjs — do not hand-edit.
      base: target,
      demoOverlay: applyDemo,
      wonBaseFileCount: wonBaseFiles.size,
      files: Object.fromEntries(Object.keys(manifestFiles).sort().map((k) => [k, manifestFiles[k]])),
    },
    null,
    2
  ) + '\n'
);
const layerCounts = {};
for (const v of Object.values(manifestFiles)) layerCounts[v.layer] = (layerCounts[v.layer] || 0) + 1;

// 6. Sync staging -> destination, writing only the files that actually differ.
// Preserving the mtime of an unchanged file is the whole point: see the note on
// `outDir` above, and tests/smoke/won-compose-idempotence.spec.ts.
function syncTree(from, to) {
  let written = 0;
  let removed = 0;
  const wanted = new Set();

  const copyInto = (rel) => {
    const srcDir = rel ? join(from, rel) : from;
    for (const entry of readdirSync(srcDir)) {
      const childRel = rel ? join(rel, entry) : entry;
      const src = join(from, childRel);
      const dest = join(to, childRel);
      if (statSync(src).isDirectory()) {
        mkdirSync(dest, { recursive: true });
        copyInto(childRel);
        continue;
      }
      wanted.add(childRel);
      const next = readFileSync(src);
      if (existsSync(dest)) {
        const current = readFileSync(dest);
        if (current.equals(next)) continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, next);
      written++;
    }
  };

  const prune = (rel) => {
    const dir = rel ? join(to, rel) : to;
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const childRel = rel ? join(rel, entry) : entry;
      const abs = join(to, childRel);
      if (statSync(abs).isDirectory()) {
        prune(childRel);
        if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true, force: true });
        continue;
      }
      if (!wanted.has(childRel)) {
        rmSync(abs, { force: true });
        removed++;
      }
    }
  };

  mkdirSync(to, { recursive: true });
  copyInto('');
  prune('');
  return { written, removed };
}

const synced = syncTree(outDir, finalDir);
rmSync(outDir, { recursive: true, force: true });

console.log(`composed ${target}: ${overlaid} code files overlaid, ${prunedNative} native duplicate sections hidden from picker, ${styledSections} sections given the shared style controls, ${mergedLocales} locale files merged, ${demoFiles} demo data files applied -> ${finalDir}`);
console.log(`sync: ${synced.written} file(s) written, ${synced.removed} removed (unchanged files keep their mtime, so the dev server does not re-upload them)`);
console.log(`manifest: ${Object.keys(manifestFiles).length} files classified (${Object.entries(layerCounts).sort().map(([k, v]) => `${k} ${v}`).join(', ')}) -> ${MANIFEST_FILE}`);
