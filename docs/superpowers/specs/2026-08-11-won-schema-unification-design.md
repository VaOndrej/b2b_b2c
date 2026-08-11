# Won- schema unification — one editor language for every won- section & block

Date: 2026-08-11
Status: Approved (user waived spec-review gate, autonomous execution)

## Problem

The won- theme surface (~30 sections + 14 blocks) grew organically. In the
Shopify theme editor each component orders its settings differently and names
its groups inconsistently: text lives under `t:won.headers.heading` in some
files and `t:won.headers.content` in others; the behavior-defining select
(carousel ↔ grid ↔ marquee) is buried mid-schema; there is no way to hide a
section on mobile or desktop. A merchant editing two won- sections has to
re-learn the layout each time.

Goal: **one predictable editor language**. Every won- component presents its
settings in the same order, under the same bold group headers, so a merchant
learns it once.

## Doctrine — canonical order

Every won- section and block emits settings in this fixed order. Groups that do
not apply to a given component are simply omitted (a block with no mode has no
"Mode" header).

| # | Header key | Group | Contents |
|---|------------|-------|----------|
| — | *(paragraph)* | About | short "what this block does" line (keep existing) |
| 1 | `won.headers.visibility` | **Visibility** | `show_on_mobile`, `show_on_desktop` (both default `true`) — sections only, where sensible |
| 2 | `won.headers.mode` | **Mode** | the behavior-defining select (layout/display mode) — only components that have one |
| 3 | `won.headers.content` | **Content** | data source (collection) + **all** text/richtext/link fields **and** their immediate typographic controls (heading size, max width) |
| 4 | `won.headers.layout` | **Layout** | columns, gap, aspect, item arrangement |
| 5 | `won.headers.controls` | **Controls** | arrows, dots, progress, autoplay — interactive components only |
| 6 | `won.headers.appearance` | **Appearance** | color scheme, section width, accent override |
| 7 | `won.headers.spacing` | **Spacing** | padding top / bottom (always last) |

### Decisions locked during brainstorming
- **Heading size stays with heading text** under Content (not Layout). Everything
  "about the heading" stays together, matching today's won-carousel.
- **Visibility is functional, not cosmetic.** It renders through a shared CSS
  utility and genuinely hides the section at the target breakpoint.
- **Visibility only where it makes sense.** Skip chrome / PDP-functional
  sections: `won-footer`, `won-announcement-bar`, `won-page-header`,
  `won-app-slot`, `won-sticky-atc`, `won-variant-picker`.
- **Mode select is hoisted** directly under Visibility because it changes what
  every setting below it means.
- **Blocks inherit their section's visibility** — blocks get no visibility group.
- **Legacy header keys are migrated**, not duplicated: `heading` → `content`,
  `source` folds into `content`, `padding` → `spacing`. Keep `media` where a
  component genuinely has a distinct media sub-group.

## Mechanics

### Visibility rendering — CORRECTION (use what already exists)
The device toggles were **already implemented**: `compose.mjs` step 2d injects a
shared style-control fragment (`themes/build/won-style-controls.json`) into all
26 won sections, including `hide_mobile` / `hide_desktop` checkboxes, wired via
`snippets/won-style-vars.liquid` (`--won-d-m: none` / `--won-d-d: none`) and
`assets/won-tokens.css` (`.won-section { display: var(--won-d-m, block) }` at
≤749px, `var(--won-d-d, block)` at ≥750px). They just sat at the BOTTOM inside
the Appearance block.

So the unification does **not** add a new visibility system. It **relocates the
existing controls to the top**:
- `compose.mjs`: lift `hide_mobile` / `hide_desktop` out of the appended
  Appearance block and prepend them under a `t:won.headers.visibility` header
  (after a leading About paragraph if present).
- The shared "Padding" header is renamed to `t:won.headers.spacing`; both keys
  are in `removeHeaders` so any section-authored padding/spacing header is
  deduped and replaced by the single shared Spacing group.
- No `won-visibility` snippet, no `show_on_*` settings, no `.won-hide-*` CSS —
  those were an initial wrong turn and were reverted.

### Infinite scroll (won-carousel) — expose dormant feature
`won-carousel.js` already supports an endless rail via a `data-won-loop`
attribute (`always | desktop | mobile`) that clones bookend slides, but the
section never emitted it and the schema never exposed it. Added a `loop` select
to the carousel Controls group (Off / On / Desktop only / Mobile only) and emit
`data-won-loop="{{ s.loop }}"` when `layout == 'slider'` and `loop != blank`.

### Source of truth & build
- **Edit `themes/won-base` only.** `themes/build/compose.mjs` rebuilds
  `themes/dist/horizon-dev` from the pristine base (`rm -rf` dist). Never
  hand-edit dist; recompose to regenerate it (W5).

### Locale keys
- `themes/won-base/locales/en.default.schema.json` and `cs.schema.json` gain the
  canonical header keys under `won.headers`: `visibility`, `mode`, `content`,
  `layout`, `controls`, `appearance`, `spacing`, plus new setting labels/info
  for `show_on_mobile`, `show_on_desktop`. Retire orphaned `heading`/`source`/
  `padding` header keys once no schema references them.

## Rollout (waves — one spec, staged for reviewability)

1. **W1 Foundation** — `won-visibility` snippet, CSS utilities, canonical locale
   header keys + visibility setting strings (cs + en).
2. **W2 Mode sections** — `won-carousel`, `won-grid`, `won-marquee`,
   `won-tabbed-rail`, `won-band`: hoist mode select, merge texts into Content,
   add visibility.
3. **W3 Content sections** — `won-hero`, `won-hero-carousel`, `won-hero-grid`,
   `won-features`, `won-stats`, `won-comparison`, `won-newsletter`,
   `won-collection`, `won-collection-tiles`, `won-articles`, `won-panels`,
   `won-shoppable-image`, `won-media-compare`, `won-contact`, `won-accordion`,
   `won-tabs`. (Skip-list sections get reorder but no visibility.)
4. **W4 Blocks** — all 14 won- blocks reordered to canonical order (no
   visibility group; blocks inherit the section).
5. **W5 Recompose + gates** — run `compose.mjs`; `won-settings-coverage.spec.ts`
   (no dead controls); visual QA.

## Testing / acceptance

- **Static:** `validate_theme` (Shopify MCP) clean; existing
  `tests/smoke/won-settings-coverage.spec.ts` still green (271+ settings, 0 dead
  — every new toggle/select must have a visible effect).
- **Structural (Playwright, new permanent test `won-unified-schema.spec.ts`):**
  reads composed dist; asserts canonical header order, Visibility-first,
  Mode-select-always-visible, and hide_mobile/hide_desktop only under Visibility.
- **Behavioural (Playwright, new permanent test `won-unified-behavior.spec.ts`,
  needs `shopify theme dev`):**
  - `--won-d-m:none` hides the section at ≤749px and NOT at ≥750px (and inverse
    for `--won-d-d`), asserted on both project viewports.
  - Mode select drives a `won-carousel--<mode>` render class.
  - `data-won-loop` clones bookend slides only on the viewport its scope covers.

## Non-goals
- No new visual features beyond visibility. No preset changes. No renaming of
  merchant-visible field *values*. No refactor of section render internals
  beyond adding the visibility class and reordering the schema block.
