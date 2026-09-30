# MVP 2 finální brána, fáze A: plán Free (2026-09-30)

Stav: **Matice ✗ Horizon ✗ Dawn. Všechny CZ scénáře marže ✓ na obou tématech ve dvou maticích po sobě, produktová chyba nenalezena. Řádky padají jen na dvou blokerech prostředí. Store je uklizený.**

Blokery prostředí:
- **SK/EUR:** trh slovensko nic neprodává. Všech 23 produktů katalogu má v SK `available: false`, přidání do košíku vrací 422 „je již vyprodán“.
- **Embed od 09:53Z:** dev preview appky vrací 404 na `won-discounts.js`. Stalo se to po nepovedeném buildu funkce, který spustil paralelní engine agent.

Nastavení běhu:
- `shopify app dev` běžel bez `WON_DEV_PLAN` (`NODE_ENV=development`, override chybí), tedy Free. Seed i úklid hlásí `plan free`.
- Bez `--bail`, `PLAYWRIGHT_RETRIES=1` z runneru.
- Marže: zapnutá, minimální marže 25 %, maximální sleva 30 %.
- Pravidla: automatická 50 % na simple-a, simple-b a spare. Kódy `WONE2EM20` (20 % na objednávku) a `WONE2EM60` (60 %).
- Regrese MVP 1 s vypnutou marží: profil `mvp1` a `shapes` (`WON_E2E_PLAN=free`) ✓ na obou tématech. Padá jen embed kvůli stejnému 404.

## Kroky

| krok | výsledek |
|---|---|
| 0 unit test úklidu | `node --test …/margin-cleanup.test.mjs`: 6 z 6 |
| 0 `--state`, `verify-clean --live`, read-back | čisto: 0 pravidel, `function_config` 389 B (`modules.margin = {"enabled":false}`), jen uzel „Won Discounts“ (ACTIVE). 0 variant metafieldů, 6 variant má nákupní cenu v katalogu |
| 1 seed `--profile margin` (dry-run → `--live`) | SyncRun `cmunu947r0006snsxo05hyolc` ok, verze `cmunu869a0000snsx78ty7juz`, 951 B, `plan free: nothing to gate`. Uzly kódů `WONE2EM20` a `WONE2EM60`, 3 produkty dostaly pravidlo |
| 1b webhook zrcadla (nečekané) | Po seedu `products/update` → `[won-costs] … queued`. Webhook sám zapsal metafield simple-a `{"cost":6,"cur":"USD"}` (read-back 1 z 9). Offline session teď existuje, viz Nálezy 3 |
| 2 zrcadlo `margin-costs.mjs` (dry-run → `--live`) | 51 variant přečteno, zapsáno 5 metafieldů (simple-a už měl). Read-back 6 z 6: `{"cost":6,…}`, `{"cost":5,…}`, 4× `{"cost":8,"cur":"USD"}` |
| 3 matice 1 (08:25–08:35Z) | CZ testy ✓✓✓ na obou tématech. SK ✗ na obou: `POST /localization` přes theme dev → 401, země zůstala CZ (chyba specu, opraveno) |
| 4 průzkum SK (4 sondy, jen Horizon, dočasný spec smazán) | `?country=SK` přepne session na SK/EUR. Každý produkt je ale v SK nedostupný, na theme dev i na skutečném storefrontu |
| 5 **matice 2** (08:57–09:06Z) | CZ testy ✓✓✓ na obou napoprvé. SK ✗ na obou u nové kontroly dostupnosti (prostředí). Embed Horizon 1× flaky (503 na PDP, retry ✓) |
| 6 `--cleanup` (dry-run → `--live`) | SyncRun `cmunxhbw60001sng94mplhach`, 389 B, oba uzly kódů smazané, 3 produkty vyčištěné |
| 7 `margin-costs --clear` (dry-run → `--live`) | 6 metafieldů smazáno, read-back 0 z 9, zrcadlo v DB 0 řádků |
| 8 seed `mvp1` (dry-run → `--live`) + matice | SyncRun `cmunxkhxc0003sn7ok6wpe6u0`, 715 B. `checkout.mvp1` 3 z 3 ✓ na obou. Embed ✗ na obou (404) |
| 9 seed `shapes` (dry-run → `--live`) + matice `WON_E2E_PLAN=free` | SyncRun `cmunyamcr0003snpvajl7g6o7`, `plan free: 2 Pro setting(s) not applied`, 872 B. `checkout.shapes` 2 z 2 ✓ na obou. Embed ✗ na obou (404) |
| 10 `--cleanup` (dry-run → `--live`) | SyncRun `cmunyp8mk0001sna69tfqdqdg`, 389 B, 2 produkty vyčištěné |
| 11 `verify-clean --live`, `--state`, read-back | shodné s krokem 0, jiný je jen `updatedAt` metafieldu `function_config`. Obsah je stejný (389 B) |

## Matice 2, profil `margin` (2026-09-30T08:57Z – 09:06:30Z)

```
  ✓   1 checkout.margin.spec.ts:694 — Horizon › cart: simple-a to its cost floor, simple-b to 30 %, spare to 30 %, Small none, WONE2EM20 … = planCart with the logged rate (25.0s)
[checkout.margin] Horizon: WONE2EM20 re-entered in checkout
  ✓   2 checkout.margin.spec.ts:749 — Horizon › checkout (Bogus): margin never blocks; the thank-you page charges planCart … (51.8s)
[checkout.margin] Horizon: WONE2EM60 re-entered in checkout
  ✓   3 checkout.margin.spec.ts:819 — Horizon › order discount lowered by margin (WONE2EM60): … the exact D_max over both lines … (47.3s)
[checkout.margin] Horizon: after ?country=SK: country SK, currency EUR
  ✘   4 checkout.margin.spec.ts:897 — Horizon › slovensko (EUR): … (14.7s)
  ✘   5 … (retry #1) (14.7s)   Error: won-e2e-simple-a is for sale in the slovensko market (store setup: …)  Received: false
  ✘  11 storefront.embed.spec.ts:111 — Horizon › renders the ready marker … (430ms)   GET /products/won-e2e-simple-a → 503
  ✓  12 … (retry #1) (7.9s)
  ✓  13 storefront.embed.spec.ts:139 — Horizon › causes no horizontal overflow at 390px (1.2s)
  1 failed, 1 flaky, 5 skipped, 4 passed (4.3m)
  ✓   1 … — Dawn › cart … (33.7s)
  ✓   2 … — Dawn › checkout (Bogus) … (51.9s)
  ✓   3 … — Dawn › order discount lowered by margin (WONE2EM60) … (44.3s)
  ✘   4 … — Dawn › slovensko (EUR) … (13.5s)
  ✘   5 … (retry #1) (12.8s)   stejná kontrola dostupnosti
  ✓  11 storefront.embed.spec.ts:111 — Dawn (1.3s)
  ✓  12 storefront.embed.spec.ts:139 — Dawn (920ms)
  1 failed, 5 skipped, 5 passed (4.2m)
   ✗ Horizon
   ✗ Dawn
```

Celý výstup je v `e2e-final-A/matrix2.stdout.txt`, matice 1 v `e2e-final-A/matrix1/`. 5 přeskočených testů jsou specy `mvp1` a `shapes`, běží jen se svým profilem.

Běhy funkce pokladny se zalogovaly ve všech testech (`checkoutRunsLogged: true`). Kód se z theme dev košíku do pokladny nepřenesl, spec ho zadal v pokladně. To je známé rozdělení session.

## Kurz (F-M1)

`presentmentCurrencyRate` = `"21.85092"`:
- JSON string (Decimal), 7 platných číslic, 5 desetinných míst;
- směr USD → CZK;
- stejný ve všech bězích košíku i pokladny v obou maticích a na obou tématech.

Kontrola proti ceně Small: 328 Kč / 15 USD = 21,8667, poměr kurz/cena = 0,99928.

Včera byl kurz `"21.8802535"`, proto Small stojí 328 místo 329 Kč. Spec počítá z kurzu v logu, takže změnu přečetl sám.

EUR kurz není ověřený, SK scénář neprošel (Nálezy 1).

## Co pokladna strhla (obě témata stejně, CZK)

Floor jednoho kusu počítá spec vlastní aritmetikou:
- s nákupní cenou: `ceilTol(cost × 21,85092 × 100 / 0,75)`;
- bez nákupní ceny: `ceilTol(cena × 0,70)`.

Hlavní košík + `WONE2EM20`:

| řádek | cena | nákupní cena | floor | chtěná 50 % | produktová sleva (výstup funkce) | objednávková | po všech slevách | nad floor |
|---|---|---|---|---|---|---|---|---|
| Simple A | 219,00 | 6 USD = 131,11 | 174,81 | −109,50 | **−44,19** `fixedAmount` | 0, vyřazen | 174,81 | 0,00 |
| Simple B | 263,00 | žádná, strop 30 % | 184,10 | −131,50 | **−78,90** `fixedAmount` | 0, vyřazen | 184,10 | 0,00 |
| Spare (kontrolní řádek, ceník 199 Kč) | 199,00 | žádná, strop 30 % | 139,30 | −99,50 | **−59,70** `fixedAmount` | 0, vyřazen | 139,30 | 0,00 |
| Two Variants Small | 328,00 | 5 USD = 109,25 | 145,68 | žádné pravidlo | 0 | **−65,60** | 262,40 | 116,72 |

| zdroj | mezisoučet po produktových slevách | WONE2EM20 | doprava | celkem |
|---|---|---|---|---|
| `planCart` (kurz z logu) | 826,21 | −65,60 (20 % z 328,00) | | 760,61 |
| výstup funkce (log) | `fixedAmount` 44.19 / 78.90 / 59.70, `appliesToEachItem` | `fixedAmount` 65.60, `excludedCartLineIds` = řádky A, B a spare | | |
| `/cart.js` | 826,21, alokace `fixed_amount` | `applicable: true`, `fixed_amount` 65.6, alokováno 6560 | | 760,61 |
| děkovná stránka | 826,21 | −65,60 | 656,00 | **1 416,61 Kč** = strženo z karty |

Snížená objednávková sleva (`WONE2EM60`, Small + multiaxis S / Red):

| řádek | cena | nákupní cena | floor | h = cena − floor − 1 |
|---|---|---|---|---|
| Multi Axis S / Red | 438,00 | 8 USD = 174,81 | 233,08 | 204,91 |
| Two Variants Small | 328,00 | 5 USD = 109,25 | 145,68 | 182,31 |

- Chtěných 60 % z 766,00 = 459,60 Kč.
- `D_max = min(⌊20491 × 76600 / 43800⌋, ⌊18231 × 76600 / 32800⌋) = min(35835, 42576)` = **358,35 Kč**, rozloženo přes oba řádky.
- Plán: `{fixedTotal: 35835}`, `marginCapped {before 45960, after 35835}`, `marginExcludedLineIds []`.
- Výstup funkce: `fixedAmount 358.35`, `excludedCartLineIds []`.
- `/cart.js`: `fixed_amount` 358.35, alokováno 35835, celkem 407,65.
- Děkovná stránka: mezisoučet 766,00, WONE2EM60 −358,35, doprava 656,00, **1 063,65 Kč** = strženo z karty.

Invariant (vlastní aritmetika specu, podíl objednávkové slevy podle skutečného `excludedCartLineIds` z výstupu funkce):
- Hlavní košík: A, B i spare přesně na floor (rezerva 0). Small 262,40 ≥ 145,68. Součet 760,61 ≥ Σ floors 643,89.
- Order-cap (proporcionální dělení zaokrouhlené nahoru, jinak se nedá zjistit):
  - multiaxis 438,00 − 204,91 = 233,09 ≥ 233,08 (rezerva 1 haléř, rezerva enginu);
  - Small 328,00 − 153,45 = 174,55 ≥ 145,68;
  - součet 407,65 ≥ 378,76.

Parita: v každém testu platí zalogovaný výstup = `runCartLines` referenčního adaptéru nad zalogovaným vstupem. Pokladna hlavního košíku měla 8 běhů na téma. Plán ze zalogovaného vstupu = plán z `/cart.js` + metafieldů.

F-M2: `wonVariant`:
- `{"cost":6,"cur":"USD"}` simple-a;
- `{"cost":5,…}` Small;
- `{"cost":8,…}` multiaxis;
- `null` simple-b a spare.

`marginRefs` ve vstupu chybí (Free, bez kolekce).

## Regrese MVP 1 (marže vypnutá, Free)

| profil | test | Horizon | Dawn | strženo |
|---|---|---|---|---|
| `mvp1` | cart: automatic 10 % + WONE2E15 = planCart | ✓ | ✓ | |
| `mvp1` | checkout (Bogus) | ✓ | ✓ | 822,53 Kč (stejné jako MVP 1 final gate 29. 9.) |
| `mvp1` | one buyer session: kód z košíku přenesen do pokladny | ✓ | ✓ | |
| `shapes` Free | cart: fix/ks nad cenou → 100 %, Pro stack NEsečten (jen 10 %) | ✓ | ✓ | |
| `shapes` Free | checkout (Bogus) | ✓ | ✓ | 852,10 Kč (stejné jako 29. 9.) |
| embed | ready marker + 390 bez přetečení | ✗ (404) | ✗ (404) | |

Na Free gate složil Pro stack i s `MAX_STACK_CANDIDATES`: simple-a dostal jen „E2E Pro 10 %“ (21,90), 15 % stack (32,85) se nesečetl. Výstupy jsou v `mvp1/matrix-mvp1.stdout.txt` a `shapes/matrix-shapes.stdout.txt`.

## Nálezy (žádná produktová chyba)

1. **SK/EUR: trh slovensko nic neprodává (nastavení storu, mimo scope).**
   - Matice 1: `setStorefrontCountry` posílal `POST /localization` přes theme dev. Odpověď 401, země zůstala CZ.
     - Příčina: proxy CLI 4.8 posílá ne-GET požadavky na store se svým storefront Bearer tokenem a store formulář s ním odmítne.
     - Cookie `localization` v prohlížeči nepomůže, další odpověď ji přepíše zpět (sonda 1).
   - Oprava specu: `support/cart.ts` přepíná zemi přes `?country=<kód>` na renderu stránky. Sonda 2: session přejde na SK/EUR a zůstane v něm. Matice 2: „after ?country=SK: country SK, currency EUR“ na obou tématech.
   - Pak ale `/cart/add.js` vrátil 422 „Produkt … je již vyprodán“ pro všech 5 produktů.
   - Sonda 3: v SK mají všechny won-e2e varianty `available: false`, na theme dev i na skutečném storefrontu. V CZ jsou dostupné.
   - Sonda 4: v SK je nedostupných všech 23 produktů katalogu, i snowboardy a gift card.
   - Admin API `contextualPricing(country: SK)` ceny v EUR vrací (8,95 / 10,95 / 13,95 / 17,95 / 8,95 €). Trh tedy existuje, ale neprodává.
   - Pravděpodobně chybí SK v zóně doručení nebo trh není aktivní pro prodej. Appka nemá `read_shipping` ani `read_markets`, přes API jsem to ověřit nemohl.
   - Spec teď před košíkem hlídá dostupnost všech produktů v SK a padá s jasnou zprávou.
   - Nastavení storu jsem neměnil, je to zápis do adminu mimo scope. Evidence: `e2e-final-A/sk-probe/`.
2. **Embed: dev preview vrací 404 na `won-discounts.js` od 09:52:59Z (prostředí).**
   - V `app-dev.log` je „Building function won-discounts-engine … Failed to build function. Build error“. Pak „Extension changed / Extension changed / Updated dev preview“.
   - Build spustil paralelní engine agent (Rust v `extensions/won-discounts-engine`).
   - Od té chvíle vrací `https://cdn.shopify.com/extensions/01a0f1ba-…/dev-9265927e-…/assets/won-discounts.js` 404, na theme dev i na skutečném storefrontu. CSS padá na `ERR_BLOCKED_BY_ORB`. Embed zůstane `data-won-discounts-status="loading"`.
   - Ve storefront extension se nic nezměnilo (`git status`). V maticích 1 a 2 (do 09:06Z) prošel embed na obou tématech.
   - Opraví to restart `shopify app dev`, který controller dělá před fází B, nebo nový bundle theme extension. Nic z toho nesmím. Evidence: `e2e-final-A/embed-404/`.
3. **Offline session už existuje.**
   - `app-dev.log`: „Creating new session … isOnline: false“, pak admin requesty s offline session. Appku zřejmě někdo otevřel v adminu.
   - Důsledek: webhookové zrcadlo nákupních cen poprvé zapsalo živě. `products/update` po seedu → `[won-costs] … queued` → metafield simple-a `{"cost":6,"cur":"USD"}`. Stalo se to před plným průchodem `margin-costs.mjs` (read-back 1 z 9, `steps/costs-readback-after-seed-webhook.json`).
   - Cesta F-M3 „webhook → zápis metafieldu“ tím běží naživo. Chybí cílený test (změna nákupní ceny → webhook → nová hodnota).
4. **`app-dev.log` obsahuje tajemství.** Debug výpis `shopify-api` loguje access token a část client secretu. Log leží ve scratchpadu controlleru. Do evidence jsem z něj nic nekopíroval, necommitovat.
5. **Souběžné změny v pracovním stromu.** Během matice 2 měl engine agent upravený `packages/core/src/discounts/plan-margin.ts` (mez prohledávání objednávkové sady). Spec počítá `planCart` z pracovního stromu. Všechny CZ aserce přesto seděly s živou funkcí na haléř. Snapshot je v `steps/worktree-during-matrix2.txt`.
6. Infra: jednou 503 na PDP přes theme dev (embed Horizon, matice 2, retry ✓). Po sondách jednou 429 z Cloudflare na preflightu app proxy. Po 10 minutách pauzy prošlo.

## Úklid

- Pravidla, uzly kódů `WONE2EM20`, `WONE2EM60` a `WONE2E15` i produktové metafieldy jsou pryč. Zůstal jen uzel „Won Discounts“ (ACTIVE) a 3 cizí EXPIRED uzly, stejně jako v kroku 0.
- Variant metafieldy: 0 z 9. Nákupní ceny v katalogu (6.0, 5.0, 4× 8.0 USD) zůstaly. Zrcadlo v app DB má 0 řádků.
- `verify-clean`: `protoNodes`, `foreignProtoNodes`, `allDiscountNodes`, `products`, hodnota `function_config` i `clean` jsou stejné jako v kroku 0. `clean: false` je jen kvůli existujícímu `function_config` (389 B), známý stav.
- Záloha seedu je obnovená a přejmenovaná (`seed-mvp1-backup.restored-…json` ve scratchpadu `won-e2e-final-A/`). Fáze B si vytvoří vlastní.

Testovací objednávky (Bogus), celkem 12:
- `won-e2e+margin@example.com`: 4× 1 416,61 Kč (hlavní) a 4× 1 063,65 Kč (order-cap), matice 1 + 2;
- `won-e2e+mvp1@example.com`: 2× 822,53 Kč;
- `won-e2e+shapes@example.com`: 2× 852,10 Kč.

## Změny ve specu (scope `tests/e2e/**`)

- `tests/e2e/support/cart.ts` `setStorefrontCountry`: `?country=<kód>` místo `POST /localization`. Komentář vysvětluje proč (401 přes theme dev).
- `tests/e2e/checkout.margin.spec.ts`:
  - hlavička scénáře 4;
  - krok „every product of the cart is for sale in the slovensko market“ před košíkem (jasná zpráva místo 422 v `/cart/update.js`);
  - log „after ?country=SK“.
- `tsc --noEmit` ok, `eslint` ok. Dočasné sondy `zz-probe-*.spec.ts` jsou smazané. Jejich kód je jako `.txt` v `sk-probe/`.

## Soubory

- `e2e-final-A/`:
  - `cart-margin-*`, `checkout-margin-*`, `order-cap-margin-*` (+ `function-runs-*`) `-{horizon,dawn}.json`: matice 2;
  - `matrix1/`: matice 1;
  - `matrix2.stdout.txt`.
- `e2e-final-A/screenshots/`:
  - `thankyou-margin-{1440,390}-{horizon,dawn}.png`;
  - `thankyou-order-cap-margin-{1440,390}-{horizon,dawn}.png`;
  - embed PDP z matice 2.
  - 390 je s rozbaleným shrnutím.
- `e2e-final-A/mvp1/`, `e2e-final-A/shapes/`: JSON, screenshoty děkovné stránky 390/1440, výstupy matic.
- `e2e-final-A/steps/`: dry-run a live výstupy všech seedů, úklidů a zrcadla, SyncRun JSON, read-backy, verify-clean před a po, stav před a po.
- `e2e-final-A/sk-probe/`, `e2e-final-A/embed-404/`: sondy k nálezům 1 a 2.

## Příkazy pro ověření

SK v prohlížeči: otevři `https://b2b-b2c-store-development.myshopify.com/products/won-e2e-simple-a?country=SK`. Tlačítko přidat do košíku musí být aktivní, ne „Vyprodáno“.

Po opravě trhu SK a restartu `shopify app dev` (Free), z kořene repa:

```sh
E=$PWD/docs/won-discounts/evidence/mvp2
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin --out /tmp/won-e2e-final-A            # dry-run
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin --live --out /tmp/won-e2e-final-A
node apps/won-discounts/scripts/e2e/margin-costs.mjs --live --out /tmp/won-e2e-final-A
WON_E2E_PROFILE=margin WON_DISCOUNTS_E2E_EVIDENCE_DIR=$E/e2e-final-A WON_DISCOUNTS_E2E_SCREENSHOT_DIR=$E/e2e-final-A/screenshots \
  npm run test:e2e:local:all -w won-discounts
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live --out /tmp/won-e2e-final-A
node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear --live --out /tmp/won-e2e-final-A
WON_PROTO_OUT=/tmp/won-e2e-final-A/verify-after node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
```
