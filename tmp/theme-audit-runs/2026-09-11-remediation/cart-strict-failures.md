# Strict cart repetition — offline classification

**0 passed /12 failed /0 skipped**,3.8min, started2026-09-11 07:32:38 UTC. Exact entries: `cart-strict-failures.json`; source: `cart-strict-repeat.json`.

| Failure category | Executions | Proof |
|---|---:|---|
| POST `/cart/update.js` HTTP429 |5| Two desktop ordinary tests and all three desktop held-request tests have direct HTTP429 network attachments. |
| Storefront unauthorized JSON |5| Mobile snapshots contain `{"error":"unauthorized"}`. HTTP status was not recorded; do not claim HTTP401 from body text alone. |
| Storefront render502 error page |1| Mobile held-request snapshot explicitly says `Failed to render storefront with status 502 (Bad Gateway).` |
| Generic storefront error page |1| Desktop ordinary snapshot says `There was a problem loading this website`. HTTP status unknown. |

## Why the three held tests timed out

They did receive the held response; the network evidence records429. The secondary error in **all three** results is `response.text: Test timeout of 60000ms exceeded`, at `tests/smoke/won-feedback-8.spec.ts:215:110`. The code awaited `response.text()` while constructing the failure message before `expect(response.ok()).toBeTruthy()` could execute. An unavailable/incomplete error body delayed the explicit429 failure until the overall test timeout.

This is diagnostic error-reporting behavior, not a first-response waiter failure or demonstrated cart deadlock. Remove the awaited error-body read from this assertion's message; retain status and the successful-response quantity assertion. Network diagnostics already prove HTTP429. This preserves the strict assertion and avoids masking status behind a timeout.

Seven runs never reached cart interaction because the expected store identity was absent on error pages. Five reached a real write and all five were explicitly rejected. No strict successful decrement verification was achieved. Earlier rollback-compatible green results are superseded; the cart gate is **not green**.

No browser or cart requests were made during this analysis.
