# T6 živé E2E — matice Horizon / Dawn (2026-09-28)

Příkaz: `WON_DISCOUNTS_E2E_SCREENSHOT_DIR=… WON_DISCOUNTS_E2E_EVIDENCE_DIR=… npm run test:e2e:local:all -w won-discounts` (bez `--bail`). Výstup: jen řádky ✓/✗.

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  1 tests/e2e/checkout.mvp1.spec.ts:407:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (18.8s)
  ✓  2 tests/e2e/checkout.mvp1.spec.ts:480:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts (18.3s)
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:602:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › one buyer session on the real storefront: the code applied in the cart is carried into checkout (10.4s)
  ✓  4 tests/e2e/storefront.embed.spec.ts:113:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.2s)
  ✓  5 tests/e2e/storefront.embed.spec.ts:141:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.3s)
  5 passed (50.7s)
  ✓  1 tests/e2e/checkout.mvp1.spec.ts:407:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (18.2s)
  ✓  2 tests/e2e/checkout.mvp1.spec.ts:480:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts (18.7s)
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:602:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › one buyer session on the real storefront: the code applied in the cart is carried into checkout (10.1s)
  ✓  4 tests/e2e/storefront.embed.spec.ts:113:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.1s)
  ✓  5 tests/e2e/storefront.embed.spec.ts:141:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (970ms)
  5 passed (49.9s)
   ✓ Horizon
   ✓ Dawn
```

Předchozí běh téže matice (bez testu „one buyer session“) byl taky zelený: 8/8, `✓ Horizon`, `✓ Dawn`.
