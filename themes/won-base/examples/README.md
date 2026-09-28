# Editorial PDP composition

`product.editorial.json` is an **optional Horizon composition example**, not a default
product template and not automatically published. It demonstrates the desktop PDP
screenshot as merchant-editable Won capabilities. Replace illustrative content and
select real media before assigning it to a product. No TheraBeast assets are embedded.

## Mapping and editor setup

| Screenshot pattern                      | Reusable implementation                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two-column PDP / square media grid      | Native Horizon `product-information` and `_product-media-gallery`: grid, two columns, square ratio, gap 16, radius 14. Mobile remains Horizon's carousel.                                              |
| Badge, brand and type                   | `won-product-meta`: badge-only before native heading, metadata-only after; vendor/type are Shopify product fields.                                                                                     |
| Purchase                                | Native description text, `variant-picker`, `price`, `buy-buttons` and `won-price-per-unit`. Put the native picker inside `won-product-offer` for outlined options and optional overlapping offer text. |
| Delivery                                | Existing `won-delivery-note`, appearance **Plain row**.                                                                                                                                                |
| Recommended products beside disclosures | `won-grid` (two columns), two `won-group` children; selected `won-product-card` blocks on the left, `won-panel` editorial rows on the right.                                                           |
| Split reviews                           | **Won · Split reviews** preset in `won-carousel`; `won-slide` visualization **Split testimonial**; independent light card scheme, image, heading, body, reviewer and rating. Zero hides the rating.    |
| Numbered benefits + expert              | **Won · Editorial columns** preset in `won-grid`; `won-feature` presentation **Numbered benefit**, bare icon, marker color; expert `won-slide` with image caption and role.                            |
| Trust strip / check list                | Existing grid and feature blocks, bare icons, active scheme/section accent.                                                                                                                            |
| Ingredient explainer                    | Nested groups; feature **Statistic** plus standard icon features.                                                                                                                                      |
| Two-column FAQ                          | **Won · Two-column FAQ** preset; same native `details/summary` primitive as the PDP disclosures.                                                                                                       |
| Editorial cards                         | `won-tile`, label position **Below image**; or existing blog-driven `won-grid` article source.                                                                                                         |

The new `won-group` keeps columns independently editable and supports one to four
desktop columns, one or two mobile columns, three existing spacing tokens and optional
color-scheme inheritance. It also works inside native Horizon sections accepting theme
blocks. `won-product-card` is a thin selection wrapper around the existing shared card:
price, compare-at price, availability, badges and quick-add have one implementation.

Content and images use ordinary settings, so supported Shopify dynamic sources can be
connected in the editor. Product descriptions use `closest.product.description` in
native text; metadata reads the current product; unit cost retains existing metafield
rules. No new metafield definitions or discounts are created. Offer copy must correspond
to discounts configured in Shopify. Reviews are manually authored testimonials, not
fabricated product AggregateRating data.

## Palette and media

Use the existing theme typography settings for body and display fonts. The example uses
section-local navy/cyan/pink values as editable **example settings**, never global CSS
constants. For native purchase controls create/select a color scheme with navy foreground,
white background, lime primary button and navy primary-button text. Configure hover colors
with readable contrast. The screenshot's display font is approximated with the merchant's
selected theme font. Keep the header/navigation owned by Horizon.

Set a light scheme on testimonial cards independently of the cyan parent section. Upload
review/expert images through image pickers; empty editorial media has a neutral placeholder.
Replace sample ratings and copy with real content before publication. Bundle items reference
demo products only in this optional example; choose the merchant's actual products.

Native Horizon owns product video/external-video rendering, zoom, availability and form
state. The existing gallery forces cover for fixed square ratios; use square-prepared
product media or the native adaptive ratio for uncropped images. The dev product used for
QA has one image, so a four-media layout and hosted/external-video playback were not exercised.

## Reproduce the dev-only fixture

From the `b2b_b2c` root, using the configured **b2b-b2c-store-development** store:

```sh
cp themes/won-base/examples/product.editorial.json themes/demo/horizon/templates/product.won-editorial.json
node themes/build/compose.mjs horizon
shopify theme dev -e horizon
```

Open `/products/the-videographer-snowboard?view=won-editorial` through the local preview.
The normal demo-overlay build materializes the source example; no hand-authored generated
Liquid/CSS is needed. No product template assignment is changed. The optional template can
also be composed in Theme Editor using the presets above.

```sh
WON_EDITORIAL_QA=1 npm run test:smoke -- --grep 'editorial PDP' --reporter=line
```

After testing, remove only the temporary `themes/demo/horizon/templates/product.won-editorial.json`
and compose Horizon again. Keep this source example. This preserves the existing default PDP.

## Compatibility and limitations

All new visual settings are opt-in; existing defaults remain standard/overlay/card/plain.
Disclosure styles moved into `won-panel` so they load when the block is nested outside the
`won-panels` section. No new JavaScript, font or icon dependency was introduced.

Horizon composition succeeds. The combined `npm run theme:compose` currently fails on its
Skeleton step because the existing build expects Horizon header-search calls in Skeleton's
header. This unrelated integration was not changed. Full-theme CLI validation also reports
existing vendor translation/static-ID issues and the deprecated `won-stats` parser-blocking
script. Supported English/Czech schema checks and checks of changed Won files are reported
separately. No live-theme publication or generic consumer modifications are performed.
