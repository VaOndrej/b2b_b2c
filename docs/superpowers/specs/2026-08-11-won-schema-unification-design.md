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

### Visibility rendering
- New snippet `themes/won-base/snippets/won-visibility.liquid`, mirroring the
  existing `won-spacing.liquid` pattern. Emits a class fragment:
  `won-hide-mobile` when `settings.show_on_mobile == false`,
  `won-hide-desktop` when `settings.show_on_desktop == false`.
  Absent/blank settings are treated as visible (backward compatible).
- Utility classes added to `themes/won-base/assets/won-tokens.css`:
  ```css
  @media (max-width: 749px)  { .won-hide-mobile  { display: none !important; } }
  @media (min-width: 750px)  { .won-hide-desktop { display: none !important; } }
  ```
  (750px = Horizon's mobile/desktop breakpoint; confirm against tokens.)
- Wired into each qualifying section's root element:
  `class="won-section color-{{ s.color_scheme }} {% render 'won-visibility', settings: s %}"`.

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
- **Functional (Playwright, new permanent tests):**
  - `show_on_mobile=false` → section is `display:none` at ≤749px, visible ≥750px.
  - `show_on_desktop=false` → inverse.
  - Mode select genuinely changes rendered layout (carousel vs grid vs marquee
    DOM/class differs).
  - Added to the smoke suite under `tests/smoke/` so future changes re-verify
    real behavior, not just static render.

## Non-goals
- No new visual features beyond visibility. No preset changes. No renaming of
  merchant-visible field *values*. No refactor of section render internals
  beyond adding the visibility class and reordering the schema block.
