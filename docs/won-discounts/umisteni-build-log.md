# Won Discounts: umístění prvků na web, build log

Zadání: `WonCommerce/Apps/docs/won-discounts-umisteni-na-web-zadani.md` (mimo repo). Větev `won-discounts-umisteni`
ve worktree `WonCommerce/b2b_b2c-umisteni`, protože na `main` paralelně běžel krok 6 kombinování. Po dokončení se
sloučí do `main`. Samostatný log, aby se nepral s `docs/won-discounts-build-log.md`.

**CHECKPOINT U7 (14. 10. 2026): balík D hotový v kódu, naživo neověřený; další F.** Značky `tiers` a `outlet`:
snippety `won-tiers` / `won-outlet` (bloky jen `render`), embed na stránce produktu s `tg.ti` / `tg.ob`, CSS a skripty
po `won-discounts-tags.js`, vyplněná značka skryje blok (CSS `:has`), v editoru mimo produkt `sample.tag_product`.
Tabulka ve značce po změně košíku `zero()` bez dotazu na sekci (test padá bez opravy). Jádro `tg.ti/ob`, model míst
i zadání pro AI je znají. Brány: core 1 009, app 1 957 (jednou spadl `margin.test.ts` na časování, samostatně 3× OK),
typecheck, lint 0 chyb, Theme Check 6× OrphanedSnippet (2 nové snippety, stejný planý poplach), Liquid celkem v limitu.

**CHECKPOINT U6 (14. 10. 2026): balík D rozpracovaný, F čeká.** Zásuvka: podklad k rozhodnutí
`docs/won-discounts/rozhodnuti-zasuvka-kosiku.md` (doporučení varianta 1 + kontrola čtením vzhledu), Ondřej
rozhodne; mezitím D a F. Plán D:
- `snippets/won-tiers.liquid` a `snippets/won-outlet.liquid` = celý Liquid bloků (blok je jen `render`), parametry
  `accent`, `attrs`, `scripts`.
- Embed na stránce produktu (`template.name == 'product'`) s `tg.ti` / `tg.ob` tiskne `<template data-won-tag="tiers|outlet">`
  a načte CSS a skripty tabulky / štítku; v editoru ukázky (`tag_unknown`, mimo produkt `tag_product`).
- `won-discounts-tags.js`: `show="tiers|outlet"`. Značka má přednost: CSS skryje blok, když je na stránce vyplněná
  značka.
- **Překreslení po změně košíku:** SF-1 zakazuje skriptu tabulky číst košík a značka nemá vlastní sekci. Ve značce
  proto po změně košíku `zero()` (počítá jen zvolené množství, nikdy víc než pokladna), jako dnes při chybě.
  Po načtení stránky počítá košík Liquid přesně. Přesnější cesta (app proxy) až když to Ondřej bude chtít.
- Jádro `tg.ti`, `tg.ob`; `theme-tags.ts`, model míst, zadání pro AI pro `tiers` a `outlet`.
F potom: `docs/reference/` (značky už generuje `docs:gen`), `docs/tasks/` postupy, odkaz „Zeptat se“ z průvodce.

**CHECKPOINT U5 (14. 10. 2026): navigace a příprava merge.** Ondřej: stránka musí jít proklikat, ne jen přes
odkaz. Pravidlo Won (`packages/app-kit/src/admin-nav.tsx`): nejvýš 5 položek v postranním menu, související stránky
sdílí položku a pruh. „Umístění na webu“ je proto poslední položka pruhu pod „Slevy“ (`discountStripItems`), pruh
je i na stránce samé: Slevy → Umístění na webu. Zadání pro AI anglicky: schváleno.
**Merge do `main` dělám já, až druhá AI skončí.** Postup:
1. `./docs/won-discounts/merge-umisteni.sh`: zkusný merge v paměti (nic nezapíše) + kolize čísla Postgres migrace.
   Při kolizi `--fix` přečísluje `0007_theme_tags` na další volné číslo a commitne to na této větvi. Ověřeno na
   simulovaném `main` s `0007_other` → navrhne `0008`. SQLite migrace mají časové razítko, kolize nehrozí.
2. `git merge main` do této větve. Čekané textové konflikty (obě strany přidávají na konec souboru):
   `app/i18n/cs.ts`, `app/i18n/en.ts` (blok „Umístění na webu“ až za klíče z `main`), `app/lib/dev-harness.server.ts`,
   seznam `HARNESS_SCREENS` v `dev.preview.$.tsx`, `tests/ui/harness-screens.test.ts`. Řešení: obojí ponechat.
   `MilestonesScreen.tsx` a `CampaignsScreen.tsx`: mám jen jeden řádek `<PlacementsLink …/>` a import.
3. Brány (core, docs:gen, test:unit:node včetně `tests/lib/migrations.test.ts`, typecheck, lint, Theme Check),
   pak teprve merge do `main` a push po dotazu.
Stav 14. 10.: `main` = `a73ce412`, čistý, poslední Postgres migrace `0006` → dnes bez kolize a bez konfliktu.

**CHECKPOINT U4 (14. 10. 2026), balík E rozpracovaný.** Zadání pro tuhle část: `docs/won-discounts/prompt-umisteni-pokracovani.md`.
Ověřeno (shopify.dev, Admin 2026-04): `theme.files(filenames:, first:)` bere nejvýš 50 vzorů s `*`, `first` až 2 500,
odpověď se zkrátí podle velikosti (stránkuje se kurzorem); soubor má `checksumMd5` a `size`. Liquid soubor má
nejvýš 256 KB. Plán, jak se čte: (1) jeden dotaz na jména a součty (`layout/ sections/ snippets/ blocks/
templates/*.liquid`), (2) obsah jen pro součty, které aplikace ještě nezná (paměť podle `checksumMd5`, sdílená mezi
vzhledy, takže kopie živého vzhledu stojí jen dotaz na jména). Kopie: nejvýš 3 naposledy upravené `UNPUBLISHED`.
Plán E po krocích (každý commit zvlášť):

- **E1 hotové v kódu.** `app/lib/integration/theme-scan.server.ts` + `app/components/model/theme-scan.ts`, sloupce
  `ShopSyncState.themeTags/themeTagsAt` (migrace sqlite `20261014120000_theme_tags`, postgres `0007_theme_tags`:
  pozor na kolizi čísla, kdyby `main` mezitím přidal 0007), resync „theme“, `writeStorefrontConfig` bere značky
  z DB. **Nalezená chyba mimo E:** `wiring.server.ts` zahazoval `shopTimezone`, takže `camps` (kampaně pro banner,
  feedback 2 bod 7) se do konfigurace pro web ze syncu nikdy nezapsaly; opraveno a pokryto testem. Na skutečných
  souborech: Horizon 268 souborů / 2 MB (karta bere blok), Dawn 106 / 0,9 MB (karta ne). Testy
  `tests/integration/theme-scan.test.ts` (10), `storefront-sync.test.ts` +2. Brány: core 1 009, app 1 945,
  typecheck, lint 0 chyb. Volání `readThemeScan` z obrazovek přijde v E2.
- **E2–E5 hotové v kódu, naživo neověřené.** Stránka `/app/placements` („Umístění na webu“,
  `PlacementsScreen.tsx`, `app.placements.tsx`, `lib/integration/placements.server.ts`): každý prvek každého modulu
  a každé místo, jedno hlavní tlačítko podle vzhledu („Přidat na web“ / „Připravit zadání pro AI“), u míst s blokem
  tiché „Chci to jinde“. Průvodce pod řádkem: zadání pro AI (anglicky, z `theme-tags.ts` + obsah souboru načtený až
  po kliknutí), odkaz `/admin/themes/<id>?key=<soubor>`, „Zkontrolovat znovu“; záložka „Udělám to sám“. Stavy:
  Jen v kopii, Won vypnutý (+ Zapnout), „je na webu, teď nemá co ukázat“ (žádný milník / kampaň / sleva / výprodej,
  ceny na kartách vypnuté), neznámé `show` (překlep) v „Další vložená místa“. Karta produktu má stav (značka, nebo
  blok `card_tiers` v JSON šablonách). Navigace je plná (5 položek), stránka je přes odkaz z Milníků, Kampaní
  a karet v Množstevních slevách. Dev náhled `/dev/preview/placements?state=horizon|copy|embed-off|nothing|unknown`,
  screenshoty `evidence/umisteni-2026-10-14/placements-*`, `guide-*`, `link-*` (390 i 1440, bez vodorovného
  posunu). **Nedělané z E2:** tlačítka na stránkách modulů se podle vzhledu nemění (zásuvka v Milnících dál říká
  „Zapnout na webu“, protože do balíku C ji umísťuje skript). Testy `tests/integration/placements.test.ts` (6).
  Brány: core 1 009, app 1 951, typecheck, lint 0 chyb, Theme Check 4× OrphanedSnippet (známé).
- **E1** čtení: čisté funkce (značky v Liquidu bez `{% comment %}`, `@app` ve schématu sekce → kam blok jde),
  výsledek živého vzhledu do `ShopSyncState.themeTags` (nový sloupec, sqlite i postgres), sync ho předá jako
  `themeTags` → `tg`. Změněné značky = resync.
- **E2** řádek místa: „Přidat na web“, nebo „Připravit zadání pro AI“ kde blok nejde; „Chci to jinde“.
- **E3** průvodce: zadání z `theme-tags.ts` + obsah souboru (načte se až po kliknutí), odkaz do editoru kódu,
  „Zkontrolovat“; záložka „Udělám to sám“.
- **E4** stavy s příčinou: embed vypnutý, jen v kopii, nic k ukázání.
- **E5** stránka „Umístění na webu“ + stav karty produktu.

**CHECKPOINT U3 (14. 10. 2026).** **Balík B2 hotový v kódu, naživo neověřený:** karta mimo kolekci a vyhledávání.
App proxy `GET /apps/won-discounts/card-tiers?h=…&cur=…&mk=…&c=…` (`app/routes/won-discounts.card-tiers.tsx`,
`app/lib/integration/card-tiers.server.ts`): jádro `cardTier` nad živou konfigurací pro web, metapoli produktu,
příznaky výprodeje a nákupní ceny variant a nejnižší cenou v měně stránky (contextual pricing podle země). Keš 10 min
na obchod a zemi, `onAdminWrite` ji zahodí, 30 čtení Shopify za minutu na obchod. Dotazy ověřené proti Admin API.
`won-discounts-tags.js` pošle všechny chybějící handly stránky jedním dotazem, texty slov z šablony
`card-tier-texts` (embed ji tiskne s `tg.cd` a zapnutými kartami), výsledek si pamatuje. Skript 1 724 B gzip,
volitelný strop zvednut na 2 048 B (jako blocks). Testy: `tests/integration/card-tiers.test.ts` (6), prohlížeč +1.
Brány: core 1 009, app 1 933, typecheck, lint 0 chyb, Theme Check bez nových nálezů. Balík B je v kódu celý.
Další: E (čtení vzhledu, kdo plní `tg`; řádek místa; průvodce).

**CHECKPOINT U2 (14. 10. 2026).** Ondřej: ruční cesta = varianta (a), volitelná; druhá AI na `main` poběží dlouho,
živé ověření počká. **Balík B1 hotový v kódu, naživo neověřený:**

- Jádro: `tg` v konfiguraci pro web (`themeTagsPart`, `StorefrontConfigOptions.themeTags`): `ms` velikosti žebříku,
  `cp` kampaň, `cd` karty. Plní ho až balík E (čtení vzhledu); do té doby embed šablony netiskne.
- Embed: `<template data-won-tag>` jen podle `tg`, v editoru všechny ukázky (`*-sample`, důvod `sample.tag_unknown`
  a `sample.tag_card`), načte `won-discounts-tags.js` (1 083 B gzip, volitelný strop 1 280 B).
- `won-discounts-tags.js`: vlastní prvek `won-discounts`, plní prázdnou značku i po překreslení tématu.
- Košík: `won-discounts-cart.js` kreslí panel do značky (velikost z atributu); se značkou na stránce nehádá místa.
  `won-discounts-cards.js` se značkou karty nedělá nic.
- Popis značek jednou: `app/components/model/theme-tags.ts` → `docs/reference/theme-tags.generated.md` (chatbot),
  později průvodce v adminu a zadání pro AI.
- Testy: `tests/contracts/storefront-tags.contract.test.ts` (8, v Chromiu přes Playwright, bez sítě).

Brány: core 1 009, app 1 926, typecheck, lint 0 chyb, Theme Check bez nových nálezů.
Zbývá k B: **B2** karta mimo kolekci a vyhledávání (app proxy, výpočet jádrem `cardTier` na serveru: data produktu
přes Admin API, cache). Pak E (kdo plní `tg`), C, D.

**CHECKPOINT U1 (14. 10. 2026).** Ověření před stavbou zapsané v zadání (oddíl „Výsledek ověření“). Riziko:
App Store 5.1.1 („You or merchants should not make any code changes to the theme“) proti ruční cestě se značkou,
rozhoduje Ondřej. Balík A hotový v kódu, **naživo neověřený** (deploy rozšíření do dev obchodu čeká, až druhá AI
dokončí živé testy):

- Ukázka v editoru vzhledu (`request.design_mode`) se stejnými třídami a velikostí jako prvek, čárkovaný rámeček
  (outline, nebere místo) a důvod: `blocks/quantity_tiers.liquid` → `snippets/won-sample-tiers.liquid`;
  `blocks/card_tiers.liquid` (i mimo kartu: „přetáhněte ho do karty“); `blocks/cart_rewards.liquid` (ve slotu,
  skutečný panel ji skryje CSS `.won-cart:not(:empty) ~ [data-won-discounts-sample]`).
- Skutečný žebřík místo věty: `blocks/rewards_progress.liquid`, `blocks/announcement_milestones.liquid` →
  `snippets/won-sample-ladder.liquid` (velikost podle bloku).
- Důvod: `snippets/won-card-tier.liquid` vrací s `why` kód (`off, many, none, outlet, gift, margin, cap,
  currency`); texty `sample.*` v cs/sk/en, na stránce Překlady se nenabízejí (jen editor).
- Ukázka nese datové atributy, ne třídy: třídy patří vlastnímu vzhledu a průvodci AI.
- Odkaz na kartu: deep link neumí cílit dovnitř karty (`target=mainSection` dal blok vedle karet, kde nemá
  produkt). `cardBlockAddUrl` smazán, tlačítko otevře editor na šabloně kolekce a text řekne kroky.

Brány: `test:unit:node` 1 912 z 1 912, typecheck, lint 0 chyb (4 varování jako na `main`), Theme Check bez nových
nálezů (OrphanedSnippet je falešný, i na `main`). Screenshoty adminu: `evidence/umisteni-2026-10-14/karta-admin-*`.

Zbývá k A: živě na Horizonu a Dawnu, 390 a 1440 px, v editoru: tabulka (bez slevy, ve výprodeji, s marží),
karta (v kartě, mimo kartu), košík (embed vypnutý / zapnutý), Milníky ve třech velikostech, Oznámení: Milníky.
Další: B (čeká na rozhodnutí k 5.1.1).
