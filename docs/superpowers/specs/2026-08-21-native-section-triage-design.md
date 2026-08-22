# Native Horizon section triage — hide, rebuild, or keep

Date: 2026-08-21
Status: Approved in brainstorming (2026-08-21)

## Problem

Twenty native Horizon sections still appear in the theme editor's "Add section"
picker. `HIDE_NATIVE_SECTIONS` (compose step 2c) hides eight — the ones that
duplicate a Won hero/carousel/collection equivalent. The rest were never triaged.

The natives are not weak. Measured:

| Section | Lines | Settings | Presets |
|---|---|---|---|
| `quick-order-list` | 1180 | 6 | 1 |
| `product-list` | 882 | 17 | 3 |
| `product-hotspots` | 744 | 15 | 1 |
| `product-recommendations` | 560 | 16 | 1 |
| `featured-blog-posts` | 494 | 16 | 3 |
| `featured-product-information` | 231 | 9 | 1 |
| `featured-product` | 191 | 5 | 1 |

The difference is not control count. It is that Won sections sit inside a
contract the natives do not: the W3-b Universal Customization Layer (21 shared
controls), the settings-coverage gate ("no dead settings"), and the smoke suite.
A merchant has no way to tell which sections carry those rules.

Two aggravating findings:

1. **Duplicate picker group names.** Won presets use `t:won.categories.*`,
   Horizon uses `t:categories.*`. In `cs` both render `Produkty` and
   `Rozvržení`, so the merchant sees two identically-named groups.
2. **`product-recommendations` pads with low-relevance products.** Shopify
   associates up to ten products per product, ordered by relevance, and the API
   exposes **no score** — only an ordered list. Asking for six returns ranks
   1–6; in a small catalogue ranks 4–6 are noise. Confirmed by the docs:
   *"You can't customize the recommendation algorithm to exclude specific
   products. However, you can choose which of the returned products to show
   with JavaScript."*

Demo templates reference **zero** native content sections, so hiding any of them
breaks nothing in the demo.

## Hard constraint — track B portability

The Skeleton / Theme Store track stands (severka Vlna 3). Per
`docs/theme-roadmap.html` §03, *any* override of Horizon vendor files is
**non-portable** — it locks the work into the agency track and cannot move to a
Skeleton product. Therefore:

- **Restyling a native section to look like Won is off the table.** It is a
  vendor-file override.
- Only additive `won-*` files are portable.
- Stripping `presets` from a native schema at build time (step 2c) stays the
  accepted middle ground: it changes discoverability, not behaviour, and touches
  only `dist`, which is rebuilt from pristine Horizon on every compose.

## Decision rule (applies to future Horizon updates too)

For each native section, in order:

1. **Is there a Won equivalent at least as capable?** → hide it (strip presets).
2. **No equivalent, but load-bearing for the supplements funnel?** → build a
   `won-*` section additively.
3. **No equivalent, and marginal or infrastructure?** → keep the native visible.

## Replacement contract — "must add, not match"

When a native is hidden in favour of a Won equivalent, that equivalent must meet
all three:

1. **Parity on what merchants actually use** — no capability disappears that the
   native's default preset turns on.
2. **At least one improvement the native lacks**, belonging to the vertical
   (supplements / AEO) or the doctrine (per-device, honest, tokens).
3. **Fewer controls for the same job.** Four overlay pickers become one select
   with good defaults. Without this, "improvement" means more settings, which
   `theme-roadmap.html` §01 explicitly warns against.

## Triage

| Section | Verdict | Rationale |
|---|---|---|
| `product-hotspots` | hide | `won-shoppable-image` after the work below |
| `product-list` | hide | `won-carousel` (`layout: grid`, `source: collection`) after the work below |
| `featured-blog-posts` | hide | `won-grid` (`source: articles`) — already at parity |
| `product-recommendations` | **build `won-recommendations`** | only genuine capability gap; funnel-critical |
| `quick-order-list` | keep | 1180 lines of B2B plumbing, no Won ambition, repo is b2b_b2c |
| `featured-product` | keep | 191 lines, marginal |
| `featured-product-information` | keep | 231 lines, marginal |
| `custom-liquid` | keep | escape hatch, owner's call |
| `divider` | keep | owner's call |
| header / footer / footer-utilities / header-announcements / logo / main-collection / main-blog-post / search-results / product-information / `_blocks` / `section` | keep | chrome and template mains, not "add section" choices |

## `won-recommendations` — the source ladder

The native has one source and pads until it hits the limit. The Won section
walks an **ordered chain**, tops up from each source in turn, and **stops
honestly**.

### Sources are blocks, not settings

Shopify blocks are ordered and drag-reorderable in the editor. Modelling each
source as a block gives the merchant ladder ordering for free, through native UI,
with no custom control. It also matches the repo's container/primitive taxonomy.

| Block type | Settings | Trust |
|---|---|---|
| `won-rec-metafield` | `namespace` (text, default `custom`), `key` (text, default `pairs_with`) | highest — merchant owns it |
| `won-rec-complementary` | — | high — curated in Search & Discovery |
| `won-rec-match` | `source_collection` (collection), `match_by` (select: type \| vendor \| tag) | medium — a rule |
| `won-rec-related` | — | low — this is the padder |
| `won-rec-manual` | `products` (product_list) | floor, not a recommendation |

`won-rec-manual` is global to the section, not per-product. Its `info` text must
say so plainly, or the merchant will believe it recommends.

Default preset ships the ladder as: metafield → complementary → match → related.
`won-rec-manual` is not in the default preset; a merchant adds it deliberately.

### Section settings

| Group | Setting | Notes |
|---|---|---|
| Mode | `target_count` (range 2–12, default 4) | docs recommend 4 |
| Mode | `min_count` (range 1–6, default 2) | below this the section hides entirely |
| Content | `product` (product) | **parity requirement** — the native has it. Resolves as `section.settings.product \| default: product`, so the section also works off a product template. `product` settings support no `default` attribute and are not updated when switching presets. |
| Content | `heading` (richtext) + the standard heading size/max-width quartet | per schema-unification spec |
| Layout | `columns_desktop`, `columns_tablet`, `columns_mobile`, `gap`, `card_aspect`, `mobile_carousel` | mirror `won-carousel` |
| Controls | `show_arrows`, `arrow_style`, `show_dots` | shared with the carousel work below |

Appearance and Spacing come from the W3-b fragment. `won-recommendations` joins
`WON_STYLE_SECTIONS`.

### Mechanics

- **Accumulate, dedupe, cap.** Walk blocks in editor order. Append products not
  already collected, never the current product, until `target_count` is reached.
- **Honest stop, evaluated on the final list.** If the ladder runs dry below
  `target_count`, render what there is. If below `min_count`, render nothing.
  **Never pad.** This is doctrine §12 (*Honest by construction — never fabricate
  what looks like proof*) applied to the storefront, the same principle as the
  no-fabrication cold-start in Won Toasts.
- **`min_count` is enforced on the resolved list, not on the server pass.** If
  the server-side ladder is short but an API block is still pending, the section
  **must still emit its container and `data-url`**, hidden and card-less, or the
  swap has nothing to hook into and a section that would have filled up stays
  empty forever. Only after the last pending fetch resolves does `min_count`
  decide whether the section stays hidden.
- **Server-first.** `won-rec-metafield`, `won-rec-match` and `won-rec-manual`
  render server-side. Only `won-rec-complementary` and `won-rec-related` need
  the Section Rendering API round-trip. The native fetches unconditionally; this
  section fetches **only** when the server-side ladder falls short and an API
  block is still pending. On a store with populated metafields, one network
  request per PDP disappears. This satisfies doctrine SF-2 (*every storefront
  feature explains and budgets its cost*).
- **Two-pass rendering.** `recommendations.performed?` is false on the initial
  render and true on the API render — the standard Shopify pattern. The ladder
  must produce a correct result in both passes; the API pass replaces the list
  wholesale.
- **One intent per fetch.** If both API blocks are present, fetch in ladder
  order and stop as soon as `target_count` is met. Cap at two fetches.

### Known caveats to encode

- Liquid `for` loops cap at 50 iterations — `won-rec-match` must pass `limit:`.
- `collection` is not available on a product template, so `won-rec-match`
  requires an explicit `source_collection`; fail closed (contribute nothing) if
  it is blank.
- Shopify already excludes out-of-stock products, price-0 products, gift cards,
  and items already in the visitor's cart from API recommendations.
- Metafield list length uses `.value.count` (reference types), not `| size`.
- The metafield must be **visible to the storefront**, or the dynamic
  `product.metafields[namespace][key]` lookup silently returns blank and the
  ladder quietly falls through to the next source. The block's `info` text has
  to say this; a silent fall-through looks identical to "no pairs configured".
- `product_list` caps at 50 selections and exposes `.count`; `product` and
  `collection` settings accept no `default` attribute and are not updated when
  the merchant switches presets. Any preset therefore ships these blocks empty,
  and every source must fail closed on a blank picker.
- The fetch URL follows the native's shape:
  `{{ routes.product_recommendations_url }}?section_id=…&product_id=…&limit=…&intent=…`
  — `product_id` resolves from the `product` setting above.

## `won-shoppable-image` — close the gap, then improve

The only replacement where the Won section is genuinely weaker (9 settings vs
15). The missing capabilities are content-specific, so the W3-b layer does not
cover them.

| Native has | Replacement |
|---|---|
| `toggle_overlay`, `overlay_color`, `overlay_style`, `gradient_direction` | **one** `image_overlay` select: none \| soft \| strong \| gradient-top \| gradient-bottom, reading a token (condition 3) |
| `hotspot_color`, `bullseye_color` | `accent_override` (already in W3-b) + `pin_style`: dot \| numbered \| pulse (§11 one meaning, one colour) |
| `section_height` | `section_height` range, straight port |
| `product_title_preset`, `product_price_preset`, `product_title_gap` | inherit from the shared card typography; no new controls |

**Improvement the native lacks (condition 2):** `mobile_display` = pins \|
pins+list \| list. Hotspots at 390 px are cramped and the native does nothing
about it; the fallback is a scrollable product row beneath the image. Consistent
with the repo's per-device doctrine (`custom_mobile_pos`, `hide_mobile/desktop`).

`pin_style: numbered` additionally unlocks a captioned list beneath the image,
which the native cannot express.

## `won-carousel` — two additions

Already ahead of `product-list` on price-per-unit (supplements-critical),
marquee layout, manual source via `won-slide`, autoplay, progress bar and
per-device heading sizing. Missing:

- **`mobile_carousel`** — grid on desktop, carousel on mobile. **The pattern
  already exists in `won-grid`.** Port it; do not invent a second one.
- **`arrow_style`** — the native offers `icons_style` (5 variants) and
  `icons_shape`; Won has only `show_arrows` on/off. Add one `arrow_style`
  select, later shared with `won-recommendations`. **Not** `won-grid`: its
  `mobile_carousel` is a plain scroll rail with no arrow controls at all, so
  there is nothing there to style.

## `won-grid` — one addition

Already at parity with `featured-blog-posts`: `mobile_carousel`,
`article_layout: featured` (≈ editorial), blog/limit/columns, plus `show_date`,
`show_excerpt`, `item_style` and `mosaic`, which the native lacks.

**Improvement (condition 2):** `show_author` + `show_reading_time`. Author
signals are an E-E-A-T input, and severka names AEO as the soul of the theme.

## Category label collision

Rename the Horizon category labels in the merged `cs` and `en` schema locales so
they cannot collide with Won's. This is a **locale merge**, which compose
already performs — not a section override — so portability is unaffected.

- Horizon `categories.products` → a distinct label (e.g. `Produkty (Horizon)`)
- Horizon `categories.layout` → likewise

Won's own five categories stay untouched.

## Build changes

`themes/build/compose.mjs`:

- Add `product-hotspots`, `product-list`, `featured-blog-posts` to
  `HIDE_NATIVE_SECTIONS` with the same `-> won-*` comment convention.
- Add `product-recommendations` once `won-recommendations` ships — **not
  before**, or the store loses recommendations with nothing to replace them.
- Add `won-recommendations` to `WON_STYLE_SECTIONS`.

## Rollout (three waves, one spec)

Each wave is independently shippable and **ends with its own hide**. The
invariant: a native is never added to `HIDE_NATIVE_SECTIONS` until its
replacement is merged and green. Ordered cheapest-first, so value lands early.

| Wave | Work | Ends with |
|---|---|---|
| **1 — parity, no new engine** | `won-carousel`: `mobile_carousel` (port from `won-grid`) + `arrow_style`. `won-grid`: `show_author`, `show_reading_time`. Horizon category labels renamed. | hide `product-list`, `featured-blog-posts` |
| **2 — close the real gap** | `won-shoppable-image`: `image_overlay`, `pin_style`, `section_height`, `mobile_display` | hide `product-hotspots` |
| **3 — new section** | `won-recommendations`: section + five source blocks + lazy fetch | hide `product-recommendations`, add to `WON_STYLE_SECTIONS` |

Wave 3 is the only one that builds a new engine and is roughly the size of the
other two combined. It can take its own implementation plan if wave 1–2 land
first.

## Testing / acceptance

- **Settings-coverage gate stays green.** Every new schema `id` — including the
  five source blocks — must be referenced in source, or
  `tests/smoke/won-settings-coverage.spec.ts` fails. Corpus must include
  `blocks/`.
- **New spec `tests/smoke/won-recommendations.spec.ts`:**
  - ladder order follows block order in the template
  - a ladder that runs dry renders fewer cards and **never pads**
  - below `min_count` the section renders nothing
  - no duplicate products, and the current product never appears
  - with only server-side blocks present, **no** recommendations fetch fires
  - with a pending API block and a short server-side ladder, the container and
    `data-url` **are** emitted even though no card renders, and the section
    fills in after the swap (the regression the `min_count` rule guards)
  - placed off a product template with the `product` picker set, it resolves
    against that product
- **New spec for shoppable image:** `mobile_display: list` renders the fallback
  row at 390 px and no pins; `pin_style: numbered` renders the caption list.
- **Behavioural, not just static.** The 2026-08-11 audit found four chain bugs
  that static reference checks missed. Every new control needs a behavioural
  assertion, per `tests/smoke/won-settings-fixes.spec.ts`.
- **Upload gate:** `shopify theme push --path themes/dist/horizon-dev --theme
  161463730417 --json`, check `.theme.errors` — catches server-only schema
  errors the MCP validator misses.
- Range defaults must land on a step of their own range, or Shopify rejects the
  upload.

## Non-goals

- **`layout_type: editorial`.** A third layout engine for marginal gain. Skipped
  deliberately.
- **Rebuilding `quick-order-list`, `featured-product`,
  `featured-product-information`.** Kept native.
- **Any override of a Horizon vendor file.** Breaks track B.
- **App-backed recommendations.** If recommendation quality later needs order
  data or server state, that is a Won app, not a theme section — and it is gated
  behind the same fan-out signal as every other app in severka.
