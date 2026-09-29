# F-M1 a F-M2: kurz a nákupní cena ve vstupu funkce (2026-09-29)

Ověřeno živě na dev storu `b2b-b2c-store-development.myshopify.com` během T5b fáze A.
- Plán Free, marže zapnutá.
- Trh cesko (CZK), měna obchodu USD.
- Zdroj: 127 běhů funkce, které `shopify app dev` zapsal do `apps/won-discounts/.shopify/logs/` mezi 16:11:51Z a 16:35:36Z.
- Z toho 113 běhů cíle `cart.lines…` a 14 běhů cíle `cart.delivery-options…`, všechny se stavem `success`.
- Výtah je v `f-m1-f-m2-function-input.json`. Běhy jednotlivých testů jsou v `e2e-phaseA/function-runs-*.json`.

## F-M1: `presentmentCurrencyRate`

- Hodnota ve všech 127 bězích, v obou cílech: `"21.8802535"`.
- Typ: JSON string (GraphQL `Decimal`), ne číslo.
- Délka: 9 platných číslic, 7 desetinných míst. Čtečka funkce (`decimalNumber`, Rust `DecimalNumber`) bere až 15 platných číslic, rezerva stačí.
- Směr: měna obchodu → měna košíku, 1 USD = 21,8802535 Kč. Nákupní cenu v USD funkce tímto kurzem násobí.
- Srovnání s cenami v košíku (CZK cena = USD × kurz, zaokrouhleno nahoru na celé Kč):

| produkt | USD | USD × kurz | cena v košíku | Kč/USD z ceny |
|---|---|---|---|---|
| won-e2e-simple-a | 10,00 | 218,80 | 219,00 Kč | 21,900 |
| won-e2e-simple-b | 12,00 | 262,56 | 263,00 Kč | 21,917 |
| won-e2e-two-variants Small | 15,00 | 328,20 | 329,00 Kč | 21,933 |

- Kurz / poměr cen u simple-a = 0,99910. Poměr z cen je o zaokrouhlení vyšší, proto plán a funkce berou kurz, ne poměr cen.
- Kurz se mezi košíkem (theme dev) a pokladnou nezměnil.

## F-M2: `wonVariant` ve vstupu funkce

Po živém běhu zrcadla nákupních cen (`margin-costs.mjs --live`) nese vstup funkce u každého řádku `merchandise.wonVariant`:

| varianta | `wonVariant` ve vstupu |
|---|---|
| won-e2e-simple-a (48468678902001) | `{"jsonValue": {"cost": 6, "cur": "USD"}}` |
| won-e2e-two-variants Small (48468678967537) | `{"jsonValue": {"cost": 5, "cur": "USD"}}` |
| won-e2e-simple-b (48468678934769) | `null` (nemá nákupní cenu, zrcadlo metafield nepsalo) |

- `cost` přichází jako JSON číslo, `cur` jako řetězec. Stejné je to ve všech 127 bězích a v obou cílech.
- Hodnoty se rovnají metafieldům přečteným přes Admin API jménem appky (spec to kontroluje v každém běhu).

## Parita

Každý zalogovaný běh jsem přepočítal referenčním adaptérem (`extensions/won-discounts-engine/tests/reference-adapter.js`) ze zalogovaného vstupu.
- Výsledek: `runCartLines` / `runDelivery` = zalogovaný výstup ve 127 ze 127 běhů (113 cílů lines, 14 cílů delivery).
- Spec to navíc kontroluje u běhů svého košíku a své pokladny.

## Neověřeno

- Kurz v košíku v měně obchodu (USD). Očekávám `"1.0"` nebo podobnou hodnotu, ale engine ji v tom případě stejně ignoruje.
- Jiné trhy (slovensko EUR).
- Vývoj kurzu v čase. Celý den byla hodnota stejná. MVP 1 ale 28. 9. vidělo simple-a za 218 Kč a simple-b za 262 Kč, kurz se tedy mezi dny mění.
