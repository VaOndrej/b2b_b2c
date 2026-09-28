# won-discounts-engine

The Won Discounts discount function (Discount Function API 2026-04), targets
`cart.lines.discounts.generate.run` and `cart.delivery-options.discounts.generate.run`.

## Two implementations, one brain

- **Rust function (this folder): the production hot path.** It is a port of what
  the function needs from the TS engine: config reading, `planCart`,
  `emitForNode`, and the output mapping. It does not port explain or describe,
  except the short text of an unnamed rule, which is the checkout message.
- **TS engine (`packages/core/src/discounts`): the reference.** The admin
  ("Vyzkoušet košík") and the storefront use it, and it defines what is correct.
  `tests/reference-adapter.js` is the TS adapter the JS function used. With the
  TS engine it computes the reference output for any function input.

Why Rust: the JS function (Javy) cost ~96 M instructions on a 200-line cart,
against Shopify's limit of 11 M. Reading the input alone cost 12.3 M. Over the
limit, Shopify drops every Won discount without an error. See
`.superpowers/sdd/2026-09-28-won-discounts-mvp1/task-2-report.md` and
`task-2b-report.md`.

## Parity (DATA-4 mitigation)

The fixtures are the parity oracle. `tests/fixtures/*.json` are generated from
`tests/scenarios.js` through the public `@won/core` builders
(`npm run fixtures -w won-discounts-engine`). Their expected outputs were
written by hand, and the TS engine reproduces all of them. When the TS engine
changes behaviour, the port must follow. These checks catch a gap:

| Check | Where |
|---|---|
| Every fixture, TS reference = fixture output | `tests/parity.test.js` |
| Every fixture, Wasm = fixture output | `tests/default.test.js` |
| Every fixture, native Rust = fixture output (character for character) | `cargo test` (`src/fixture_tests.rs`) |
| Seeded random carts and configs, junk included: Wasm = TS reference | `tests/parity.test.js`; `PARITY_CASES=5000 PARITY_SEED=7` for a longer run |
| Every fixture through `shopify app function run`: output = fixture = TS engine, plus the instruction budget | `apps/won-discounts/tests/contracts/function.contract.test.ts` |
| The A1 rules one by one | `cargo test` (`src/engine/tests.rs`) |

Rules for a change:

- A change to the engine semantics goes into the TS engine first, as a
  scenario and a regenerated fixture. The Rust port follows until every check
  above is green.
- Never edit a fixture's expected output to match the Rust function.

## Layout

| Path | What |
|---|---|
| `src/main.rs` | `#[typegen]` + `#[query]` modules, the two Wasm exports (dash-named, as in the JS version) |
| `src/cart_lines_discounts_generate_run.rs`, `src/cart_delivery_options_discounts_generate_run.rs` | the two targets |
| `src/input.rs` | function input → engine cart, config and node role (the reference adapter's `adaptInput`) |
| `src/json.rs` | tolerant readers for the `jsonValue` metafields and the line price (`custom_scalar_overrides`) |
| `src/output.rs` | emission → function output, written through the Wasm API (numbers as numbers, like the reference) |
| `src/engine/` | `config.rs` (shared config), `cart.rs` (normalizeCart), `plan.rs` (planCart), `emit.rs` (emitForNode), `hash.rs` (code hash), `money.rs`, `describe.rs`, `js.rs` (the JS semantics the engine relies on: Math.round, trim, string order) |

Invariants:

- Money is in integer minor units (i64). Percentages use the TS float
  expression and `Math.round` semantics.
- Ties go to amount desc, then priority desc, then id asc.
- Parsing never fails. Junk in a metafield reads as "nothing". A missing or
  invalid shared config emits no operations.

## Build and test

Rust is installed user-level (rustup) and is **not on the default PATH**. The
npm scripts add it:

```sh
npm test -w won-discounts-engine          # cargo test, then vitest (fixtures, drift, parity, query cost)
npm run build:functions -w won-discounts  # shopify app function build (cargo + trampoline)
```

In a shell of your own, run `export PATH="$HOME/.cargo/bin:$PATH"` before `cargo` or
`shopify app dev`. The `wasm32-unknown-unknown` target is required, because
`shopify_function` 2.x refuses `wasm32-wasip1`. `rust-toolchain.toml` lists
it, so rustup installs it when it is missing.
