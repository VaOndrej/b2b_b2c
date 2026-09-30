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
| The Pro stack cap, 1 500 Pro mesh carts built for it, every way it decides ≥ 20 times | `tests/parity.test.js` |
| The margin order search's bound, 1 000 carts of 17–60 lines whose rates tie in classes, the exact limit, the bound and the shortcut checked against it each ≥ 20 times | `tests/parity.test.js` |
| The search against its written-out definition, 5 000 line sets of tied and nearly tied rates, and a digest of its answers equal to the TS search's | `cargo test` (`the_order_search_on_clustered_rates_…`) and its twin |
| Many markets (up to 50, duplicated handles, the country anywhere or nowhere) and entered codes (up to 250: foreign, matching in any case and padding, repeated, non-ASCII, empty; the 25-code cap binding and leaving a Won code out ≥ 20 times), 400 carts | `tests/parity.test.js` |
| Entered codes of any length against the longest Won code (`maxCodeLength` shipped, missing, junk, 0, below a Won code; codes of 1–300 characters, a Won code one character longer, Won codes padded within and past the longest + 16 as entered, codes whose upper-case form alone is too long, white space, entries without a code string; code nodes), 600 carts, each of 12 ways ≥ 20 times | `tests/parity.test.js` |
| The dev store's logged runs (every real checkout run) through a build: its output parsed and serialized again = the logged output so | `tests/replay-logs.mjs` (by hand, below) |

Details:
- **Wasm output text.** The output text function-runner prints (sorted keys, and numbers in the form the Wasm wrote them, e.g. `10` not `10.0`) must equal the expected output rendered the same way.
- **Native Rust output text.** Compared character for character. The same run checks that the output-size arithmetic equals the written JSON.
- **Random carts.**
  - Seeds `20260928,1,2,3,5,8` × 400 cases, up to 260 lines, junk data included.
  - "Big" carts (150–260 lines, 200-character names, distinct Pro stack amounts or rounding ties) go over the output budget, so the degraded and truncated outputs are compared too; "large" carts reach quantities of 5 000, prices of 99 999 999.99 and amounts at the money cap.
  - Codes padded with NBSP, BOM and tab, astral and case-mapped codes; lower-case, padded and invalid countries; priorities up to 1 000; CZK, EUR, JPY, KWD, HUF, BHD and USD; entitled minimums; a fixed shipping amount on split shipments.
  - Rule ids include non-ASCII, astral and 64-character text, plus a UTF-16 tie mode, so the tie order is compared too.
  - Margin protection (MVP 2): on / off / legacy / junk payloads, collection overrides (products listing more than 4 marginRefs among them), cost prices in the shop currency and in others, junk costs, `presentmentCurrencyRate` as decimal strings, numbers and junk, carts of exponent 0 / 2 / 3, and big over-budget carts with capped and tight lines. Every margin branch (capped, capped to 0, capped stack, order lowered / leaving lines out / floored, exclusive mode, cost and maximum-% floors, collection settings, converted and unconvertible costs, tight lines, over-budget outputs, margin off with costs) is counted like the rest.
  - Every engine branch must be hit ≥ 20 times, or the test fails.
  - Env overrides: `PARITY_SEEDS=…`, `PARITY_CASES=…`.
- **Entered codes of any length.** 1–5 code rules with codes of 1–64 characters (ASCII, Czech, ß and ligatures whose upper case is longer, Greek with a 2–3-character upper case, astral, CJK); `maxCodeLength` as the sync ships it (55 %), below the longest code (a hand-made payload), junk or out of range, or missing; 1–60 entries: the codes in any case and padding (up to 3 characters, or 4–19 of one white space character on either side: within and past the longest + 16 as entered), a Won code one character longer, foreign codes of 1–300 characters, white-space-only codes, `""`, `{}`, `{code: null}`, `{code: 7}`; a code node of the rule owning the triggering code. Counted: a code over the longest left out, a padded Won code longer as entered than the longest (matched), a Won code padded past the longest + 16 (left out), a code whose upper-case form alone is over the longest (left out), a code over 64 among the first 25, a Won code left out by a hand-made bound, a Won code past the cap behind left-out or empty entries, a code node emitting and one emitting nothing for a left-out trigger (`PARITY_LONG_CASES=…`).
- **Pro stack cap.** 7–16 product rules combining at a random density up to a full mesh (percents with repeats, fixed amounts, code rules, priorities), 1–40 lines each listing its own 5–14 of them, half the carts with 7–9 order rules in a mesh, 40 % with margin protection. Counted: a line with 7+ candidates that stacks, a stack of the 6 best, a partner of the whole stack left out by the cap, margin cutting a capped stack, an order stack of the 6 best (`PARITY_MESH_CASES=…`).
- **Margin order search's bound.** 17–60 lines, most of them k × one price with a cost floor of k × (price − headroom) − 1 haléř (a 10 or 20 % product discount keeps them proportional), so a class's rates tie exactly; k from ranges of 8, 16, 17 or 40 values, so a candidate set has fewer than, exactly or more than 16 distinct lines tied for its minimum; a few ordinary lines; an order discount of 5–90 % or a fixed amount (`PARITY_TIED_CASES=…`).
- **Unit-test twins.** Each twin runs the Rust test's scenario through the TS engine and asserts the same values. The test names are paired automatically.
- **Replay of the logged runs.** `node tests/replay-logs.mjs <wasm> [<wasm> …]` runs every function run the dev store logged (`apps/won-discounts/.shopify/logs`, what `shopify app dev` writes) through each build and compares its output with the logged one (both parsed and serialized again: key order and values, not how a number was written — the fixtures' text check covers that); with two builds it also counts the runs where they differ from each other. Audit round 4 (the order search's bound, landed while the final live E2E gate ran; `shopify app dev` uploaded the new build at 09:52 UTC, and the dev bundle's Wasm is byte for byte the tested one): 1 024 runs with an input; the new build, the round-3 build and the round-2 build gave the same output on every one; 874 equal the log (every run since 2026-09-28 18:00 UTC, the final gate's 222 of 2026-09-30 included, 73 of them served by the new build), and the 150 that do not are the MVP 0 prototype's contract probes of 2026-09-28 11:19–14:11 UTC (a different function and config: messages `WON:WONPROTO1…`, ~570 k instructions a run). 9 more logged runs have no input (the C4 probes' `InvalidVariableValueError`). Audit round 5 (markets resolved once, entered codes matched in one pass; the dev bundle again byte for byte the tested build): 1 091 runs, the new build and the round-4b build the same on every one, 941 equal to the log, the other 150 the same MVP 0 probes. Audit round 6 (entered codes bounded by the longest Won code, the case table, cart lines read by position): 1 094 runs, the new build and the round-5b build the same on every one, 944 equal to the log, the other 150 the same MVP 0 probes. Audit round 7 (entered codes bounded as entered, the 2-byte case table, markets read for the cart's country; the dev bundle byte for byte the tested build, sha1 be756b08…): 1 094 runs, the new build and the round-6 build the same on every one, 944 equal to the log, the other 150 the same MVP 0 probes.

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
                  decisive collections with a margin setting, ≤ 2, MVP 2;
                  more than 4 → the store's strictest setting, none read)
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

- ordinary fixtures, and the budget carts that are not at the input limit
  (the MVP 1 and margin-path carts, 55–75 kB of input, 44–58 %): ≤ **70 %** of
  the (line-scaled) limit, so the larger allowance below never hides a
  regression on them;
- the budget carts filled to Shopify's input limit (`lines-margin-pro-*`,
  `lines-margin-near-min-*`, `lines-markets-*`, `lines-codes-*`, each checked
  to be ≥ 99 % of it): ≤ **90 %** —
  9.9 M up to 200 lines, 24.75 M at 500;
- every budget cart is an input Shopify can send: ≤ 128 kB of MessagePack
  (scaled with the lines) and a shared config ≤ 9 000 B of JSON (C7).

**What holds, measured (audit round 7).** Every search the function runs is
bounded per target by a constant: a Pro stack is searched among its 6
best-ranked candidates, the margin order search evaluates a candidate set's
limit line by line over at most 16 lines tied for its minimum, a product has
at most 4 marginRefs read (more → the store's strictest setting), the config's
markets are read once per run and only as far as the cart's country decides
them, at most the first 25 entered codes are read, and of those only a code at
most the longest Won code (≤ 64 characters) + 16 long as entered is trimmed,
and hashed only until its upper-case form passes the longest Won code (all in
Invariants and below). So a run's cost grows with what it reads, and Shopify's
input limit bounds that. **Every family the audits' sweeps, hill climbs, hunts
and tunings found stays under 99 % of the limit; the highest is 98.3 %**
(below), with every input within the limits the app and Shopify set (a shared
config ≤ 9 000 B, a product metafield ≤ 9 000 B, the input ≤ Shopify's
MessagePack limit, app-format rule ids, ≤ 250 entered codes of any length, ≤ 50
markets).

**The margin is thin — re-run the search before adding work.** The costliest
bases (JPY, 16–20 markets of 20–30 countries that every rule targets with the
cart's country last, 11–30 rule refs a line, exclusive mode, most lines capped,
an output over the budget, the input filled) run at ~97.4–97.9 % with no entered
code, and 24 of the costliest entered codes add ~0.5–0.8 point. 1 % of the
limit is 110 k instructions, ~550 a line of a 200-line cart. Any new per-line,
per-ref, per-market or per-code work in a later MVP must re-run this search
(the audit generators heavy8–heavy12 and their tunings, the saved families
below) before it ships. What the function's input costs, measured:

| What the input holds | Instructions | Per byte of input |
|---|---|---|
| A string the function reads (a rule ref, a market handle, a country, a line id) | ~630–670 (the provider's `get_at_index` ~470, the copy ~180) | ~30 (a 22-character ref) – ~220 (a country) |
| A small value the function never reads (an entered code after the 25th, a sibling variant's refs) | ~0.9 k (`{"code":"X"}`: the provider walks it) | ~110 |
| A long string the function never reads | ~0 (skipped by its length) | ~0 |
| One of the first 25 entered codes | up to ~7 k (below) | 26–54 |

- **Entered codes.** A cart can hold 250 codes (the Storefront API's maximum)
  of up to 255 characters. Only the first 25 entries count (Invariants), so
  the function reads at most 25; the rest cost only the provider's walk
  (~0.9 k instructions an entry). Of those 25, an entry longer than the
  longest Won code + 16 as entered is left in O(1) (its byte length alone
  rules it out) or after at most that many white space characters, and one
  whose upper-case form is longer than the longest Won code after that many
  units — never upper-cased or trimmed further. The rest are trimmed (~30
  instructions an ASCII space, ~52 an NBSP, ~72–77 a 3-byte white space
  character) and hashed as they would be upper-cased (~43 an ASCII character,
  ~72 a 2-byte one, ~97–109 a 3-byte one, ~139 an astral one; ß → SS ~100,
  ΐ → 3 characters ~108, ᾀ → 2 ~137). So a code costs at most ~7 k
  instructions (64 fullwidth or Georgian letters; 80 characters of the most
  white space ~6.3 k), 25 of them ≤ ~175 k (1.6 % of the limit), and per byte
  of input 26–54 — about what a rule ref costs (~30). The round-6 re-review
  found padding (19–35 instructions a byte of white space around a code, with
  no bound: 25 codes of 4 000 spaces took a 2-line cart to 30.7 %, 1.6 % now)
  and expanding letters (ΐ ~135, ﬃ 148 a character) taking its costliest
  bases to 99.9–100.03 %; on this build they measure at most 98.0 %.
  Without a code rule whose hash a code can have, none is read.
- **Pro markets.** The config's markets are read for the cart's country
  (`Config::read_in`): a market's countries until it (a market that does not
  hold it: every one), and a rule's market handles until one of the markets
  that hold it — ~670 instructions a country and ~630 a handle (round 6: ~860
  and ~730, every one read and copied). The same decisions as the whole lists
  (`markets_read_for_the_carts_country_decide_as_the_whole_lists`, the parity
  runs). 20 markets of 20 countries that 20 rules target are still ~0.52 M
  instructions (~4.7 %) when the cart's country is the last one listed.
- Every other family stays under 99 % (table below).
- The realistic worst cases, the gated budget carts, stay ≤ 90 % (max 85.7 %).
- The rule refs a line lists are strings the function reads and resolves
  (~0.7–1 k instructions each), ~1 % of the limit per ref at the input limit. There
  is no limit on the rules targeting one product (a product decision, audit
  round 3): the input limit bounds the refs.

The typical carts meet the old 75 % goal with room to spare (MVP 1 cart 45 %,
margin carts 51–56 %). The 90 % gate protects the realistic worst case at the
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

Measured with the CLI's build (function-runner, as `shopify app function run`
and the contract test run it); "before" is the round-6 build (audit round 6,
Wasm sha1 43341357…) on the same inputs. Round 7 moved no cart by more than
0.1 point but the markets cart (0.8: markets read for the cart's country) and
the Won-codes cart (0.4: the 2-byte case table).

| Budget cart (shape) | Input (MessagePack) | Before | Now | Gate |
|---|---|---|---|---|
| `lines-200-lines-budget` (MVP 1 worst case: 37 rules, 3–6 refs a line, codes, a Pro stack; margin off) | 68.7 kB | 4.91 M (44.7 %) | 4.91 M (44.6 %) | 7.7 M (70 %) |
| `delivery-200-lines-budget` | 68.7 kB | 4.63 M (42.1 %) | 4.63 M (42.1 %) | 7.7 M |
| `lines-margin-200-lines-budget` (the same, margin on, a cost price on every line, a 5 % order discount; the order stage's shortcut) | 73.8 kB | 5.81 M (52.8 %) | 5.80 M (52.8 %) | 7.7 M |
| `delivery-margin-200-lines-budget` | 73.9 kB | 5.51 M (50.1 %) | 5.51 M (50.1 %) | 7.7 M |
| `lines-margin-slow-200-lines-budget` (10 lines that cannot carry their share: the full two-ordering search) | 73.9 kB | 6.14 M (55.8 %) | 6.13 M (55.8 %) | 7.7 M |
| `lines-margin-capped-200-lines-budget` (3 of 4 lines cut to their floor, an output over the budget: stacks relaxed, candidates dropped) | 74.9 kB | 6.10 M (55.4 %) | 6.10 M (55.4 %) | 7.7 M |
| `lines-margin-capped-500-lines-budget` (the same on 500 lines) | 178.3 kB | 13.97 M (50.8 %) | 13.97 M (50.8 %) | 19.25 M |
| `lines-margin-pro-200-lines-budget` (Pro worst case: 37 rules, 4 refs a line, the Pro stack VIP + S_x, a cost price, 2 marginRefs of 100 collections with a margin setting and 5–6 variant-level refs of other variants on every line, a 10 % order discount, an output over the budget; config 8 998 B) | 128.0 kB | 9.03 M (82.1 %) | 9.03 M (82.1 %) | 9.9 M (90 %) |
| `lines-margin-pro-500-lines-budget` (the same on 500 lines) | 320.0 kB | 21.31 M (77.5 %) | 21.31 M (77.5 %) | 24.75 M |
| `lines-margin-pro-bridge-200-lines-budget` (the Pro worst case with 4 marginRefs a product, as many as the sync's transition bridge writes, and 4–5 variant-level refs) | 128.0 kB | 9.31 M (84.7 %) | 9.31 M (84.6 %) | 9.9 M |
| `lines-margin-pro-long-ids-200-lines-budget` (the Pro worst case with 64-character rule ids: 29 collections fit the config; 4 refs on every line, 0–1 variant-level refs) | 128.0 kB | 7.46 M (67.8 %) | 7.46 M (67.8 %) | 9.9 M |
| `lines-margin-pro-mesh-200-lines-budget` (the stack search's worst case: 18 Pro rules that all combine, every line a DIFFERENT 12 of them, a cost price, a 5 % order discount, 2–3 variant-level refs; config 8 172 B) | 128.0 kB | 9.05 M (82.3 %) | 9.05 M (82.3 %) | 9.9 M |
| `lines-margin-near-min-200-lines-budget` (the order search's worst case: every line's rate within 10⁻¹¹ of the others', a 20 % ceiling and no cost prices, a 30 % order discount no line can carry, every line a different 10 of 14 code rules nobody entered, 3–4 variant-level refs) | 128.0 kB | 7.14 M (65.0 %) | 7.14 M (64.9 %) | 9.9 M |
| `lines-margin-near-min-500-lines-budget` (the same on 500 lines) | 320.0 kB | 17.45 M (63.5 %) | 17.45 M (63.4 %) | 24.75 M |
| `lines-markets-200-lines-budget` (Pro market targeting at its limits: 50 markets of 5 countries, every rule targeting all 50, the cart's country last; 10 product rules, each line a different 4–8 of them, a 5 % order discount) | 128.0 kB | 7.75 M (70.4 %) | 7.66 M (69.6 %) | 9.9 M |
| `lines-margin-pro-bridge-codes-200-lines-budget` (the heaviest realistic cart, the bridge, with 250 entered codes — Shopify's maximum a cart: PROCODE first, then partners' codes, repeats, non-ASCII; only the first 25 entries count) | 128.0 kB | 9.43 M (85.7 %) | 9.43 M (85.7 %) | 9.9 M |
| `lines-margin-pro-bridge-won-codes-200-lines-budget` (the bridge with the code rule's 25 codes of 64 Czech letters with diacritics — the longest a Won code can be, every character upper-cased through the Unicode tables — all 25 entered in lower case; 90 collections fit the config; audit round 6) | 128.0 kB | 9.40 M (85.4 %) | 9.35 M (85.0 %) | 9.9 M |
| `lines-codes-200-lines-budget` (40 entered codes — foreign, a code rule's own padded in lower case, repeats, non-ASCII — with a code rule configured; the same cart without markets) | 128.0 kB | 6.99 M (63.5 %) | 6.98 M (63.5 %) | 9.9 M |

Adversarial sweeps, hill climbs and tunings on this build (every input within
the limits above; outputs equal to the TS reference in every run; "round 6" =
the round-6 build on the same saved inputs, "—" = found on this round's
candidate; the saved inputs of every earlier audit round were re-run, 93 145
in all):

| Family | Runs | Round 6 | Round 7 | ≥ 90 % | ≥ 99 % | ≥ 100 % |
|---|---|---|---|---|---|---|
| Round 7's hill climbs (heavy12: heavy11 + the costliest entered codes per character and per byte — ß, ΐ, ᾀ, Czech, Cyrillic, Georgian, fullwidth, CJK, mixed — and every one of the first 25 padded to exactly the longest Won code + 16 with U+200A, U+FEFF or spaces), 8 seeds × 100 rounds | 798 | — | 98.2 % | 556 | 0 | 0 |
| The round-6 re-review's climbs (heavy10, heavy11 and its fine space) re-run from its starts on this build, 20 seeds | 1 926 | — | 98.1 % | 1 316 | 0 | 0 |
| Tunings of the 38 top climbed inputs (the first 25 codes as each of 10 costliest kinds, bare or padded to the bound with U+FEFF or spaces; the config topped up to 9 000 B with countries or names; the input refilled with sibling refs) | 4 680 | — | **98.3 %** | 4 680 | 0 | 0 |
| Every code kind on the round-6 re-review's top base (`realDup`: JPY, 20 markets, 11 refs a line), Won code first or not | 54 | — | 98.2 % | 54 | 0 | 0 |
| The round-6 re-review's saved climbs (h10–h12: ΐ, Czech and padded codes on 12–20 markets) | 1 926 | 99.9 % | 98.1 % | 1 317 | 0 | 0 |
| Its tunings (combo, tune1–4, over: ΐ/ΰ/ß/ﬃ/ž codes, countries up to 9 000 B, no `maxCodeLength`) | 108 | 100.03 % | 98.0 % | 108 | 0 | 0 |
| Its padding families (pad1–pad4, ws: white space around the codes up to the input limit) | 384 | 98.6 % | 97.6 % | 126 | 0 | 0 |
| Its and round 6's 1-line code sets (every scalar value's codes, expanding letters, 250 codes) | 1 543 | 3.7 % | 3.7 % | 0 | 0 | 0 |
| Round 6's own hill climbs (heavy9), 20 seeds | 2 850 | 98.3 % | 97.6 % | 1 598 | 0 | 0 |
| The round-5b re-review's heavy8 climbs | 2 032 | 98.3 % | 97.6 % | 1 138 | 0 | 0 |
| Its top inputs, long codes and every fixture with 25 × 255 "ﬃ" | 136 | 97.9 % | 97.2 % | 31 | 0 | 0 |
| Round 6's long codes at the bound and markets sweeps | 68 | 97.8 % | 96.9 % | 47 | 0 | 0 |
| The round-4 re-review's families: heavy4–heavy7 (rule refs up to 30 a line, 60 rules, 1–50 markets), their markets and entered-codes variants | 5 579 | 95.9 % | 95.6 % | 2 025 | 0 | 0 |
| The audit round 2 generator (hill climbing over rules, refs a line, names, collections, costs, caps, stacks, 200–500 lines), decisive and transition marginRefs | 961 | 90.8 % | 90.8 % | 7 | 0 | 0 |
| The same extended with the round-3 dimension, and round 3's capped sweeps | 2 895 | 87.1 % | 87.1 % | 0 | 0 | 0 |
| The round-2 re-review's hunt and round 2/3's adversarial shapes and refs dimension | 166 | 90.9 % | 90.9 % | 9 | 0 | 0 |
| The round-3 re-review's near-minimum order search; round 4's own tied and ulp-close rates | 89 | 79.2 % | 79.2 % | 0 | 0 | 0 |
| Legacy marginRefs (16–30 a product) | 612 | 85.8 % | 85.7 % | 0 | 0 | 0 |
| The round-2 re-review's adversarial sets (junk in every field, huge money) | 1 569 | 60.3 % | 60.3 % | 0 | 0 | 0 |
| The engine fix rounds' parity fuzz (random, junk, big and capped carts, 101–404 lines) and their sweeps | 19 673 | 90.9 % | 90.9 % | 35 | 0 | 0 |
| The drift audits' node inputs (random realistic carts and configs, every node of each) | 49 536 | 75.0 % | 75.0 % | 0 | 0 | 0 |

The fixtures: max 85.7 % (the bridge with 250 codes), the same as round 6.

Two saved sets are outside the limits above and are left out: the round-2
re-review's memory inputs `mem/k12`–`k24` (30 rules in a full mesh, 20 refs on
every line, rule ids of 2–3 characters: 103–120 % on this build, 103–120 % on
the round-6 build) — with the app's rule ids (`r_` + 20 hex digits) their
config is 17 kB, over the 9 000 B limit (and even so the heaviest measures
92.7 %); and 1 577 inputs over the input or config limit (1 451 of them the
round-2 re-review's adversarial sets, 50 the round-6 re-review's padding sets).

Round 7 changed no output of these runs but 333, among the 885 inputs whose
matching the new rule decides differently (an entry among the first 25 with a
Won code's hash that one rule matches and the other does not; checked for
every input). Of the 333, 326 carry a Won code with 1 000 or more white space
characters around it (the round-6 re-review's padding fills, the long-code
generator's padded codes), 7 a Won code whose upper-case form is longer than
the payload's `maxCodeLength` (hand-made payloads: the builder ships the
longest upper-cased code). A random 4 000 of the other 92 260 inputs give the
same output on both builds (3 997; the runner refuses 3 drift probes on both).
Where the TS reference differs from the Wasm (206 adversarial inputs with money
beyond 2⁵³, 91 drift inputs with numbers of 16+ significant digits, 3 fuzz
inputs; Accepted edge differences), it differs the same way from the round-6
build, and none of them has an entry the new rule decides differently.

Round 6 changed no output of these runs (84 874 inputs, both builds side by
side) but 35, each with a Won code longer than 64 characters (UTF-16 units)
among the first 25 entries — the heavy8 generator's codes of 100 and 255
characters, the long-code generator's astral and padded ones — which the
editor and the sanitizer no longer accept: that code no longer matches. Where
the TS reference differs from the Wasm (206 adversarial inputs with money
beyond 2⁵³, 91 drift inputs with numbers of 16+ significant digits, 3 fuzz
inputs; Accepted edge differences), it differs the same way from the round-5b
build, and the TS reference of HEAD gives the same outputs as this one; 26
drift probes with numbers beyond the f64 range are refused by the runner on
both builds.

The order search's bound changed no output of these runs (the drift audit's
four generator families at four seeds, 12 939 inputs, and the re-review's
adversarial set, 300: 0 outputs differ from the round-3 build) and moved their
instructions by less than 0.05 %. The shapes over 90 % are not driven by a search (their Pro
stacks are pairs, their order searches small): they put 12 rule refs on every
line of a 200-line cart with pair stacks, cap half the lines, carry an order
stack and margin collections, and fill the input (the refs dimension above).

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
- decisive marginRefs (≤ 2 a product, core targeting.ts), none read at all
  without collection settings, and none read of a product listing more than 4
  (only the array's length: the store's strictest setting applies); collection settings looked up by the
  numeric id (`MarginRef`), and each distinct refs list resolved once per run;
- `src/engine/table.rs`: the run's lookup tables (rule ids, code hashes, refs
  lists, collection settings, output grouping, outlet lists, the plan's caches)
  are open-addressing tables with a cheap hash and word-at-a-time key equality —
  std's HashMap and `memcmp` (a byte loop in Wasm) cost ~300 instructions a
  lookup; a line whose refs equal the previous line's (a product's lines) is
  not looked up again;
- rules are ranked once per run in (priority desc, id asc in JS string order)
  order (`Rule::order`), so the ties after the amount compare one number;
  without a Pro partner among a line's candidates the best one is found by one
  scan, with no sort;
- the Pro stack search runs over at most 6 candidates (the stack cap): the 6
  best-ranked are moved to the front of the line's candidates in one pass of
  insertion, and their sets are built over the rules' partner bits in one pass
  a seed (the per-run caches of rank orders and sets are gone: with a
  different candidate list on every line they only cost); the owner and
  message of a stack are built once per run and stack (`StackLabels`, keyed by
  its ≤ 6 rules packed into one word: one shared message, which the output
  finds by address);
- no 64-bit multiplication with an overflow check on the hot path
  (`money::mul_sat`): Wasm has none, and `saturating_mul`/`checked_mul` call a
  128-bit multiply of a few hundred instructions;
- `src/alloc.rs`: a bump allocator, and nothing a run built is ever dropped (a
  stack message is leaked on purpose: the run's memory is thrown away);
- the output mapping keeps the output's size as a running sum and drops the
  least-saving candidates through a heap (re-measuring the order candidate,
  which lists every capped line, on every drop was quadratic: 16.4 M on a
  200-line capped cart), measures JSON strings 8 bytes at a time, and borrows
  every text from the plan and the input instead of copying it; when a Pro
  stack step will follow, the exact pass stops as soon as its part of the
  output is over the budget (the size only grows; the log then says
  "exact output ≥ N B"); messages are grouped by a hash of every 8 bytes
  (`table.rs` `Message`): stack messages share their first and last 8 bytes
  and their length, and a hash of the ends alone put 200 of them in one probe
  chain (1.3 M instructions);
- the shared config's money is read in the cart currency only: one lookup a
  fixed amount instead of every currency's key and value (`config.rs`
  `read_money`, `Config::read_in`);
- the margin order search's work is bounded: a line joins a base's
  near-minimum set in O(17) and a candidate set evaluates at most 16 lines per
  base (Invariants below); before that bound, lines whose rates lie within
  10⁻⁹ of each other made the search quadratic (145 % of the limit at 500
  lines);
- the order stage's exact shortcuts (Invariants below);
- Pro market targeting resolves the cart's country to its markets once per run
  (`markets_here`: one pass over `marketCountries`, a table by handle); a
  rule's check is then one lookup per handle it lists (audit round 5: a scan of
  every market's countries per rule and handle took a 200-line cart to 104 %).
  The config's markets are read for the cart's country (`Config::read_in`,
  audit round 7): a market's countries until the country (nothing kept but
  whether it holds it), a rule's handles until one of the markets that hold
  it, and neither when no market can (every country or handle read as a
  string costs ~630–670 instructions, most of it the provider's);
- entered codes: none is read without a code rule whose hash a code can have,
  and never more than the first 25 entries (the cap, Invariants). An entry
  longer than the longest Won code (the payload's `maxCodeLength`, ≤ 64) + 16
  as entered is left without trimming it (audit round 7: trimming cost 19–35
  instructions a byte of white space, and an entry could be all padding), one
  whose upper-case form is longer than the longest Won code is left after that
  many units (round 7: ΐ is 3 units upper-cased, ~135 instructions a character;
  round 6 bounded the entry's own length only); the rest are hashed as they
  would be upper-cased, one pass, without building the text
  (`hash::normalized_hash_within`), and matched by the number of their hash
  (round 6: 25 codes of 255 "ﬃ" took the bridge cart to 169 %). Nothing is
  deduplicated or upper-cased for the plan: a rule keeps its entries' hashes
  and texts, and only the code node upper-cases an entry, one with the
  triggering code's hash (`CartPlan::rule_has_code`; deduplicating every code
  pairwise was O(codes²): 800 codes on a 1-line cart took 320 %, and comparing
  each of 25 codes of 255 "ﬃ" in full with the earlier ones 88 % of a 1-line
  cart);
- upper-casing reads a generated table (`src/engine/upper_table.rs`, checked
  against `char::to_uppercase` for every scalar value): the standard library
  searches its table for every non-ASCII character (~620 instructions); a
  2-byte character (Latin, Greek, Cyrillic) is one read of `UPPER2` (round 7:
  ~72 instructions a character hashed, ~100 through the two-level pages), any
  other two reads. `js::trim_counted` reads white space from its UTF-8 bytes
  at either end, counting it and stopping at a limit (~30 instructions an
  ASCII space, ~52 an NBSP, ~72–77 a 3-byte white space character); `js::trim`
  returns a text that starts and ends visible (every price) at once;
- the fields of a cart line and of its merchandise are read by position, the
  positions learned from the first line (`input.rs` `Shape`): a read by name
  makes the provider compare the key with the object's keys, ~1.5 k
  instructions a line for 8 fields, 3 % of the limit on 200 lines (audit
  round 6; every budget cart moved 2.1–3.2 points).

## Layout

| Path | What |
|---|---|
| `src/main.rs` | `#[typegen]` + `#[query]` modules (the input queries checked against the schema at compile time), the two Wasm exports (dash-named, as in the JS version) |
| `src/cart_lines_discounts_generate_run.rs`, `src/cart_delivery_options_discounts_generate_run.rs` | the two targets |
| `src/input.rs` | function input → engine cart, config and node role (the reference adapter's `adaptInput`), read from the input's JSON value; the margin inputs are read only while protection is on, `marginRefs` only with collection settings |
| `src/json.rs` | the interned object keys (`Key`), tolerant readers for the `jsonValue` metafields (product, variant cost), the line price and `presentmentCurrencyRate`, the per-run outlet-list cache |
| `src/alloc.rs` | the Wasm build's bump allocator (instruction budget; native tests keep the system allocator) |
| `src/output.rs` | emission → function output (`@won/core` `function-output.ts`): exact values, rounding ties, grouping, the output budget, delivery groups; written through the Wasm API |
| `src/engine/` | `config.rs` (shared config), `cart.rs` (normalizeCart), `plan.rs` (planCart, the margin stages of `plan-margin.ts` included), `order_search.rs` (`searchOrderSets`, pure), `margin.rs` (`margin.ts`: the payload reader, floors, cost conversion), `emit.rs` (emitForNode), `hash.rs` (code hash, the entered-code bound), `upper_table.rs` (the generated case table, with a one-read table for 2-byte characters), `money.rs`, `describe.rs`, `table.rs` (the run's lookup tables), `js.rs` (the JS semantics the engine relies on: Math.round, trim, string order) |

Invariants:

- Money is in integer minor units (i64). Sums saturate.
- Percentages use the TS float expression and `Math.round` semantics.
- Ties go to amount desc, then priority desc, then id asc (JS string order, by UTF-16 unit).
- The Pro stack cap ([spec], MVP 2 audit round 3): a stack — a line's or the order's — is searched only among the target's **6 best-ranked candidates** (`MAX_STACK_CANDIDATES` in plan.ts and `plan.rs`; rank as above). A candidate ranked 7th or lower is never part of a stack, even when it combines with every member; it is "outranked" (explain says a better discount won, and each member of the stack does give more). Output differs from an uncapped search only on targets with more than 6 positive candidates and combinesWith links among them. Margin protection is unaffected: it cuts what the search picked.
- A minimum counts the whole cart (every non-gift line, pre-discount, outlet included), or only a product rule's own lines when the payload says `minimum.scope: "entitled"` (a migrated native's semantics; absent = the cart).
- Parsing never fails. Junk in a metafield reads as "nothing". A missing or invalid shared config emits no operations.
- Margin protection (MVP 2) evaluates every float expression of `margin.ts` / `plan-margin.ts` in the same order (`ceilTol` = ceil(x − 1e-6), the cost `(unitCost × rate) × scale`, the order stage's floor((h × S) / a) and floor((h × S0) / s)). The order stage's search is the pure function `search_order_sets` (`src/engine/order_search.rs`, `searchOrderSets`, unit-tested with the TS instances).
  - **The bound on its exact work ([spec], audit round 4, `ORDER_SEARCH_EXACT_LINES` = 16).** On each base (after and before product discounts), a candidate set's limit min over its lines of floor((h × X) / x) is evaluated line by line only while at most 16 DISTINCT lines — distinct by h and the price on that base; equal lines have equal values — have a rate h / x within 2⁻⁴⁸ (32 ulps) of the set's smallest rate m. With more, the limit is floor((X × m) × (1 − 2⁻⁴⁴)), which is never above the exact minimum (the proof is in plan-margin.ts `limitOnBase`: two roundings on each side, 512 units of roundoff of slack). So it fails closed: the order discount can come out smaller, never below a line's floor. It happens only when more than 16 different lines tie for a minimum rate exactly or within a few ulps (proportional cost floors, or prices of billions), and then it gives at most a haléř or so less (1 below the exact value where X × m is a whole number: `lines-margin-order-tied-bound`, 1 529,99 Kč instead of 1 530 Kč). Many copies of one line (variants at one price) count once and stay exact.
  - **The same answer as the TS search, with O(17) work a line.** A line whose rate is more than (1 + 2⁻⁴⁸) × m above the smallest cannot hold the minimum (its value is at least the smallest line's), so the minimum over the near lines is the minimum over the set, which TS evaluates line by line. `NearMin` keeps at most 17 near lines of a base, the lowest-rate ones, so a line joins in O(17): at most 16 kept means they are all of them (exact), 17 means there are more (the bound, which needs only m). The h/a ordering is not searched again when it is the h/s ordering's very sequence (no product discounts). `protect_order` (`plan.rs`) leaves the lines that can give nothing (h = 0) out of the search, since every set holding them has D = 0, and when the set of every line that can give something carries its whole wanted amount — its D_max by the same rule, bound included — that set wins both orderings without sorting (`all_that_can_give`; this one needs an order amount that never falls as the base grows, which every order discount is).
  - **Tests.** A dedicated parity run (2 000 carts built for the search) compares every reachable way the search ends — the shortcut, the skipped h/a search, the h/a ordering winning, a tie between different sets going to the larger one — against the TS search, and another (1 000 carts of tied lines) the exact limit, the bound and the shortcut checked against it. The last tie-break (equal D, equal size, different sets → the h/s set) does not occur with an order discount's wanted amount, which never falls as the base grows (0 in that run, 0 in T1's 2 million random cases); the unit-test pair `order_search_ties_go_to_the_larger_set_then_to_the_h_s_set` pins it with a synthetic wanted amount. The unit tests `the_order_search_takes_a_bound_…` (16 vs 17 tied lines, equal lines, the plan), `the_order_search_on_clustered_rates_…` (5 000 line sets against the definition written out, and a digest equal to the TS search's) and `the_order_limit_bound_is_never_above_any_lines_value` (200 000 sets; the TS property test runs 1 000 000) have TS twins.
- Only the first 25 entered codes count ([spec], audit round 5b, `MAX_ENTERED_CODES` in cart.ts and `hash.rs`): of the codes as entered (a cart can hold 250), the first 25 entries — trimmed, upper-cased — are matched to rules, each code once per rule. The cap counts ENTRIES, whatever they hold: a repeat, an empty code, an entry without a code string (`{}`, `{code: null}`: the reference adapter passes it as "", the Rust reader reads it as one), a code longer than every Won code (below), so nothing can make the reader read more. A later code is never matched: the TS plan gives it the outcome `over_limit` (explain says once: "Zadaných kódů je víc než 25, další se už nezapočítají." / "More than 25 codes were entered; the rest aren't counted."), its rule does not see it (a code discount whose code comes after them does not apply: fail closed), and its code node emits nothing, so Shopify shows it as not applicable. The function's reader stops after the 25th entry; Shopify still walks the rest of the input.
  - **Known limit (fails closed).** A rule with one code among the first 25 and another after them applies in the plan (and in Try Cart), but if Shopify runs its node with the later code as the triggering code, the node emits nothing: that code is not among the rule's entered codes.
- A Won code has at most 64 characters (`CONFIG_LIMITS.codeLength`, trimmed and upper-cased, UTF-16 units; audit round 6; Shopify accepts 255). The rule editor refuses a longer one (`editor.error.codeLength`), the sanitizer drops it with the issue `code_too_long`, and a Shopify discount with a longer code stays in Shopify (`classifyNative`: `code_too_long`). The shared config carries the longest Won code's length (`modules.codes.maxCodeLength`, whenever a code rule ships codes; missing or junk reads as 64, more as 64). `,"maxCodeLength":N` adds 18 B to the payload, 19 B once the longest code has 10 characters or more. An entered code is never matched, in both engines (plan.ts `matchCodes`, hash.rs `normalized_hash_within`), when **it is longer than the longest Won code + 16 (`ENTERED_CODE_PADDING`, hash.rs `CODE_PADDING`) as entered** — UTF-16 units, the white space around it included; audit round 7 — or when its upper-case form (trimmed) is longer than the longest Won code: every Won code is at most that long, so it cannot be one (upper-casing never shortens a text in UTF-16 units, checked for every scalar value in both engines, so a code whose trimmed text is longer is left too). The Rust function neither trims nor upper-cases such an entry past the bound. It still counts as an entry. A Won code entered with more white space around it than the bound allows is not taken (fail closed: its discount does not apply); every code the dev store logged was entered without white space, a pasted one may carry a space or a line break, and 16 characters of white space around the longest Won code (more around a shorter one) still match. For the shop's own codes, entered with up to 16 characters of white space around them, the output is the same as matching every code (a property over 3 000 random carts, `entered-codes-length.test.ts`); only a foreign code that cannot be a Won code whose hash collides with a Won code's (a ~n/2³² event) is no longer taken for that code (fail closed). (UTF-16 units, not UTF-8 bytes: upper-casing can shorten a text in bytes — ı → I, ſ → S, ﬁ → FI — so a byte bound would not prove "cannot match".)
- A product listing more than 4 marginRefs ([spec], audit round 4b, `MAX_MARGIN_REFS` in margin.ts and `margin.rs`) — the sync writes at most 4; legacy or hand-made metafields can list more — is not resolved ref by ref: it takes the payload's strictest setting (`strictestMargin`: the highest minimum margin and the lowest maximum discount over the global values and every collection, as Free's plan-gate.ts folds them), computed once per run, and none of its refs is read (the count is the array's length, junk entries included). That is never looser than any collection the product could be in, so it fails closed (`lines-margin-refs-over-limit`). With 4 refs or fewer nothing changes.
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
- **Unicode case mapping.** Discount codes are upper-cased with Rust's Unicode tables (`upper_table.rs`, generated from this toolchain's `char::to_uppercase`; a toolchain with other tables fails its test until regenerated), while the admin hashes them with Node's ICU tables. A code containing a character whose upper-case form differs between those Unicode versions (only recently added characters) hashes differently. It then never matches, which fails closed: that code's rule does not apply.
- **Outlet lists.** Lines are taken to share one outlet list when the list's length and first element agree. That is always true for what the sync writes, because a product lists its own variant GIDs and a variant belongs to one product. A hand-made metafield where two products list the same first GID but differ further on would be read as one list.
- **Duplicate JSON keys.** Metafield JSON is stored parsed, so duplicate keys cannot reach the function.
- **Schema-invalid input.** Shopify builds the input from the query, so it always has the query's shape; the function reads it by that shape (`src/input.rs`, not through the generated accessors): a line's `merchandise` counts as a ProductVariant by its fields (`product`, `wonVariant`, `id`, which only `... on ProductVariant` selects), not by reading `__typename`; a line without an `id` string is skipped and a `quantity` that is not a positive number reads as 0, as in the reference adapter; a cart line's and its merchandise's fields are read by position, the positions learned from the first line of the query's size (5 fields, 4 for a ProductVariant; the provider's key order need not be the query's: function-runner sorts keys), so a later line of that size with other keys, or in another order, would be misread (Shopify builds every line from the same query); an object the query gives exactly one field (a metafield's `jsonValue`, `product { wonProduct }`, `cost { amountPerQuantity { amount } }`, the gift attribute's `value`, an `isoCode`, a `code`, a delivery group's `id`) is read by position when it has one key (`sole`), by name otherwise. Input that is not the query's shape (a CustomProduct with product fields, a missing key the schema requires, a one-field object whose one key is another) can differ; it cannot reach the function.
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
node apps/won-discounts/extensions/won-discounts-engine/tests/replay-logs.mjs <new.wasm> <old.wasm>   # logged runs (Parity)
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
