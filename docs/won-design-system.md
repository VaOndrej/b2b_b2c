# Won Design System — Theme Sections

**The shared visual language for the Won generic Shopify theme.** Every
storefront `won-*` section is a consumer of one contract: the `won-tokens` CSS
layer (`themes/won-base/assets/won-tokens.css`). This document is the canonical
reference for that contract and for the section inventory built on top of it. It
is the theme-side parallel to the app-side [Won App Design Doctrine](won-app-design-doctrine.md).

> **How to use.** Before adding or changing a `won-*` section, read the
> [`won-tokens` contract](#the-won-tokens-contract) and the
> [design rules](#design-rules-for-adding-or-modifying-a-section). Consume
> tokens; never hardcode a colour, radius, or spacing value that a token already
> owns. When a rule here overlaps app-side doctrine (tokens-as-shared-render-
> layer, help-on-every-setting), cite it the same way apps do (`doctrine A1`).

## What this doc is (and is not)

- **This doc** = the *design system*: the token contract, the logical grouping
  of sections, and the rules for building a section that belongs to the set.
- **[theme-blocks-catalog.html](theme-blocks-catalog.html)** = the *catalog*:
  every block laid out **per storefront page** (Home / PDP / PLP / Cart / Blog /
  Finder / Account), with the universal breakpoint + config contract. It answers
  "what goes on this page?"; this doc answers "what is the section, and what
  visual language must it speak?" The two are complementary — do not duplicate
  the catalog's per-page walk-through here; link to it.
- **[Won App Design Doctrine](won-app-design-doctrine.md)** = the *app* rules
  (`§1`–`§8`, `A1`–`A5`) for merchant-facing admin surfaces. The theme borrows
  its cross-cutting ideas — one shared render layer reading `--won-*` tokens
  (`A1`), locale-as-data (`A5`) — but the theme's runtime is Liquid + the
  storefront, not the Polaris admin.

---

## The `won-tokens` contract

`won-tokens.css` is **self-contained and base-agnostic**. Colours defer to the
active Shopify colour scheme (`var(--color-*)`) with neutral fallbacks, so the
same section renders on Horizon, Skeleton, or bare Liquid alike. Every section
must read these tokens rather than inventing its own values — this is the theme
expression of doctrine **A1** (one shared visual language, no per-surface forks).

### Layout — container & gutter

| Token | Value | Controls |
| --- | --- | --- |
| `--won-container-wide` | `1320px` | Max width of a standard section (`.won-container`) |
| `--won-container-narrow` | `760px` | Reading-width sections — newsletter, prose (`.won-container--narrow`) |
| `--won-gutter` | `clamp(16px, 4vw, 48px)` | Page side margin; container width is computed against it |

Helpers: `.won-container`, `.won-container--narrow`, `.won-container--full`
(edge-to-edge, e.g. full-bleed hero).

### Spacing — one fluid scale

`--won-space-1` … `--won-space-7`, each a `clamp()` that grows with the viewport
(`4px→6px` up to `48px→96px`). All internal gaps, padding, and stacking use this
scale — never a raw `px` gap. Section block-padding is driven by `--won-pt` /
`--won-pb` (per-section settings) scaled by `--won-pad-scale` (0.7 on mobile,
1 on desktop ≥990px) inside `.won-section`.

### Radii — corner-radius everywhere

| Token | Value | Typical use |
| --- | --- | --- |
| `--won-radius-sm` | `8px` | Media wells, product-card images |
| `--won-radius-md` | `14px` | Cards, hero peek slides |
| `--won-radius-lg` | `22px` | Large feature panels |
| `--won-radius-pill` | `999px` | Buttons, badges, arrows, progress bars |

**Hard rule (repo convention):** every rounded surface uses a radius token, and
a leaf can be re-rounded per-instance by overriding `--won-radius-md` on it — so
"corner radius everywhere" is a merchant-tunable property, not a hardcode.

### Colour — inherit the scheme, one swappable accent

| Token | Source / value | Controls |
| --- | --- | --- |
| `--won-fg` | `var(--color-foreground, #14171c)` | Text / foreground |
| `--won-bg` | `var(--color-background, #fff)` | Section background |
| `--won-muted` | foreground (dimmed via opacity at use site) | Secondary text |
| `--won-border` | `color-mix(fg 14%, transparent)` | Hairlines, dividers |
| `--won-surface` | `color-mix(fg 4%, bg)` | Raised wells, card media backing |
| `--won-accent` | `#ff5a3c` (neutral-athletic default) | **The single brand knob** — buttons, price, sale badge, rating fill |
| `--won-accent-contrast` | `#fff` | Text/icon on the accent |

Rule: sections reference these tokens, **not** raw hex or `var(--color-*)`
directly. Swapping `--won-accent` re-brands the entire theme in one place.
(Fixed non-accent badge hues — `--sale`/`new`/`eco` blue & green — are the only
sanctioned literals, in `.won-badge--*`.)

### Typography & motion

- **Headings:** `.won-heading` — `var(--font-heading--family)`, line-height 1.1,
  `letter-spacing -0.02em`. Sizes come from the host theme scale.
- **Motion:** `--won-dur` (`240ms`) + `--won-ease`
  (`cubic-bezier(.22,.61,.36,1)`). All transitions use these, and every motion
  is disabled under `@media (prefers-reduced-motion: reduce)`.

### Universal Customization Layer (W3-b)

Merchants shape every won section from the theme editor through **one shared
control fragment**, not per-section bespoke settings (doctrine **A1** + **A6** —
one shared surface, sophisticated engine). Mechanics:

- **`themes/build/won-style-controls.json`** — the canonical Tier-1 fragment (the
  single source; edit here, never per section).
- **`snippets/won-style-vars.liquid`** — superset of `won-spacing`; emits inline
  `--won-*` custom properties on the section root, only for opt-in / non-default
  values so an untouched section falls back to tokens.
- **`themes/build/compose.mjs` step 2d** — injects the fragment into each
  allow-listed won section's schema (dedupe, preserving each section's curated
  defaults) and swaps the root `won-spacing` render for `won-style-vars`. Widen
  `WON_STYLE_SECTIONS` to roll Tier 1 out (pilot → all 26; `won-sticky-atc`
  excluded — floating widget, own model).
- **`won-tokens.css` → `.won-section`** consumes the contract so a control works
  with **zero per-section CSS** and ports to Horizon + Skeleton.

Tier-1 section-root vars (all default to a no-op):

| Var | Control (id) | Consumed by |
| --- | --- | --- |
| `--won-pt` / `--won-pb` | `padding_top` / `padding_bottom` | `.won-section` block padding |
| `--won-radius-md` / `-sm` | `corner_radius` (px) | every rounded child (cards/media) |
| `--won-border-width` / `-style` / `-color` | `border_width` / `border_style` / `border_color` | `.won-section` outline |
| `--won-section-radius` | (set when border/bg present) | `.won-section` border-radius |
| `--won-shadow` | `shadow` (none/sm/md/lg → mapped) | `.won-section` box-shadow |
| `--won-accent` | `accent_override` | won accent token (buttons/prices) |
| `--won-section-bg` | `bg_color` | `.won-section.won-section` background (overrides the scheme) |
| `--won-text-color` / `--won-fg` | `text_color` | `.won-section.won-section` text (overrides the scheme) |
| `--won-d-m` / `--won-d-d` | `hide_mobile` / `hide_desktop` | `.won-section` display per breakpoint |

**Colour — two supported paths (both, not either/or):** every section keeps its
`Color scheme` control (binds to the global schemes, Settings → Colors) AND a
`Background color` + `Text color` picker in the *Appearance* group. Empty pickers
inherit the scheme; a picked colour overrides just that section. The doubled
`.won-section.won-section` selector (0,0,2,0) out-specifies the scheme rule
`.color-<id>` (0,0,1,0) so the override wins, while empty pickers fall back to the
scheme's own `--color-background`/`--color-foreground` — Horizon's scheme system is
never modified.

Tier-2 (typography + motion, under a *Typography & motion* header — named selects,
each defaulting to *theme*/none = no-op):

| Var | Control (id) | Consumed by |
| --- | --- | --- |
| `--won-heading-weight` | `heading_weight` | `.won-section .won-heading` weight |
| `--won-letter-spacing` | `letter_spacing` | `.won-section` letter-spacing |
| `--won-line-height` | `line_height` | `.won-section` line-height |
| `--won-text-transform` | `text_transform` | `.won-section` text case |
| `--won-anim` | `animate_in` (fade/slide/scale) | `.won-section` entry animation (disabled under `prefers-reduced-motion`) |

Tier-3 (advanced, hidden behind the `show_advanced` toggle — disclosure so an
untouched merchant never sees them):

| Var | Control (id) | Consumed by |
| --- | --- | --- |
| `--won-pad-inline` | `pad_inline` (raw px) | `.won-section` inline padding |
| `--won-section-opacity` | `section_opacity` | `.won-section` opacity |
| `--won-shadow` | `custom_shadow` (raw CSS string) | overrides the Shadow select |

**Soft guardrail:** `snippets/won-contrast-guard.liquid` (wired after each section
root by compose 2d) renders an **editor-only, never-blocking** warning when an
`accent_override` would be unreadable as white-on-accent button text
(`color_contrast < 3.0`). Merchant freedom is preserved — it warns, never blocks
save (Rozhodnutí 2026-08-10 #6).

**Deliberately section-authored, NOT in the fragment** (Rozhodnutí 2026-08-10):
`color_scheme`, `section_width`, `content_align` are class/Liquid-coupled (adding
them where a section's Liquid can't honour them would ship a dead control).
Background/text colour ARE offered as optional per-section overrides (above) via
won-scoped vars that out-specify the scheme without modifying Horizon's system.

### Shared component classes (defined once in the token layer)

`.won-btn` (+`--primary`/`--secondary`, 44px WCAG tap floor, pill),
`.won-badge` (+`--sale`/`--new`/`--eco`), `.won-pcard` (product card: media /
badges / quick-add pill, shared by carousel, PLP, search, cross-sell),
`.won-rating` (metafield star rating), and the `.won-hero--single|grid|slider`
stage styling shared by all three hero sections. A section should reuse these
rather than restyle the same primitive.

### Responsive & alignment invariants (baked into the layer)

- **Mobile centres by default** (`@media max-width:749px { .won-section {
  text-align:center } }`).
- **Structured/data sections opt out as a whole** via `won-section--start` so a
  centred title never floats over left-aligned body (comparison tables, FAQ).
  Enforced by the `assertHeadingBodyAlignment` responsive invariant.
- **Hero slides read centred on small screens** regardless.
- **44px tap-target floor** is enforced for both Won controls and the native
  base-theme controls the layer sits beside.

---

## Section inventory

All 26 sections share one **universal config contract**: every section exposes
`color_scheme`, `section_width` (`full` toggles `.won-container--full`), and
block-padding via the `won-spacing` snippet (`--won-pt`/`--won-pb`). Below,
"key settings" lists what is *distinctive* to each section. Several sections are
**schránky** ("shells") — one section covering a family of layouts via a
`source` / `display` / `layout` axis rather than N near-duplicate sections.

### Chrome / global

| Section | Purpose | Key settings |
| --- | --- | --- |
| `won-announcement-bar` | Thin top-of-page bar; each announcement is its own on/off block (free-shipping progress, promo, plain msg), rotating or static, optional session-dismiss. Replaces the old single-purpose `won-shipping-bar`. | announcement blocks, rotate vs static, dismissible |
| `won-page-header` | Page/collection/blog title banner, optional image. | `image`, heading, subheading |
| `won-footer` | Site footer — brand, link columns, payment/social. | `brand_heading`, link blocks, `color_scheme` |
| `won-app-slot` | Neutral container that hosts `@app` blocks (Won apps or 3rd-party) inside the themed grid. | app blocks via `content_for` |

### Hero

All three share the `.won-hero` styling and render `won-slide` blocks; they
differ only in the stage shape (`--single` / `--grid` / `--slider`).

| Section | Purpose | Key settings |
| --- | --- | --- |
| `won-hero` | Single full-bleed stage; one slide, overlay/split/centred via the slide's `media_position`. | slide's `media_position`, `min_height` |
| `won-hero-grid` | Row of hero tiles (Aktin-style promo grid); responsive CSS grid, tablet 2-up, mobile stacked. | `--won-hero-cols`, `--won-hero-gap` |
| `won-hero-carousel` | Hero as a swipeable one-slide-per-view slider driven by shared `won-carousel.js`; optional peek. | `--won-hero-peek`, loop, arrows/progress |

### Content

| Section | Purpose | Key settings |
| --- | --- | --- |
| `won-band` | Media + text band (image/video + copy, split or overlay) — the workhorse marketing row. | `media_type`, `image`/`image_asset`/`video`, layout |
| `won-grid` | **Shell:** any static "grid of things" via a `source` axis — `blocks` (feature/tile/slide cards), `articles` (blog cards), `stats` (number row). Absorbs `won-features` + `won-collection-tiles` + `won-articles` + `won-stats`. | `source`, `item_style`, `mosaic`, `columns_desktop` |
| `won-features` | Icon/feature cards in a grid (standalone predecessor now folded into `won-grid`). | feature blocks, `columns_desktop` |
| `won-stats` | Big-number row parsed from a textarea (real metrics only — doctrine §5). | `stats` textarea |
| `won-articles` | Blog-article cards pulled from a chosen blog. | `blog`, `articles_limit` |
| `won-marquee` | Thin scrolling USP/deal strip; local `token` blocks (text/image), seamless CSS loop, static fallback under reduced-motion. | token blocks, speed |
| `won-panels` | **Shell:** switchable content via a `display` axis — `tabs` (`<won-tabset>`) or `accordion` (`<details>`). Absorbs `won-tabs` + `won-accordion`. | `display`, `layout` (stacked/split-sticky) |
| `won-tabs` | Tabbed content (standalone; folded into `won-panels`). | `won-panel` blocks w/ `data-title` |
| `won-accordion` | FAQ accordion (standalone; folded into `won-panels`). | `won-panel` blocks, layout |
| `won-comparison` | Feature comparison table parsed from rows; centred ✓/✗. | `rows` textarea |
| `won-media-compare` | Before/after image slider (drag handle). | before/after images |
| `won-contact` | Contact form (name/email/message), layout variants. | `layout`, form fields |
| `won-newsletter` | Email capture in reading width; inline layout. | `content_align`, heading |

### Product / PDP

| Section | Purpose | Key settings |
| --- | --- | --- |
| `won-variant-picker` | PDP variant selector + price/per-unit; money pre-formatted server-side (no client money math). | `ppu_amount` + metafield override, `design_mode` |
| `won-sticky-atc` | Sticky add-to-cart bar for the current product. | product context, offset |
| `won-shoppable-image` | Lifestyle image with pinned product **hotspots**; pure-CSS reveal. Non-link container (pins are the interactive elements). | `hotspot` blocks (x/y + optional **separate mobile x/y**), product |

#### Product media gallery — use the native Horizon block, don't rebuild it

The PDP gallery is **native Horizon** (`blocks/_product-media-gallery.liquid` schema
+ `snippets/product-media-gallery-content.liquid` renderer) and is already
**comprehensively configurable** — there is no `won-*` gallery and there should not
be one (rebuilding it would fork Horizon and lose upgrade-safety). Configure it from
the store's `templates/product.json` gallery block:

| Want | Native setting |
| --- | --- |
| Grid vs carousel; 2-up grid | `media_presentation` (grid/carousel), `media_columns` (one/two), `image_gap` |
| Thumbnail rail position / size | `thumbnail_position` (left/bottom/right), `thumbnail_width`, `thumbnail_radius`, `slideshow_controls_style: thumbnails` |
| Image size / crop | `aspect_ratio`, `media_fit` (cover/contain), `media_radius`, `constrain_to_viewport` |
| Zoom, video loop, hide unselected variant media | `zoom`, `video_loop`, `hide_variants` |

**Extension rule:** change gallery behaviour via these settings in `product.json`;
handle visual polish with a **scoped CSS snippet**, never by editing the native
renderer. Overlaying the native gallery files into `won-base` under their native
names is possible (compose copies by name) but breaks the "additive, won-* only"
invariant and is **not upgrade-safe** — only do it for a genuinely new mechanic the
native settings can't express, and document + re-verify it on every Horizon upgrade.

### Commerce (collections & rails)

| Section | Purpose | Key settings |
| --- | --- | --- |
| `won-collection` | Collection / PLP grid with facets + `.won-pcard` cards. | collection, filters, `columns_desktop` |
| `won-collection-tiles` | Grid of collection promo tiles (standalone; folded into `won-grid`). | tile blocks, `columns_desktop` |
| `won-carousel` | **The JS slider engine.** Product/manual rail, one-per-view or peek, driven by `won-carousel.js`. Product & slider grids live here (static grids live in `won-grid`). | `source` (manual/collection), `products_limit`, peek |
| `won-tabbed-rail` | Product rail with a segmented **source switch** (Bestsellers ⇄ New Arrivals); each `tab` block is a collection. Plain CSS scroll-snap (no `won-carousel.js`). | `tab` collection blocks |

---

## Design rules for adding or modifying a section

These are the repo's existing theme conventions, stated as hard rules. They mirror
the "theme block UX rules" and "block taxonomy" already codified in repo memory.

1. **Consume tokens; hardcode nothing a token owns.** Colours via `--won-fg` /
   `--won-surface` / `--won-accent`, spacing via `--won-space-*`, radius via
   `--won-radius-*`. A raw hex or raw `px` gap in a section is a review reject.
   (Only sanctioned literals: the fixed non-accent badge hues.)
2. **Corner-radius everywhere, and tunable.** Every rounded surface uses a
   radius token; allow per-instance override by re-declaring the token on the
   leaf so a merchant can round any corner.
3. **Every setting has help text — no dead toggles.** Each schema setting
   carries an `"info"` string explaining what it does; every storefront-affecting
   control must visibly change output (no toggle that does nothing). This is the
   theme sibling of doctrine §3c / §4c.
4. **Honour the universal config contract.** Expose `color_scheme`,
   `section_width`, and `won-spacing` block-padding like every sibling — a
   section that skips them breaks the catalog's uniform breakpoint contract.
5. **Prefer a shell axis over a new section.** If the new idea is a variant of an
   existing family (another grid, another switchable-content mode), add a value
   to `won-grid` / `won-panels` / `won-carousel` rather than a near-duplicate
   section (block-taxonomy: container shells vs primitives vs functional widgets).
6. **Reuse the shared primitive.** Product cards → `.won-pcard`, buttons →
   `.won-btn`, badges → `.won-badge`, stars → `.won-rating`, hero stage →
   `.won-hero--*`. Never restyle a primitive per section (doctrine A1).
7. **Real data, honest on empty (doctrine §5).** Stats, counts, and social proof
   render real values or nothing — never fabricated numbers.
8. **Respect the responsive invariants.** Mobile centres by default; structured/
   data sections opt out *as a whole* via `won-section--start`; keep the 44px tap
   floor; disable motion under `prefers-reduced-motion`. These are enforced by the
   responsive-invariants test suite (`tests/support/responsive-invariants.ts`).
9. **Locale-as-data (doctrine A5).** Labels come from locale files
   (`t:won.names.*`, `t:won.options.*`) — never hardcode shopper-facing strings.

---

## Gaps / TODO

- **Help-text coverage is incomplete.** ~15 of 26 sections carry `"info"` help
  strings; the rest need help text on every setting to satisfy rule 3 (candidates
  include `won-app-slot`, `won-contact`, `won-media-compare`, `won-footer`).
- **`won-announcement-bar` is new and lightly documented.** It replaced
  `won-shipping-bar`; its free-shipping-progress block, rotation, and dismiss
  behaviour need a dedicated catalog entry and QA (was previously called out as
  missing from the catalog).
- **Standalone vs shell duplication.** `won-features`, `won-stats`,
  `won-articles`, `won-collection-tiles`, `won-tabs`, `won-accordion` are each
  absorbed by a shell (`won-grid` / `won-panels`) yet still ship standalone.
  Decide per section whether to keep the thin standalone as an alias or retire it,
  and document the canonical entry point.
- **`won-tokens` typography is under-specified.** Heading family/line-height/
  tracking are tokenised but body type scale and weights defer entirely to the
  host theme — document the expected host contract (or add `--won-text-*` tokens)
  so sections render predictably on bare Liquid.
- **No dark-scheme worked example.** Tokens defer to `var(--color-*)`, but there
  is no documented reference of a section under a dark colour scheme; add one to
  lock the `color-mix` fallbacks visually.
- **Cross-link the catalog.** `theme-blocks-catalog.html` is page-organised and CZ;
  add per-block anchors so this doc's inventory can deep-link into it.
