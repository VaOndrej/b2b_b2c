# Won Discounts storefront extension — notes on the scripts

The scripts in `assets/` ship as written (no build, no minification: nova-aplikace §8), but their
explanations live here: every comment counts against the storefront JavaScript budget (SF-2:
10 240 B gzipped for all scripts together, MVP 4 moved ~2 kB of comments here to make room for the
cart). Each note below is the comment that stood above the named line.

## `won-discounts-tiers-core.js`

Won Discounts quantity tiers: pure logic (MVP 3, contracts K2, K4 v2, K5, K6). No DOM, no network: won-discounts-tiers.js renders with it. Split off so each file stays under Theme Check's 10 000 B raw limit and readable (no build). The block loads it with `defer`; whichever of the two files runs second starts the block (window.__wonTiersBoot). Money = Liquid units (major x 100).

- `var EXP0 = " BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF ";` — ISO 4217 minor digits other than 2 (= core money.ts MINOR_DIGITS).
- `function floorUnits(f, sc, cur, rate) {` — K4 v2: the item's floor in Liquid units of the cart currency. `f` = minor units of the shop currency `sc`; another currency converts with the shop -> cart rate, rounded up + 1 minor unit; no usable rate = null (nothing is promised).
- `function capOf(v, data, rate, g) {` — The per-item discount ceiling of a variant (K4 v2 / K6): `f` = price - floor; `m` = price x m / 100 rounded down to a minor unit (g), the percent ceiling of a variant without a cost; neither (a cost without a matching floor) = null: no table for it (fail closed).
- `function offered(breaks, cur) {` — K5 breaks for the cart currency; an amount without a value there is not offered (MKT-1).
- `function discount(b, price, cap, g) {` — Per item (the table): the percent rounded DOWN, or the amount; never above the ceiling `cap` or the price, so never more than checkout gives at any quantity. `g` = Liquid units per minor unit (100 for JPY & co.: Liquid counts yen x 100).
- `function lineDiscount(b, price, cap, qty, g) {` — Per line, like the engine: a percent rounds once per line (in minor units); the margin allows quantity x the per-item ceiling (P2-1: the engine's floor is per item).
- `function countOf(mode, qty, inCart) {` — K6: the chosen quantity + the cart items counted toward the same tier.
- `function compute(data, variantId, qty, rate) {` — The block's state for a variant, quantity and shop -> cart rate. Tier = the highest min <= count (K2); `total` = the line after the discount, `unit` = its per-item price; next = the nearest tier that lowers the per-item price. A row capped by the margin says the percent it really gives (floored to 0.1).
- `var FORMATS = {` — The theme's money format like Liquid's money filter: placeholder -> [thousands separator, decimal mark, decimals].
- `function sampleFormat(sample) {` — The ACTIVE currency's money format, read back from Liquid's own rendering of 1 234 567,89 (`{{ 123456789 | money }}`): shop.money_format can be the shop currency's. Returns a format for money(), or null when the sample is unusual.
- `function fill(template, vars) {` — "{name}" placeholders of the locale files and merchant texts.
- `function pctText(n, lang) {` — A percent for display: one decimal at most, a decimal comma outside English.

## `won-discounts-tiers.js`

Won Discounts quantity tiers block (MVP 3, contracts K6 + K8). Liquid renders the selected variant; this keeps the table live from the block's JSON, with the pure logic of won-discounts-tiers-core.js (whichever file loads second starts it). The buy form is found by our variant ids and `input.form`, never by nesting (Horizon: block below the grid; Dawn: quantity input outside the form). Never touches or reads the cart (SF-1): cart counts come from Liquid and drop to 0 on the theme's cart-change signal. After every change it dispatches `won-discounts:tiers:update` on document (K8).

- `function pickForm(root, data, strict) {` — The buy form holds our variant id AND owns the quantity input or a submit button: Dawn and Horizon also render an installment form holding the id in the price block. In the block's own section a buy form wins even while its id is empty (unavailable variant); elsewhere only forms holding our id count.
- `var fmt = core.sampleFormat(data.ms) || data.fmt;` — Open question 1: format in the ACTIVE currency, read from Liquid's own `money` sample.
- `var sc = w.Shopify && w.Shopify.currency;` — K4 v2: a floor in another currency converts with the storefront's rate (shop -> active currency).
- `function zero() {` — K6 (amended): a cart change zeroes the counts that came from the cart; they are never re-read (0 only ever under-promises). A new Liquid render of the block brings fresh ones (its JSON text changes, so readData parses it again).
- `var hooked = false;` — Dawn's cart signal is its pubsub global `subscribe` (deferred pubsub.js may run after us).
- `var timer = null;` — A debounce that never shortens a pending later rescan: a click right after a promise-less product:select must not rescan before the theme swapped the variant.
- `["input", "change", "click", "quantity-selector:update", "shopify:section:load"].forEach(f` — Capture phase: also events a theme stops. "click" = steppers without events; "quantity-selector:update" = Horizon's plus/minus.
- `["shopify:cart:lines-update", "cart:update"].forEach(function (name) {` — Cart changes: Horizon's standard storefront event (older Horizon: cart:update).
- `doc.addEventListener("shopify:product:select", function (event) {` — Horizon morphs the form and sets input[name=id] without a change event.
