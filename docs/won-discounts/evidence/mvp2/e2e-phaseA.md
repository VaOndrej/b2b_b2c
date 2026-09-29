# MVP 2, T5b fáze A: pokladna s ochranou marže, plán Free (2026-09-29)

Stav: **✓ Horizon ✓ Dawn, bez `--bail`, žádný řádek flaky. Marže pokladnu neblokuje, děkovná stránka = `planCart` se skutečným kurzem z logu funkce, žádný řádek není pod floor. Store je uklizený.**

- `shopify app dev` běžel bez `WON_DEV_PLAN` (Free). Seed i úklid hlásí `plan free: nothing to gate`.
- Nastavení marže: zapnutá, minimální marže 25 %, maximální sleva 30 %.
- Pravidla: automatická 50 % na won-e2e-simple-a + won-e2e-simple-b, kód `WONE2EM20` = 20 % na objednávku.
- Košík v CZK (trh cesko), po jednom kuse: simple-a, simple-b, two-variants Small + kód `WONE2EM20`.
- Kurz z logu funkce: `presentmentCurrencyRate` = `"21.8802535"`. Podrobně v `f-m1-f-m2-function-input.md`.
- `PLAYWRIGHT_RETRIES=1` z runneru, v závěrečné matici žádný retry.

| krok | výsledek |
|---|---|
| 0 `--state`, `verify-clean --live`, read-back variant | čisto: 0 pravidel, `function_config` 427 B, jen uzel „Won Discounts“. 0 variant metafieldů, 6 variant má nákupní cenu (katalog) |
| 1 seed `--profile margin` (dry-run → `--live`) | SyncRun `cmumv9vka0004sn75ifcl6x5p` ok, 767 B. Vytvořen uzel kódu `WONE2EM20`, 2 produkty dostaly pravidlo |
| 2 zrcadlo nákupních cen `margin-costs.mjs` (dry-run → `--live`) | 51 variant přečteno, 6 metafieldů zapsáno. Read-back 6 ze 6: `{"cost":6,"cur":"USD"}`, `{"cost":5,…}`, 4× `{"cost":8,…}` |
| 3 vývojové běhy, jen Horizon (`run-theme-matrix --only horizon`) | běh 1 ✗: aserce pořadí řádků ve specu. Běh 2: košík ✓, pokladna ✗ (níže) |
| 4 matice 1 | ✓ Horizon ✓ Dawn, ale test košíku 1× flaky na každém tématu: HTTP 503 od Shopify (níže) |
| 5 **matice 2** | **✓ Horizon ✓ Dawn**, všech 8 testů hned napoprvé |
| 6 `--cleanup` (dry-run → `--live`) | SyncRun `cmumwgrpc0001sn8jyoimk1ws` ok, 389 B. Uzel kódu smazán, metafieldy obou produktů smazané |
| 7 `margin-costs.mjs --clear` (dry-run → `--live`) | 6 metafieldů smazáno, read-back 0 ze 9 variant. Nákupní ceny v katalogu zůstaly |
| 8 `verify-clean --live`, `--state` | stejné jako v kroku 0, liší se jen `modules.margin` (viz Úklid) |

## Matice 2 (2026-09-29T16:33:13Z – 16:35:55Z)

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  1 tests/e2e/checkout.margin.spec.ts:329:3 › Won Discounts margin protection in cart and checkout (MVP 2) — Horizon › cart: simple-a to its cost floor, simple-b to 30 %, Small none, WONE2EM20 applicable as an exact amount = planCart with the logged rate (22.7s)
[checkout.margin] Horizon: code re-entered in checkout
  ✓  2 tests/e2e/checkout.margin.spec.ts:431:3 › Won Discounts margin protection in cart and checkout (MVP 2) — Horizon › checkout (Bogus): margin never blocks; the thank-you page charges planCart with the checkout's logged rate, no line below its floor (49.5s)
  ✓  8 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.5s)
  ✓  9 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.2s)
  5 skipped
  4 passed (1.3m)
  ✓  1 tests/e2e/checkout.margin.spec.ts:329:3 › Won Discounts margin protection in cart and checkout (MVP 2) — Dawn › cart: simple-a to its cost floor, simple-b to 30 %, Small none, WONE2EM20 applicable as an exact amount = planCart with the logged rate (25.7s)
[checkout.margin] Dawn: code re-entered in checkout
  ✓  2 tests/e2e/checkout.margin.spec.ts:431:3 › Won Discounts margin protection in cart and checkout (MVP 2) — Dawn › checkout (Bogus): margin never blocks; the thank-you page charges planCart with the checkout's logged rate, no line below its floor (45.5s)
  ✓  8 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.2s)
  ✓  9 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (1.1s)
  5 skipped
  4 passed (1.2m)
   ✓ Horizon
   ✓ Dawn
```

5 přeskočených = `checkout.mvp1.spec.ts` a `checkout.shapes.spec.ts` (běží jen se svým profilem). Celý výstup: `e2e-phaseA/matrix-run.stdout.txt`.

## Co pokladna strhla (obě témata stejně, CZK)

Kurz `21.8802535`, floor jednoho kusu:
- s nákupní cenou: `ceilTol(cost × kurz × 100 / 0,75)`;
- bez nákupní ceny: `ceilTol(cena × 0,70)`.

| řádek | cena | nákupní cena v Kč | floor | chtěná 50 % | produktová sleva | objednávková sleva | cena po všech slevách | nad floor |
|---|---|---|---|---|---|---|---|---|
| Simple A | 219,00 | 6 USD = 131,28 | 175,05 | −109,50 | **−43,95** (fixní částka) | 0, vyřazen | 175,05 | 0,00 |
| Simple B | 263,00 | žádná → strop 30 % | 184,10 | −131,50 | **−78,90** (fixní částka) | 0, vyřazen | 184,10 | 0,00 |
| Two Variants Small | 329,00 | 5 USD = 109,40 | 145,87 | žádné pravidlo | 0 | **−65,80** | 263,20 | 117,33 |

| zdroj | mezisoučet po produktových slevách | WONE2EM20 | doprava | celkem |
|---|---|---|---|---|
| `planCart` (kurz z logu) | 688,15 | −65,80 (20 % ze 329,00) | | 622,35 |
| výstup funkce (log) | produkty `fixedAmount` 43.95 a 78.90, `appliesToEachItem` | `fixedAmount` 65.80, `excludedCartLineIds` = řádky Simple A a Simple B | | |
| `/cart.js` | 688,15, alokace `fixed_amount` 43.95 a 78.9 | `applicable: true`, `fixed_amount` 65.8, alokováno 6580 | | 622,35 |
| děkovná stránka | 688,15 | −65,80 | 657,00 | **1 279,35 Kč** = strženo z karty |

- Objednávková sleva jde jako přesná fixní částka, ne jako 20 %. Řádky na floor vynechává (`marginExcludedLineIds`), celá leží na Small.
- Invariant spec počítá vlastní aritmetikou, ne z plánu. Podíl objednávkové slevy bere z excludedCartLineIds ve skutečném výstupu funkce.
- Simple A: marže po slevě = (175,05 − 131,28) / 175,05 = 25,003 %.
- Každý zalogovaný běh košíku i pokladny = referenční adaptér nad zalogovaným vstupem (spec). Offline to platí pro všech 127 běhů dne.
- Plán ze zalogovaného vstupu (`adaptInput`) = plán z `/cart.js` + metafieldů čtených jménem appky.

Kód se z theme dev košíku do pokladny nepřenesl (známé rozdělení session, `checkout.mvp1.spec.ts`), spec ho zadal v pokladně. Vlastní běhy funkce v pokladně byly zalogované na obou tématech (`checkoutRunsLogged: true`, 8 běhů, země CZ).

## Nálezy během běhů

1. **Spec, opraveno: pořadí řádků.** Shopify v košíku řadí Small první, spec čekal pořadí A, B. `marginExcludedLineIds` se teď porovnává bez ohledu na pořadí.
2. **Log, obejito: pokladna bez zalogovaného běhu.** Vývojový běh 2, Horizon, 16:18:50–16:19:40Z: pokladna prošla a děkovná stránka seděla s plánem (1 279,35 Kč). Přesto v `.shopify/logs` ani v `app-dev.log` nebyl od 16:18:43 do 16:22:39 žádný běh.
   - Pokladny předtím (16:14, 16:15) i potom (16:22) se zalogovaly, i se stejným vstupem.
   - Příčina není známá. Buď Shopify použil hotový výsledek, nebo `app dev` vynechal log. Dokumentace o cache nic neříká.
   - Spec proto čeká na běhy pokladny 90 s. Když nepřijdou, vezme běhy téhož košíku z předchozích sekund (stejné řádky, kód i kurz). V evidenci je to `checkoutRunsLogged: false`.
   - V matici 1 i 2 se to nestalo.
3. **Spec, opraveno: řádek bez slevy.** Na děkovné stránce nemá řádek bez slevy `<s>`/`<p>`, cena je jen text buňky. `support/checkout.ts` ho teď čte.
4. **Infra, obejito: HTTP 503.** Matice 1: `GET /products/<handle>.js` přes theme dev vrátil jednou na každém tématu 503 `{"errors":[{"message":"There was a problem loading this website. Please try again.","extensions":{"code":"SERVICE_UNAVAILABLE"}}]}`.
   - Opakování prošlo.
   - `support/cart.ts` teď na 502/503/504 čeká stejně jako na 429.
   - Matice 2 prošla bez retry. Výstup matice 1: `e2e-phaseA/matrix-run1-flaky503.stdout.txt`.
5. **Prostředí: appka nemá offline session.** Seed zapsal produktové metafieldy, `products/update` webhooky došly a zrcadlo je zařadilo. Pak je zahodilo: `[won-costs] costs …: no Admin API session, the queued mirror was dropped` (`app-dev.log`).
   - V `dev.sqlite` není offline session pro store. Webhookové zrcadlo tedy na dev storu teď nic nezapíše.
   - E2E to neovlivnilo, zrcadlo běželo přes `live-costs.ts`.
   - Zápis ze živého webhooku (F-M3, zbytek z T3) zůstává neověřený.

Bez produktové chyby: výstup funkce, `/cart.js` i děkovná stránka odpovídají plánu na obou tématech.

## Úklid

- Pravidla, uzel kódu `WONE2EM20` a produktové metafieldy jsou pryč. Zůstal jen uzel „Won Discounts“ (ACTIVE), stejně jako v kroku 0.
- Variant metafieldy nákupní ceny: 0 z 9. Nákupní ceny v katalogu (6.0, 5.0, 4× 8.0 USD) zůstaly.
- `verify-clean`: `protoNodes`, `foreignProtoNodes`, `allDiscountNodes`, `products` i `clean` jsou stejné jako v kroku 0. `clean: false` je jen kvůli existujícímu `function_config`, stejně jako v MVP 1.
- `function_config` měl 427 B, teď má 389 B. Jediný rozdíl je `modules.margin`:
  - před E2E tvar MVP 1 `{"global":{"maxDiscountPercent":50},"perCollection":[]}`;
  - teď kompaktní tvar MVP 2 `{"enabled":false}`.
  - Obojí engine čte jako „marže vypnutá“ (`readMarginPayload`). Sync MVP 2 píše vždy nový tvar.
- Zrcadlo v app DB je prázdné: `clearCostMirror` smazal všech 51 řádků, `margin-costs.mjs --clear` (dry-run) po úklidu hlásí 0 řádků.

Testovací objednávky (Bogus, `won-e2e+margin@example.com`, každá 1 279,35 Kč): 8.
- 2× vývojový běh 1;
- 2× vývojový běh 2;
- 2× matice 1;
- 2× matice 2.

## Soubory

- `e2e-phaseA/cart-margin-{horizon,dawn}.json`, `checkout-margin-{horizon,dawn}.json`: plán, floors, výstup, `/cart.js`, děkovná stránka, invariant, kurz.
- `e2e-phaseA/function-runs-{cart,checkout}-margin-{horizon,dawn}.json`: zalogované běhy (vstup řádků, `wonVariant`, kurz, výstup).
- `e2e-phaseA/screenshots/thankyou-margin-{1440,390}-{horizon,dawn}.png`: 390 s rozbaleným shrnutím.
- `e2e-phaseA/steps/`: dry-run a live výstupy seedu, zrcadla, úklidu, SyncRun JSON, read-back variant, verify-clean před a po.
- `f-m1-f-m2-function-input.md` + `.json`: F-M1 a F-M2.

## Příkazy pro ověření

```sh
# běží `shopify app dev` BEZ WON_DEV_PLAN (Free)
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin            # dry-run
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin --live
node apps/won-discounts/scripts/e2e/margin-costs.mjs                          # dry-run
node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
WON_E2E_PROFILE=margin npm run test:e2e:local:all -w won-discounts
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup                   # dry-run
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live
node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear                  # dry-run
node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear --live
WON_PROTO_OUT=/tmp/won-verify node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
node apps/won-discounts/scripts/e2e/margin-costs.mjs --readback
```
