# MVP 1 finální brána, fáze B: plán Pro (2026-09-29)

Stav: **✓ Horizon ✓ Dawn. Pro stack se v pokladně sčítá (10 + 5 → 15 %), pokladna = `planCart` na živém payloadu. Store je uklizený.**

- `shopify app dev` běžel s dev-only overridem: `react-router dev` má `NODE_ENV=development WON_DEV_PLAN=pro`.
- Seed i úklid jely s `NODE_ENV=development WON_DEV_PLAN=pro`. SyncRun krok `plan` hlásí `plan pro: nothing to gate`.
- Bez `--bail`, `PLAYWRIGHT_RETRIES=1` z runneru, žádný řádek `flaky`. Fallback `[unlockRealStorefront]` se nespustil.

## Změna specu před během

`emitted` v `tests/e2e/checkout.shapes.spec.ts` rozhoduje o tie stejně jako `output.rs` (`exact_value`, `percent_on_line`, `exact_amount`):
- `:163` `percentOnLine`: když `roundingTiePossible(S, P)`, posílá se přesná částka, jinak `P %`;
- `:175` `emittedValue`: jedno procento, fix na kus, stack (100 % / ΣP % / přesná částka);
- `:202` `expectSentAs`: `/cart.js` `value_type` a `value` odpovídají tomu, co funkce poslala;
- použití: `:302` (a), `:320` (b Free), `:347` a `:352` (b Pro).

Offline kontrola proti referenčnímu mapperu (`emitForNode` → `mapToFunctionOutput`, `@won/core`): shapes config Pro i Free, cena Simple A 1,00–600,00 Kč, množství 1–3.
- **718 812 řádků, 0 rozdílů**;
- z toho 53 910 řádků s tie (`fixed_amount`).

## Průběh

| krok | výsledek |
|---|---|
| 0 `--state` | čisto: 0 pravidel, `function_config` 427 B, jen uzel „Won Discounts“ |
| 1 seed `shapes` (dry-run → `--live`) | SyncRun `cmumf1x4s0003snzsl03ffrw7` ok, `plan pro: nothing to gate`, payload 1007 B s `combinesWith` |
| 2 matice `shapes` (`WON_E2E_PLAN` nenastaveno = pro) | **✓ Horizon ✓ Dawn** |
| 3 `--cleanup` (dry-run → `--live`) | SyncRun `cmumf6aou0001sn43sqddfgrq` ok, config 427 B, 0 pravidel, metafieldy obou produktů smazané |
| 3 `verify-clean --live` + `--state` | `protoNodes: []`, všech 5 `won-e2e-*` bez metafieldu, stejný stav jako v kroku 0 |

## Matice: profil `shapes`, Pro (2026-09-29T08:30:41Z – 08:32:31Z)

`WON_E2E_PROFILE=shapes npm run test:e2e:local:all -w won-discounts`

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  4 tests/e2e/checkout.shapes.spec.ts:260:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Horizon › cart: a capped fixed per-item amount arrives as 100 %, a Pro stack as one summed percent, both = planCart (26.9s)
  ✓  5 tests/e2e/checkout.shapes.spec.ts:395:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Horizon › checkout (Bogus): the thank-you page charges what planCart predicts for both shapes (23.6s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.3s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.2s)
  3 skipped
  4 passed (53.8s)
  ✓  4 tests/e2e/checkout.shapes.spec.ts:260:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Dawn › cart: a capped fixed per-item amount arrives as 100 %, a Pro stack as one summed percent, both = planCart (18.4s)
  ✓  5 tests/e2e/checkout.shapes.spec.ts:395:3 › Won Discounts output shapes in cart and checkout (MVP 1 gate) — Dawn › checkout (Bogus): the thank-you page charges what planCart predicts for both shapes (21.8s)
  ✓  6 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.8s)
  ✓  7 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (1.2s)
  3 skipped
  4 passed (44.1s)
   ✓ Horizon
   ✓ Dawn
```

3 přeskočené = `checkout.mvp1.spec.ts` (jen s profilem `mvp1`).

## Pozorováno vs. plán (obě témata stejně, CZK)

Simple A 1× 219,00 Kč, Simple B 2× 262,00 Kč. Detail v `final-gate-pro-shapes.json`.

| zdroj | Simple A (B 10 % + C 5 %, `combinesWith`) | Simple B (fix 1000 Kč/ks) | celkem před dopravou |
|---|---|---|---|
| `planCart` (živý payload) | stack `fixedTotal 3285` = 2190 + 1095; C `combined` do B; `emitted` 15 % (bez tie) | `fixedPerItem 26200` = 52 400, `emitted` 100 % | 18 615 |
| výstup funkce (16 běhů) | `percentage 15`, „E2E Pro 10 % + E2E Pro 5 %“ | `percentage 100` | |
| `/cart.js` | `percentage 15.0`, −32,85 | `percentage 100.0`, −524,00, řádek 0 | 186,15 |
| děkovná stránka | „E2E PRO 10 % + E2E PRO 5 %“ −32,85, 186,15 | −524,00, ZDARMA | 186,15 + doprava 655,00 = **841,15 Kč** = strženo z karty |
| „Celková úspora“ | | | 556,85 = `planCart` productDiscount |

- Běhy funkce: 16× `cart.lines`, 6× delivery bez operací.
- 0,206–0,220 M instrukcí, výstup nejvýš 282 B, všechny `success`.
- Stejný košík na Free (fáze A): Simple A 10 % = 21,90, celkem 197,10 (`final-gate-free-shapes.json`).

## Soubory

- `final-gate-pro-shapes.json`: pozorováno vs. plán po tématech, SyncRun seedu, skupiny běhů funkce.
- `final-gate-screenshots/thankyou-pro-shapes-{1440,390}-{horizon,dawn}.png`: 390 s rozbaleným shrnutím.
- Důkaz úklidu:
  - `final-gate-phaseB-cleanup-syncrun.json`;
  - `final-gate-phaseB-cleanup-verify-clean.json` + `.stdout.txt`;
  - `final-gate-phaseB-state-after-cleanup.json`.
- `clean: false` jen kvůli existujícímu `function_config` (427 B, 0 pravidel). Je to známý stav, sync ho píše vždy.
- Testovací objednávky (Bogus): 2× 841,15 Kč, `won-e2e+shapes@example.com`.

## Příkazy pro ověření

```sh
# běží `shopify app dev` S overridem (NODE_ENV=development WON_DEV_PLAN=pro)
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile shapes --live
WON_E2E_PROFILE=shapes npm run test:e2e:local:all -w won-discounts
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live
WON_PROTO_OUT=/tmp/won-verify node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
```
