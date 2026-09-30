# MVP 2 finální brána, fáze B: plán Pro (2026-09-30)

Stav: **✓ Horizon ✓ Dawn.** Bez `--bail`, 1 řádek flaky (infra, níže).
- Přepis podle kolekce platí: Simple B má strop 10 %.
- Kontrolní řádek spare drží globálních 30 %. Free fold by mu dal 10 %.
- Objednávková sleva jde jako přesná částka.
- Embed je zase ✓ na obou tématech, 404 z fáze A je pryč.
- SK/EUR je **přeskočené jako BLOCKED (nastavení storu)**, ne prošlé.
- Úklid bez zálohy zná Pro tvar. `verify-clean` = stav před fází B.

Nastavení běhu:
- `shopify app dev` běžel s `NODE_ENV=development WON_DEV_PLAN=pro`, restart dělal controller. Nový dev preview, finální Wasm (b496d2b + 05aa9ef).
- Seed, zrcadlo i úklid jely se stejným override, SyncRun hlásí `plan pro: nothing to gate`.
- Marže: globálně minimální marže 25 % a maximální sleva 30 %. Přepis kolekce `won-e2e-margin` (jen won-e2e-simple-b): maximální sleva 10 %, minimum bere z globálu.
- Pravidla jako ve fázi A: automatická 50 % na simple-a, simple-b a spare, kódy `WONE2EM20` a `WONE2EM60`.

## Kroky

| krok | výsledek |
|---|---|
| 0 `--state`, `margin-collection --state`, read-back, `verify-clean --live` | čisto (stav po fázi A): 0 pravidel, 389 B, jen uzel „Won Discounts“. Kolekce neexistuje, 0 variant metafieldů, 6 nákupních cen v katalogu |
| 1 kolekce `margin-collection.mjs` (dry-run → `--live`) | ruční „Won E2E — Margin (Pro)“ `won-e2e-margin` = `gid://shopify/Collection/492000346353`, produkty [won-e2e-simple-b]. Read-back ok |
| 2 seed `--profile margin-pro` (dry-run → `--live`, Pro override) | SyncRun `cmunzpceu0006snccg62pitm5`, verze `cmunzn8ds0000snccg4ws2kbk`, 984 B, `plan pro: nothing to gate`, `(1 collection(s))`. Pořadí: nejdřív metafield simple-b s `marginRefs:["492000346353"]`, pak `function_config`, pak simple-a a spare |
| 2b webhook zrcadla | `products/update` po seedu zapsal metafield simple-a `{"cost":6,"cur":"USD"}` sám (read-back 1 z 9), stejně jako ve fázi A |
| 3 zrcadlo `margin-costs.mjs` (dry-run → `--live`) | 51 variant, zapsáno 5 metafieldů. Read-back 6 z 6 |
| 4 **matice `margin-pro`** (10:58:10–11:05:57Z) | **✓ Horizon ✓ Dawn.** Hlavní košík, pokladna a order-cap ✓ na obou. SK `skipped` s důvodem BLOCKED na obou. Embed 2 z 2 na obou. Horizon order-cap 1× flaky: pokladna se napoprvé nenačetla, retry ✓ |
| 5 `--cleanup` **bez zálohy** (`--out` na prázdný adresář, dry-run → `--live`) | „margin settings = the margin-pro seed's (override of gid://shopify/Collection/492000346353) → reset to the defaults (off, no override)“. SyncRun `cmuo053zs0002sngkz62hvxki`, 389 B |
| 6 `margin-costs --clear` (dry-run → `--live`) | 6 metafieldů smazáno, read-back 0 z 9, zrcadlo 0 řádků |
| 7 `margin-collection --delete` (dry-run → `--live`) | kolekce smazaná. Read-back: neexistuje, simple-b je v [] |
| 8 `verify-clean --live`, `--state`, `margin-collection --state`, read-back | shodné s krokem 0, jiný je jen `updatedAt` metafieldu `function_config`. Obsah je stejný (389 B) |

## Matice `margin-pro` (2026-09-30T10:58:10Z – 11:05:57Z)

```
  ✓   1 checkout.margin.spec.ts:695 [Pro: collection override] — Horizon › cart: simple-a to its cost floor, simple-b to its collection's 10 %, spare to 30 %, Small none, WONE2EM20 … (26.x s)
[checkout.margin] Horizon: WONE2EM20 re-entered in checkout
  ✓   2 … — Horizon › checkout (Bogus): margin never blocks; the thank-you page charges planCart … (53.2s)
  ✘   3 … — Horizon › order discount lowered by margin (WONE2EM60) … (1.9m)   openCheckout: locator('#email') not visible in 90 s
[checkout.margin] Horizon: WONE2EM60 re-entered in checkout
  ✓   4 … — Horizon › order discount lowered by margin (WONE2EM60) … (retry #1) (46.4s)
[checkout.margin] Horizon: after ?country=SK: country SK, currency EUR
[checkout.margin] Horizon: SK scenario skipped — BLOCKED by store setup: the slovensko market does not sell won-e2e-simple-a, won-e2e-simple-b, won-e2e-two-variants (Small), won-e2e-spare (available: false with country SK; /cart/add.js would answer 422 "vyprodán"). Not an app result: enable selling in SK (shipping zone / market) and rerun.
  -   5 … — Horizon › slovensko (EUR): …
  ✓  11 storefront.embed.spec.ts:111 — Horizon › renders the ready marker and boots window.WonDiscounts on the PDP (1.4s)
  ✓  12 storefront.embed.spec.ts:139 — Horizon › causes no horizontal overflow at 390px (1.2s)
  1 flaky, 6 skipped, 4 passed (5.2m)
  ✓   1 … — Dawn › cart … 
  ✓   2 … — Dawn › checkout (Bogus) … (48.3s)
  ✓   3 … — Dawn › order discount lowered by margin (WONE2EM60) … (45.8s)
[checkout.margin] Dawn: SK scenario skipped — BLOCKED by store setup: … (stejný důvod)
  -   4 … — Dawn › slovensko (EUR): …
  ✓  10 storefront.embed.spec.ts:111 — Dawn (1.0s)
  ✓  11 storefront.embed.spec.ts:139 — Dawn (906ms)
  6 skipped, 5 passed (2.3m)
   ✓ Horizon
   ✓ Dawn
```

Celý výstup je v `e2e-final-B/matrix.stdout.txt`. Přeskočené testy: SK (BLOCKED) a 5 specu `mvp1` a `shapes`, které běží jen se svým profilem.

Flaky Horizon order-cap, 1. pokus:
- `openCheckout` čekal 90 s na `#email` a pokladna se nenačetla. Objednávka nevznikla.
- Retry prošel celý (46,4 s), s logovanými běhy a děkovnou stránkou = plán. Příčina je na straně načítání pokladny Shopify, ne v appce.

## Kurz (F-M1)

`presentmentCurrencyRate` = `"21.833462"`:
- JSON string (Decimal), 8 platných číslic, 6 desetinných míst;
- směr USD → CZK;
- stejný ve všech bězích košíku i pokladny na obou tématech.

Ráno (fáze A) byl kurz `"21.85092"`. Simple B teď stojí 262 Kč a multiaxis 437 Kč. Spec počítá z kurzu v logu.

Poměr kurz/cena (Small 328 Kč / 15 USD) = 0,99845.

## Co pokladna strhla (obě témata stejně, CZK)

Hlavní košík + `WONE2EM20`. Floor jednoho kusu:
- s nákupní cenou: `ceilTol(cost × 21,833462 × 100 / 0,75)`;
- bez nákupní ceny: `ceilTol(cena × (1 − strop))`.

| řádek | nastavení (fixture, ne payload) | cena | floor | chtěná 50 % | produktová sleva (výstup funkce) | objednávková | po všech slevách | nad floor |
|---|---|---|---|---|---|---|---|---|
| Simple A | globální, m 25 %, cost 6 USD = 131,00 | 219,00 | 174,67 | −109,50 | **−44,33** `fixedAmount` | 0, vyřazen | 174,67 | 0,00 |
| Simple B | **kolekce p 10 %** (`source: "collection"`) | 262,00 | 235,80 | −131,00 | **−26,20** `fixedAmount` | 0, vyřazen | 235,80 | 0,00 |
| Spare (kontrolní řádek) | **globální p 30 %** (mimo kolekci) | 199,00 | 139,30 | −99,50 | **−59,70** `fixedAmount` | 0, vyřazen | 139,30 | 0,00 |
| Two Variants Small | globální, cost 5 USD = 109,17 | 328,00 | 145,56 | žádné pravidlo | 0 | **−65,60** | 262,40 | 116,84 |

Pro proti Free:
- Free fold by přepis kolekce složil do globálu (10 %). Spare by pak dostal −19,90 místo −59,70.
- Spec tvrdí, že spare ≠ fold, a prošlo to.
- Simple B by na Free (globál 30 %) dostal −78,60.

| zdroj | mezisoučet po produktových slevách | WONE2EM20 | doprava | celkem |
|---|---|---|---|---|
| `planCart` (kurz z logu) | 877,77 | −65,60 (20 % z 328,00) | | 812,17 |
| výstup funkce (log) | `fixedAmount` 44.33 / 26.20 / 59.70, `appliesToEachItem` | `fixedAmount` 65.60, `excludedCartLineIds` = řádky A, B a spare | | |
| `/cart.js` | 877,77, alokace `fixed_amount` | `applicable: true`, `fixed_amount` 65.6, alokováno 6560 | | 812,17 |
| děkovná stránka | 877,77 | −65,60 | 655,00 | **1 467,17 Kč** = strženo z karty |

Živý payload a vstup funkce (spec to kontroluje v každém běhu):
- `margin = {"enabled":true,"min":25,"max":30,"cur":"USD","col":{"492000346353":[null,10]}}`. Globál zůstal na 30, přepis jde jako `col`.
- `marginRefs:["492000346353"]` má jen simple-b, u simple-a, spare, Small a multiaxis chybí.
- `wonVariant`: `{"cost":6,"cur":"USD"}` simple-a, `{"cost":5,…}` Small, `null` simple-b a spare.

Snížená objednávková sleva (`WONE2EM60`, Small + multiaxis S / Red):

| řádek | cena | nákupní cena | floor | h = cena − floor − 1 |
|---|---|---|---|---|
| Multi Axis S / Red | 437,00 | 8 USD = 174,67 | 232,90 | 204,09 |
| Two Variants Small | 328,00 | 5 USD = 109,17 | 145,56 | 182,43 |

- Chtěných 60 % ze 765,00 = 459,00 Kč.
- `D_max = min(⌊20409 × 76500 / 43700⌋, ⌊18243 × 76500 / 32800⌋) = min(35727, 42548)` = **357,27 Kč**, rozloženo přes oba řádky.
- Plán: `{fixedTotal: 35727}`, `marginCapped {before 45900, after 35727}`, `marginExcludedLineIds []`.
- Výstup funkce: `fixedAmount 357.27`, `excludedCartLineIds []`.
- `/cart.js`: `fixed_amount` 357.27.
- Děkovná stránka: mezisoučet 765,00, WONE2EM60 −357,27, doprava 655,00, **1 062,73 Kč** = strženo z karty.

Invariant (vlastní aritmetika specu, podíl objednávkové slevy podle skutečného výstupu funkce):
- Hlavní košík: A, B (s floor z kolekce) i spare přesně na floor. Small 262,40 ≥ 145,56. Součet 812,17 ≥ Σ floors 695,33.
- Order-cap (proporcionální dělení zaokrouhlené nahoru):
  - multiaxis 437,00 − 204,09 = 232,91 ≥ 232,90 (1 haléř);
  - Small 328,00 − 153,19 = 174,81 ≥ 145,56.

Parita: v každém testu platí zalogovaný výstup = `runCartLines` referenčního adaptéru nad zalogovaným vstupem, 8 běhů na pokladnu hlavního košíku. Plán ze zalogovaného vstupu = plán z `/cart.js`. Běhy pokladny byly zalogované ve všech testech (`checkoutRunsLogged: true`).

## SK/EUR: BLOCKED (nastavení storu)

- Spec přepne session přes `?country=SK` (country SK, currency EUR na obou tématech). Pak ověří předpoklad: každý produkt košíku se v trhu slovensko prodává.
- Není splněný: `won-e2e-simple-a`, `won-e2e-simple-b`, `won-e2e-two-variants (Small)` i `won-e2e-spare` mají v SK `available: false`.
- Test proto skončí `test.skip` s důvodem „BLOCKED by store setup …“. Není to pass. Zapíše `sk-margin-pro-blocked-{horizon,dawn}.json` (`status: "blocked (store setup)"`).
- Příčina je doložená ve fázi A (`e2e-final-A/sk-probe/`): v SK se neprodává žádný z 23 produktů katalogu, EUR ceny existují.
- Jakmile store začne v SK prodávat, test poběží celý bez změny kódu: F-M1 pro EUR, košík, Bogus do Bratislavy, invariant.

## Úklid bez zálohy (Pro tvar)

- `--cleanup --out <prázdný adresář>`:
  - pozná uloženou marži jako fixture `margin-pro` (přepis na `gid://shopify/Collection/492000346353`, tedy kolekci `won-e2e-margin`, dotaz přes `nodes`);
  - resetuje ji na výchozí (vypnuto, bez přepisu);
  - smaže E2E pravidla i oba uzly kódů.
- Pořadí zápisů je fail closed:
  1. simple-b nejdřív dostane `{"ruleIds":[],"variantRuleIds":{},"marginRefs":["492000346353"]}`, refs drží až do přepnutí;
  2. metafieldy simple-a a spare smazány;
  3. `function_config` 389 B;
  4. `products.prune` smaže metafield simple-b až po přepnutí.
- Nepoužitá záloha seedu z kroku 2 je přejmenovaná na `won-e2e-final-B/seed-mvp1-backup.unused-nobackup-cleanup-ran.json` (scratchpad), aby ji budoucí seed se stejným `--out` nepovažoval za živou.
- `verify-clean`: `protoNodes`, `foreignProtoNodes`, `allDiscountNodes`, `products`, hodnota `function_config` i `clean` jsou stejné jako v kroku 0. `clean: false` je jen kvůli existujícímu `function_config`, známý stav.
- Nákupní ceny v katalogu (6.0, 5.0, 4× 8.0 USD) zůstaly. Variant metafieldy 0 z 9, zrcadlo 0 řádků, kolekce neexistuje.

Testovací objednávky (Bogus, `won-e2e+margin-pro@example.com`): 2× 1 467,17 Kč (hlavní) a 2× 1 062,73 Kč (order-cap). Flaky první pokus objednávku nevytvořil.

## Nálezy

1. **Embed je opravený restartem.** Nový dev preview servíruje `won-discounts.js` a embed je `ready` na obou tématech (2 z 2). 404 z fáze A šlo na vrub nepovedeného buildu funkce během běhu, ne kódu.
2. **Webhookové zrcadlo nákupních cen běží živě** (offline session existuje). Po seedu zapsalo metafield simple-a samo, na Free i na Pro. Cílený test změny nákupní ceny přes webhook nemám.
3. **Pokladna se jednou nenačetla** (Horizon, order-cap, 90 s bez `#email`), retry ✓. Infra Shopify.
4. SK zůstává BLOCKED do změny nastavení storu. To je rozhodnutí pro Ondřeje, appka nemá `read_shipping` ani `read_markets`.

## Změny ve specu (scope `tests/e2e/**`)

- `checkout.margin.spec.ts`, SK test:
  - kontrola, že session je po `?country=SK` v SK;
  - předpoklad „every product of the cart is for sale in the slovensko market“ jako krok;
  - při nesplnění evidence `sk-margin[-pro]-blocked-*.json`, log a `test.skip(true, "BLOCKED by store setup: …")`;
  - hlavička scénáře 4 to popisuje.
- `tsc --noEmit` ok, `eslint` ok.

## Soubory

- `e2e-final-B/`:
  - `cart-margin-pro-*`, `checkout-margin-pro-*`, `order-cap-margin-pro-*` (+ `function-runs-*`) `-{horizon,dawn}.json`;
  - `sk-margin-pro-blocked-{horizon,dawn}.json`;
  - `matrix.stdout.txt`.
- `e2e-final-B/screenshots/`:
  - `thankyou-margin-pro-{1440,390}-{horizon,dawn}.png`;
  - `thankyou-order-cap-margin-pro-{1440,390}-{horizon,dawn}.png`;
  - `e2e-embed-{horizon,dawn}-{1440,390}.png`.
  - 390 je s rozbaleným shrnutím.
- `e2e-final-B/steps/`: dry-run a live výstupy kolekce, seedu, zrcadla, úklidu bez zálohy, clearu a smazání kolekce. Dále SyncRun JSON, read-backy, verify-clean před a po, stav před a po.

## Příkazy pro ověření

```sh
# `shopify app dev` s NODE_ENV=development WON_DEV_PLAN=pro, z kořene repa
E=$PWD/docs/won-discounts/evidence/mvp2
node apps/won-discounts/scripts/e2e/margin-collection.mjs --live --out /tmp/won-e2e-final-B
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin-pro --live --out /tmp/won-e2e-final-B
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/margin-costs.mjs --live --out /tmp/won-e2e-final-B
WON_E2E_PROFILE=margin-pro WON_DISCOUNTS_E2E_EVIDENCE_DIR=$E/e2e-final-B WON_DISCOUNTS_E2E_SCREENSHOT_DIR=$E/e2e-final-B/screenshots \
  npm run test:e2e:local:all -w won-discounts
mkdir -p /tmp/won-e2e-nobackup && NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live --out /tmp/won-e2e-nobackup
NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear --live --out /tmp/won-e2e-final-B
node apps/won-discounts/scripts/e2e/margin-collection.mjs --delete --live --out /tmp/won-e2e-final-B
WON_PROTO_OUT=/tmp/won-e2e-final-B/verify-after node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
```
