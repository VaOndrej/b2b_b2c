# Won Discounts — pravidla vzhledu z 6. kola (10. 10. 2026)

Z devíti bodů zpětné vazby je sedm pravidel. Každé má jednu sdílenou součástku, takže platí všude, kde se použije.

| # | Pravidlo | Součástka | Kde platí teď | Kde ještě ne |
|---|---|---|---|---|
| 1 | Vybraná dlaždice se pozná rámečkem a ikonou. Žádná šipka. | `shell/ModuleTile.tsx` | všechny stránky s dlaždicemi | — |
| 2 | Dlaždice je širší než vyšší. Pět v řadě má text pod ikonou přes celou šířku a krátkou větu. | `ModuleTile.tsx` (`columns={5}`), `marginTileSummary` | Ochrana marže | jiná stránka pět dlaždic nemá |
| 3 | Část, která jen něco ukazuje, má štítek „Jen přehled“, větu „tady nic nezapínáte“ a žádné Uložit pod sebou. | `ViewTile note`, `shell/InfoStrip.tsx` | Marže: Nákupní ceny, Snížené slevy | Přehledy, Vyzkoušet košík (výsledek) |
| 4 | Víc věcí v jedné sekci = víc karet s vlastní hlavičkou a tlačítkem. Žádné rozbalovací řádky pro hlavní akce. | `shell/SubCard.tsx` | běžící výprodej, pravidla výprodeje, Časté kombinace | Skončené kampaně, seznam slev |
| 5 | Kroky formuláře jsou samostatné karty na stránce: číslo, „Krok 1 / 4“, šedá hlavička, bílé tělo. | `shell/StepCard.tsx` | Nový výprodej, Nová kampaň | editor slevy (má boční menu, kroky nemá) |
| 6 | Volba „buď, nebo“ jsou dvě karty na kliknutí. Co platí a co ne, ukazují značky ✓ / ✕. | `choiceCardStyle`, `YesNo` v `SubCard.tsx` | kombinace u výprodeje | kombinace u slevy v editoru |
| 7 | Upozornění říká „Co se stalo“, „Co s tím“ a má tlačítko, které tam vede. Hlavní akce je tlačítko, ne odkaz v textu. | `try-cart/CombinationsSection.tsx` (`TODO`) | Časté kombinace | výsledek košíku, Přehled (řádky „k vyřešení“) |
| 8 | Dlouhá stránka má boční menu s kotvami. | `shell/SectionNav.tsx` | Nastavení, Překlady, editor slevy, Vyzkoušet košík | — |
| 9 | Blok, který v šabloně už je, se otevírá vybraný a nic se nepřidává. | `editorOpenUrl(url, spot)` | výprodej, milníky, kampaně, množstevní tabulka | košíkový blok (polohu nečteme) |
| 10 | Na co jde kliknout, reaguje na myš. Vybraný prvek nereaguje. (7. kolo) | `shell/hover.tsx` (`hoverMark`) | lišta, dlaždice, karty volby, vzhledy, segmenty, sbalovací hlavičky | — |

## Co není jen vzhled

- **Které slevy výprodej bere** (množstevní / slevy a kódy na produkty / sleva z objednávky) je změna pokladní funkce.
  Příznak varianty je `true` (žádná sleva), číslo 1–6 (součet povolených: 1, 2, 4), nebo chybí (všechny).
  Jádro: `packages/core/src/discounts/cart.ts` (`OUTLET_ALLOW`), `plan.ts`, `plan-tiers.ts`, `plan-margin.ts`.
  Rust: `engine/plan.rs`, `engine/cart.rs`, `input.rs`. Web: `quantity_tiers.liquid`, `won-card-tier.liquid`.
- **Výběr bloku v editoru** stojí na parametrech `section` a `block`, které si editor píše do adresy sám.
  Shopify je nedokumentuje. Když je editor nezná, otevře šablonu jako dřív.

## Neověřeno naživo

Výběr bloku v editoru, pokladna s výprodejem „jen množstevní sleva“, tabulka množstevních slev u takového produktu.
