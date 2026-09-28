# Full smoke failure evidence (offline analysis)

Run started 2026-09-11 07:14:16 UTC, duration17.9min: **408 passed,25 failed,39 skipped,0 flaky**. Source: `full-smoke.json`. Per-test classification and exact HTTP evidence: `full-smoke-failures.json`.

| Category | Failed executions | Evidence |
|---|---:|---|
| Confirmed cart write HTTP429 |15| Decoded per-test network/row response attachments: `/cart/update.js`429. Includes both header tests, both row-cart tests, and11 toast executions. |
| Confirmed cart read HTTP503 |3| Mobile toast burst failed initial API cart read with explicit503; mobile two-line and top-anchor tests captured runtime `/cart.js`503. |
| Storefront connection challenge |1| Mobile collection breadcrumb snapshot says “Your connection needs to be verified before you can proceed”. No breadcrumb page was rendered. HTTP status was not captured. |
| Storefront error page |1| Mobile toast drawer test snapshot says “There was a problem loading this website”; Shopify.shop missing. HTTP status was not captured. |
| Cart failure without HTTP instrumentation |4| Stepper/cart parity and sheen replay, each desktop/mobile. Symptoms are compatible with failed writes/rollback, but these exact executions cannot honestly be classified as confirmed429. |
| Static wrapper selector false positive |1| Guard rejected valid `.shopify-block:has(> .won-slide)` / tile selectors. Corrected after this run; root reports separate4-test guard validation passed. This does not retroactively turn the full run green. |

The original parity test already polls cart state10s, and header count polls8s. Their full-run failures are not the original immediate optimistic read race. Header HTTP429 is now directly proven; parity remains uninstrumented.

## Crucial decrement limitation

**The four green decrement entries in this full run are not final verification.** Those versions could receive a recovery `cart:refresh` with zero after a rejected write, and mistake rollback for successful decrement. Root subsequently strengthened the tests to require a positively committed quantity1 and a successful held first response with item_count1 before accepting the finalzero. Only the subsequent strict run can establish successful cart writes/decrement. Earlier59/60 repetition and zero-ending diagnostic claims must carry this same limitation.

## All39 skips examined

-18 existing viewport conditions.
-11 existing settings/content conditions.
-6 existing editorial opt-in skips: `WON_EDITORIAL_QA` was not enabled in this run.
-4 existing QA fixture opt-in skips: catalogue-fix tests were not enabled.

For every skipped execution, the file's current `test.skip(...)` statements were normalized and compared with `/private/tmp/won-pre-remediation-20260911/tests/...`; **all39 reference pre-existing skip calls**. No new skip was introduced to make the gate green. Existing skip reasons and source locations are retained individually in JSON. The six editorial skips still mean this full run did not verify those native editorial interactions; separate targeted evidence must be cited if available.

No browser or cart requests were made during this analysis. The gate is not green.
