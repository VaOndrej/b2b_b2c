# Cart decrement remediation evidence

**Correction after full-run analysis:** Early green zero-ending tests below are not definitive: a failed write followed by recovery cart zero could satisfy the initial committed-event helper. Root subsequently strengthened both regressions to require a successful positive cart commit / held HTTP200 response before accepting zero. Consult the strict rerun result and `full-smoke-failures.md`; do not cite earlier59/60 or four full-run decrement passes as proof of successful server writes.

Store verified through `Shopify.shop`: `b2b-b2c-store-development.myshopify.com`.

## Confirmed cause

The decrement smoke test observed an optimistic DOM state, then immediately read `/cart.js` once. `won-cart.js` intentionally paints `desiredQtyMap` immediately and batches absolute quantities after 90 ms. A hidden quantity/minus control therefore does not mean the final Shopify write has completed.

Real network diagnostic (`cart-diagnostic.json`, 1440 px):

- Update to zero requested at 8379 ms.
- Immediate cart read at 8520 ms returned `item_count: 1`, while the quantity was already hidden.
- Outstanding update-to-zero response at 9095 ms returned `item_count: 0`.
- Subsequent cart read at 9410 ms returned `item_count: 0`.

At 390 px the immediate read happened to return zero, although the intermediate update to two and subsequent zero write were still pending. This also proves that an immediate zero can be a false early success, not only a false failure.

No production cart runtime change is warranted by this evidence.

## Resolution

- Keep all optimistic 1 → 2 → 1 → hidden DOM assertions.
- Observe the existing `cart:refresh` event (announced after the batch loop commits), require final count zero, then independently read Shopify and require `item_count: 0` and `items: []`.
- Add an explicit in-flight regression using a Promise barrier on the first *real* Shopify update request. Tap +,+,−,− while it is held, assert the optimistic states, release it, and require the real final empty cart. This does not mock server responses or introduce a delay.
- Toast tests retain their fixed-pointer multi-tap coverage, but wait for committed counts instead of arbitrary sleeps. Playwright actionability waits stabilize the hover-revealed control.
- Test setup clears the context cart, verifies success, then reloads so the runtime initial read and server-rendered toast baseline both start empty. This removes a setup race; cross-context cart contamination was not evidenced.
- Explicit store identity assertion precedes cart mutation.

## Files

- `tests/support/cart-state.ts` (new)
- `tests/smoke/won-feedback-8.spec.ts`
- `tests/smoke/won-toast.spec.ts`

No change to `themes/won-base/assets/won-cart.js`.

## Verification

Pending repeated real storefront tests; see `cart-repeat-final.log`. No retries, no skips added, no assertion removed, no arbitrary sleeps added. Existing setting-dependent toast skips remain.

### Store throttling discovered during repetition

First repeat: 59 passed, 1 setup failure (stepper initialization absent; no network cause captured). Both decrement tests passed all 12 executions.

Second repeat after stable theme restart: 33 passed, 27 setup failures. A single direct diagnostic request proved `/cart/clear.js` returned HTTP 429 with `too_many_requests`, `Too many attempts`, `Please try again in a few minutes` (see `cart-throttle.json`). This is an external storefront rate limit, not a committed-quantity mismatch. Requests were stopped; no retry, sleep, skip or relaxed assertion was added to the test gate.

Setup now verifies the context's real cart first. A fresh empty browser context does not require an unnecessary clear write/reload. Non-empty contexts still clear, verify zero, and reload. Runtime initialization still must prove zero in the actual DOM. Failed initial reads or clears explicitly fail with HTTP status/body. This preserves isolation while reducing needless Shopify writes.

### Final bounded run after cooldown

With the reduced-write setup, the 12-execution decrement run stopped after its first failure (11 not run): optimistic UI rolled back after adding. A single instrumented diagnostic execution then proved the cause: `won-cart.js` HTTP 200, initial `/cart.js` HTTP 200, both `/cart/update.js` writes HTTP 429, followed by successful recovery cart reads (HTTP 200). Exact evidence is the `cart-request-diagnostics` attachment in `cart-http.json`; diagnostic started 2026-09-11 07:02:10 UTC. All further cart requests stopped. The final gate cannot be called green while Shopify refuses writes. Parent owns the subsequent full smoke run.

The helper/specs now retain network diagnostics on any failed cart interaction, not only setup failures, so HTTP throttling cannot be misreported as a decrement assertion defect.

`git diff --check` passed for the three touched test files. Production cart source is unchanged. No tests were skipped or weakened; the remaining limitation is the observed external write throttle.
