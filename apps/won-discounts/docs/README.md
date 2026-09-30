# Won Discounts — support knowledge base

Zdroj pravdy pro **support chatbota** (RAG) a lidský support. Píše se **průběžně po
každém MVP**, obsah je rozvrstvený podle _stability_, volatilní věci se **generují
z kódu** a drift hlídá test. Kanonický princip: [`docs/nova-aplikace.md` §9](../../../docs/nova-aplikace.md).
Vzor: [`apps/won-toasts/docs/`](../../won-toasts/docs/).

Stav: pokrývá **MVP 0–2** (Slevy a kódy, engine a kombinování, přesun nativních slev
s undo, Vyzkoušet košík, Ochrana marže). Moduly MVP 3+ (množstevní slevy, odměny,
výprodej, kampaně, vzhled) tu záměrně nejsou; dokumenty k nim přibydou po ustálení
MVP, do té doby je zmiňují jen jako „not built yet“.

## Vrstvy

| Složka | Co tam je | Kdo to píše |
|---|---|---|
| [`concepts/`](concepts/) | Jak engine plánuje slevy, kombinování (A1 + Pro per sleva), kódy vs. automatické, sync se Shopify, slevy mimo Won a přesun, ochrana marže, nákupní ceny, marže per kolekce (Pro), trhy a měny, Free vs Pro. | Ručně |
| [`tasks/`](tasks/) | Automatická sleva, kód, přesun nativních slev, undo přesunu, zapnutí ochrany marže, Vyzkoušet košík. | Ručně |
| [`support/`](support/) | Sleva v pokladně jiná, kód se neuplatnil, sleva snížená marží, produkty bez nákupní ceny, sleva mimo Won, sleva se v měně nenabízí. | Ručně |
| [`reference/`](reference/) | Free vs Pro, limity, výchozí kombinování, nastavení marže, volby slevy + recepty, stavy slev. | **Generováno** (`*.generated.md`), needitovat |

Jazyk: angličtina (jako won-toasts). Klíčové pojmy adminu jsou v `keywords` i česky
a reference uvádí české popisky adminu vedle anglických.

## Frontmatter

Stejný jako won-toasts: `title`, `slug` (== název souboru), `layer`, `feature`,
`min_plan`, `status`, `app_version`, `source`, `generated_from`, `lang`, `updated`,
`keywords`, `summary`. `title` a `summary` bez „: “ (validní YAML).

`feature` v téhle appce: `core` · `engine` · `discounts` · `native-discounts` ·
`margin` · `markets` · `plans` · `try-cart` · `sync`.

`min_plan: pro` mají jen Pro featury (kombinace per sleva, marže per kolekce).

## Generovaná reference

```bash
npm run docs:gen -w won-discounts     # přepíše reference/*.generated.md z kódu
```

`scripts/gen-docs.ts` (`buildDocs()`, čistá funkce) čte `@won/core/discounts`
(enumy, `CONFIG_LIMITS`, `DEFAULT_CONFIG`, `PRO_CAPABILITIES` + skutečný Free gate
`gateConfigForPlan`, `MAX_STACK_CANDIDATES`, výpočet podlahy marže), limit aktivních
kódových slev z `app/lib/config-guards.server.ts`, seznam modulů
(`app/components/model/modules.ts`), recepty a texty adminu (`app/i18n`).

## Drift guard

`tests/docs-freshness.test.ts` (součást `npm run test:unit -w won-discounts`):
regeneruje referenci v paměti a porovná s commitnutými soubory, a u všech dokumentů
hlídá povinný frontmatter (`min_plan`, `status` …), `slug` == název souboru, složku
podle vrstvy, unikátní slugy a mrtvé odkazy.

Není tu (oproti won-toasts): `index.generated.md` a export `dist/corpus.jsonl`.

## Přidání dokumentu

1. Vrstva podle otázky: „jak/proč“ → `concepts/`, „jak nastavím“ → `tasks/`,
   troubleshooting → `support/`. Reference se ručně nepíše.
2. Frontmatter zkopíruj z existujícího dokumentu, `min_plan` + `status` +
   `app_version` pravdivě. Rozpracovaná featura = `status: planned` nebo `beta`.
3. Jeden dokument = jedno téma. Odkazy: slug ve stejné složce, jinak relativní cesta
   s `.md`.
4. `npm run docs:gen -w won-discounts` a `npm run test:unit -w won-discounts`.
