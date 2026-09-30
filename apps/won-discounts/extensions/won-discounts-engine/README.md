# won-discounts-engine

The Won Discounts discount function (Discount Function API 2026-04), targets
`cart.lines.discounts.generate.run` and `cart.delivery-options.discounts.generate.run`.

## Two implementations, one brain

- **Rust function (this folder): the production hot path.** It is a port of what
  the function needs from the TS engine: config reading, `planCart` (margin
  protection of MVP 2 included: `margin.ts`, `plan-margin.ts`), `emitForNode`,
  and the output mapping. It does not port explain or describe, except the short
  text of an unnamed rule, which is the checkout message, nor the rule states
  beyond "eligible or not" (so `margin_floor` / `not_combinable` precedence has
  no Rust counterpart: no emission depends on it).
- **TS engine (`packages/core/src/discounts`): the reference.** The admin
  ("Vyzkoušet košík") and the storefront use it, and it defines what is correct.
  The output mapping lives there too (`function-output.ts`
  `mapToFunctionOutput`), so the admin's `checkoutPreview` shows what the
  checkout will actually apply and warns when the output was degraded.
  `tests/reference-adapter.js` is the function-input adapter around it: with
  the TS engine it computes the reference output for any function input.

Why Rust: the JS function (Javy) cost ~96 M instructions on a 200-line cart,
against Shopify's limit of 11 M. Reading the input alone cost 12.3 M. Over the
limit, Shopify drops every Won discount without an error. See
`.superpowers/sdd/2026-09-28-won-discounts-mvp1/task-2-report.md` and
`task-2b-report.md`.

## Parity (DATA-4 mitigation)

The fixtures are the parity oracle. `tests/fixtures/*.json` are generated from
`tests/scenarios.js` through the public `@won/core` builders
(`npm run fixtures -w won-discounts-engine`). Their expected outputs are written
by hand, and the TS reference reproduces all of them.

| Check | Where |
|---|---|
| Every fixture, TS reference = fixture output | `tests/parity.test.js` |
| Every fixture, Wasm = fixture output (parsed) | `tests/default.test.js`, `function.contract.test.ts` |
| Every fixture, Wasm output text = expected text | `tests/parity.test.js` |
| Every fixture, native Rust output text = JSON.stringify of the expected output | `cargo test` (`src/fixture_tests.rs`) |
| Seeded random carts and configs vs the TS reference | `tests/parity.test.js` |
| Every Rust unit test has a TS twin | `tests/engine-unit.twins.test.js` |
| Every Wasm run's linear memory ≤ 4 000 KB (bump allocator) | `tests/parity.test.js` |
| The margin order search, 2 000 carts built for it, every reachable way it ends ≥ 20 times | `tests/parity.test.js` |

Details:
- **Wasm output text.** The output text function-runner prints (sorted keys, and numbers in the form the Wasm wrote them, e.g. `10` not `10.0`) must equal the expected output rendered the same way.
- **Native Rust output text.** Compared character for character. The same run checks that the output-size arithmetic equals the written JSON.
- **Random carts.**
  - Seeds `20260928,1,2,3,5,8` × 400 cases, up to 260 lines, junk data included.
  - "Big" carts (150–260 lines, 200-character names, distinct Pro stack amounts or rounding ties) go over the output budget, so the degraded and truncated outputs are compared too; "large" carts reach quantities of 5 000, prices of 99 999 999.99 and amounts at the money cap.
  - Codes padded with NBSP, BOM and tab, astral and case-mapped codes; lower-case, padded and invalid countries; priorities up to 1 000; CZK, EUR, JPY, KWD, HUF, BHD and USD; entitled minimums; a fixed shipping amount on split shipments.
  - Rule ids include non-ASCII, astral and 64-character text, plus a UTF-16 tie mode, so the tie order is compared too.
  - Margin protection (MVP 2): on / off / legacy / junk payloads, collection overrides, cost prices in the shop currency and in others, junk costs, `presentmentCurrencyRate` as decimal strings, numbers and junk, carts of exponent 0 / 2 / 3, and big over-budget carts with capped and tight lines. Every margin branch (capped, capped to 0, capped stack, order lowered / leaving lines out / floored, exclusive mode, cost and maximum-% floors, collection settings, converted and unconvertible costs, tight lines, over-budget outputs, margin off with costs) is counted like the rest.
  - Every engine branch must be hit ≥ 20 times, or the test fails.
  - Env overrides: `PARITY_SEEDS=…`, `PARITY_CASES=…`.
- **Unit-test twins.** Each twin runs the Rust test's scenario through the TS engine and asserts the same values. The test names are paired automatically.

Rules for a change:

- A change to the engine semantics goes into the TS engine first, as a
  scenario and a regenerated fixture. The Rust port follows until every check
  above is green.
- Never edit a fixture's expected output to match the Rust function.

## Input query

Both targets read the same fields (`src/*.graphql`; the delivery target also reads
`cart.deliveryGroups`). The `.graphql` files keep only a short header: Shopify counts every
character of an input query file, comments included, against its 3000-character limit
(`tests/query-cost.test.js` measures the whole file).

```text
Engine input (MVP 1; margin protection MVP 2; spec §3 "Emise per uzel", "Transport configu"). Every Won
node reads the SAME cart and shared config, plans the whole cart and emits
only its own part (src/input.rs; reference: tests/reference-adapter.js).

  discount.vars   the node's own `$app:won_discounts`/`function_vars`: role,
                  ruleId, campaignId, varsVersion (@won/core buildNodeVars)
  shop.config     the app-owned SHOP metafield `$app:won_discounts`/
                  `function_config`, shared by every node (C7); over 10 000 B
                  it arrives as null → no discount, no error
  wonProduct      per product `{ruleIds, variantRuleIds?, outlet?, marginRefs?}`
                  (precomputed targeting; `marginRefs` = numeric ids of its
                  decisive collections with a margin setting, ≤ 2, MVP 2)
  wonVariant      per variant `$app:won_discounts`/`variant` = `{cost, cur}`: the
                  cost price in MAJOR units of the shop currency (margin
                  protection, MVP 2; read only while margin protection is on)
  presentmentCurrencyRate
                  shop currency → cart currency (a Decimal): converts cost
                  prices when the cart is in another currency (margin, MVP 2)
  country         Pro market targeting (market → countries map in the shared
                  config; the deprecated `localization.market` is not used)

CONTRACT: the node's `function_vars` MUST contain top-level `campaignStart` and
`campaignEnd` (DateTimeWithoutTimezone in shop-local time; "1970-01-01T00:00:00"
for both when there is no campaign). Shopify binds input-query variables only
from the metafield named in [extensions.input.variables] (C4:
docs/won-discounts/evidence/mvp0/c4-campaign-window.json): a missing key or a
missing metafield fails the run with InvalidVariableValueError before any code
runs, so the node gives no discount (checkout is not blocked). There are no
query defaults on purpose: the platform does not apply them. The local runner
(`shopify app function run`) binds no variables; fixtures carry the resolved
`campaignActive` leaf. @won/core buildNodeVars always writes both keys.
```

## Output size

Shopify refuses a function output over **20 kB** (1 kB = 1000 B) for carts up to
200 lines; the limit scales with the line count above that
(shopify.dev/docs/api/functions/2026-04, "Resource limits"). Over it, the node
gives no discount at all. The output mapping (the same in
`tests/reference-adapter.js` and `src/output.rs`) therefore works in three steps:

1. **Every value is exact and as groupable as possible.** Candidates with the same message and value share one candidate with several targets.
   - A fixed amount per item that equals the unit price → 100 %.
   - A Pro stack of fixed total T on a line of subtotal S:
     - T = S → 100 %;
     - whole-percent stack ΣP with `Math.round(S × ΣP / 100)` = T → ΣP %;
     - T divisible by the quantity q → T / q per item;
     - otherwise T once, on that line only. A shared `appliesToEachItem: false` amount would be applied once across all its targets, so it is never grouped.
   - A percent whose amount is half a minor unit (a rounding tie, `roundingTiePossible` / `tie_possible`: 10 % of 10.05 Kč) is emitted as its exact amount the same way (per item, else once on the line). Shopify rounds the decimal S × P / 100 itself and may round a tie the other way than the plan. The same holds for a stack's ΣP and for an order percent (then a fixed amount off the order).
   - Margin protection (MVP 2): a value it lowered (`margin_capped`) is always its exact amount, never a percent; with protection on, every order discount is emitted as its exact amount (`margin_protected`), never a percent of a base the checkout computes (`lines-margin-order-left-out`).
2. **Over the budget, exactness goes step by step, the cheapest loss first.** The budget is 19 000 B, scaled like Shopify's limit. The first step that fits wins; a step that changes nothing (no tie, no stack) is skipped; the function logs which steps it took.
   - a. Rounding ties go back to their percent. At worst 1 minor unit per line, and only if Shopify rounds the tie the other way (`lines-output-ties-relaxed`). Never on a margin-tight line (no minor unit left above its floor, or in the base of a margin-protected order discount): its tie stays exact (`lines-margin-tight-ties-exact`).
   - b. Every Pro stack is emitted as its top rule's own value, which groups; the customer keeps the larger part of the stack. Ties stay exact here when they fit (`lines-pro-stack-output-degraded`).
   - c. Both.
3. **Last resort, drop the smallest.** The product candidates that save the least are dropped until the output fits (`lines-output-truncated`). A margin-capped line is never relaxed by a or b: it keeps its exact amount or is dropped.

`mapToFunctionOutput` reports each step (`relaxedTies`, `degradedStacks`, `droppedCandidates`), and `checkoutPreview` sums them for the admin.

The rounding-tie test allows only the float error of `(S × P) / 100` (an absolute 10⁻⁹ plus 4·10⁻¹⁵ × the amount), never a share of the amount: a 500 000 HUF line at 10 % is not a tie, 10 % of 10.05 Kč is.

Above 200 lines the budget scales like Shopify's limit (`lines-240-lines-scaled-budget`: 22.7 kB, exact, under the 22 800 B budget of 240 lines).

Delivery: a percent (free shipping = 100 %) targets every delivery group; a
fixed amount targets the first group only. Shopify's docs do not say that one
fixed candidate on several groups is taken once, and the plan counts it once,
so a split shipment never gets it N times (`delivery-fixed-shipping-first-group`).

Worst-case fixtures:

| Fixture | Exact output | Emitted output |
|---|---|---|
| `lines-pro-stack-output-percent` | 32.7 kB before the change | 14.9 kB |
| `lines-pro-stack-output-degraded` | 35.0 kB | 11.6 kB (15 rounding ties as exact amounts) |
| `lines-output-truncated` | 47.5 kB | 18.2 kB |
| `lines-output-ties-relaxed` | 67 kB (200 exact ties) | 8.9 kB (one 10 % candidate) |
| `lines-240-lines-scaled-budget` | 22.7 kB | 22.7 kB (exact: the 240-line budget is 22 800 B) |

## Instruction budget

Shopify's limit is 11 M instructions for carts up to 200 lines and scales with
the line count above that. Its input limit is **128 kB of MessagePack** (1 kB =
1000 B), scaled the same way (shopify.dev/docs/api/functions/2026-04 "Resource
limits": "Function input 128 kB", "for carts with more than 200 line items,
these values will scale proportionally"). The page does not name the encoding;
the logs do: every one of the dev store's 802 logged runs
(`apps/won-discounts/.shopify/logs`) has `inputBytes` and `outputBytes` equal to
the MessagePack size of its input and output (`tests/input-size.js`
`messagePackBytes`, pinned to logged runs by `tests/input-size.test.js`), 78–99 %
of the compact JSON. A real input can so be ~15 %
more JSON than 128 kB, and the budget carts are filled to that real limit.
(The output budget below stays in JSON bytes: every fixture's output is at most
0.89 × its JSON in MessagePack, so it is the stricter measure.)

`apps/won-discounts/tests/contracts/function.contract.test.ts` gates every fixture:

- ordinary fixtures: ≤ **70 %** of the (line-scaled) limit;
- the budget carts (`*-lines-budget`, the realistic worst cases): ≤ **90 %** —
  9.9 M up to 200 lines, 24.75 M at 500;
- every budget cart is an input Shopify can send: ≤ 128 kB of MessagePack
  (scaled with the lines) and a shared config ≤ 9 000 B of JSON (C7).

The typical carts meet the old 75 % goal with room to spare (MVP 1 cart 47 %,
margin carts 53–58 %). The 90 % gate protects the realistic worst case at the
real input limit: a Pro cart with a cost price, a Pro stack and collection
margin settings on every line, whose input is Shopify's 128 kB. Such carts went
over Shopify's limit before MVP 2's fixes (101–143 %: no Won discount at all).

Every budget cart carries the ids the checkout really sends: rule ids in the
app's format (`r_` + 20 hex digits, rule-form.ts `newRuleId`) in the config and
the product metafields, cart line ids as Shopify numbers them
(`gid://shopify/CartLine/0`, `/1`, … — every line of the dev store's logged
function runs), 14-digit variant ids (fixture-builder.js `withRealisticIds`).
The Pro carts are filled to the input limit with variant-level refs of other
variants (`filledToInputLimit` in tests/scenarios.js): the function reads only
its own variant's entry, but the input provider walks every value, so the
filler costs what real data of that size costs.

Measured with the CLI's build (`shopify app function run`, the contract test);
"before" is the build of commit 37d51d9 on the same inputs:

| Budget cart (shape) | Input (MessagePack) | Before | Now | Gate |
|---|---|---|---|---|
| `lines-200-lines-budget` (MVP 1 worst case: 37 rules, 3–6 refs a line, codes, a Pro stack; margin off) | 68.6 kB | 5.46 M | 5.12 M (46.5 %) | 9.9 M |
| `delivery-200-lines-budget` | 68.7 kB | 5.19 M | 4.85 M (44.1 %) | 9.9 M |
| `lines-margin-200-lines-budget` (the same, margin on, a cost price on every line, a 5 % order discount; the order stage's shortcut) | 73.8 kB | 6.49 M | 6.08 M (55.2 %) | 9.9 M |
| `delivery-margin-200-lines-budget` | 73.9 kB | 6.20 M | 5.79 M (52.6 %) | 9.9 M |
| `lines-margin-slow-200-lines-budget` (10 lines that cannot carry their share: the full two-ordering search) | 73.9 kB | 6.83 M | 6.41 M (58.3 %) | 9.9 M |
| `lines-margin-capped-200-lines-budget` (3 of 4 lines cut to their floor, an output over the budget: stacks relaxed, candidates dropped) | 74.8 kB | 6.79 M | 6.38 M (58.0 %) | 9.9 M |
| `lines-margin-capped-500-lines-budget` (the same on 500 lines) | 178.3 kB | 15.73 M | 14.69 M (53.4 %) | 24.75 M |
| `lines-margin-pro-200-lines-budget` (Pro worst case: 37 rules, 4 refs a line, the Pro stack VIP + S_x, a cost price, 2 marginRefs of 100 collections with a margin setting and 5–6 variant-level refs of other variants on every line, a 10 % order discount, an output over the budget; config 8 997 B) | 128.0 kB | 9.84 M (89.4 %) | 9.34 M (84.9 %) | 9.9 M |
| `lines-margin-pro-500-lines-budget` (the same on 500 lines) | 320.0 kB | 23.36 M (85.0 %) | 22.10 M (80.4 %) | 24.75 M |
| `lines-margin-pro-bridge-200-lines-budget` (the Pro worst case with 4 marginRefs a product, as many as the sync's transition bridge writes, and 4–5 variant-level refs) | 128.0 kB | 10.12 M (92.0 %) | 9.62 M (87.5 %) | 9.9 M |
| `lines-margin-pro-long-ids-200-lines-budget` (the Pro worst case with 64-character rule ids: 29 collections fit the config; 4 refs on every line, 0–1 variant-level refs) | 128.0 kB | 8.23 M (74.8 %) | 7.76 M (70.6 %) | 9.9 M |

The drift audit's heavy generator (random search and hill climbing over rules,
refs a line, names, collections, costs, caps, stacks and 200–500 lines, every
input within Shopify's limits, now the MessagePack one), 3 seeds × 100 rounds a
marginRefs space, on this build: with the marginRefs the sync writes (≤ 2) and
its transition bridge (≤ 4), no run reaches the limit — up to **96.3 %** (it
found up to 107.2 % on the build before). Those shapes put 12 rule refs and a
Pro stack on every line, cap half the lines and fill the input: on them the
input provider's walk and the reads are ~70 % of the limit, the plan ~25 %.
With 20–30 marginRefs a product, as the sync wrote them before it kept only the
decisive ones (commit 37d51d9; the sync rewrites them), it still reaches 103.4 %:
each ref is a string the function reads (~600–900 instructions).

**Headroom caveat.** These are function-runner's counts (the CLI's `shopify app
function run`); the dev store's logged `fuelConsumed` was ~1 % below them on
small runs. A new function-runner, CLI or `shopify_function` crate can move the
counts a little: re-measure the budget carts after such a bump (the contract
test does), and read the 90 % gate as the realistic worst case's margin, not
as slack.

Most of a run is Shopify's input provider: walking the input costs ~26 k
instructions per kB whatever the function reads (every value), and every
property the function reads is a call into it (~400–650 instructions; a string
~500 more). What keeps the carts in budget:

- `src/input.rs` reads the input by its JSON value, not through the generated
  accessors: every key is interned once per run (`json.rs` `Key`), a line's
  merchandise is read without `__typename`, an object's keys are looked up only
  until all it has were found (`Fields`, `WonProduct::read`), an object the
  query gives one field is read by position (`sole`: `jsonValue`, `wonProduct`,
  `amountPerQuantity`, `amount`, the gift's `value`), and a value is decoded
  once where its type decides (an array is a key that held something);
- decisive marginRefs (≤ 2 a product, core targeting.ts) and no `marginRefs`
  read at all without collection settings; collection settings looked up by the
  numeric id (`MarginRef`), and each distinct refs list resolved once per run;
- `src/engine/table.rs`: the run's lookup tables (rule ids, code hashes, refs
  lists, collection settings, output grouping, outlet lists, the plan's caches)
  are open-addressing tables with a cheap hash and word-at-a-time key equality —
  std's HashMap and `memcmp` (a byte loop in Wasm) cost ~300 instructions a
  lookup; a line whose refs equal the previous line's (a product's lines) is
  not looked up again;
- rules are ranked once per run in (priority desc, id asc in JS string order)
  order (`Rule::order`), so the ties after the amount compare one number; a
  line's candidates are sorted by insertion, a dozen or more of them as integer
  keys (amount, order, rule);
- the Pro stack search builds its sets over the rules' partner bits in one pass
  a seed; and the rank order and sets are cached per run by the line's
  candidates (`StackOrders`: a line with the same candidates as an earlier one
  tries that line's rank order — kept only when it is the rank order — and then
  only sums the sets), the owner and message of a stack by its rules
  (`StackLabels`: one shared message, which the output finds by address);
- no 64-bit multiplication with an overflow check on the hot path
  (`money::mul_sat`): Wasm has none, and `saturating_mul`/`checked_mul` call a
  128-bit multiply of a few hundred instructions;
- `src/alloc.rs`: a bump allocator, and nothing a run built is ever dropped (a
  stack message is leaked on purpose: the run's memory is thrown away);
- the output mapping keeps the output's size as a running sum and drops the
  least-saving candidates through a heap (re-measuring the order candidate,
  which lists every capped line, on every drop was quadratic: 16.4 M on a
  200-line capped cart), measures JSON strings 8 bytes at a time, and borrows
  every text from the plan and the input instead of copying it;
- the order stage's exact shortcuts (Invariants below).

## Layout

| Path | What |
|---|---|
| `src/main.rs` | `#[typegen]` + `#[query]` modules (the input queries checked against the schema at compile time), the two Wasm exports (dash-named, as in the JS version) |
| `src/cart_lines_discounts_generate_run.rs`, `src/cart_delivery_options_discounts_generate_run.rs` | the two targets |
| `src/input.rs` | function input → engine cart, config and node role (the reference adapter's `adaptInput`), read from the input's JSON value; the margin inputs are read only while protection is on, `marginRefs` only with collection settings |
| `src/json.rs` | the interned object keys (`Key`), tolerant readers for the `jsonValue` metafields (product, variant cost), the line price and `presentmentCurrencyRate`, the per-run outlet-list cache |
| `src/alloc.rs` | the Wasm build's bump allocator (instruction budget; native tests keep the system allocator) |
| `src/output.rs` | emission → function output (`@won/core` `function-output.ts`): exact values, rounding ties, grouping, the output budget, delivery groups; written through the Wasm API |
| `src/engine/` | `config.rs` (shared config), `cart.rs` (normalizeCart), `plan.rs` (planCart, the margin stages of `plan-margin.ts` included), `order_search.rs` (`searchOrderSets`, pure), `margin.rs` (`margin.ts`: the payload reader, floors, cost conversion), `emit.rs` (emitForNode), `hash.rs` (code hash), `money.rs`, `describe.rs`, `table.rs` (the run's lookup tables), `js.rs` (the JS semantics the engine relies on: Math.round, trim, string order) |

Invariants:

- Money is in integer minor units (i64). Sums saturate.
- Percentages use the TS float expression and `Math.round` semantics.
- Ties go to amount desc, then priority desc, then id asc (JS string order, by UTF-16 unit).
- A minimum counts the whole cart (every non-gift line, pre-discount, outlet included), or only a product rule's own lines when the payload says `minimum.scope: "entitled"` (a migrated native's semantics; absent = the cart).
- Parsing never fails. Junk in a metafield reads as "nothing". A missing or invalid shared config emits no operations.
- Margin protection (MVP 2) evaluates every float expression of `margin.ts` / `plan-margin.ts` in the same order (`ceilTol` = ceil(x − 1e-6), the cost `(unitCost × rate) × scale`, the order stage's floor((h × S) / a) and floor((h × S0) / s)). The order stage's search is the pure function `search_order_sets` (`src/engine/order_search.rs`, `searchOrderSets`, unit-tested with the TS instances) and gets the same result as the TS search with less work, provably: the minimum over a set comes only from lines whose rate is within 10⁻⁹ of the set's smallest (`NearMin`), and the h/a ordering is not searched again when it is the h/s ordering's very sequence (no product discounts). `protect_order` (`plan.rs`) leaves the lines that can give nothing (h = 0) out of the search, since every set holding them has D = 0, and when every line that can give something carries its whole share, that set wins both orderings without sorting (`all_that_can_give`; this one needs an order amount that never falls as the base grows, which every order discount is). A dedicated parity run (2 000 carts built for it) compares every reachable way the search ends — the shortcut, the skipped h/a search, the h/a ordering winning, a tie between different sets going to the larger one — against the TS search. The last tie-break (equal D, equal size, different sets → the h/s set) does not occur with an order discount's wanted amount, which never falls as the base grows (0 in that run, 0 in T1's 2 million random cases); the unit-test pair `order_search_ties_go_to_the_larger_set_then_to_the_h_s_set` pins it with a synthetic wanted amount.
- A run never frees what it built: the bump allocator (`src/alloc.rs`) and `mem::forget` at the end of a run (its memory is thrown away with it).

## Accepted edge differences (junk data only)

These differ from the TS reference only for values that the admin's
`sanitizeConfig`, the sync or the platform never produce. They are accepted and
not covered by the random parity test.

- **Priority.** A priority beyond ±9.2·10¹⁸ saturates in `i64`, while TS still orders such priorities. The sanitizer clamps priority to 0–1000 (`CONFIG_LIMITS.rulePriority`).
- **Huge money.** Config amounts are capped at 10¹² minor units by the sanitizer (`CONFIG_LIMITS.moneyMinorUnits`) and both engines read a larger hand-made amount as that cap, so they always agree on it. Cart prices arrive as decimal strings and are refused above 2⁵³ − 1 minor units on both sides. What remains: a cart whose TOTAL passes 2⁵³ minor units (~90 trillion CZK) saturates in Rust and loses precision in TS.
- **Number text.** Rust prints plain decimals where JS switches to exponent notation (≥ 10²¹ or < 10⁻⁶).
  - For a line price given as a JSON number, both read the same value: Shopify sends prices as strings, and such numbers end as "no price" or 0 on both sides.
  - Percentages are clamped to 0–100 and messages round them to 2 decimals. A percent below 10⁻⁶ would print differently but parse to the same number.
- **Unicode case mapping.** Discount codes are upper-cased with Rust's Unicode tables, while the admin hashes them with Node's ICU tables. A code containing a character whose upper-case form differs between those Unicode versions (only recently added characters) hashes differently. It then never matches, which fails closed: that code's rule does not apply.
- **Outlet lists.** Lines are taken to share one outlet list when the list's length and first element agree. That is always true for what the sync writes, because a product lists its own variant GIDs and a variant belongs to one product. A hand-made metafield where two products list the same first GID but differ further on would be read as one list.
- **Duplicate JSON keys.** Metafield JSON is stored parsed, so duplicate keys cannot reach the function.
- **Schema-invalid input.** Shopify builds the input from the query, so it always has the query's shape; the function reads it by that shape (`src/input.rs`, not through the generated accessors): a line's `merchandise` counts as a ProductVariant by its fields (`product`, `wonVariant`, `id`, which only `... on ProductVariant` selects), not by reading `__typename`; a line without an `id` string is skipped and a `quantity` that is not a positive number reads as 0, as in the reference adapter; an object the query gives exactly one field (a metafield's `jsonValue`, `product { wonProduct }`, `cost { amountPerQuantity { amount } }`, the gift attribute's `value`, an `isoCode`, a `code`, a delivery group's `id`) is read by position when it has one key (`sole`), by name otherwise. Input that is not the query's shape (a CustomProduct with product fields, a missing key the schema requires, a one-field object whose one key is another) can differ; it cannot reach the function.
- **Numbers with 16 or more significant digits, or an exponent outside ±22** (drift audit P3-1). Shopify's input provider and the local runner read JSON numbers with serde_json's fast parser, which can land 1 ulp away from `JSON.parse` for such numbers (`23.794300000050022` reads as `23.794300000050026`; `6.0343000001e-34` likewise). On a cost at a `ceilTol` boundary (x ≈ N + 1e-6 minor units) that moves the floor by 1 minor unit either way. A number beyond the f64 range (`1e400`) makes the runner reject the whole input (no discount, checkout not blocked), where TS reads Infinity. What the app writes never has such numbers: the cost mirror writes Shopify's decimal cost as a number with at most 15 significant digits (`apps/won-discounts/tests/lib/sync/costs-digits.test.ts`), the rule editor and the migration round percents to 2 decimals, and margin percents keep 1 decimal (config/margin.ts); 15 digits and exponents within ±22 are read exactly by both (Clinger's fast path). How production Shopify reads numbers was not observable; the live runs had costs 5 and 6.
- **Duplicate cart line ids (margin).** A line is margin-tight when it is in the order discount's base; the TS engine decides that by line id, the Rust function by line. They differ only when two cart lines share an id, which Shopify never sends.

Not a difference, but a rule both sides share: `presentmentCurrencyRate` is read as plain decimal digits cut to their first 15 significant digits (`decimalNumber` in the reference adapter, `DecimalNumber` in `src/json.rs`, which reads it without float-parsing tables for the Wasm size limit: one exact division or multiplication). The cut changes a rate by less than 10⁻¹⁴ of itself, far below a haléř on any cost (`lines-margin-rate-long`). Only a rate that after the cut has more than 22 decimals or drops more than 22 integer digits (below 10⁻⁷, above 10³⁶: not a currency rate) reads as no rate; so do junk, a missing rate (`lines-margin-rate-missing`) and a null one — cost prices in another cart currency are then unknown and the maximum-discount ceiling applies — never a wrong conversion, but that ceiling is only stricter than no protection, not necessarily than the cost floor (a product whose cost is 70 % of its price keeps a 50 % ceiling). What Shopify actually sends is to be confirmed live (Task 5b, F-M1).

## Build, dev and test

Rust is installed user-level (rustup) and is **not on the default PATH**. The
npm scripts add it themselves:

```sh
npm test -w won-discounts-engine             # cargo test, then vitest (fixtures, drift, parity, twins, query cost)
npm run build:functions -w won-discounts     # this function only (cargo + trampoline)
npm run build:all -w won-discounts           # the function, then the app
npm run dev -w won-discounts                 # shopify app dev, with cargo on PATH (hot reload)
```

`npm run build -w won-discounts` builds the app only, so CI's `build:apps`
needs no Rust toolchain; CI does not run this function's tests. In a shell of
your own, run `export PATH="$HOME/.cargo/bin:$PATH"` before `cargo` or
`shopify app dev`.

The target `wasm32-unknown-unknown` is required, because `shopify_function` 2.x
refuses `wasm32-wasip1`. `rust-toolchain.toml` lists it, so rustup installs it
when it is missing.

A function build briefly re-exposes cargo's raw Wasm before the CLI re-applies
its trampoline. Don't run the function tests while another build of it runs,
such as a `shopify app dev` hot reload; if that happens, re-run them.
