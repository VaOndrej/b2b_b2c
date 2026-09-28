# Won visual QA catalogue

This reusable **dev-only** catalogue inventories all 21 active Won sections, all
20 theme blocks, every named section preset, and meaningful visual/layout variants.
Six deprecated sections without presets are recorded but excluded. All blocks remain
active, including the legacy accordion row and tab.

Run from the repository root:

```sh
node themes/won-base/examples/qa/generate.mjs
node themes/build/compose.mjs horizon
shopify theme dev -e horizon
```

Use the configured `b2b-b2c-store-development.myshopify.com` store only. Open URLs
listed in `manifest.json` through `http://127.0.0.1:9292`. Alternative `?view=`
templates do not assign templates to products/pages, update catalog data or publish
a live theme. The generator only writes the new `*won-qa*.json` names in the demo
source layer. Keep these files for reproduction; never edit the dist output.

The manifest contains case id, component, variant, actual context, URL, section id,
selector and content limitations. QA headings live only in these fixture templates.
Content pages have at most 24 sections; PDP fixtures preserve the native demo main
section. Sticky bars and standalone Won variant pickers each have their own PDP to
avoid multiple floating controls. The additional editorial PDP starts from the
existing optional source composition and adds real demo media and longer content.

Representative images are existing Shopify Files selected from dev product data.
Manual review copy is labelled illustrative and ratings are zero; QA disclosure,
nutrition and dosage schemas are disabled. No demonstration rating is added to
product AggregateRating. A public YouTube URL is an external sample, not store video
content. Hosted video, actual app content and absent metafield data require explicit
report limitations; an empty shell never counts as successful visual coverage.
Blog cases require existing `news` articles. Explicit missing-image cases are
separate from populated image cases.

The generator normalizes the existing preset value `won-slide.card_style: plain`
to the declared schema value `minimal`; this is a QA configuration correction, not
a production component fix. Shared section styling is injected by compose; the
catalogue deliberately avoids a Cartesian product of colors, padding and typography.

`manifest.json` is an inventory and a list of fixtures, **not a record of passing
checks**. Evidence must be recorded separately after rendering each case at 390,
768 and 1440 px, inspecting the screenshots and exercising relevant controls.
Use the repository Playwright harness and shared responsive/carousel invariants.

## Capture and review

```sh
WON_CATALOG_QA=1 npm run test:smoke -- --grep 'QA catalogue' --project=desktop --reporter=line
WON_CATALOG_QA=1 npm run test:smoke -- --grep 'QA verified fixes' --project=desktop --reporter=line
WON_EDITORIAL_QA=1 npm run test:smoke -- --reporter=line
```

The collector uses all three widths itself. For focused recapture set
`WON_QA_IDS=qa128,qa158` and optionally `WON_QA_WIDTHS=390,768,1440`.
It records identity, HTTP status, per-case checks, images, console/page errors and
failed asset requests. It captures the expanded keyboard disclosure state too.
The global sticky header is hidden only during component screenshots to prevent
capture overlap. Device-scoped sticky bars are asserted hidden on excluded widths.

Current evidence is in `tmp/theme-audit-runs/2026-09-10-catalog/` and the
[2026-09-10 audit](../../../../docs/audits/2026-09-10-won-visual-audit.md).
**A green collector only means collection completed.** Check per-case JSON,
visually inspect each screenshot, and record the review before assigning a verdict.
Before a filtered recapture, archive the previous per-page JSON: the collector
replaces that page/width file with the selected cases. The final audit merges
`before-fixes`, `after-recapture` and current files in that order.
