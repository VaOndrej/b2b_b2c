# Won Discounts — úkoly 8 a 9: Překlady, vzhled u modulů, kontrola kombinací (zadání pro novou session, stav k 8. 10. 2026)

## Kdo jsi a co je cíl

Jsi vývojář Shopify aplikace `won-discounts`. Dokončuješ třetí kolo feedbacku, dávky E a F:

- **Úkol 8 (body 11 až 14):** stránka **Vzhled** zaniká. Texty na webu jdou na novou stránku **Překlady** (tabulka na každý jazyk obchodu, export a import), nastavení vzhledu se stěhuje k modulům, kterým patří.
- **Úkol 9 (bod 16):** **Vyzkoušet košík** dostane předpřipravené scénáře kombinací slev jako hlavní cestu, ruční košík zůstane jako druhá možnost. Úvodní stránka ukáže počet upozornění.

Majitel aplikace (Ondřej) není u počítače. Co je rozhodnuté, je níž; kde ti něco chybí, rozhodni sám, zapiš to do build logu a pokračuj. Ptej se jen před nevratným krokem mimo tento seznam.

Pracuješ **výhradně inline, bez subagentů**. Pořadí je 8 → 9. Úkol 9 nezačínej, dokud úkol 8 není v `main` se zelenou bránou.

## Jak se od tebe čeká, že budeš pracovat

Tohle je hlavní požadavek na tuhle session, ber ho stejně vážně jako zadání samotné.

**Po každém kroku ověř, že jsi nic nerozbil.**
- Práci si rozděl na kroky, které jdou samostatně ověřit (jádro → server → stránka → web). Po každém kroku pusť testy souborů, na které jsi sáhl, a `npx tsc --noEmit` v `apps/won-discounts`.
- Po každé vrstvě pusť celý `npm run test:unit:node -w won-discounts` a `npm run test:packages`. Cílené testy nestačí: změna textu nebo typu tu běžně shodí test na jiné stránce.
- Před každým commitem do `main` celá brána (níž). Čísla testů porovnej s výchozím stavem: počet testů smí jen růst, a když klesne, musíš umět říct proč.
- Když test spadne, nejdřív zjisti, jestli má pravdu on, nebo ty. Očekávání v testu měň jen tehdy, když se chování změnilo záměrně, a v tom případě ho nahraď stejně přísným. Nikdy test nemaž, nepřeskakuj (`skip`, `todo`) ani neuvolňuj, aby prošel.
- Chování, které měníš, má mít test dřív nebo zároveň s kódem. U převodu uložených dat (rozdělení vzhledu, texty po jazycích) je test na skutečných tvarech nastavení povinný, včetně „načíst a uložit beze změny dá stejný výsledek“.

**Drž kód úsporný a čistý.**
- Než něco napíšeš, najdi, jestli to v repu už není: sdílené komponenty v `app/components/shell/`, modely v `app/components/model/`, výpočty v `packages/core/src/discounts`. Jedna věc má jedno místo; logiku neopisuj mezi serverem, stránkou a webem.
- Co přestane být potřeba, smaž ve stejném commitu: komponenty, exporty, texty v `cs.ts` / `en.ts`, typy, stavy dev náhledu, testy mrtvého kódu. Nenechávej staré a nové vedle sebe „pro jistotu“.
- Hlídej limity, které repo má, a čísla před a po zapiš: velikost nastavení pro web, váha skriptů na stránku (`tests/contracts/perf-budget.contract.test.ts`), velikost a instrukce funkce v pokladně (`docs/won-discounts/analyza-velikost-funkce.md`), počet dotazů do Shopify při načtení stránky.
- Komentáře piš jako okolní kód: krátce proč, ne co.

**Žádné obcházení.**
- Žádné `any`, `as unknown as`, `@ts-ignore`, `eslint-disable` ani nové výjimky v lintu jen proto, aby něco prošlo. Když typ nesedí, oprav typ.
- Žádné čekání na čas místo podmínky, žádné zachytávání chyb naprázdno, žádné zvláštní větve „jen pro test“ nebo „jen pro dev náhled“ v produkčním kódu.
- Limit se nezvedá proto, že se do něj nevejdeš. Nejdřív zmenši, co posíláš; když to nejde, zastav se, zapiš čísla a možnosti a nech rozhodnout Ondřeje.
- Omezení v rozhraní musí mít stejnou kontrolu na serveru. Skrytí tlačítka není omezení.
- Když narazíš na chybu, která s úkolem nesouvisí, neopravuj ji mimochodem. Zapiš ji do build logu („Parkované otázky a dluh“) a pokračuj; opravu udělej jen tehdy, když ti blokuje bránu.

## Kde to je

- Repo: `~/Development/WonCommerce/Apps/b2b_b2c` (monorepo). Aplikace `apps/won-discounts`, sdílené jádro `packages/core/src/discounts`.
- `main` je pushnutý; výchozí commit je `4fd92aa` nebo novější. Začni `git fetch origin`.
- **V hlavním adresáři souběžně pracuje jiná session** (stránka Nastavení: `SettingsScreen.tsx`, `shell/SectionNav.tsx`, `cs.ts`, `en.ts`, `tests/ui/harness-screens.test.ts`; její rozbor je `docs/won-discounts/audit-navigace-2026-10-08.md`). Proto si udělej vlastní pracovní adresář a větev a do hlavního adresáře nesahej:

```
cd ~/Development/WonCommerce/Apps/b2b_b2c
git fetch origin
git worktree add ../b2b_b2c-preklady -b won-discounts-preklady origin/main
cd ../b2b_b2c-preklady && npm install
```

  Nejdřív se podívej na `git status` v hlavním adresáři. Když už je čistý a nikdo tam nepracuje, můžeš pracovat rovnou v něm na nové větvi z `origin/main`; běží nad ním `shopify app dev`, takže se ti změny rozšíření samy nahrávají do dev obchodu.
- `cs.ts` a `en.ts` mění obě session. Před každým pushem `git fetch origin && git rebase origin/main`; konflikt v nich řeš ponecháním obou sad klíčů, v build logu ponecháním obou zápisů, a bránu pusť znovu.
- Stav běhu: `docs/won-discounts-build-log.md`, oddíl „Aktuální stav“. **Začni tím, že ho přečteš**, a po každé kompakci kontextu znovu.
- Dev náhled bez přihlášení běží jen nad hlavním adresářem: `http://localhost:<port>/dev/preview/<obrazovka>`. Z vlastního adresáře dělej screenshoty ze staticky vykreslených stránek (viz „Důkazy“). Dev servery sám nespouštěj ani nerestartuj.
- Seznam obrazovek a stavů náhledu je v komentáři na začátku `apps/won-discounts/app/routes/dev.preview.$.tsx`.

## Co si přečti, než začneš

1. `docs/won-discounts-build-log.md` — „Aktuální stav“, hlavně úkol 7 (Milníky).
2. `docs/won-discounts/feedback-2026-10-06-kolo3-plan.md` — kapitoly 11 až 14 a 16, „Rozhodnuto 6. 10. 2026“, tabulka „Stav implementace“ a doplnění z 6. 10. večer.
3. `docs/won-discounts/rozhodnuti.md` — produktová rozhodnutí, neměň je.
4. `docs/won-app-design-doctrine.md`, oddíly §16 až §19.
5. `docs/won-discounts/audit-dlazdice-trhy-2026-10-06.md`, kapitola 6 (slovníček náhrad).
6. `docs/won-discounts/navrh-castky-podle-trhu.md` a `docs/won-discounts/analyza-velikost-funkce.md` — jak se tu měří limity a jak se rozhoduje podle čísel.
7. Kód, na kterém stavíš:
   - úkol 8: `app/components/screens/AppearanceScreen.tsx`, `app/components/model/appearance.ts`, `app/lib/integration/appearance.server.ts`, `packages/core/src/discounts/custom-look.ts`, `storefront-config.ts`, `app/components/tiers/TiersPreview.tsx`, rozšíření `extensions/won-discounts-storefront/` (`locales/`, `blocks/`, `snippets/`, `assets/`, `README.md`);
   - úkol 9: `app/components/screens/TryCartScreen.tsx`, `app/lib/integration/try-cart-plan.ts`, `try-cart.server.ts`, `app/components/model/try-cart-form.ts`, `packages/core/src/discounts/plan.ts`, `explain.ts`, `milestones.ts`.

## Co je rozhodnuto

- **Vzhled se mezi moduly nesdílí.** Každý prvek na webu má vlastní; Free vybírá z hotových vzhledů, Pro má vlastní barvy a CSS.
- **Barva zvýraznění** je na každém tarifu. Dnes se vybírá jen v náhledu u Množstevních slev (`TiersPreview.tsx`, pole `accentPreset`); dej ji ke každému prvku na webu, který ji používá.
- **Jazyky:** bere se seznam jazyků zapnutých v Shopify. Free 2 jazyky (výchozí + 1), Pro neomezeně.
- **Export a import překladů** je jen Pro.
- **Kontrola kombinací:** počet upozornění vidí i Free, podrobnosti (které a proč) jsou Pro.
- **Štítek „Pro“** je na dlaždici Pro části vidět na každém tarifu.
- **Milníky:** limit stupňů platí v každém trhu zvlášť (Free 2, Pro 6); sleva na objednávku jako stupeň je pravidlo s id `ms-…` (`packages/core/src/discounts/milestones.ts`). Neměň to, jen na tom stav.

## Úkol 8 — Překlady a přesun Vzhledu

### Nejdřív změř (než napíšeš první řádek stránky)

Dvě věci rozhodují o tvaru dat. Změř je a výsledek i rozhodnutí zapiš do `docs/won-discounts/navrh-preklady-a-vzhled.md`:

1. **Texty po jazycích.** Dnes jsou změněné texty v nastavení pro web (`storefront-config.ts`, `texts`) pro cs / sk / en. Kolik bajtů zabere jeden plně přeložený jazyk a kolik jazyků se vejde do limitu metapole? Plán počítá s tím, že každý jazyk dostane vlastní úložiště a web načte jen ten, ve kterém je stránka. Ověř v dokumentaci Shopify, jak ho rozšíření přečte a jaké jsou limity.
2. **Čtyři sady vlastního CSS.** Dnes je jedno CSS pod společným kořenem všech prvků (`custom-look.ts`). Vejdou se čtyři do nastavení pro web vedle všeho ostatního? Když ne, každý prvek dostane vlastní úložiště stejnou cestou jako jazyky.

Přesný název oprávnění ke čtení jazyků obchodu ověř v dokumentaci Shopify. Obchodník ho jednou potvrdí; aplikace bez něj musí dál fungovat (výchozí jazyk) a říct, co chybí, s tlačítkem.

### A. Stránka Překlady (body 11, 12, 14)

1. **Menu:** Slevy · Ochrana marže · Překlady · Přehledy · Nastavení. Adresa `/app/appearance` přesměruje na `/app/translations`. Dlaždice „Vzhled“ na úvodní stránce se změní na „Překlady“ a dostane řádek stavu.
2. **Výchozí jazyk** obchodu je první tabulka. Další jazyk se přidá z rozbalovacího seznamu „Přidat jazyk“ (jen jazyky zapnuté v Shopify) a přibude tabulka.
3. **Tabulka:** řádek = jeden text. Sloupce: kde se text ukazuje (lidsky, nikdy klíč), výchozí text šedě, pole pro vlastní. Seskupené podle místa: Množstevní tabulka, Milníky, Košík, Výprodej, Kampaně, Ceny na kartách. Na 390 px se neposouvá do strany.
4. **Části ve složených závorkách** (`{amount}`, `{reward}`) se kontrolují: text, kterému chybí nebo přebývá, se neuloží a pole řekne proč.
5. **Milníky (bod 11):** texty žebříčku už v rozšíření jsou (`cart.ms_left`, `ms_done`, `ms_from`, `ms_ship`, `ms_gift`, `ms_gift_named`, `ms_disc`) a mají lidské názvy (`appearance.text.cart.ms_*`). Přidej k stupni se slevou **vlastní název odměny, který jde přeložit**. Název dárku se bere z produktu, překládá ho Shopify. Pozor: texty košíku dnes rozšíření bere jen ze svých souborů (`'cart.…' | t` v `won_discounts_embed.liquid`); změněný text obchodníka se tam musí začít uplatňovat stejně jako u množstevní tabulky.
6. **Limit:** Free 2 jazyky, Pro neomezeně, v rozhraní i na serveru. Po přechodu z Pro na Free zůstanou další jazyky uložené, na webu se použije výchozí text a stránka to řekne (§14a, §16).
7. **Export a import (Pro):** export CSV (klíč, místo, výchozí text, sloupec na jazyk). Import nejdřív ukáže, co se změní a co odmítá (neznámý klíč, chybějící `{amount}`, text delší než limit), a uloží až po potvrzení.
8. **Převod:** dnešní uložené texty se objeví v tabulkách beze ztráty. Test na skutečném tvaru nastavení.

### B. Vzhled u modulů (bod 13)

| Co je dnes ve Vzhledu | Kam |
|---|---|
| Styl množstevní tabulky (Tabulka, Zvýrazněná úroveň, Štítky, Dlaždice) | Množstevní slevy, sekce „Vzhled tabulky“ |
| Ceny na kartách produktů · BETA | Množstevní slevy |
| Tabulka na webu (stav a přidání) | Množstevní slevy (už tam je) |
| Vzhled žebříčku milníků | Milníky |
| Štítek výprodeje | Výprodej |
| Banner kampaně | Kampaně |
| Texty na webu | Překlady |
| Vlastní barvy a CSS (Pro), zadání pro AI | ke každému modulu zvlášť |

1. **Hotové vzhledy (Free)** pro každý prvek. Množstevní tabulka je má. Návrh pro ostatní: Milníky — Odškrtávací seznam, Ukazatel se značkami, Jedna věta; Výprodej — Štítek, Štítek s odpočtem, Pruh; Kampaň — Pruh, Banner s odpočtem, Karta. Odpočet do konce je součást vzhledu výprodeje a kampaně.
2. **Žebříček Milníků podle Ondřeje:** fajfky u splněných stupňů, bez fajfky u nesplněných, zvýraznění barvou při dosažení stupně, volitelně krátké bliknutí v okamžiku dosažení. Efekt respektuje „omezit pohyb“ v zařízení. Dnešní výchozí vzhled a značky jsou v `extensions/won-discounts-storefront/README.md`, oddíl „Milníky: the ladder“.
3. **Vlastní CSS každého prvku platí jen uvnitř něj.** Dnešní společné CSS se při převodu zkopíruje k tabulce (jediné místo, kde se reálně používá). Ověř testem i na webu, že se po převodu nic nezmění.
4. **Náhled** u každého vzhledu je živý a ukazuje i vlastní CSS.
5. **„Zadání pro AI“** se generuje zvlášť pro každý prvek (jeho třídy a proměnné); seznam tříd hlídá test proti souborům rozšíření (`STOREFRONT_CLASSES`).
6. Po přesunu nesmí v aplikaci zůstat žádný odkaz na `/app/appearance` kromě přesměrování, ani žádný text, který posílá „do Vzhledu“.

**Do úkolu 8 nepatří** překlad názvů voleb rozšíření v úpravě vzhledu obchodu (odložené, viz níž).

## Úkol 9 — Vyzkoušet košík se scénáři

1. **Scénáře sestaví aplikace** z aktivních typů slev: množstevní sleva sama; se slevou s kódem; se slevou z objednávky; s dopravou zdarma; s dárkem ze stupně; **se stupněm se slevou z Milníků**; výprodej s čímkoli z toho; kampaň v den startu. Jen kombinace, které nastavení dovoluje. Nejvýš zhruba 12.
2. **Produkty do scénáře vybere aplikace:** produkt s nejnižší marží, produkt z výjimky, varianta ve výprodeji, nejprodávanější (z přehledů, když jsou).
3. **Částky podle trhu:** scénáře běží pro každý zapnutý trh, kde se výsledek může lišit (jiná částka stupně, jiná minimální útrata). Limit Milníků po trzích musí vyjít stejně jako v pokladně.
4. **Co hlásí:**
   - ochrana marže slevu snížila nebo zrušila,
   - součet slev překročil nastavené maximum,
   - sleva se neuplatní, protože se nesčítá s jinou,
   - kód vezme nárok na dárek,
   - ze dvou dosažených stupňů se slevou platí jen vyšší, nebo ji přebil kód,
   - pokladna slevy zkrátí (moc slev na jeden košík).
5. **Kde:** ve Vyzkoušet košík nahoře seznam „Časté kombinace“ se stavem V pořádku / Upozornění; kliknutí otevře scénář v ručním formuláři. Na úvodní stránce dlaždice s počtem („6 v pořádku, 1 upozornění“). U upozornění odkaz na nastavení, které ho způsobuje.
6. **Free a Pro:** počet upozornění vidí i Free; které a proč je Pro (jantarově, §16, se zamčeným obsahem a jednou větou, k čemu to je). Server podrobnosti na Free vůbec neposílá.
7. **Kdy se počítá:** po uložení jakékoli slevy a jednou denně, z cen a nákupních cen, které aplikace už má uložené. **Žádný další dotaz do Shopify při otevření stránky.**
8. **Jeden výpočet:** scénáře počítá `planCart`, stejně jako pokladna a ruční košík. Žádná druhá sada pravidel. Funkce v pokladně se nemění.
9. **Poctivě:** je to výpočet, ne ostrá objednávka. Stránka to říká jednou větou.

## Tvrdá omezení

- **Funkce v pokladně** (`extensions/won-discounts-engine`, Rust): do `src/` ani do sestavení nesahej. Žádný z obou úkolů ji nepotřebuje. Měníš nejvýš `tests/scenarios.js` a `tests/fixtures/`; po změně scénářů `npm run fixtures -w won-discounts-engine`. `git diff origin/main --stat -- apps/won-discounts/extensions/won-discounts-engine/src` musí zůstat prázdný.
- **Váha skriptů na webu:** stránka produktu má **11 678 B z 12 288 B**, stránka košíku 6 513 B z 10 240 B, `won-discounts-blocks.js` 1 511 B z 2 048 B, každý soubor nejvýš 10 000 B nezabalený. Vzhledy řeš přednostně v CSS, ne ve skriptu.
- **Zápisy do dev obchodu:** jen přes runbook (`apps/won-discounts/scripts/e2e/runbook/`), vždy nejdřív nanečisto, podívej se, co přepíše, pak naostro; po doběhnutí musí být obchod vrácený ze zálohy (`cleanup`, `verify-clean` exit 0). Jiné zápisy do Shopify bez svolení nedělej. `shopify app deploy` nepouštěj.
- **Rozšíření za běhu `shopify app dev`:** změna v `extensions/` v hlavním adresáři se hned nahraje do dev obchodu a může rozbít soubory na webu do dalšího restartu. Po změnách ověř `node apps/won-discounts/scripts/check-storefront-assets.mjs the-inventory-not-tracked-snowboard` (exit 0); když hlásí chybějící soubory, napiš Ondřejovi, ať dev server restartuje.

## Pravidla práce

- **Cizí rozpracované soubory nech být:** `apps/won-discounts/DEPLOY.md`, `apps/won-discounts/railway.json`, `apps/won-toasts/railway.json`, `docs/product-roadmap.html`, `docs/railway-hosting.md`, `docs/won-companion/`, `docs/won-discounts/paralelizace.md` a vše, co má rozdělané souběžná session. Nikdy `git add .`, `git add -A`, `git stash` ani `git add apps/won-discounts`. Přidávej konkrétní složky a před commitem zkontroluj `git status --short`.
- **Žádný prettier ani jiný formátovač.** Před commitem se podívej na `git diff --stat`.
- **React 18 a pole Shopify (`s-*`):** funguje jen `onClick`. Změny čti nativními událostmi `input` / `change` na formuláři. Neměň atributy pole (`value`, `error`), zatímco do něj obchodník píše; hlášky kresli vedle pole.
- **V inline stylech nemíchej zkrácený a plný zápis téže vlastnosti** (`border` spolu s `borderColor`).
- **Texty česky i anglicky:** každý nový klíč do `app/i18n/cs.ts` i `en.ts`. Obchodníkovi se vyká. Krátké konkrétní věty. Žádný žargon: „téma“, „editor tématu“, „blok“, „synchronizace“, „práh“, „recept“, „cílení“, „strop slevy“.
- **V textech nikdy neukazuj klíč** částky ani textu. Trh se jmenuje jménem („Slovensko (EUR)“), text místem, kde ho zákazník vidí.
- **Dokumentace:** po změně textů stavů, voleb nebo limitů `npm run docs:gen -w won-discounts`. Ručně psané stránky v `apps/won-discounts/docs/` uprav tam, kde popisují Vzhled nebo Vyzkoušet košík. Jeden oddíl dokumentace nesmí přesáhnout 1 500 znaků (hlídá test).
- **Slučování:** po zelené bráně `git fetch origin && git rebase origin/main`, bránu po rebase pusť znovu, pak `git push origin HEAD:main`. Žádný `--force`; když push odmítne, zopakuj fetch a rebase.
- **Second Brain:** `node /Users/ondrej/Development/second-brain/src/cli.mjs list`. Práce patří k úkolu `won-discounts-kolo3`. Po každém dokončeném úkolu tam zapiš poznámku (`note-add won-discounts-kolo3 "…" --no-llm`; nepiš do ní data ve tvaru „7. 10.“, nástroj je čte jako připomínku).

### Brána (před každým commitem do `main`)

Z kořene repa, každý příkaz zvlášť, všechno musí skončit s kódem 0:

```
npm run test:packages
npm run test:unit -w won-discounts
npm run typecheck -w won-discounts
npm run lint -w won-discounts
npm run build -w won-discounts
npm run guard:test:core
npm run validate:shopify
```

Výchozí stav (8. 10. 2026, commit `4fd92aa`): `test:packages` 927 + 53, `test:unit` 1 789 + cargo 102 + vitest 699, guard 301, lint 0 chyb a 6 starších varování, `validate:shopify` bez nálezů. Kořenový `npm run lint` (bez `-w`) kontroluje jinou aplikaci a padá na jejích starších chybách; do brány nepatří. Sestavení funkce potřebuje balíček `binaryen`: po rebase, který změní `package-lock.json`, pusť v kořeni `npm install`.

### Důkazy (bez nich úkol není hotový)

- **Aplikace:** screenshoty 390 px a 1440 px každého nového stavu, bez vodorovného posuvu, do `~/Development/WonCommerce/Apps/.playwright-mcp/preklady/` a `…/scenare/`. Z vlastního adresáře: `cd apps/won-discounts && npx tsx scripts/static-preview.ts <složka> <název>=<obrazovka?dotaz>` a potom `node ~/Development/WonCommerce/Apps/.playwright-mcp/dotazeni-static-shots.mjs <složka> <výstup> [název:panel]`. Aspoň dva snímky každé stránky si sám prohlédni.
- **Logika:** výstup testu s čísly, ne tvrzení.
- **Web:** každý nový vzhled na Horizonu i Dawnu, 390 a 1440 px, přes runbook (`profile.sh`, profily `tiers`, `rewards`, `rewards-pro`, `outlet`). Dev obchod po desítkách dotazů vrací HTTP 429; jednotlivý test jde zopakovat po pauze přes `debug-run.sh <profil> "<část názvu>" --only horizon|dawn`. Pro profily Pro musí Ondřej spustit `shopify app dev` s `NODE_ENV=development WON_DEV_PLAN=pro`; když neběží tak, napiš mu to a pokračuj tím, co na tom nezávisí.
- **Žebříček bez obchodu:** `node apps/won-discounts/scripts/milestones-web-preview.mjs <složka>` projde košíkem stupně nad skutečnými styly a skripty; po změně vzhledu žebříčku musí dál skončit bez chyby.
- U každé části napiš, co jsi naživo neověřil.

Po každé části zapiš stav do build logu a do tabulky „Stav implementace“ v plánu třetího kola.

## Hotovo, když

**Úkol 8**
1. Stránka Překlady ukládá a načítá texty pro každý jazyk obchodu, limit jazyků platí v rozhraní i na serveru a dnešní uložené texty se načtou beze ztráty (test na skutečném tvaru nastavení).
2. Změněný text obchodníka se na webu uplatní u všech prvků včetně košíku a žebříčku Milníků, v jazyce stránky.
3. Export a import CSV fungují na Pro; import nic neuloží bez potvrzení a odmítnuté řádky říká s důvodem.
4. Vzhled je u modulů, stránka Vzhled neexistuje, `/app/appearance` přesměruje. Vlastní CSS jednoho prvku neovlivní jiný a web po převodu vypadá stejně jako před ním.
5. Rozhodnutí o úložišti jsou podložená čísly v `docs/won-discounts/navrh-preklady-a-vzhled.md`.

**Úkol 9**
6. Vyzkoušet košík ukazuje scénáře sestavené z aktivních slev, každý se stavem; výsledek scénáře se shoduje s `planCart` (test).
7. Úvodní stránka ukazuje počet upozornění; Free vidí počet, Pro podrobnosti, a server to tak i posílá.
8. Otevření stránky nedělá žádný dotaz do Shopify navíc (test).

**Obojí**
9. Tvoje commity nemění zdrojáky ani sestavení funkce v pokladně a parita s referenčním výpočtem drží.
10. Brána je zelená, `main` je pushnutý, build log a plán jsou aktuální.

## Mimo rozsah

- Odložené v Second Brain, nezakládej je znovu: `won-discounts-overeni-po-nasazeni`, `won-discounts-billing-nazivo`, `won-discounts-pristup-k-objednavkam`, `won-discounts-preklady-nastaveni-rozsireni`.
- Stránka Nastavení a navigace uvnitř stránek (dělá souběžná session).
- Dodělávky Milníků naživo (pokladna na Dawnu ve Free profilu, proklikání stránky): jsou v build logu, nedělej je, pokud o ně nezakopneš.
- Nasazení (`shopify app deploy`) dělá Ondřej.

## Závěrečná zpráva

Po každém z obou úkolů krátce, česky, pro Ondřeje, v tomto pořadí:

1. Jedna věta, co je hotové.
2. Odrážky, co se změnilo, s odkazem na soubor.
3. Co naživo ověřené není a přesný příkaz nebo cesta v aplikaci, kterou to Ondřej ověří.
4. Co potřebuješ rozhodnout.

Dlouhý rozbor patří do souboru v `docs/won-discounts/`, do zprávy jen odkaz. Výsledky testů uváděj čísly z výstupu.
