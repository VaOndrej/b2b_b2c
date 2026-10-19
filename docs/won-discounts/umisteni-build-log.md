# Won Discounts: umístění prvků na web, build log

Zadání: `WonCommerce/Apps/docs/won-discounts-umisteni-na-web-zadani.md` (mimo repo). Větev `won-discounts-umisteni`
ve worktree `WonCommerce/b2b_b2c-umisteni`, protože na `main` paralelně běžel krok 6 kombinování. Po dokončení se
sloučí do `main`. Samostatný log, aby se nepral s `docs/won-discounts-build-log.md`.

**CHECKPOINT U15 (16. 10. 2026): body 1–5 (Ondřej: „začni všemi“), necommitnuto.**
1. Horní pruh v E2E = blok „Announcement: Milestones“ v nové sekci Apps skupiny záhlaví (`announcementTemplateOverlays`
   v `make-e2e-overlay.mjs`; `@won/testing` umí `newSection`). Specs `rewards` a `looks` čtou
   `[data-won-discounts-topbar-block="milestones"]`. Brány: `@won/testing` 55, `test-gates` 8/8, typecheck.
2. Živé E2E `rewards` zelené: Dawn (zásuvka, `WON_E2E_DAWN_CART=drawer`) celý; Horizon celý po opakování jen
   padlých (SIGABRT workerů během `brew upgrade`, 429 v pokladně, 401 `theme dev` jednou). Nálezy a opravy:
   Horizon otevírá zásuvku po přidání jen s `auto_open_cart_drawer` (výchozí vypnuto) → test ji otevře ikonou košíku;
   pruh Milníků v sekci Apps Horizonu (`_blocks`, sloupec `flex-start`) byl úzký vlevo → CSS roztáhne obal
   `.shopify-app-block:has(> .won-topbar--block)` (+ třída v `looks.server.ts`, `docs:gen`). Screenshoty 390/1440 ve
   scratchpadu session 7d8853a5 (`e2e-rewards*`, `e2e-strip2`). Seed `rewards` v obchodě nechán (bez `--cleanup`).
   Brána: test:unit 1 992/1 992, typecheck, lint 0 chyb, Theme Check bez nálezů.
3. Logy funkce: `shopify app logs` (3.92.1 i globální 4.9.4) hlásí „Malformed JWT while fetching app logs“ už
   při pollu (subscribe projde) → `app dev` proto od 7. 10. nic nezapisuje do `.shopify/logs`. Chce to nové přihlášení
   (`shopify auth logout`, pak `shopify app logs` interaktivně), Ondřej.
4. `admin.navigation.spec.ts` „view tiles“: dva panely „global“ od kroku 4 kombinování → test kontroluje všechny.
   Náhled adminu 46/46.
5. Billing (distribuce appky) a analytika (schválení chráněných dat) čekají na Partner Dashboard, nic nespuštěno.
Pozn.: globální `shopify version` (Homebrew) sám spustil `brew upgrade` shopify-cli 4.8.5→4.9.4 + node 26.12, git,
sqlite, openssl@4 (openssl@3 odlinkován, `opt/openssl@3` zůstal). Repo používá svůj CLI 3.92.1.

**CHECKPOINT U14 (16. 10. 2026): seed `rewards` zapsaný do dev obchodu, E2E nepuštěno (Ondřej: teď není potřeba).**
`seed-mvp1.mjs --profile rewards --live` ok, 14 kroků ověřených zpětným čtením (verze `cmvb2zbmy0000sntnno3ya3st`).
Záloha předchozí konfigurace jen ve scratchpadu session 7d8853a5 (`seed-rewards/seed-mvp1-backup.json`), návrat `--cleanup`.

**CHECKPOINT U13 (15. 10. 2026): živé ověření připravené, seed zastavila kontrola oprávnění.** Ondřej dal go.
`shopify app dev` restartován (heslo obchodu z `.env` přes pseudo-terminál, skript ve scratchpadu), běží, rozšíření
nahrané do dev obchodu. Dry-run seedu `rewards` OK (7 mutací). Živý seed zamítl automatický klasifikátor Claude Code
(„Modify Shared Resources“), nic se nezapsalo. Připraveno: `tests/e2e/storefront.drawer.spec.ts` (panel v zásuvce nad
tlačítkem pokladny, 1440 a 390), overlay `e2e/settings_data.dawn-drawer.json` (`WON_E2E_DAWN_CART=drawer`), filtr
`WON_E2E_SPECS` v `scripts/require-e2e-contract.mjs`, overlaye bez záložního pruhu (`drawer_position: summary`).
**Pozor:** `storefront.rewards.spec.ts` a `storefront.looks.spec.ts` čekají horní pruh z embedu
(`[data-won-discounts-topbar]`), ten C3 smazal; před plným živým kolem je přepsat na blok oznámení.

**CHECKPOINT U12 (15. 10. 2026): balík C hotový, ověření lokálně hotové, živé čeká na go.** C1–C4 v commitech
`2c574c33`, `405e737b`, `5080e1f4`, `d06fbc4a`. Ověření:
- `tests/contracts/storefront-drawer.contract.test.ts` (Chromium, skutečné `won-discounts.js` + `won-discounts-cart.js`
  + CSS na výřezu zásuvky Horizonu a Dawnu): panel je v `.cart-drawer__summary` / `.drawer__footer` PŘED tlačítkem
  pokladny v DOM i na obrazovce (bez nastavení i `summary`), `top` nad produkty a pořád nad tlačítkem, `off` nic,
  značka vyhrává. Mutace (panel na konec místo na začátek) test shodí, 4 ze 6.
- `tests/e2e-preview/admin.placements-guide.spec.ts` (390 i 1440 px): stránka z pruhu pod Slevy, žádné technické
  slovo v rozhraní (kromě názvů souborů), nejvýš jedno hlavní tlačítko v řádku, kroky 1–3 shora dolů, do schránky
  jde přesně zobrazené zadání, odkaz do editoru kódu na konkrétní soubor v novém okně, Zkontrolovat odpoví, záložka
  Udělám to sám, zásuvka Horizon/Dawn (Změnit místo, Chci to jinde, vypnuto). 6/6.
- Celá sada náhledu adminu: 45/46; padá `admin.navigation.spec.ts` „view tiles“, padá stejně i na `main` před
  mergem (`7f4138ac`, práce druhé AI), nesouvisí.
Živě (deploy rozšíření + E2E na Horizonu a Dawnu) čeká na Ondřejovo go: zápis do dev obchodu.

**CHECKPOINT U11 (15. 10. 2026): `main` pushnutý (`31f1f43e`), balík C rozpracovaný.** Ondřej: push, C, pak vše
ověřit testy (panel v zásuvce nad hlavním tlačítkem pokladny, průvodce v adminu srozumitelný). Plán C po commitech:
C1 smazat `won-discounts-cards.js` (JSON `#won-discounts-cards` zůstává pro značku karty), C2 smazat `PAGES`
(stránka košíku jen blokem nebo značkou), C3 záložní pruh z embedu (nastavení `top_bar_*`, markup, admin ho
přestane počítat jako „na webu“), C4 přepínač karet podle nového stavu. Pak ověření: zásuvka naživo (Horizon,
Dawn, 390/1440, panel nad tlačítkem pokladny) a čitelnost průvodce.

**CHECKPOINT U10 (15. 10. 2026): zásuvka košíku hotová v kódu na `main`, naživo neověřená.** Ondřej: varianta 1 (Horizon a Dawn
automaticky) + vlastní volba místa + k tomu cesta přes AI (značka). Vlastní boční košík ne (samostatný produkt).
Plán: nastavení embedu `drawer_position` (`summary` nad tlačítkem pokladny = dnes, `top` nahoře nad produkty, `off`),
`won-discounts-cart.js` adresy podle polohy (`dp` v datech košíku); čtení vzhledu pozná zásuvku Horizonu / Dawnu
podle značek v `snippets/cart-drawer.liquid` a polohu z nastavení embedu; řádek „Zásuvka košíku“ = automaticky
(+ „Změnit místo“, „Chci to jinde“ → AI), vypnuto, nebo jiný vzhled → zadání pro AI. Značka má dál přednost.
Hotovo: nastavení `drawer_position` v embedu, `dp` v datech košíku, `drawerOf()` (ověřeno na skutečném Horizonu
a Dawnu), `ThemePlacements.drawerPosition`, stav `auto` / `missing off` v modelu, tlačítko „Změnit místo“ /
„Zapnout v zásuvce“ (nastavení embedu), „Chci to jinde“ i u zásuvky, postup v `docs/tasks/place-elements-on-the-store.md`.
Dev náhled `?state=drawer-auto|drawer-off|horizon`, screenshoty `evidence/umisteni-2026-10-14/drawer-*`.
Brány: core 1 009, app 1 971, typecheck, lint 0 chyb, Theme Check 6× OrphanedSnippet (známé).
Zbývá z C: smazat `won-discounts-cards.js`, `PAGES` (stránka košíku jen blokem), záložní pruh z embedu, přepínač
karet. Naživo: A, B, D, E a zásuvka na Horizonu a Dawnu.

**CHECKPOINT U9 (15. 10. 2026): sloučeno do `main`, nepushnuto.** Druhá AI skončila (`main` = `7f4138ac`), zkusný
merge bez konfliktů, Postgres migrace `0007` volná. `main` sloučen do větve (`7960672e`), brány zelené, pak `main`
posunut fast-forward na `7960672e`. Brány na `main`: core 1 009, app 1 969, typecheck, lint 0 chyb, Theme Check
6× OrphanedSnippet; Won Toasts 168 testů OK, 4 soubory potřebují lokální Postgres (P1010, nesouvisí); typecheck
Won Toasts a B2B Companion bez chyb. Ondřej 15. 10.: zásuvka košíku = varianta 1. Další: C.

**CHECKPOINT U8 (14. 10. 2026): balík F hotový.** `docs/reference/theme-tags.generated.md` (generuje se
z `theme-tags.ts`, už se `tiers` a `outlet`), postupy `docs/tasks/place-elements-on-the-store.md`,
`docs/tasks/add-an-element-with-ai.md`, řešení potíží `docs/support/element-not-showing-on-the-store.md`, odkazy
z postupů tabulky a štítku. Popisky odpovídají `en.ts`. **Odkaz „Zeptat se“ do chatbota nejde postavit:** chatbot
v adminu zatím neexistuje (ani ve Won Toasts), `docs/` je jen korpus pro něj. Čeká na chatbota. Zbývá: C (čeká na
rozhodnutí o zásuvce), živé ověření A, B, D, E, merge.

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
