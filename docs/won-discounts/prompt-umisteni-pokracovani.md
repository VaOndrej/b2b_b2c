Pokračuj ve stavbě „Won Discounts: umístění prvků na web“. Balíky A a B jsou hotové v kódu, teď balík E.

## Kde a jak

- Pracuj ve worktree `/Users/ondrej/Development/WonCommerce/b2b_b2c-umisteni`, větev `won-discounts-umisteni`.
  Na `main` v `Apps/b2b_b2c` pracuje jiná AI: nesahej tam, nepřepínej tam větev a nic tam necommituj. Do `main` se
  větev sloučí až po dokončení.
- Pracuj inline, bez subagentů.
- Dev obchod teď používá druhá AI na živé testy. Rozšíření nenasazuj (`shopify app dev` / `deploy`) a do obchodu
  nezapisuj, dokud ti to Ondřej nepovolí.
- Commituj do větve, nepushuj bez dotazu. Prettier nespouštěj (repo nemá config).

## Přečti nejdřív

1. Zadání: `/Users/ondrej/Development/WonCommerce/Apps/docs/won-discounts-umisteni-na-web-zadani.md` (balík E,
   oddíl „Výsledek ověření 14. 10.“ a rozhodnutí o variantě (a)).
2. Důvody a návrh UX: `/Users/ondrej/Development/WonCommerce/Apps/docs/won-discounts-integrace-do-tematu.md`,
   oddíly 9 až 11.
3. Build log větve: `docs/won-discounts/umisteni-build-log.md`, checkpointy U1 až U3. Další checkpointy zapisuj tam
   (U4, …), průběžně, ne až na konci.
4. `apps/won-discounts/app/components/model/theme-tags.ts` (popis značek, jediný zdroj),
   `extensions/won-discounts-storefront/README.md` oddíl „Tags in the theme“.

## Rozhodnuto

- Ruční cesta se značkou je volitelná (varianta (a)), výchozí je vždy blok. App Store 5.1.1 je známé riziko.
- Odkaz do editoru neumí cílit dovnitř karty: u karty návod, ne deep link (hotovo v A).

## Co je hotové a co z toho plyne pro E

- Konfigurace pro web má pole `tg` (`packages/core/src/discounts/storefront-config.ts`, `themeTagsPart`,
  `StorefrontConfigOptions.themeTags`). **Nikdo ho zatím neplní**, proto značky milníků, kampaně a karty na webu
  zůstávají prázdné. Funguje jen značka `cart`. Plnit ho má E.

## Balík E (podle zadání)

1. Čtení vzhledu (`app/lib/integration/themes.server.ts`): schémata sekcí, tedy kam blok jde (`@app`). Dál soubory
   Liquidu, tedy kde je značka `<won-discounts show=… size=…>`, živý vzhled i kopie. Výsledek předat do sync jako
   `themeTags`, aby se `tg` zapsal. Ověř, že `theme(id).files(filenames:)` stačí a co stojí číst všechny soubory.
2. Řádek místa (`components/StorefrontPlacements.tsx`): tlačítko podle toho, co vzhled dovolí, tedy „Přidat na
   web“, nebo „Připravit zadání pro AI“ (název zatím návrh). U míst, kam blok jde, je ruční cesta jen pod odkazem
   „Chci to jinde“.
3. Průvodce: zkopírovat zadání (s obsahem správného souboru), otevřít soubor (ověř adresu
   `/admin/themes/<id>?key=<soubor>`) a zkontrolovat. K tomu záložka „Udělám to sám“. Zadání se skládá
   z `theme-tags.ts`.
4. Stavy s konkrétní příčinou: embed vypnutý, značka jen v kopii, nic k ukázání.
5. Stránka „Umístění na webu“ se všemi prvky a stav pro kartu produktu.

Pozor: `TiersScreen.tsx`, `MilestonesScreen.tsx` a `i18n/cs.ts` mají od druhé AI sekci „Sčítá se s“. Přidávej
vedle ní, nepřepisuj ji.

## Potom

- C: smazat `won-discounts-cards.js`, `DRAWERS`/`PAGES` v `won-discounts-cart.js`, záložní pruh z embedu a přepsat
  přepínač karet. Zásuvka košíku je **nerozhodnutá**: zeptej se Ondřeje, než na ni sáhneš.
- D: značky `tiers` a `outlet` (Liquid do snippetů, překreslení tabulky bez vlastní sekce).
- Živé ověření A a B na Horizonu a Dawnu, 390 a 1440 px, až bude obchod volný.

## Brány před „hotovo“

```
cd packages/core && npm test
cd apps/won-discounts && npm run docs:gen && npm run test:unit:node && npm run typecheck && npm run lint
shopify theme check --path apps/won-discounts/extensions/won-discounts-storefront   # 4× OrphanedSnippet je planý poplach
```

Admin lokálně (screenshoty 390 a 1440 px přes Playwright, `/dev/preview/<stránka>`):

```
cd apps/won-discounts && SHOPIFY_APP_URL=http://localhost:58777 SHOPIFY_API_KEY=dev SHOPIFY_API_SECRET=dev SCOPES=read_products DATABASE_URL="file:$PWD/prisma/dev.sqlite" npx react-router dev --port 58777 --strictPort
```
