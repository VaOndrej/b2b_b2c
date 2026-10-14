# Předávka po kompakci: kombinování slev podle typů (13. 10. 2026)

Čti nejdřív: `docs/won-discounts-build-log.md` → „CHECKPOINT K4“ (co je kde, brány, čísla) a
`docs/won-discounts/navrh-kombinace-2026-10-13.md` (schválený návrh + oddíl „Upřesnění při stavbě“, 16 bodů).
Úkol v SB: `won-discounts-kombinace-typy-vyjimky`. Pracuje se inline bez subagentů, na `main`, bez prettieru.

## Stav

**14. 10.:** otázky 1–5 vyřešené (návrh, oddíl „Upřesnění při stavbě“), kroky 1–3 pushnuté (`ae8b897`), brána
instrukcí zelená (9,87 M). Hlášení ztracených dvojic v kroku 5 odpadá. Zbývají kroky 4–6.

- Kroky 1–3 ze 6 hotové v pracovním stromu, **necommitnuto**. Kroky 4–6 nezačaté.
- `origin/main` je rozbitý: commit `7c341ef` (13. 10. 10:15) vzal práci uprostřed kroku 1. Oprava = commit
  současného stromu. Commit a push jen na Ondřejův pokyn.
- Ondřejův `shopify app dev` běží (react-router dev na portu 58569, může se změnit: `lsof -iTCP -sTCP:LISTEN -P | grep node`).

## Otevřené otázky pro Ondřeje (na tyhle čekám)

1. **Commit a push** současného stavu, aby se `main` opravil? (Ano / ne / jinak.)
2. **Instrukce funkce:** tři košíky `lines-margin-pro-bridge*-200` mají 10,00–10,12 M, brána projektu 9,9 M,
   limit Shopify 11 M. Hledat dál úsporu, nebo přijmout ~92 % a bránu upravit? Bránu jsem neměnil.
3. **Upřesnění, která mění, co zákazník dostane** (čísla podle návrhu):
   - 5: sleva na objednávku vedle slev na položkách = lepší ze dvou plánů („položky napřed“ / „objednávka napřed“).
   - 6: doprava a dárek se neporovnávají; když se nesčítají s tím, co košík dostal, neplatí.
   - 7: seznam Výprodeje se týká jen slev z ceny; doprava a dárek u výprodeje platí vždy; výprodej s vlastním
     seznamem se řídí jen tím svým (globální „výprodej se vším“ už ho nepřebije).
   - 9: výchozí stav nového obchodu (slevy z ceny se mezi sebou nesčítají; doprava a Milníky ke všemu).
   - 11–13: co převod stojí (Milníky + automatická sleva na objednávku → dárek se přestane sčítat; množstevní
     + automatická na produkt + automatická na objednávku → množstevní se přestane sčítat s objednávkou; sleva
     za milník se v novém obchodě sčítá s jinou slevou na objednávku).
   - Možnost, kterou jsem NEzvolil: převod by na Pro mohl doplnit výjimky i pro dvojice, které se sčítaly přes
     přepínače (ztratilo by se míň, konfigurace by byla větší).
4. **Ceník** (z návrhu, nezávislé): nižší tarif zdarma, nebo 9 USD.
5. **Zaškrtávátka, která nic neznamenají, se neukazují** (bod 8) — návrh říkal „šest všude“.

## Co zbývá postavit (kroky 4–6)

- Krok 4: sekce „Sčítá se s“ na Množstevních slevách, Milnících, Výprodeji (`shell/CombineTypes.tsx`,
  `model/combine.ts readCombineTypes(form, "tiers" | "rewards" | "outlet")`, uložit `modules.<modul>.combine`).
  Staré věty a pole: `withOthers`, `productWithOrder`, `outletWithAnything` v
  `app/lib/integration/{outlet-admin,rewards,tiers}.server.ts`, věta `tiersActive` v editoru.
- Krok 5: neshody (`@won/core/discounts/combine-config combineMismatches`) v Kontrole kombinací, červená tečka
  u sekce a u slevy v seznamu, tlačítka „Povolit i u druhé strany“ / „Zakázat i tady“; jednorázové hlášení
  ztracených dvojic po převodu (`migrateCombineV1(stored).lost`; čtení configu: `app/lib/config.server.ts`).
- Krok 6: živé E2E Horizon + Dawn, Free + Pro (`tests/e2e/checkout.shapes.spec.ts` už čte `engine.cx`).

## Brány (poslední běh)

```
cd packages/core && npm test                                   # 1 007 z 1 007
cd apps/won-discounts/extensions/won-discounts-engine
PATH="$HOME/.cargo/bin:$PATH" cargo test --quiet               # 107 z 107
PATH="$HOME/.cargo/bin:$PATH" npx vitest run                   # 720 z 720
cd ../.. && npm run test:unit:node                             # 1 903 z 1 906 (3 = brána instrukcí)
npm run lint && npm run typecheck && npm run build             # 0 chyb
WON_PREVIEW_BASE_URL=http://localhost:58569 npm run test:e2e:preview   # 40 z 40
```

Po změně payloadu nebo scénářů: `npm run fixtures` ve složce funkce, po změně textů nápovědy `npm run docs:gen`.

## Na co nezapomenout

- `packages/core/tests/discounts/fixtures/combine-before.json` + `combine-migration-cases.ts` NEMĚNIT (starý engine už není).
- Payload: všechny seznamy v jednom textu `engine.cx` (čtení klíče stojí ~1 000 instrukcí); Rust čte `c`/`x` na
  pravidle a `engine.mc` jen pod `#[cfg(test)]`. Wasm 252 842 B z 256 000 B: hlídat po každé změně v Rustu.
- Měření instrukcí po částech konfigurace: `tests/budget-families/measure-variants.mjs` ve složce funkce.
- Staré scénáře funkce a náhodné payloady dostávají seznamy přes `tests/legacy-lists.js`; staré fixtury jádra
  přes `tests/discounts/engine-fixtures.ts configOf` (čte je jako uložený obchod schématu 1).
- Paměť SB: zapsána dvě poučení (čtení klíčů ve funkci, velikost Wasm).
