# MVP 1 brána: živá E2E matice Horizon / Dawn (2026-09-28)

Jen řádky ✓/✗ a souhrny. Bez `--bail`, `PLAYWRIGHT_RETRIES=1` z runneru; žádný řádek `flaky` ani `retry`.

## Běh 1: profil MVP 1 (2026-09-28T19:49:22Z – 2026-09-28T19:53:11Z)

`node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live` → `npm run test:e2e:local:all -w won-discounts`

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  1 tests/e2e/checkout.mvp1.spec.ts:64:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (19.6s)
  ✓  2 tests/e2e/checkout.mvp1.spec.ts:139:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts (19.3s)
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:233:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › one buyer session on the real storefront: the code applied in the cart is carried into checkout (11.2s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.8s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.1s)
  2 skipped
  5 passed (53.9s)
  ✓  1 tests/e2e/checkout.mvp1.spec.ts:64:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (20.4s)
  ✓  2 tests/e2e/checkout.mvp1.spec.ts:139:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts (18.1s)
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:233:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › one buyer session on the real storefront: the code applied in the cart is carried into checkout (2.0m)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.6s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (872ms)
  2 skipped
  5 passed (2.7m)
   ✓ Horizon
   ✓ Dawn
```

2 přeskočené testy = `checkout.shapes.spec.ts` (běží jen s `WON_E2E_PROFILE=shapes`).

## Běh 2: profil shapes (2026-09-28T20:06:54Z – 2026-09-28T20:08:40Z)

`node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile shapes --live` → `WON_E2E_PROFILE=shapes npm run test:e2e:local:all -w won-discounts`

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  4 tests/e2e/checkout.shapes.spec.ts:155:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Horizon › cart: a capped fixed per-item amount arrives as 100 %, a Pro stack as one summed percent, both = planCart (20.8s)
  ✓  5 tests/e2e/checkout.shapes.spec.ts:250:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Horizon › checkout (Bogus): the thank-you page charges what planCart predicts for both shapes (24.0s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.2s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.1s)
  3 skipped
  4 passed (48.0s)
  ✓  4 tests/e2e/checkout.shapes.spec.ts:155:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Dawn › cart: a capped fixed per-item amount arrives as 100 %, a Pro stack as one summed percent, both = planCart (21.7s)
  ✓  5 tests/e2e/checkout.shapes.spec.ts:250:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Dawn › checkout (Bogus): the thank-you page charges what planCart predicts for both shapes (23.2s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.0s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (967ms)
  3 skipped
  4 passed (47.7s)
   ✓ Horizon
   ✓ Dawn
```

3 přeskočené testy = `checkout.mvp1.spec.ts` (běží jen s profilem MVP 1).

Mezi během 1 a 2 proběhly dva dřívější pokusy s profilem shapes (stejný seed): první skončil ✗ Horizon / ✗ Dawn, protože Cloudflare odpověděl na odeslání hesla storefrontu interaktivní výzvou „Verify you are human“ (test košíku prošel, pokladna se nespustila); druhý ✓ Horizon / ✓ Dawn, ale screenshot 1440 zachytil přechod platby na děkovnou stránku. Detail v `.superpowers/sdd/2026-09-28-won-discounts-mvp1/gate-live-report.md`.
