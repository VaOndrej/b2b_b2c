# Zadání: navigace a stav uvnitř stránek Won Discounts

Pracuješ v nové session bez předchozího kontextu. Tohle zadání je úplné, nic dalšího k němu nedostaneš.

## Kde pracuješ

- Repo: `/Users/ondrej/Development/WonCommerce/Apps/b2b_b2c` (monorepo), aplikace `apps/won-discounts`.
- Lokální větev `won-discounts-milniky` sleduje `origin/main` a pushuje se přímo do něj. Lokální větev `main` je zastaralá, nepoužívej ji. „Na mainu“ znamená v `origin/main`.
- Z `origin/main` staví Railway produkční server (`docs/railway-hosting.md`). Každý push je tedy nasazení serveru. Pushuj jen se zelenou bránou.
- Ve stejném pracovním stromu můžou souběžně commitovat jiné session (Překlady, vzhled u modulů, scénáře košíku). Počítej s tím, že se ti soubory pod rukama změní.
- Admin je React 18.3 + React Router 7 + webové komponenty Polaris (`s-*`), embedded v Shopify.
- Uživatel je Ondřej. Odpovídej česky, texty v UI česky s vykáním, komentáře v kódu anglicky jako okolní kód.

## Co si přečti, než sáhneš na kód

1. `CLAUDE.md` v kořeni repa (způsob spolupráce, důkaz místo tvrzení).
2. `docs/won-discounts/implementace-pravidla-pro-agenty.md`: tvrdá pravidla (bez prettieru, React 18.3 a `s-*` prvky, pravidla textů, P1–P9). Platí celá kromě vět o více agentech v jednom stromu, pracuješ sám.
3. `docs/won-app-design-doctrine.md`: na její paragrafy (§11, §17, §19…) odkazují komentáře v kódu. Čti hlavně §11 (barvy a stav), §17 (sekce), §19e (dlaždice a pohledy).
4. `docs/won-discounts/audit-navigace-2026-10-08.md`: audit, ze kterého zadání vychází. Platí jeho poslední část „Úprava po zpětné vazbě“. Varianta „sloupec místo dlaždic“ je zamítnutá.
5. Kód, na který navazuješ:
   - `app/components/shell/SectionNav.tsx`: sloupec „Na této stránce“ (hotový, zatím jen v Nastavení).
   - `app/components/screens/SettingsScreen.tsx`: jak se SectionNav zapojuje.
   - `app/components/shell/ModuleTile.tsx` (`ModuleTile`, `ViewTile`, `TileContent`) a `app/components/shell/views.tsx` (`useView`).
   - `app/components/shell/SubNav.tsx` a `app/components/model/modules.ts` (`discountSubNavItems`).
   - `app/components/shell/WonSection.tsx` (`StatusPill`, `Pill`, kotvy) a `app/components/shell/tokens.ts`.
   - `app/components/model/module-status.ts` (`ModuleStatus`, `ModuleState`).

## Krok 0: dostaň rozdělanou práci na main, než začneš

V pracovním stromu jsou necommitované změny z předchozí session. Tvoje jsou jen tyhle:

- `apps/won-discounts/app/components/shell/SectionNav.tsx` (nový)
- `apps/won-discounts/app/components/screens/SettingsScreen.tsx`
- `apps/won-discounts/app/i18n/cs.ts` a `en.ts` (heslo `common.onThisPage`)
- `apps/won-discounts/tests/ui/harness-screens.test.ts`
- `docs/won-discounts/audit-navigace-2026-10-08.md` a `docs/won-discounts/prompt-navigace-stav.md` (nové)

Postup:

1. `git status` a `git diff` nad těmito soubory. Ověř, že v nich není nic cizího (jiná session mohla do `cs.ts`, `en.ts` nebo testu mezitím přidat své). Cizí řádky do commitu nedávej.
2. `cd apps/won-discounts && npm run typecheck && npm run test:unit`. Musí být zelené.
3. Commit jen vyjmenovaných souborů, přidaných jmenovitě. Zpráva ve stylu `git log` (česky, „Won Discounts: …“).
4. `git pull --rebase` a `git push`. Ověř, že `git status -sb` hlásí shodu s `origin/main`.

Ostatní necommitované soubory (`DEPLOY.md`, `railway.json`, `docs/product-roadmap.html`, `docs/railway-hosting.md`, `docs/won-companion/`, `docs/won-discounts/paralelizace.md`…) nejsou tvoje. Necommituj je a nesahej na ně.

## Proč se to dělá

Ondřejovi se líbí dvě věci a chce je mít všude:

- V Nastavení je mapa stránky pořád na očích a nic se neschovává.
- Na dlaždicích je po otevření sekce hned vidět, co je a co není aktivní.

Dnes ale dlaždice opakují to, co říká hlavička sekce hned pod nimi, a spolu s vodorovným pruhem posouvají obsah na 310 až 435 px od horního okraje (1440 × 900). Editor slevy je dlouhý formulář bez mapy. Na Přehledu je rozcestník modulů až kolem 1 030 px.

Jedno pravidlo pro všechno níž: **stav je vidět jednou a nahoře, vysvětlení jednou a u obsahu.**

## Co má být hotové

### 1. Nízké dlaždice pohledů (Množstevní slevy, Milníky, Výprodej, Kampaně, Ochrana marže)

- `ViewTile` ukazuje jen to, co se mění: název, štítek stavu, jednu větu souhrnu (`active`), počet věcí k vyřešení. Stálý popis (`about`, `aboutShort`) z ní zmizí.
- `ModuleTile` na Přehledu zůstává s popisem. Tam je dlaždice rozcestník a popis říká, co modul dělá.
- Cílová výška řady dlaždic na 1440 px je kolem 80–90 px (dnes 170–190 px). Změř ji a napiš skutečné číslo.
- Na 390 px se text souhrnu nesmí uříznout uprostřed věty (audit N3 v komentáři `TileContent`). Zalomí se.
- Zamčená dlaždice Pro si drží jantarový vzhled a štítek. Štítek „Pro“ je vidět i na tarifu Pro (rozhodnutí Ondřeje, neměň ho).

### 2. Hlavička sekce pod dlaždicí neopakuje stav

- V pohledu, který má dlaždici, hlavička první sekce neukazuje znovu štítek stavu ani stejnou větu souhrnu. Zůstane jí název a vysvětlující věta, tedy to, co odešlo z dlaždice.
- Sekce, které dlaždici nemají (další sekce téhož pohledu), si svůj souhrn nechávají.
- Projdi všech pět stránek a každý pohled. Výsledek: žádný text není na obrazovce dvakrát pod sebou.

### 3. Tečka stavu ve vodorovném pruhu pod „Slevy“

- U každé z pěti položek (Slevy a kódy, Množstevní slevy, Milníky, Výprodej, Kampaně) tečka: zelená aktivní, červená vyžaduje pozornost, šedá neaktivní. Zamčený modul tečku nemá, říká to štítek Pro.
- Barvy a význam jen z `tokens.ts` a ze stejného zdroje jako `StatusPill`. Žádná nová barva, žádný nový význam (§11a).
- Tečka sama nestačí pro čtečky: stav musí být i v textu pro čtečky u odkazu.
- Stav musí být stejný jako na dlaždici modulu na Přehledu, z jednoho výpočtu. Dnes layout loader `app/routes/app.tsx` vrací jen `goals`. Najdi, kde Přehled stavy modulů počítá, a zvol řešení, které nepřidá druhý výpočet ani zbytečné dotazy do Shopify při každé navigaci. Pokud to bez citelné ceny nejde, zastav se a napiš Ondřejovi varianty s čísly.
- Dev harness nemá layout loader. Náhled musí tečky umět ukázat z fixtur.

### 4. Tečka stavu ve sloupci SectionNav

- `SectionNavItem` dostane volitelný stav. Stejná tečka, stejný zdroj barev, stejné pravidlo pro čtečky.
- Nastavení: tečku jen tam, kde sekce stav opravdu má (Trhy a měny: chybí částky → vyžaduje pozornost). Sekce bez stavu tečku nemají (P2: nic bez obsahu).

### 5. Editor slevy: sloupec jako v Nastavení

- `RuleEditorScreen.tsx`, sekce Sleva, Podmínky, Jak se uplatní, Kdy platí, Pro koho platí a kombinace.
- Červená tečka u sekce, kde chybí hodnota nebo je chyba. Musí se měnit živě s formulářem (P5), ne až po uložení. Použij stejný zdroj, ze kterého editor skládá stavovou větu a značky u polí, nepiš druhou validaci.
- První sekce má vpravo panel „Co uvidí zákazník“. Se sloupcem ubude 208 px šířky. Ověř na 1440, 1200 a 1024 px, že formulář a panel dávají smysl. Když ne, navrhni a udělej úpravu (širší stránka, nebo panel pod formulář dřív) a zdůvodni ji.
- Sbalená sekce (Pro koho platí): klik ve sloupci ji rozbalí a sjede na ni. Podívej se na `jumpToAnchor` v `rule-editor/parts.tsx`, ať nevzniknou dvě cesty pro totéž.
- Sekce „Sleva“ dnes nemá kotvu. Kotvy editoru mají aliasy (`EDITOR_ANCHOR_ALIASES`) a vedou na ně odkazy z jiných stránek. Žádný existující odkaz se nesmí rozbít.

### 6. Milníky: řádek se stupni

- V hlavičce sekce „Stupně a odměny“ řádek s čísly stupňů. Klik sjede na daný stupeň.
- Dlaždice nahoře zůstávají. Sloupec tu nebude, byl by třetí navigace nad sebou.
- Stupeň s chybou (chybí částka pro trh) je v řádku červeně. Počet stupňů se mění (přidat, odebrat, až 12), řádek to musí sledovat živě a na 390 px nepřetékat.

### 7. Přehled: rozcestník modulů výš

- Dlaždice modulů nad „Slevy vytvořené přímo v Shopify“.
- „Vyžaduje pozornost“ zůstává první. Než pořadí změníš, přečti komentáře v `OverviewScreen.tsx`, proč je dnešní pořadí takové, a zkontroluj stavy `empty`, `clean`, `conflict`, `moved`, `sync-failed` v náhledu.

## Jak má vypadat kód

- Nejdřív hledej, co už existuje, a použij to. Tečka stavu je jedna komponenta pro pruh, sloupec i řádek stupňů, ne tři kopie.
- Screen jen skládá. Výpočty stavu patří do `components/model/`, společné prvky do `components/shell/`.
- Žádná nová závislost. Žádné nové barvy mimo `tokens.ts`.
- Schovaný panel se nikdy neodmontuje (§17d), stránka má jeden formulář a jedno Uložit.
- Poslouchání scrollu a resize přes `requestAnimationFrame` a s úklidem, jako v SectionNav. Žádné měření DOM při renderu.
- Když je SectionNav potřeba upravit (stav, rozbalení sbalené sekce), uprav ho obecně, ne výjimkou pro jednu stránku.
- Bez prettieru a bez přeformátování. Před koncem zkontroluj `git diff --stat`: v souboru, kde jsi měnil pár řádků, nesmí být stovky změn.
- Každé nové heslo do `cs.ts` i `en.ts`, vedle souvisejících hesel. Hesla, která po změně nikdo nepoužívá, smaž z obou.
- Pravidlo z tohoto zadání (stav jednou nahoře, vysvětlení jednou u obsahu; kdy pruh, kdy dlaždice, kdy sloupec) dopiš do `docs/won-app-design-doctrine.md` k §19e, protože platí pro všechny Won aplikace.

## Žádné zkratky

Ondřej chce čistý kód, ne kód, který jen projde. Tohle všechno je zkratka a nesmí v odevzdané práci být:

- `any`, `as unknown as`, vykřičník za výrazem nebo `@ts-ignore` jen proto, aby zmlkl typecheck. Oprav typ.
- `eslint-disable` bez věty, proč je tady správně.
- `setTimeout` nebo opakované zkoušení jako oprava časování, kterému nerozumíš. Najdi příčinu.
- `!important`, vymyšlený `z-index`, záporné okraje nebo pevné pixely jako oprava rozložení, které jsi nepochopil.
- Zkopírovaný blok místo společné funkce nebo komponenty. Podmínka `if (stránka === …)` uvnitř sdílené komponenty.
- Druhý výpočet téhož (stav modulu, chybějící hodnota) vedle toho, který už existuje.
- Text natvrdo v komponentě místo hesla v i18n. Barva natvrdo místo tokenu.
- Logika jen pro náhled nebo jen pro test v produkčním kódu.
- Test smazaný, přeskočený nebo oslabený, aby prošel. Tvrzení přepsané tak, že už nic nehlídá.
- Spolknutá chyba (`catch {}` bez důvodu), mrtvý kód, zakomentovaný kód, `TODO` na později, `console.log`.
- Hotovo jen pro šťastnou cestu: bez Free, bez angličtiny, bez 390 px, bez prázdného stavu.

Když se ti zdá, že bez zkratky to nejde, zastav se a napiš Ondřejovi, proč, a jaké jsou varianty.

Před každým commitem si přečti vlastní diff jako cizí recenzent a projdi ho proti tomuto seznamu. Každý kompromis, který v kódu zůstal, vypiš v odevzdání i s důvodem. Zamlčený kompromis je horší než přiznaný.

## Testy

- Jednotkové testy pro každý nový výpočet v `model/`.
- `tests/ui/harness-screens.test.ts`: pro každý bod aspoň jedno tvrzení, že prvek je, a jedno, že opakovaný text zmizel (`absent`). Rozbité existující testy oprav podle nového chování, nemaž je.
- Na konci celá brána: `cd apps/won-discounts && npm run typecheck && npm run test:unit`. Běžíš sám, plná brána je v pořádku.
- E2E v prohlížeči přes Playwright proti náhledu `/dev/preview/<stránka>`. `shopify app dev` Ondřejovi běží, port zjistíš z procesu `react-router dev` (`lsof -iTCP -sTCP:LISTEN -P | grep node`). Dev server nespouštěj, nezastavuj ani nerestartuj. Když neběží, napiš si o něj.
- Podívej se do `apps/won-discounts/e2e` a `playwright.config.ts`. Když tam jde přidat trvalý test navigace proti náhledu bez Shopify přihlášení, přidej ho. Když ne, napiš proč.

## Zkus to rozbít

Než řekneš hotovo, projdi tohle v prohlížeči a ke každému bodu napiš, co se stalo:

- Šířky 390, 768, 899, 900, 1024, 1440 px. Na žádné stránka nepřetéká do šířky.
- Editor slevy: vymaž částku, přepni typ slevy, přepni na kód. Tečky ve sloupci sledují formulář bez uložení.
- Editor slevy: klik ve sloupci na sbalenou sekci, na poslední sekci (nedojede k hornímu okraji), rychle po sobě na tři různé.
- Stránka s dlaždicemi: přepni pohled, ulož s chybou v poli, které je v jiném pohledu. Otevře se pohled s chybou (`useView`) a stav na dlaždici sedí.
- Přímý odkaz s kotvou: `/app/settings#combination`, `/app/discounts/<id>#value`, `/app/rewards#amounts`, `/app/tiers#pro`. Všechny pořád vedou, kam mají.
- Milníky: 1 stupeň, 12 stupňů, přidat a odebrat stupeň, chybějící částka v jednom trhu.
- Tarif Free a Pro (`?plan=pro`), čeština a angličtina (`?locale=en`). Dlouhé anglické texty nic nerozbijí.
- Klávesnice: Tab projde pruh, dlaždice i sloupec, fokus je vidět, Enter funguje. `prefers-reduced-motion` vypne plynulý scroll.
- Neuložené změny: klik ve sloupci a v řádku stupňů nevyvolá dotaz na opuštění stránky a nezahodí rozepsaný formulář.
- Vypnutý JavaScript nebo stav před hydratací: odkazy ve sloupci jsou obyčejné kotvy a fungují.

Každou chybu, kterou najdeš, oprav a přidej na ni test.

## Čeho se nedotýkej

- Nic nezapisuj do Shopify, žádný deploy, žádný skript s `--live`.
- Žádné `git add -A` ani `git add .`, žádný force push, žádný rebase cizích commitů, žádný `stash`, `reset` ani `checkout` nad soubory, které nejsou tvoje.
- Wasm funkce v `extensions/` a `packages/core` se tohle zadání netýká.
- Vodorovný pruh zůstává vodorovný. Dlaždice zůstávají dlaždicemi. Slevy a kódy, Přehledy, Vzhled a Vyzkoušet košík se nemění, kromě tečky v pruhu.
- Pracuj inline, bez subagentů.

## Jak postupovat

Nejdřív krok 0. Pak po bodech v tomto pořadí: 1 a 2 spolu, 3, 4, 5, 6, 7. Po každém bodu pusť testy, které se ho týkají, a vyfoť stránku.

Commituj po každém hotovém bodu zvlášť: jen své soubory přidané jmenovitě, předtím `npm run typecheck` a `npm run test:unit` zelené, potom `git pull --rebase` a `git push`. Rozpracovaný nebo červený stav nepushuj, šel by na produkční server. Když narazíš na rozpor mezi zadáním a doktrínou nebo na rozhodnutí, které mění chování pro obchodníka, zastav se a zeptej se. Jinak pokračuj až do konce.

Stav průběžně zapisuj do `docs/won-discounts-build-log.md` (sekce „Aktuální stav“), ať o něj nepřijdeš při zkrácení kontextu.

## Co odevzdáš

- Screenshoty před a po na 390 a 1440 px pro každou změněnou stránku, uložené v `docs/won-discounts/evidence/navigace-stav/`.
- Změřené hodnoty: výška řady dlaždic a odkud začíná obsah, před a po, pro pět stránek s dlaždicemi.
- Skutečný výstup `npm run typecheck` a `npm run test:unit` (počty prošlo / neprošlo), ne tvrzení.
- Seznam z části „Zkus to rozbít“ s výsledkem u každého řádku.
- Seznam změn jako `soubor:řádek`, a zvlášť co jsi neudělal a proč.
- Seznam commitů (hash a zpráva) a potvrzení, že `origin/main` je obsahuje.
- Seznam kompromisů v kódu podle části „Žádné zkratky“, nebo výslovně „žádné“.
- Přesný příkaz nebo URL, kterým si to Ondřej ověří sám.
