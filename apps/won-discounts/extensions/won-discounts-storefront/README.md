# Won Discounts storefront extension — notes on the scripts

The scripts in `assets/` ship as written (no build, no minification: nova-aplikace §8), but their
explanations live here: every comment counts against the storefront JavaScript budget (SF-2:
10 240 B gzipped for all scripts together, MVP 4 moved ~2 kB of comments here to make room for the
cart). Each note below is the comment that stood above the named line.

## The cart panel (MVP 4, contracts R7–R9)

- `blocks/won_discounts_embed.liquid` prints the cart data only when the storefront config offers rewards: the
  rewards, each gift variant's title and availability (`all_products[handle]`, at most 20 handles a page), the cart
  currency's minor digits, the texts (`cart.*`: the merchant's in the page's language, else `locales/*.json`) and the app proxy path (with the locale prefix of
  `routes.root_url`); then `won-discounts-cart.js` (deferred).
- `won-discounts.js` holds the pure part (`plan`: thresholds before discounts — R1 — and after them for
  countOtherDiscounts; what an earned tier lacks; which gift lines must go) and the panel's HTML (`html`, every text
  escaped). `won-discounts-cart.js` reads `/cart.js`, renders the panel into the cart block's slot
  (`blocks/cart_rewards.liquid`) or the theme's drawer / cart summary (Horizon `cart-drawer-component
  .cart-drawer__summary`, `.cart-page__summary`; Dawn `#CartDrawer .drawer__footer`, `#main-cart-footer .cart__footer`),
  and puts it back whenever the theme re-renders (MutationObserver).
- SF-1: it writes only through `Shopify.actions.updateCart` (the theme refreshes itself) and only in answer to the
  customer — a cart change event the customer caused (`shopify:cart:lines-update`, `shopify:cart:discount-update`,
  Horizon `cart:update`, Dawn's pubsub `cart-update`; the events of its own writes carry `detail.won` and are
  ignored), a click or the code form. Never on page load. Writes are 1.5 s apart (Cloudflare).
- A gift line carries `_won_gift` (the function reads it) and `_gift_progress` (Won Toasts skips it, A11).
  "Odmítnout" / a gift removed by hand → the tier in the cart attribute `_won_gift_declined`, never added again.
- The quantity hint ("přidej 1 ks") comes from the app proxy (`/apps/won-discounts/cart-plan`, the engine).

## Milníky: the ladder (feedback 6 Oct 2026, body 9 a 10)

- One component, three sizes: `bar` (a sentence + a thin track), `compact` (+ a mark per step), `full` (+ every
  step with its reward, the reached ones ticked). Markup: `.won-ms.won-ms--<size>[data-won-ms]` › `.won-ms__text`,
  `.won-ms__track[role=progressbar]` (› `span` the fill, `i[data-done]` a mark per step), `.won-ms__list` ›
  `li[data-won-ms-step=s|g|d][data-done]`. The highlight colour is `--won-tiers-accent`.
- `won-discounts.js` `plan()` builds `steps` — free shipping (`s`), the gift tiers (`g`) and the order-discount
  steps of the storefront config's `rewards.disc` (`d`), lowest cart value first, each read for the cart's market
  like every amount (`EUR@sk`, then `EUR`; a negative amount = not offered there) — and `ladder(view, size, data,
  currency)` draws them. A gift step is done when the gift is due (with countOtherDiscounts: after discounts); a
  discount step when the goods before discounts reach its value, exactly the minimum checkout measures.
- Where it shows: the cart drawer (`compact`) and the cart page (`full`) inside the cart panel
  (`won-discounts-cart.js` picks the size by where the panel sits); the "Milestones" block
  (`blocks/rewards_progress.liquid`, the size is its setting) and the embed's top strip (`bar`) — both rendered by
  `snippets/won-milestones.liquid` for the first paint and redrawn by `won-discounts-blocks.js` from the
  `won-discounts:cart:update` event (`detail.steps`), so every place follows the cart without a page load.
- `scripts/milestones-web-preview.mjs` walks a fake cart through the steps over the real stylesheet and scripts.

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
- `function zero() {` — The fallback of `refresh`: the counts that came from the cart are zeroed (0 only ever under-promises) when a fresh render cannot be read.
- `function refresh(event) {` — K6 (amended again, feedback 6 Oct 2026, bod 4): after a cart change the block GETs a fresh render of ITS OWN section (`?section_id=`, the Liquid that counts the cart: one source of truth) and takes only its data JSON from it; `readData` parses the new text. The theme's own cart request (`event.promise`) is awaited first, the old counts stay until the answer, a newer change drops an older answer. No request at page load, never a cart endpoint (SF-1).
- `var hooked = false;` — Dawn's cart signal is its pubsub global `subscribe` (deferred pubsub.js may run after us).
- `var timer = null;` — A debounce that never shortens a pending later rescan: a click right after a promise-less product:select must not rescan before the theme swapped the variant.
- `["input", "change", "click", "quantity-selector:update", "shopify:section:load"].forEach(f` — Capture phase: also events a theme stops. "click" = steppers without events; "quantity-selector:update" = Horizon's plus/minus.
- `["shopify:cart:lines-update", "cart:update"].forEach(function (name) {` — Cart changes: Horizon's standard storefront event (older Horizon: cart:update).
- `doc.addEventListener("shopify:product:select", function (event) {` — Horizon morphs the form and sets input[name=id] without a change event.

## `won-discounts.js`

- `const base = (cart) => plain(cart).reduce((s, item) => s + (item.original_line_price || 0)` — R1: the non-gift lines before every discount (/cart.js cents = Liquid units).
- `const afterBase = (cart) =>` — R4: the same after their discounts and the order's.
- `const plan = (cart, rw, facts) => {` — What the panel shows and what the cart lacks; `facts` = gift variants from Liquid ({id: {t, a}}).

## `won-discounts-cart.js`

- `const write = (payload) => {` — Every write goes through Shopify's updateCart (the theme refreshes itself), one at a time and GAP_MS apart (Cloudflare); the events it emits carry `detail.won` and trigger nothing. A rejected or lost change (a network failure or Cloudflare's 429 rejects the call; `userErrors`, e.g. the gift sold out a moment ago) is not reported: `react` reads the cart again and decides again, twice at most (3 s, 6 s) — never a blind resend, which could add a gift twice when the first write did land. updateCart posts to the storefront's own `/api/<version>/graphql.json`, which `shopify theme dev` does not serve — the E2E runs on the store domain previewing the theme.
- `const refresh = () =>` — `/cart.js` with `cache: "no-store"`: a cached read showed the cart before the customer's change (live E2E, MVP 4).
- `const onChange = (e) => {` — Storefront cart events fire as a change STARTS and carry `event.promise`: the panel waits for it, then 300 ms, then reads the cart. Reactions run one after another (one queue) and each reads a fresh cart: one action that fires two events (Dawn's pubsub + the standard event) adds the gift once, and no time window swallows the customer's own next change.
- `const withDeclined = (list) => {` — Cart attributes are replaced as a whole: keep the others, set the declined tiers.
- `const react = (before) => {` — A cart change the customer made: the gift follows the threshold (SF-1: never on load); a gift the customer removed by hand counts as declined (it never comes back). While a code is being applied, or its "you lose the gift" warning waits for the customer's choice, it changes nothing: a theme's own cart event after the discount change (seen live on Dawn) must not decide for the customer.
- `const askHint = () => {` — R9: the quantity hint comes from the app proxy (the engine); nothing on failure.
- `const panels = () => {` — The theme re-renders its drawer and cart page: the panel goes back in whenever it is missing.

## The merchant's texts (feedback 2026-10-06, body 11–14)

- A text the merchant changed on the Překlady page reaches the page from the app-data metafield of the page's
  language: `app.metafields.won_discounts['tx_' + request.locale.iso_code (lower-case)]`, a JSON object
  `{"tiers.heading": "…"}`. Every block and snippet reads `tx[key]` first and the extension's locale file
  (`'key' | t`) when it is empty — the table, the card line, the cart panel's data, the ladder, the sale badge and
  the campaign countdown alike. The storefront config carries no texts.
- A language without a metafield (none changed, or past the Free plan's two languages) shows the locale files.
- `cart.ms_name.<rule id>` is a Milníky discount step's own name: the ladder shows it instead of
  `cart.ms_disc` (`{value}` is filled in the same way). The embed hands the names to the script as `tx.n`.

## Looks (feedback 2026-10-06, bod 13)

- Every element has its own look: `.won-tiers` (the table), `.won-ms` (the ladder), `.won-outlet` (the sale badge),
  `.won-campaign` (the banner), and the cart panel with the top strip (`.won-cart`, `.won-cart-slot`,
  `.won-topbar`: the frames the ladder sits in). The storefront config's `appearance.css` is ONE stylesheet the
  embed prints: each element's ready-made look, colour and custom look — every rule under its element's root
  (core `looks.ts`, `custom-look.ts`). `appearance.preset` is the table's class only.
- A look's rule is always more specific than the base rule it overrides (never a doubled class, never the order
  of the stylesheets).
- A ready-made look is CSS over the same markup, never a script: the ladder carries its track AND its list of
  steps in `compact` and `full` (`won-discounts.css` hides the list in `compact`; the "checklist" look shows it
  and hides the track, "sentence" hides both).
- `data-new` marks the step a cart change has just reached (`plan().hit`; never on a page load). The mark holds
  for 1.5 s however often the cart is read meanwhile (a theme reports one change twice) and goes out with the
  `won-discounts:cart:update` event (`detail.hit`), so the Milestones block and the top strip get it too. The flash
  (`@keyframes won-ms-new`) plays only when the look asks for it and never with `prefers-reduced-motion`.
- The campaign banner's countdown is the banner's look alone (the "strip" look hides it): the block has no
  setting for it.
- The sale badge's time left: `appearance.oc` = a look with a countdown, the product metafield's `e` = the sales
  with an end date. Only then the block prints the banner's countdown markup and loads `won-discounts-blocks.js`.
