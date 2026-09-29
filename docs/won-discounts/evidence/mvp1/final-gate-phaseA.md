# MVP 1 finální brána, fáze A: plán Free (2026-09-29)

Stav: **✓ Horizon ✓ Dawn v obou maticích. BILL-1 platí i v pokladně: na Free se Pro stack nesčítá. Store je uklizený.**

- `shopify app dev` běžel bez `WON_DEV_PLAN` (`react-router dev`: `NODE_ENV=development`, override chybí), tedy Free.
- Seed i úklid jely bez `WON_DEV_PLAN`, SyncRun krok `plan` hlásí `plan free`.
- Bez `--bail`, `PLAYWRIGHT_RETRIES=1` z runneru, žádný řádek `flaky`.
- `[unlockRealStorefront]` fallback se nespustil (0 řádků v logu), Cloudflare výzva nepřišla.

| krok | výsledek |
|---|---|
| 0 `--state` | čisto: 0 pravidel, `function_config` 427 B, jen uzel „Won Discounts“ |
| 1 seed `mvp1` (dry-run → `--live`) | SyncRun `cmume8i7t0003snl2t95r4iw4` ok, `plan free: nothing to gate`, 753 B |
| 2 matice `mvp1`, běh 1 | ✗ Horizon ✗ Dawn: zastaralá aserce ve specu, pokladna = plán (viz níže) |
| 2 matice `mvp1`, běh 2 | **✓ Horizon ✓ Dawn** |
| 3 seed `shapes` (dry-run → `--live`) | SyncRun `cmumem7w90003snac7xzoiq8j` ok, `plan free: 2 Pro setting(s) not applied (rule_combinations:e2e-shapes-pro-10, rule_combinations:e2e-shapes-pro-5)`; uložený config 1007 B, zapsaný payload 910 B |
| 3 matice `shapes`, `WON_E2E_PLAN=free` | **✓ Horizon ✓ Dawn** |
| 4 `--cleanup` (dry-run → `--live`) | SyncRun `cmumequoa0001sn4zyavri90v` ok, config 427 B, 0 pravidel, metafieldy obou produktů smazané |
| 4 `verify-clean --live` + `--state` | `protoNodes: []`, všech 5 `won-e2e-*` bez metafieldu, stejný stav jako v kroku 0 |

## Matice 1: profil `mvp1` (Free)

Běh 1 (2026-09-29T08:08:09Z – 08:14:01Z), ✗ na obou tématech, jen test košíku:

```
  ✘  1 tests/e2e/checkout.mvp1.spec.ts:65:3 › … — Horizon › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (18.2s)
  ✘  2 … (retry #1) (17.5s)            Expected: "percentage"  Received: "fixed_amount"
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:140:3 › … — Horizon › checkout (Bogus): … (29.1s)
  ✓  4 tests/e2e/checkout.mvp1.spec.ts:239:3 › … — Horizon › one buyer session … (10.8s)
  (Dawn stejně: ✘ 1, ✘ 2 retry, ✓ 3, ✓ 4, embed ✓ ✓)
   ✗ Horizon
   ✗ Dawn
```

Příčina: kurz, ne sleva. Pokladna = `planCart` na obou tématech.
- CZK cena `won-e2e-simple-a` je převod z 10,00 USD živým kurzem trhu: 28. 9. 218,00 Kč, 29. 9. 219,00 Kč.
- Kód 15 % z 197,10 Kč = 29,565 Kč, tedy půl haléře (rounding tie).
- `output.rs:451` (změna z 29. 9.) na tie posílá přesnou částku: log funkce `orderDiscountsAdd "E2E kód" {"fixedAmount":{"amount":"29.57"}}`.
- `/cart.js`: `value_type fixed_amount`, `value 29.57`, 2957 = `planCart` orderDiscount.
- Děkovná stránka: −29,57 Kč, celkem 822,53 Kč = stržené z karty.
- Aserce `value_type === "percentage"` v `checkout.mvp1.spec.ts:108` pocházela z doby před tímto mapováním.
- Oprava ve specu (`checkout.mvp1.spec.ts:116`): tvar hodnoty se odvozuje jako v `output.rs`. Při `roundingTiePossible(base, 15)` čeká `fixed_amount` = plán, jinak 15 %.

Běh 2 (2026-09-29T08:14:52Z – 08:16:48Z):

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  1 tests/e2e/checkout.mvp1.spec.ts:67:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (17.3s)
  ✓  2 tests/e2e/checkout.mvp1.spec.ts:154:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts (23.1s)
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:253:3 › Won Discounts in cart and checkout (MVP 1) — Horizon › one buyer session on the real storefront: the code applied in the cart is carried into checkout (10.4s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.2s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.2s)
  2 skipped
  5 passed (54.2s)
  ✓  1 tests/e2e/checkout.mvp1.spec.ts:67:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans (17.6s)
  ✓  2 tests/e2e/checkout.mvp1.spec.ts:154:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts (20.6s)
  ✓  3 tests/e2e/checkout.mvp1.spec.ts:253:3 › Won Discounts in cart and checkout (MVP 1) — Dawn › one buyer session on the real storefront: the code applied in the cart is carried into checkout (10.3s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.1s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (934ms)
  2 skipped
  5 passed (51.3s)
   ✓ Horizon
   ✓ Dawn
```

2 přeskočené = `checkout.shapes.spec.ts` (jen s `WON_E2E_PROFILE=shapes`).

## Matice 2: profil `shapes`, `WON_E2E_PLAN=free` (2026-09-29T08:18:37Z – 08:20:23Z)

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  4 tests/e2e/checkout.shapes.spec.ts:211:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) [Free plan] — Horizon › cart (Free): a capped fixed per-item amount arrives as 100 %, the Pro stack is NOT summed (best single rule only), both = planCart (23.3s)
  ✓  5 tests/e2e/checkout.shapes.spec.ts:343:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) [Free plan] — Horizon › checkout (Bogus): the thank-you page charges what planCart predicts for both shapes (22.3s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.1s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.1s)
  3 skipped
  4 passed (48.8s)
  ✓  4 tests/e2e/checkout.shapes.spec.ts:211:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) [Free plan] — Dawn › cart (Free): a capped fixed per-item amount arrives as 100 %, the Pro stack is NOT summed (best single rule only), both = planCart (22.2s)
  ✓  5 tests/e2e/checkout.shapes.spec.ts:343:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) [Free plan] — Dawn › checkout (Bogus): the thank-you page charges what planCart predicts for both shapes (21.1s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (899ms)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (1.1s)
  3 skipped
  4 passed (46.0s)
   ✓ Horizon
   ✓ Dawn
```

3 přeskočené = `checkout.mvp1.spec.ts` (jen s profilem `mvp1`).

### Pozorováno vs. plán (obě témata stejně, CZK)

Simple A 1× 219,00 Kč, Simple B 2× 262,00 Kč. Detail v `final-gate-free-shapes.json`.

| zdroj | Simple A (B 10 % + C 5 %) | Simple B (fix 1000 Kč/ks) | celkem před dopravou |
|---|---|---|---|
| živý payload | `combinesWith` u B i C chybí, obě pravidla zapnutá | beze změny | |
| `planCart` (Free payload) | B sám, `{percent: 10}` = 2190; C `outranked`, 0 | `fixedPerItem 26200` = 52 400 | 19 710 |
| výstup funkce (16 běhů) | `percentage 10`, „E2E Pro 10 %“ | `percentage 100` | |
| `/cart.js` | `percentage 10.0`, −21,90 | `percentage 100.0`, −524,00, řádek 0 | 197,10 |
| děkovná stránka | „E2E PRO 10 %“ −21,90, 197,10 | −524,00, ZDARMA | 197,10 + doprava 655,00 = **852,10 Kč** = strženo z karty |
| Pro stack (neuplatněn) | 15 % = 3285 | | 186,15 |

Metafield Simple A dál nese obě pravidla (`e2e-shapes-pro-10`, `e2e-shapes-pro-5`). Stack zmizel jen díky gate v payloadu.

## Soubory

- `final-gate-free-shapes.json`: pozorováno vs. plán po tématech, SyncRun seedu, skupiny běhů funkce, protipříklad Pro.
- `final-gate-screenshots/thankyou-free-shapes-{1440,390}-{horizon,dawn}.png`: 390 s rozbaleným shrnutím.
- `final-gate-cleanup-syncrun.json`, `final-gate-cleanup-verify-clean.json` + `.stdout.txt`, `final-gate-state-after-cleanup.json`: důkaz úklidu.
  - `clean: false` jen kvůli existujícímu `function_config` (427 B, 0 pravidel). Je to známý stav, sync ho píše vždy.

Testovací objednávky (Bogus) z fáze A:
- 2× 822,53 Kč `won-e2e+mvp1@example.com`, běh 1;
- 2× 822,53 Kč, běh 2;
- 2× 852,10 Kč `won-e2e+shapes@example.com`.

## Příkazy pro ověření

```sh
# běží `shopify app dev` BEZ WON_DEV_PLAN (Free)
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live
npm run test:e2e:local:all -w won-discounts
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile shapes --live
WON_E2E_PROFILE=shapes WON_E2E_PLAN=free npm run test:e2e:local:all -w won-discounts
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live
WON_PROTO_OUT=/tmp/won-verify node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
```
