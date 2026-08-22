// layers.mjs — the single source of truth for "who owns this file, and which
// layer does it belong to". Shared by compose.mjs (manifest emission),
// publish.mjs (may I overwrite it?) and promote.mjs (where does an edit go?).
//
// Two orthogonal questions, two fields:
//
//   owner  — who writes the file in a DEPLOY repo (won-theme-generic / -<client>)
//            'compose'  : the build owns it; Shopify writing here is a conflict
//            'merchant' : the theme editor owns it; the build must never touch it
//            'mixed'    : both — storefront locale files (compose deep-merges won
//                         fragments into them, and the Shopify Language Editor
//                         writes merchant translations back). Additive merge only.
//
//   layer  — where an edit made in a client repo belongs
//            'won'    : Won IP -> promotes to themes/won-base/<path> via a 3-way merge
//            'vendor' : pristine base theme -> never promoted (an override kills
//                       portability to track B / Skeleton)
//            'data'   : merchant data -> stays with the client
//            'locale' : a base locale file that compose deep-merges won fragments
//                       into. NOT patchable — the deploy-repo file is base+fragment,
//                       the source is fragment only. Promotion is key-level: leaves
//                       under a namespace the fragment owns move into the fragment,
//                       everything else is a vendor/merchant string and is refused.
//
// Verified against shopify.dev 2026-08-22:
//  - Storefront locale files (`locales/*.json`, no `.schema`) ARE merchant-editable
//    through the Shopify Language Editor, and every admin edit to theme code is
//    committed back by the GitHub integration ("Files are updated in GitHub whenever
//    changes are made to a connected theme. This can't be disabled."). Hence 'mixed'.
//    Schema locale files (`*.schema.json`) drive the theme EDITOR only — not merchant
//    content — so they stay compose-owned.
//  - Root-level non-theme files are safe: "Folders in the repository that don't match
//    the default theme structure are ignored." The pristine Horizon base itself ships
//    LICENSE.md / README.md / release-notes.md at the root, so `.won-manifest.json`
//    sits in proven company.

export const MANIFEST_FILE = '.won-manifest.json';

/** Top-level directories Shopify recognises. Anything else is ignored by the platform. */
export const THEME_DIRS = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'];

/** Paths the theme editor writes — the build must never overwrite them in a deploy repo. */
export function isMerchantPath(rel) {
  const p = rel.replace(/\\/g, '/');
  if (p === 'config/settings_data.json') return true;
  if (/^templates\/.+\.json$/.test(p)) return true;          // templates/**/*.json, incl. customers/, metaobject/
  if (/^sections\/[^/]+-group\.json$/.test(p)) return true;  // header-group, footer-group, …
  return false;
}

/** Storefront locale files: merchant-editable AND deep-merged by compose step 3. */
export function isStorefrontLocale(rel) {
  const p = rel.replace(/\\/g, '/');
  return /^locales\/[^/]+\.json$/.test(p) && !p.endsWith('.schema.json');
}

/** Any locale file — storefront or schema. Both are base files compose merges into. */
export function isLocale(rel) {
  return /^locales\/[^/]+\.json$/.test(rel.replace(/\\/g, '/'));
}

/**
 * Classify one theme-relative path.
 * @param {string} rel               path relative to the theme root, e.g. 'sections/won-hero.liquid'
 * @param {Set<string>} wonBaseFiles theme-relative paths that exist in themes/won-base/**
 */
export function classify(rel, wonBaseFiles) {
  const p = rel.replace(/\\/g, '/');
  if (isMerchantPath(p)) return { owner: 'merchant', layer: 'data' };
  // Locale files are checked BEFORE the won-base lookup: themes/won-base/locales/*
  // are fragments that get merged into the base file, not whole-file replacements,
  // so they are never a plain 'won' patch target.
  if (isLocale(p)) return { owner: isStorefrontLocale(p) ? 'mixed' : 'compose', layer: 'locale' };
  if (wonBaseFiles.has(p)) return { owner: 'compose', layer: 'won' };
  return { owner: 'compose', layer: 'vendor' };
}
