# Task 7 report: prototypy C1–C4 (platformní rizika)

Stav: **hotovo**. Všechny 4 prototypy proběhly `--live` na `b2b-b2c-store-development.myshopify.com`, každý uklidil po sobě a finální kontrola ukazuje 0 uzlů `WON-PROTO`. Funkce `won-discounts-engine` se neměnila (dev preview = aktuální `dist/function.wasm`, sha1 `fb5331a2…` sedí).

## Verdikty

| # | Verdikt | Jednou větou | Důkaz |
|---|---|---|---|
| C1 | **platí** (s výhradou k řádku) | Automatický i kódový uzel dostávají v `enteredDiscountCodes` všechny zadané Won kódy. Automatický uzel dal 10 % při 1 kódu a 20 % při 2 kódech. | `…/scratchpad/prototypes/c1-entered-codes.json` |
| C2 | **fallback** | Jeden uzel s více kódy funguje a `triggeringDiscountCode` pozná použitý kód. V košíku se ale uplatní **jen 1 kód na uzel**. Kombinovat jde jen kódy z různých uzlů a jen na různých řádcích. | `…/scratchpad/prototypes/c2-multi-code-node.json` |
| C3 | **platí** | 9 000 B configu projde (11 %), 10 100 B ne (0 %). Hranice je přesně 10 000 B / 10 001 B. Per-produkt metafield funkce čte (7 %). | `…/scratchpad/prototypes/c3-config-size.json` |
| C4 | **platí** | `shop.localTime.dateTimeBetween` s proměnnými z `function_config` funguje v čase obchodu: 10 % / 0 % / 3 %. Bez klíčů `campaignStart/End` funkce spadne na `InvalidVariableValueError` a default z dotazu se nepoužije. | `…/scratchpad/prototypes/c4-campaign-window.json` |

`…/scratchpad` = `/private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad`. Surové function run logy jsou zkopírované v `…/scratchpad/prototypes/function-logs/<experiment>/`. Scratchpad je dočasný, podstatné výňatky jsou proto níže.

Společné podmínky:
- 1× `won-e2e-simple-a` (218,00 Kč v košíku, trh CZ), každé čtení = čerstvý košík.
- Stav se bere až po **2 po sobě jdoucích čteních**, která sedí.
- Každý stav má jiné procento, takže zastaralé čtení nemůže projít jako nový stav.
- Změna metafieldu se projevila hned při prvním čtení (2–4 s po `metafieldsSet`). Nový uzel byl aktivní hned při prvním čtení.

---

## C1: vidí automatický i kódový uzel zadané Won kódy?

Setup:
- automatický uzel s `echo_codes` + `echoOnAutomatic` (10 % za každý viděný kód);
- kódové uzly WONPROTO1 a WONPROTO2 s `echo_codes` (1 % na první řádek);
- nativní basic kód `WONPROTONATIVE` (5 %) jako „cizí“ kód.

| čtení | zadané kódy | automatická alokace | `discount_codes` |
|---|---|---|---|
| a | WONPROTO1 | **10 %** (`WON:AUTO\|WONPROTO1`) | WONPROTO1: applicable=false |
| b | WONPROTO1, WONPROTO2 | **20 %** (`WON:AUTO\|WONPROTO1,WONPROTO2`) | oba applicable=false |
| c | žádné | 0 % | – |
| d | WONPROTO1, WONPROTO2, NOTAWONCODE7 (neexistuje) | 20 % | všechny applicable=false |
| e | WONPROTO1, WONPROTONATIVE (nativní) | **20 %** (`WON:AUTO\|WONPROTO1,WONPROTONATIVE`) + nativní 5 % jako objednávková sleva | WONPROTONATIVE: applicable=true |

Košík b (`/cart.js`, výňatek):
```json
{"total_discount":4360,"discount_codes":[{"code":"WONPROTO1","applicable":false},{"code":"WONPROTO2","applicable":false}],
 "line_level_discount_allocations":[[{"amount":4360,"discount_application":{"title":"WON:AUTO|WONPROTO1,WONPROTO2","type":"automatic","value":"20.0","value_type":"percentage"}}]]}
```

Function run logy během b (11:41:33–41 UTC, `function-logs/c1-entered-codes/`):
```
AUTO  trig=null       entered=[WONPROTO1 rejectable:true, WONPROTO2 rejectable:true]   out WON:AUTO|WONPROTO1,WONPROTO2 @20 %
CODE  trig=WONPROTO1  entered=[WONPROTO1 rejectable:false, WONPROTO2 rejectable:false] out WON:WONPROTO1|WONPROTO1,WONPROTO2 @1 %
CODE  trig=WONPROTO2  entered=[WONPROTO1 rejectable:false, WONPROTO2 rejectable:false] out WON:WONPROTO2|WONPROTO1,WONPROTO2 @1 %
```
(soubory `20260928_114141_305Z_…_51768d.json`, `…_308Z_…_3795f5.json`, `…_310Z_…_881f43.json`)

Zjištění:
- **Automatický uzel vidí Won kódy.** Odpovídá to 10 % za kód (a: 10, b: 20, c: 0).
- **Každý kódový uzel vidí oba kódy.** `triggeringDiscountCode` je vždy jeho vlastní kód.
- `enteredDiscountCodes` obsahuje **existující** kódy, Won i nativní (e: 20 %). Neexistující kód (d) ve vstupu **není**. Engine tedy musí odlišit Won kódy od cizích podle vlastního configu. Předpoklad spec §3 „validní zadané kódy (Won i cizí)“ platí.
- `rejectable` se liší: automatický uzel dostává `true`, kódový `false`. Engine na tom nesmí stavět plán, jinak se plány uzlů rozejdou.
- **Výhrada: v košíku se uplatní jen 1 produktová sleva na řádek.** V b vyhrál automatický uzel s 20 % a oba kódy mají `applicable:false`, přestože jejich uzly 1 % vydaly (log výše).
  - Dokumentace ([ProductDiscountsWithTagsOnSameCartLineInput](https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/ProductDiscountsWithTagsOnSameCartLineInput)): „By default, only one product discount applies per line. Available only on a Shopify Plus plan.“
  - Že 1 % samo o sobě funguje, ukazuje C2 a: stejný kódový uzel bez konkurence → `applicable:true`, 1 %.
- Titulky v `/cart.js`:
  - kódová sleva ukazuje **kód** (`WONPROTO1`);
  - automatická ukazuje **message** funkce (`WON:AUTO|…`).

Dopad na §3 „Emise per uzel“:
- „Jeden mozek, víc rukou“ platí: všechny uzly dostanou stejné kódy i košík, takže deterministický engine spočítá stejný plán.
- Součet emisí = plán jen tehdy, když na každý řádek emituje produktovou alokaci **nejvýš jeden Won uzel**. Jinak Shopify vybere jednu alokaci sám. Pravidlo „výhodnější vyhrává“ je stejné, ale kódy ztratí `applicable`.
- Pro-funkce „per-sleva `combinesWith` smí povolit součet“ na stejném řádku jde mimo Plus jen tak, že **jeden** uzel emituje už sečtenou hodnotu.
- Kód, jehož uzel nic neemituje, zobrazí Shopify jako „not applicable“. Třeba když výhodu kódu dává automatický uzel nebo vyhrála jiná sleva na řádku. Storefront to musí vysvětlit (§4c).

---

## C2: jeden kódový uzel s víc kódy vs. víc uzlů

Část 1, jeden uzel `echo_codes`:
- kód WONPROTO1 + `discountRedeemCodeBulkAdd` WONPROTO2 (`importedCount 1`, `failedCount 0`);
- uzel pak má `codesCount 2`.

| čtení | kódy | výsledek | logy |
|---|---|---|---|
| a | WONPROTO1 | applicable, 1 % | `trig=WONPROTO1` |
| b | WONPROTO2 (bulk) | applicable, 1 % | `trig=WONPROTO2` |
| c | WONPROTO1 + WONPROTO2 | WONPROTO1 **false**, WONPROTO2 true, 1 % | uzel běží **jednou** na čtení, vždy `trig=WONPROTO2`, entered = oba |

Košík c: `{"discount_codes":[{"code":"WONPROTO1","applicable":false},{"code":"WONPROTO2","applicable":true}],"lines":[[{"amount":218,"title":"WONPROTO2","type":"discount_code"}]]}`.
Logy: `20260928_115246_106Z_…_3f97c1.json`, `20260928_115254_316Z_…_202242.json`. WONPROTO1 jako triggering se neobjevil ani v 1. běhu (`c2-multi-code-node.run1.json`).

Část 2, dva uzly (WONPROTO1, WONPROTO2), oba cílí první řádek:
- e: oba uzly běží (`trig=WONPROTO1` a `trig=WONPROTO2`, každý vidí oba kódy) a oba vydají 1 %;
- uplatní se jen WONPROTO1, WONPROTO2 má `applicable:false`. Je to pravidlo 1 produktové slevy na řádek.
- Logy: `…115340_882Z_…_791373.json`, `…115349_078Z_…_1a1058.json`, `…115349_082Z_…_816c79.json`.

Část 3, dva uzly na **různých** řádcích:
- uzel 2 přepnutý na `product_metafield`;
- `won-e2e-simple-b` dostal metafield `{percent:5}`;
- košík = simple-a (lines[0]) + simple-b.

```json
{"discount_codes":[{"code":"WONPROTO1","applicable":true},{"code":"WONPROTO2","applicable":true}],
 "lines":[[{"amount":218,"title":"WONPROTO1","type":"discount_code","value":"1.0"}],[{"amount":1310,"title":"WONPROTO2","type":"discount_code","value":"5.0"}]]}
```
Logy: `WONPROTO1 → CartLine/0 (simple-a) 1 %` a `WONPROTO2 → CartLine/1 (simple-b) 5 %` (`…115423_565Z_…_458672.json`, `…115423_568Z_…`).

Zjištění:
- Víc redeem kódů na jednom uzlu jde a `triggeringDiscountCode` pozná, který kód je použitý.
- Z jednoho uzlu se ale v košíku uplatní **max. 1 kód**. Shopify pustí funkci uzlu jen s jedním z nich.
- Víc Won kódů současně jde jen **z různých uzlů**, a to jen když necílí stejný řádek.
- Pořadí řádků ve vstupu funkce = pořadí `/cart.js` = **nejnovější první**. V 1. běhu C2 přidání [a, b] dalo lines[0] = b.

Proč „fallback“:
- Primární cesta předpokládala jeden kódový uzel pro všechny Won kódy. S ní se dva Won kódy nikdy nesečtou.
- Schválený fallback „Limit počtu kódů v adminu, poctivě vysvětlený“ tedy platí pro kódy na sdíleném uzlu (1 kód / košík).
- Pokud má Pro umět kombinovat kódy, důkaz ukazuje alternativu: **uzel na kombinovatelný kód/pravidlo**. Stále platí limit 1 produktové slevy na řádek.
- Rozhodnutí je na controllerovi.

---

## C3: velikost configu a per-produkt metafield

Jeden automatický uzel `percent_all`, `function_config` se přepisoval přes `metafieldsSet`. Výplň je top-level `_pad` a klíče `campaignStart/End` jsou vždy přítomné. Uložená velikost byla zpětně přečtená z `discountNode.metafield.value`.

| odesláno = uloženo | procento | košík | run log |
|---|---|---|---|
| 9 000 B | 11 | **11 %** (2398/21800) | success, `jsonValue` 9 000 B |
| 10 100 B | 13 | **0 %** | **failure** `InvalidVariableValueError` |
| 10 000 B | 12 | **12 %** | success, 10 000 B |
| 10 001 B | 14 | **0 %** | **failure** `InvalidVariableValueError` |
| `product_metafield` + `won-e2e-simple-a` `{percent:7}` | 7 | **7 %** (1526/21800) | success, `wonProduct {"percent":7}` |

Log nad limitem (`function-logs/c3-config-size/20260928_115731_786Z_…_10012d.json`):
```json
"input": null, "inputQueryVariablesMetafieldValue": null, "errorType": "InvalidVariableValueError",
"errorMessage": [{"message": "Variable $campaignStart of type DateTimeWithoutTimezone! was provided invalid value",
  "extensions": {"code": "INVALID_VARIABLE", "value": null, "problems": [{"explanation": "Expected value to not be null"}]}}, …$campaignEnd…]
```
`shopify app dev`: `❌ Function export "cart-lines-discounts-generate-run" failed to execute with error: InvalidVariableValueError`.

Zjištění:
- Limit je **≤ 10 000 B včetně** (docs: „don't return metafield values larger than 10,000 bytes“).
- Nad limitem config nedostane funkce jako `null`, ale **celá funkce spadne**. `function_config` je zároveň zdroj proměnných, ty přijdou `null` a proměnné `!` selžou. Checkout se neblokuje, sleva jen zmizí a v logu je error.
- Rozpočet `FUNCTION_CONFIG_BUDGET_BYTES = 9000` (`packages/core/src/discounts/function-config.ts`) má ~10 % rezervu a je správně.
- Per-produkt data v metafieldu `$app:won_discounts.product` funkce čte.
- Kolik pravidel se vejde do 9 000 B, prototyp neměří. Záleží na kódování pravidla, které v `encodeFunctionConfig` zatím není. Počet = (9 000 − základ) / bajty na pravidlo, změřit, až bude schéma pravidel. Tvrdý strop musí hlídat `fits` v adminu.

---

## C4: okno kampaně přes `shop.localTime` + proměnné

Automatický uzel s `campaign_window` + `debugCampaign`. Časová zóna obchodu je `America/New_York` (−04:00). Okna jsou psaná v čase obchodu. UTC je posunuté o 4 h, takže okno ±1 h je „active“, jen pokud ho Shopify čte v čase obchodu.

| stav | `campaignStart` → `campaignEnd` (NY, teď ≈ 08:01–08:03) | košík | `localTime` z logu |
|---|---|---|---|
| a | 07:01:21 → 09:01:21 | **10 %** `WON:CAMPAIGN\|2026-09-28\|active` | active=true, started=true |
| b | 09:01:50 → 10:01:50 | **0 %** | active=false, started=false |
| c | 07:02:12 → 07:32:12 | **3 %** `…\|started` | active=false, started=true |
| a2 | 07:02:35 → 09:02:35 | **10 %** (kontrola před d) | active=true |
| d | config **bez** `campaignStart/End` | **0 %** | **failure** `InvalidVariableValueError` (`$campaignStart`/`$campaignEnd` … „Expected value to not be null“), variables = jen `prototype` |
| e | `function_config` smazaný (`metafieldsDelete`) | **0 %** | **failure** `InvalidVariableValueError`, variables = null |

Logy:
- d: `function-logs/c4-campaign-window/20260928_120303_932Z_…_7e8621.json`, `…120312_108Z_…_a542d0.json`;
- a: `…120133_591Z_…_1a855a.json`.

Zjištění:
- `dateTimeBetween` / `dateTimeAfter` s proměnnými z metafieldu fungují a čas se bere v zóně obchodu.
- **Defaulty z dotazu (`= "1970-01-01T00:00:00"`) se nepoužijí.** Chybějící klíč, chybějící metafield i metafield nad 10 000 B (C3) = `null` → selhání funkce ve **všech** módech.
- Kontrakt z Task 3 je povinný: každý uzel musí mít `function_config` s oběma klíči od vzniku. Metafield proto patří do `discountAutomaticAppCreate`/`discountCodeAppCreate`, jak to dělají prototypy, ne až do dalšího kroku.

---

## Úklid

- Každý skript maže ve `finally` všechno, co vytvořil, a pak ověří, že nezbyl žádný uzel `WON-PROTO`. Všechny běhy: `cleanup.ok = true`, `remainingProtoNodes = []`, `leftoversAtStart = []`.
- Produktové metafieldy (simple-a v C3, simple-b v C2) před během neexistovaly a skripty je smazaly (`deletedMetafields … app--428983222273--won_discounts/product`).
- Metafieldy uzlů zmizely se smazáním uzlů.
- Finální read-only kontrola `verify-clean.mjs --live` (`…/scratchpad/prototypes/cleanup-final.json`, 12:04:48 UTC):
```json
{"protoNodes": [], "products": [{"handle":"won-e2e-simple-a","wonProductMetafield":null},{"handle":"won-e2e-simple-b","wonProductMetafield":null}], "clean": true,
 "allDiscountNodes": [{"title":"Test_Code_discount","status":"EXPIRED"},{"title":"Dárek zdarma","status":"EXPIRED"},{"title":"Free gift","status":"EXPIRED"}]}
```
- Původní 3 slevy obchodu zůstaly beze změny (všechny `EXPIRED`, stejné ID jako před během).

## Skripty

`apps/won-discounts/scripts/prototypes/`:
- `lib.mjs`:
  - GraphQL dokumenty validované přes Shopify dev MCP (admin 2026-04, všechny SUCCESS), `shopify app execute` wrapper, dry-run výstup;
  - úklid (`finally` + SIGINT/SIGTERM), sweep leftoverů;
  - Playwright storefront (password unlock, tempo ≥ 1,5 s mezi requesty, backoff na 429);
  - čtení run logů z `.shopify/logs` a jejich přiřazení k čtení podle časového okna.
- `c1-entered-codes.mjs`, `c2-multi-code-node.mjs`, `c3-config-size.mjs`, `c4-campaign-window.mjs`, `verify-clean.mjs`.
- `npm run lint -w won-discounts` prochází.

Použité mutace a dotazy:
- `shopifyFunctions`, `discountNodes`, `discountAutomaticAppCreate`, `discountCodeAppCreate` (`functionHandle`, `context: {all: ALL}`), `discountCodeBasicCreate` (jen C1 e);
- `discountRedeemCodeBulkAdd` + `discountRedeemCodeBulkCreation`, `metafieldsSet`, `metafieldsDelete`, `discountAutomaticDelete`, `discountCodeDelete`, `discountNode`, `productByIdentifier`.
- `functionId` je v 2026-04 deprecated, proto `functionHandle`.

Reprodukce (z rootu repa):
```sh
node apps/won-discounts/scripts/prototypes/c1-entered-codes.mjs    # dry-run: plán + GraphQL
SP=/private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad
WON_PROTO_OUT=$SP/prototypes WON_PROTO_APP_DEV_LOG=$SP/app-dev.log \
  node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/prototypes/c1-entered-codes.mjs --live
WON_PROTO_OUT=$SP/prototypes node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
```
Run logy vyžadují běžící `shopify app dev`, který je zapisuje do `apps/won-discounts/.shopify/logs`.

## Rizika a otevřené body

1. **Storefront rate limit / Cloudflare challenge.**
   - Po dvou bězích C1 těsně po sobě (4–6 requestů na každé čtení košíku) začal storefront vracet `429` s `cf-mitigated: challenge` („Verifying your connection…“).
   - Blok trval cca 10 min (11:23–11:33 UTC). Týká se i password unlocku.
   - Oprava: 2 requesty na čtení (`clear.js` + atomický `update.js {updates, discount}`) a tempo 1,5 s. Poté 0× 429.
   - Stejné riziko mají e2e suity, které hodně pracují s košíkem.
2. **1 produktová sleva na řádek (mimo Plus)** ovlivňuje §3 i Pro „kombinace per sleva“, viz C1 dopad.
3. Kolik Won kódů Shopify pustí do jednoho košíku celkem (limit kódů na košík), jsem netestoval. Otestoval jsem 2 kódy z 2 uzlů.
4. Když jsou na jednom uzlu zadané oba kódy, Shopify vybral vždy **později zadaný** (WONPROTO2, 2 běhy). Jestli je to pravidlo, nevím.
5. Scratchpad s důkazy je dočasný. Pokud mají důkazy zůstat, je potřeba výňatky přenést do build logu („Verdikty rizik“) a upravit spec §11 podle verdiktů. Obojí je práce controlleru, na ty soubory jsem nesahal.
6. Objednávkové a dopravní emise uzlů prototyp netestuje, funkce emituje jen produktové. Nativní 5% objednávkový kód se s Won produktovou slevou sečetl (C1 e).
