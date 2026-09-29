# MVP 2, T5b fáze B: přepis marže podle kolekce, plán Pro (2026-09-29)

Stav: **✓ Horizon ✓ Dawn napoprvé, bez `--bail`, žádný retry. Simple B má strop 10 % z kolekce, Simple A drží floor z nákupní ceny, objednávková sleva je přesná částka bez řádků na hranici. Děkovná stránka = `planCart` s kurzem z logu, invariant platí s hodnotami kolekce. Store je uklizený.**

- `shopify app dev` běžel s dev-only overridem `NODE_ENV=development WON_DEV_PLAN=pro`, controller ho restartoval po fázi A.
- Seed, zrcadlo i úklid jely se stejným overridem. SyncRun krok `plan` hlásí `plan pro: nothing to gate`.
- Pravidla, košík a globální marže jsou stejné jako ve fázi A: m 25 %, p 30 %, auto 50 % na Simple A + B, kód `WONE2EM20` 20 %.
- Navíc testovací ruční kolekce `won-e2e-margin` („Won E2E — Margin (Pro)“, `gid://shopify/Collection/491958272241`), jen s won-e2e-simple-b.
- Kolekce má vlastní maximální slevu 10 %. Minimální marži nechává globální.
- Kurz z logu funkce: `presentmentCurrencyRate` = `"21.8802535"`, stejný jako ve fázi A. Platí pro všech 35 běhů fáze B.

## Čím je fáze B důkazem Pro

Na Free by plan gate těch 10 % složil do globálního stropu (`gateConfigForPlan`: strictest wins). Simple B je v košíku jediný řádek bez nákupní ceny, takže Free by mu dal také 10 %. Samotný výsledek na Simple B tedy Pro od Free neodliší.

Spec proto kontroluje payload, který funkce skutečně četla:
- **globální strop zůstal 30 %**: `margin = {"enabled":true,"min":25,"max":30,"cur":"USD","col":{"491958272241":[null,10]}}`;
- **`marginRefs` má jen Simple B**: produktový metafield `{"ruleIds":["e2e-margin-auto-50"],"variantRuleIds":{},"marginRefs":["491958272241"]}`, Simple A a Small je nemají;
- obojí je i ve vstupu funkce, ve všech 35 bězích fáze B.

Strop 10 % na Simple B tak může pocházet jen z `marginRefs` + `col` ve funkci. Plán to potvrzuje: `marginCapped.source = "collection"`, `maxDiscountPercent 10`. Simple A má `source "global"`.

## Kroky

| krok | výsledek |
|---|---|
| 0 `--state`, `verify-clean --live`, read-back variant, stav kolekce | stav po fázi A: 0 pravidel, `function_config` 389 B, jen uzel „Won Discounts“, 0 variant metafieldů, kolekce neexistuje |
| 1 kolekce `margin-collection.mjs` (dry-run → `--live`) | `collectionCreate` (ruční, `products: [simple-b]`). Read-back: kolekce 491958272241, produkty [won-e2e-simple-b], simple-b je v [won-e2e-margin] |
| 2 seed `--profile margin-pro` (dry-run → `--live`) | SyncRun `cmumx3bl70004snxf5kaviycn` ok, `plan pro: nothing to gate`, `2 targeted product(s) (1 collection(s) …)`, 800 B. Uzel kódu `WONE2EM20` vytvořen, simple-b má `marginRefs` |
| 3 zrcadlo `margin-costs.mjs` (dry-run → `--live`) | 51 variant přečteno, 6 metafieldů zapsáno, read-back 6 ze 6 |
| 4 **matice `margin-pro`** | **✓ Horizon ✓ Dawn**, 8 testů napoprvé |
| 5 `--cleanup` (dry-run → `--live`) | SyncRun `cmumxb7vs0001sna9kmh95jtp` ok, 389 B, 0 pravidel, marže vypnutá, přepis kolekce pryč. Uzel kódu smazán, metafieldy obou produktů smazané |
| 6 `margin-costs.mjs --clear` (dry-run → `--live`) | 6 metafieldů smazáno, read-back 0 z 9, zrcadlo v DB 0 řádků |
| 7 `margin-collection.mjs --delete` (dry-run → `--live`) | `collectionDelete` 491958272241. Read-back: kolekce neexistuje, simple-b je v [] |
| 8 `verify-clean --live`, `--state`, read-back, stav kolekce | stejné jako v kroku 0, liší se jen `updatedAt` metafieldu `function_config` (obsah shodný) |

Scopes (ověřeno Shopify dev MCP, admin 2026-04, operace zvalidované proti schématu):
- `collectionCreate` = write_products + read_products;
- `collectionDelete` = write_products;
- čtení kolekce = read_products.

Appka má `read_products, read_themes, write_discounts, write_products`.

## Matice (2026-09-29T16:56:55Z – 16:59:41Z)

`WON_E2E_PROFILE=margin-pro npm run test:e2e:local:all -w won-discounts`

```
✓ e2e/settings_data.horizon.json up to date
✓ e2e/settings_data.dawn.json up to date
  ✓  1 tests/e2e/checkout.margin.spec.ts:444:3 › Won Discounts margin protection in cart and checkout (MVP 2) [Pro: collection override] — Horizon › cart: simple-a to its cost floor, simple-b to its collection's 10 %, Small none, WONE2EM20 applicable as an exact amount = planCart with the logged rate (22.9s)
[checkout.margin] Horizon: code re-entered in checkout
  ✓  2 tests/e2e/checkout.margin.spec.ts:539:3 › Won Discounts margin protection in cart and checkout (MVP 2) [Pro: collection override] — Horizon › checkout (Bogus): margin never blocks; the thank-you page charges planCart with the checkout's logged rate, no line below its floor (53.4s)
  ✓  8 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.5s)
  ✓  9 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Horizon › causes no horizontal overflow at 390px (1.3s)
  5 skipped
  4 passed (1.3m)
  ✓  1 tests/e2e/checkout.margin.spec.ts:444:3 › Won Discounts margin protection in cart and checkout (MVP 2) [Pro: collection override] — Dawn › cart: simple-a to its cost floor, simple-b to its collection's 10 %, Small none, WONE2EM20 applicable as an exact amount = planCart with the logged rate (22.0s)
[checkout.margin] Dawn: code re-entered in checkout
  ✓  2 tests/e2e/checkout.margin.spec.ts:539:3 › Won Discounts margin protection in cart and checkout (MVP 2) [Pro: collection override] — Dawn › checkout (Bogus): margin never blocks; the thank-you page charges planCart with the checkout's logged rate, no line below its floor (48.4s)
  ✓  8 tests/e2e/storefront.embed.spec.ts:111:3 › Won Discounts app embed (MVP 0) — Dawn › renders the ready marker and boots window.WonDiscounts on the PDP (1.3s)
  ✓  9 tests/e2e/storefront.embed.spec.ts:139:3 › Won Discounts app embed (MVP 0) — Dawn › causes no horizontal overflow at 390px (890ms)
  5 skipped
  4 passed (1.2m)
   ✓ Horizon
   ✓ Dawn
```

5 přeskočených = `checkout.mvp1.spec.ts` a `checkout.shapes.spec.ts`. Celý výstup: `e2e-phaseB/matrix-run.stdout.txt`.

## Co pokladna strhla (obě témata stejně, CZK)

Kurz `21.8802535`. Floor jednoho kusu spec počítá z hodnot, které pro produkt platí:
- s nákupní cenou: `ceilTol(cost × kurz × 100 / (1 − m))`;
- bez ní: `ceilTol(cena × (1 − p))`, u Simple B s p = 10 % z kolekce.

| řádek | nastavení | cena | floor | chtěná 50 % | produktová sleva | objednávková | po všech slevách | nad floor |
|---|---|---|---|---|---|---|---|---|
| Simple A | globální, cost 6 USD, m 25 % | 219,00 | 175,05 | −109,50 | **−43,95** (fixní částka) | 0, vyřazen | 175,05 | 0,00 |
| Simple B | **kolekce**, bez nákupní ceny, p 10 % | 263,00 | 236,70 | −131,50 | **−26,30** (fixní částka) | 0, vyřazen | 236,70 | 0,00 |
| Small | globální, cost 5 USD, m 25 % | 329,00 | 145,87 | žádné pravidlo | 0 | **−65,80** | 263,20 | 117,33 |

| zdroj | mezisoučet po produktových slevách | WONE2EM20 | doprava | celkem |
|---|---|---|---|---|
| `planCart` (kurz z logu) | 740,75 | −65,80 (20 % ze 329,00) | | 674,95 |
| výstup funkce (log) | `fixedAmount` 43.95 a 26.30, `appliesToEachItem` | `fixedAmount` 65.80, `excludedCartLineIds` = Simple A + Simple B | | |
| `/cart.js` | 740,75, `fixed_amount` 43.95 a 26.3 | `applicable: true`, `fixed_amount` 65.8, alokováno 6580 | | 674,95 |
| děkovná stránka | 740,75 | −65,80 | 657,00 | **1 331,95 Kč** = strženo z karty |

- Proti fázi A: Simple B −26,30 místo −78,90 (10 % z kolekce místo 30 %). Simple A a objednávková sleva beze změny. Celkem o 52,60 Kč víc (1 331,95 místo 1 279,35).
- Invariant spec počítá vlastní aritmetikou s hodnotami kolekce. Podíl objednávkové slevy bere z excludedCartLineIds ve skutečném výstupu funkce. Platí na všech řádcích obou témat.
- Každý zalogovaný běh fáze B = referenční adaptér nad zalogovaným vstupem: 35 ze 35 (31 cílů lines, 4 cíle delivery).
- Plán ze zalogovaného vstupu = plán z `/cart.js` + metafieldů čtených jménem appky.
- Kód se v pokladně zadával znovu (rozdělení session theme dev). Běhy pokladny byly zalogované (`checkoutRunsLogged: true`, 8 na téma).

## Nálezy

Žádná produktová chyba. Prostředí se chová stejně jako ve fázi A: appka nemá offline session pro dev store.
- Seed a přidání produktu do kolekce vyvolaly `products/update`.
- `app-dev.log`: `[won-costs] … no Admin API session, the queued mirror was dropped` a `[won-targeting] targeting refresh …: no Admin API session, skipped`.
- Na E2E to vliv nemá: `marginRefs` zapsal seed přes kanonický sync a nákupní ceny `live-costs.ts`.
- Webhookové cesty (zrcadlo i obnova targetingu po změně členství v kolekci) jsou ale na dev storu naživo neověřené.

## Úklid

- Pravidla, uzel kódu, produktové metafieldy (včetně `marginRefs`), marže i přepis kolekce jsou pryč. `function_config` má 389 B, marže `{"enabled":false}`.
- Variant metafieldy nákupní ceny: 0 z 9. Zrcadlo v app DB: 0 řádků. Nákupní ceny v katalogu zůstaly.
- Kolekce `won-e2e-margin` je smazaná, simple-b není v žádné kolekci.
- `verify-clean` proti stavu před fází B: shodný, liší se jen `updatedAt` metafieldu `function_config`, obsah je stejný.
- `verify-clean` proti stavu před fází A: liší se jen `modules.margin`, MVP 1 tvar `{"global":{"maxDiscountPercent":50},"perCollection":[]}` → MVP 2 `{"enabled":false}`. Vysvětlení v `e2e-phaseA.md` (Úklid).

Testovací objednávky (Bogus, `won-e2e+margin-pro@example.com`, každá 1 331,95 Kč): 2, jedna na téma.

## Soubory

- `e2e-phaseB/cart-margin-pro-{horizon,dawn}.json`, `checkout-margin-pro-{horizon,dawn}.json`: živý payload marže, id kolekce, plán s `settings` a `source` na řádek, výstup, `/cart.js`, děkovná stránka, invariant, kurz.
- `e2e-phaseB/function-runs-{cart,checkout}-margin-pro-{horizon,dawn}.json`: zalogované běhy (config `col`, `marginRefs`, `wonVariant`, kurz, výstup).
- `e2e-phaseB/screenshots/thankyou-margin-pro-{1440,390}-{horizon,dawn}.png`: 390 s rozbaleným shrnutím.
- `e2e-phaseB/steps/`: dry-run a live výstupy kolekce, seedu, zrcadla a úklidu, SyncRun JSON, create/delete kolekce JSON, verify-clean, `--state`, read-back před a po.

## Příkazy pro ověření

```sh
# běží `shopify app dev` S overridem: NODE_ENV=development WON_DEV_PLAN=pro
node apps/won-discounts/scripts/e2e/margin-collection.mjs                     # dry-run
node apps/won-discounts/scripts/e2e/margin-collection.mjs --live
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin-pro          # dry-run
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin-pro --live
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
WON_E2E_PROFILE=margin-pro npm run test:e2e:local:all -w won-discounts
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear --live
node apps/won-discounts/scripts/e2e/margin-collection.mjs --delete --live
WON_PROTO_OUT=/tmp/won-verify node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
```
