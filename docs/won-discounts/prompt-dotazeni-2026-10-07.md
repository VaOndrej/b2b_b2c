# Won Discounts — dotažení po auditu a třetí kolo (zadání ze 7. 10. 2026)

## Kdo jsi a co je cíl

Jsi vývojář Shopify aplikace `won-discounts`. Navazuješ na práci, která skončila 7. 10. 2026. Máš dotáhnout všechno, co majitel aplikace (Ondřej) neodložil: jednu chybu na webu, sloučení do `main`, čtyři menší úkoly a tři velké dávky. Ondřej není u počítače, rozhodnutí už udělal a jsou sepsaná níž. Kde ti něco chybí, rozhodni sám podle nejlepšího úsudku, zapiš to do build logu a pokračuj. Ptej se jen tehdy, když jde o nevratný krok mimo tento seznam.

Pracuješ **výhradně inline, bez subagentů**. Úkoly dělej v pořadí, v jakém jsou tady. Další začni až po zelené bráně a commitu toho předchozího.

## Kde to je

- Repo: `~/Development/WonCommerce/Apps/b2b_b2c` (monorepo). Aplikace `apps/won-discounts`, sdílené jádro `packages/core/src/discounts`.
- Větev: `won-discounts-feedback-2026-10-06`, 14 commitů před `main`, nepushnuto. Poslední commit s kódem je `0d7833b`, po něm už jen tohle zadání.
- Stav běhu: `docs/won-discounts-build-log.md`, oddíl „Aktuální stav“. **Začni tím, že ho přečteš**, a po každé kompakci kontextu znovu.
- Dev náhled bez přihlášení do Shopify: `http://localhost:<port>/dev/preview/<obrazovka>`. Port se mění. Zjistíš ho takhle:

```
for p in $(lsof -iTCP -sTCP:LISTEN -P | grep node | awk '{print $9}' | sed 's/.*://' | sort -u); do
  [ "$(curl -s -m 5 "http://localhost:$p/dev/preview/overview?state=modules" | grep -c data-won-tile)" -gt 0 ] && echo $p
done
```

  Když nevypíše nic, náhled neběží. Dev servery sám nespouštěj ani nerestartuj, napiš to do závěrečné zprávy.
- Seznam obrazovek a stavů náhledu je v komentáři na začátku `apps/won-discounts/app/routes/dev.preview.$.tsx`.

## Co si přečti, než začneš

1. `docs/won-discounts-build-log.md` — „Aktuální stav“.
2. `docs/won-discounts/audit-dlazdice-trhy-2026-10-06.md` — kapitola 9 (co je z auditu hotové).
3. `docs/won-discounts/feedback-2026-10-06-kolo3-plan.md` — celý. Je to plán třetího kola (16 bodů), dávky A a B jsou hotové, C až F ne.
4. `docs/won-discounts/prompt-kolo3.md` — původní zadání třetího kola, platí pro dávky C až F.
5. `docs/won-discounts/nakres-bod7-vyjimky.md` — nákres výjimek.
6. `docs/won-discounts/rozhodnuti.md` — produktová rozhodnutí. Neměň je, kromě bodu „Částky podle trhu“ níž, který jedno z nich nahrazuje.
7. `docs/won-app-design-doctrine.md`, oddíly §16 až §19.

## Pravidla práce

- **Cizí rozpracované soubory nech být.** V repu jsou necommitnuté změny, které nejsou tvoje: `apps/won-discounts/DEPLOY.md`, `apps/won-discounts/railway.json`, `apps/won-toasts/railway.json`, `docs/product-roadmap.html`, `docs/railway-hosting.md`, `docs/won-companion/`, `docs/won-discounts/paralelizace.md`. Nikdy nepoužívej `git add .`, `git add -A` ani `git add apps/won-discounts`. Přidávej konkrétní složky (`apps/won-discounts/app`, `apps/won-discounts/tests`, `packages/core/src`, …) a před commitem zkontroluj `git status --short`.
- **Žádný prettier ani jiný formátovač.** Repo nemá konfiguraci, formátovač přepíše celé soubory. Piš podle okolního kódu (dlouhé řádky jsou tu běžné). Před commitem se podívej na `git diff --stat`; nečekaně velké číslo znamená přeformátování.
- **React 18 a pole Shopify (`s-*`):** na prvcích `s-*` funguje jen `onClick`. Změny čti nativními událostmi `input` / `change` na formuláři. Nikdy neměň atributy pole (`value`, `error`), zatímco do něj obchodník píše; hlášky kresli vedle pole.
- **V inline stylech nemíchej zkrácený a plný zápis téže vlastnosti** (`border` spolu s `borderColor`). React při přepnutí smaže barvu a okraj ztmavne (nález N18).
- **Server je autorita:** každé omezení v rozhraní musí mít stejnou kontrolu na serveru.
- **Texty česky i anglicky:** každý nový klíč do `app/i18n/cs.ts` i `en.ts`. Obchodníkovi se vyká. Krátké konkrétní věty. Žádný žargon: neříkej „téma“, „editor tématu“, „blok“, „synchronizace“, „práh“, „recept“, „cílení“, „strop slevy“. Slovníček náhrad je v auditu, kapitola 6.
- **Trhy se jmenují podle trhu:** pole a hlášky říkají „Slovensko (EUR)“, ne „v EUR“.
- **Štítek „Pro“ je na dlaždici Pro části vidět na každém tarifu** (rozhodnutí Ondřeje 7. 10.). Na Free „Pro · odemknout“, na Pro prostý štítek. Neschovávej ho.
- **Nezapisuj do Shopify bez výslovného svolení v tomto zadání.** Povolené zápisy jsou jen ty u úkolu 4. `shopify app deploy` nepouštěj, nasazení dělá Ondřej.
- **Second Brain:** před plánováním si vypiš úkoly `node /Users/ondrej/Development/second-brain/src/cli.mjs list`. Práce z tohoto zadání patří k úkolu `won-discounts-kolo3`; označ jím svoje položky v seznamu úkolů jako `[brain:won-discounts-kolo3]`. Odložené věci tam už zapsané jsou (viz konec tohoto souboru), znovu je nezakládej.

### Brána (po každém úkolu, před commitem)

Z kořene repa. Všechno musí skončit s kódem 0:

```
npm run test:packages
npm run test:unit -w won-discounts
npm run typecheck -w won-discounts
npm run lint -w won-discounts
npm run build -w won-discounts
npm run guard:test:core
npm run validate:shopify
```

Poslední stav 7. 10.: `test:unit` 1 735 testů + cargo 101 + vitest 599, `test:packages` 900 + 50, vše zelené. `validate:shopify` se 7. 10. nepouštěl, pusť ho hned na začátku, ať znáš výchozí stav.

Když změníš texty stavů nebo voleb, přegeneruj dokumentaci: `npm run docs:gen -w won-discounts`.

### Důkazy (bez nich úkol není hotový)

- Vizuální změna: screenshoty 390 px a 1440 px. Vzor skriptu: `~/Development/WonCommerce/Apps/.playwright-mcp/audit-fix-shots.mjs`. Ukládej do `~/Development/WonCommerce/Apps/.playwright-mcp/dotazeni/`. Na žádné obrazovce nesmí být vodorovný posuv.
- Logika: výstup testu, ne tvrzení, že projde.
- Web: Horizon i Dawn.
- U každého úkolu napiš, co jsi naživo neověřil.

Po každém úkolu zapiš stav do build logu a do tabulky „Stav implementace“ v plánu třetího kola.

---

## Úkol 1 — Chyba: vzhled množstevní slevy se nepropisuje na web

**Co Ondřej vidí (dev obchod, 7. 10. 2026):** v aplikaci na stránce Množstevní slevy má vybraný vzhled „Štítky“ a barvu „Zelená“ a náhled v aplikaci vypadá správně (rámečky, zelené částky). Na živé stránce produktu („Elektrolyty Hydratace“) je ale množstevní sleva holý text: nadpis „Množstevní sleva“ a pod ním číslovaný seznam „1. Od 3 ks−3,00 Kč596,95 Kč/ks“, bez mezer mezi sloupci, bez rámečků, bez barvy. Není tam tedy **žádný** styl rozšíření, nejen nová barva.

**Co o tom víš z kódu:**
- Styly tabulky jsou v `extensions/won-discounts-storefront/assets/won-discounts-tiers.css`, blok je `blocks/quantity_tiers.liquid` (schéma: `"stylesheet": "won-discounts-tiers.css"`).
- Vzhled jde na web v nastavení pro web jako `appearance.preset`; barva a vlastní vzhled jako `appearance.css`, které vypisuje `blocks/won_discounts_embed.liquid` (řádek ~50) do `<style id="won-discounts-custom">`. Bez zapnutého Won na webu se tedy barva neprojeví vůbec.
- Barva zvýraznění je nová (7. 10.): `config.storefront.accent`, jádro `custom-look.ts` (`accentCss`), `storefront-config.ts`.
- V dev obchodě je vlastní živý vzhled „test-data“, ne Horizon ani Dawn.

**Postup:** nejdřív najdi příčinu, pak opravuj. Zjisti na živé stránce produktu (jen čtení): jestli se soubor `won-discounts-tiers.css` vůbec načítá; jaké třídy a `data-preset` má kořen bloku; jestli je v datech pro web `appearance.preset` „chips“ a v `appearance.css` zelená; jestli je uložené nastavení zapsané do Shopify (úvodní stránka aplikace → „Stav v obchodě“). Rozliš tři možné příčiny: styl se nenačte (vzhled obchodu, pořadí, chybějící soubor v nasazeném rozšíření), uložené nastavení se na web nezapsalo, nebo blok kreslí jinou značku, než na jakou styl míří. Podle build logu obchod po desítkách dotazů vrací 429, dělej mezi dotazy pauzy.

**Hotovo, když:** na živém vzhledu dev obchodu, na Horizonu i na Dawnu vypadá blok stejně jako náhled v aplikaci pro všechny čtyři vzhledy a zvolenou barvu; je k tomu test, který by chybu zachytil; a aplikace obchodníkovi řekne, když se barva nemůže projevit (Won na webu vypnutý). Když je příčina v nasazení rozšíření, které nemůžeš udělat sám, napiš přesně, co má Ondřej spustit.

## Úkol 2 — Sloučit do `main` a pushnout

Ondřej: „klidně vše push do mainu, vše pro Won Discounts pomergovat do mainu“.

- Lokální větve 7. 10.: `won-discounts-feedback-2026-10-06` (14 commitů před `main`), `codex/won-quantity-bootstrap` a `won-toasts` (obě 0 commitů před `main`, není co slučovat). Ověř to znovu: `git rev-list --count main..<větev>`.
- Před sloučením musí projít brána. Slučuj až po úkolu 1, ať do `main` nejde známá chyba na webu; když se úkol 1 zasekne na něčem, co neopravíš, sluč i tak a napiš to.
- `git fetch`, pak sloučit větev do `main` bez přepisování historie, pushnout `main`. Žádný `--force`.
- Cizí necommitnuté soubory zůstanou necommitnuté. Pokud brání přepnutí větve, nepoužívej `stash` ani `checkout --`; sluč jinou cestou (například `git push origin won-discounts-feedback-2026-10-06:main`, když jde o posun bez slučovacího commitu) a lokální `main` dorovnej později.
- Další úkoly dělej na nové větvi z `main` a po každém zeleném úkolu je sluč a pushni stejně.
- Nasazení (`shopify app deploy`) nedělej.

## Úkol 3 — Návrh částky i v kampaních

Ve formuláři kampaně má slevu pevnou částkou pole „Sleva v kampani“ pro každý trh. Doplň pod ně stejný návrh jako jinde: obchodník vyplní částku v měně obchodu, pro ostatní trhy s prázdným polem se nabídne „Návrh“ s tlačítkem „Použít“, nebo „Bez návrhu“, když trh nemá v Shopify ručně nastavený kurz.

- Hotová součástka: `app/components/shell/AmountSuggestions.tsx`. Kurzy čte `readAmountSuggest` v `app/lib/integration/themes.server.ts`. Vzor použití: `RewardsScreen.tsx`, `TierSetEditor.tsx`.
- Platí i pro částky množstevních slev v kampani („Sleva za kus v kampani“).
- Návrh jde jen z měny obchodu do ostatních. Nic se nevyplní bez kliknutí.
- Test podle `tests/ui/audit-2026-10-06.test.ts` („návrh 2“).

## Úkol 4 — Zkouška tabulky na produktu na Horizonu a Dawnu

Z dávky B (bod 4 třetího kola) je hotová úprava, kdy tabulka na stránce produktu sleduje košík bez načtení stránky. Chybí zkouška na obou šablonách. Ondřej dal „go“.

- Zkouška: `tests/e2e/storefront.tiers.spec.ts`, část „bod 4“. Spouštění a profily: `npm run test:e2e -w won-discounts` a runbook, na který odkazuje build log.
- Zkouška přepisuje nastavení dev obchodu. **Nejdřív dry-run**, podívej se, co přepíše, pak naostro. Po doběhnutí vrať obchod do stavu před zkouškou, pokud to runbook umí; když ne, napiš, co zůstalo změněné.
- Když spadne jeden profil, opakuj jen ten, ne celé kolo.
- Změř rychlost stránky produktu před a po (limit skriptů je 12 288 B, poslední váha 10 800 B) a čísla zapiš.

## Úkol 5 — Výjimky v Množstevních slevách (dávka C, bod 7)

Nákres je v `docs/won-discounts/nakres-bod7-vyjimky.md`. Ondřej ho nechce kreslit ani schvalovat: „nechám to na tvém nejlepším úsudku“. Postav to podle nákresu; kde je nejasný nebo se s dnešním stavem rozchází, rozhodni sám a zapiš proč.

Mysli na to, co se od nákresu změnilo: úrovně jsou očíslované karty (`TierSetEditor.tsx`), chyby se ukazují až po pokusu, pole se jmenují podle trhu, pod částkami je návrh. Výjimky mají vypadat a chovat se stejně.

## Úkol 6 — Částky podle trhu, ne podle měny

**Rozhodnutí Ondřeje 7. 10. 2026, nahrazuje dosavadní stav:** „Pokud to budou dva trhy, tak si zákazník může změnit tu slevu per trh. Cílíme na to tak, že je to vše per trh.“

Dnes se částky ukládají podle měny (`MoneyByCurrency` v `packages/core/src/discounts/config/types.ts`): sleva, minimální útrata, částka pro dopravu zdarma a dárek, částka za kus. Slovensko a Německo v eurech proto sdílejí jednu částku. Nově má mít **každý trh vlastní částku**, i když má stejnou měnu jako jiný.

Je to zásah do uložených dat, do slevové funkce v pokladně (`extensions/won-discounts-engine`, Rust) i do dat pro web. Proto:

1. Nejdřív napiš krátký návrh do `docs/won-discounts/navrh-castky-podle-trhu.md`: jak se částky uloží, jak pokladna a web poznají trh zákazníka (dnes se trh pozná podle země košíku, viz `marketCountries` a `shipMarketCountries` v `function-payload.ts`), co se stane s uloženými nastaveními (převod musí být bezztrátový: každý trh dostane částku své měny), kolik to přidá do limitu velikosti nastavení pro pokladnu a co se stane, když se trh nepozná. Na schválení nečekej; návrh slouží jako záznam a ty podle něj pokračuješ.
2. Staré nastavení se musí dál číst. Převod pokryj testy na skutečných tvarech nastavení.
3. Změny sdíleného jádra nesmí rozbít `guard:test:core` (aplikace `b2b-companion`).
4. V rozhraní pak každé pole patří jednomu trhu. Věta v Nastavení „Trhy se stejnou měnou mají společnou částku“ (`settings.markets.sameCurrency`) zmizí. Přehled trhů v Nastavení, upozornění na úvodní stránce a počítání „věcí k vyřešení“ přejdou z měn na trhy (`model/markets.ts`, `model/markets-overview.ts`, `module-status.ts`).
5. Návrh částky (úkol 3) pak nabízí částku pro každý trh zvlášť.
6. Ověř limit velikosti nastavení pro pokladnu na největším rozumném obchodě (víc trhů × víc úrovní). Když se to nevejde, zastav se, zapiš čísla a možnosti do návrhu a pokračuj úkolem 7 s dnešním ukládáním; Milníky pak stav tak, aby šly přepnout.

Udělej to **před Milníky**, protože Milníky stojí na tabulce „stupeň × trh“.

## Úkol 7 — Milníky (dávka D, body 9 a 10)

Stránka Odměny se přestaví na jeden žebříček stupňů podle hodnoty košíku. Rozhodnuto 6. 10.: odměna u stupně je dárek, doprava zdarma, nebo sleva na celou objednávku (procenta nebo částka); Free 2 stupně, Pro 6; název „Milníky“ / „Milestones“. Podrobnosti jsou v plánu třetího kola a v `prompt-kolo3.md`.

Navíc z auditu 6. 10.:

- **Částky v tabulce:** řádek = stupeň, sloupec = trh. Obchodník vyplní sloupec měny obchodu, tlačítko „Navrhnout ostatní trhy“ doplní zbytek k potvrzení (z ručního kurzu trhu, jinak řekne, že kurz není). Na 390 px se tabulka nesmí posouvat do strany: sloupce se skládají pod sebe.
- **Průvodce prvním nastavením** dnes při cíli „Doprava zdarma nebo dárek“ vede na `/app/rewards?start=shipping#shipping` (`REWARDS_FIRST_HREF` v `OnboardingScreen.tsx`). Po přestavbě má vést na první stupeň Milníků s předvyplněnou částkou.
- **Po uložení** říct, co zákazník uvidí a co ještě chybí, s tlačítkem (dnes sekce „Co dál“ v `RewardsScreen.tsx`).
- **Chybějící trh** je věc k vyřešení na dlaždici, v seznamu „Vyžaduje pozornost“ i v přehledu trhů (dnes `rewardsOverviewOf`, `rewardsStatus`).
- Dlaždice na úvodní stránce se přejmenuje z „Odměny“ na „Milníky“.

## Úkol 8 — Překlady a přesun Vzhledu (dávka E, body 11 až 14)

Podle plánu třetího kola: stránka Vzhled se změní na Překlady (texty na webu pro každý jazyk zapnutý v Shopify; export a import jen Pro) a nastavení vzhledu se přesune k jednotlivým modulům. Free vybírá z hotových vzhledů, Pro má vlastní CSS.

Navíc: **výběr barvy zvýraznění** je dnes jen v náhledu na stránce Množstevní slevy (`TiersPreview.tsx`, pole `accentPreset`). Při přesunu vzhledu k modulům ho dej ke každému prvku na webu, který barvu používá, a nech ho na Free.

Do této dávky **nepatří** překlad názvů voleb rozšíření v úpravě vzhledu obchodu. To je odložené (viz níž).

## Úkol 9 — Vyzkoušet košík se scénáři (dávka F, bod 16)

Podle plánu třetího kola: předpřipravené scénáře kombinací slev jako hlavní cesta, ruční košík jako druhá možnost. Počet upozornění vidí i Free, detail (které a proč) je Pro. Scénáře mají pokrýt i Milníky (dárek a doprava) a částky podle trhu.

---

## Odložené — nedělej, jen o nich věz

Jsou zapsané ve Second Brain, nezakládej je znovu:

| Úkol v SB | Co to je | Proč čeká |
|---|---|---|
| `won-discounts-overeni-po-nasazeni` | Ověření oprav naživo po nasazení, nové oprávnění ke čtení trhů | Nasazení a ověření dělá Ondřej |
| `won-discounts-billing-nazivo` | Platby za Pro naživo | Vyžaduje veřejnou distribuci aplikace, ta volba je nevratná |
| `won-discounts-pristup-k-objednavkam` | Přístup k objednávkám: kvóta výprodeje z objednávek, živé Přehledy, řádek na dlaždici Přehledy | Ondřej musí povolit chráněná data v Partner Dashboardu |
| `won-discounts-preklady-nastaveni-rozsireni` | České názvy voleb rozšíření v úpravě vzhledu obchodu | Ondřej: „zatím překlady neřešme“ |

Dlaždice Vzhled na úvodní stránce zůstává bez řádku stavu, zaniká v úkolu 8.

## Závěrečná zpráva

Krátce, česky, pro Ondřeje, v tomto pořadí:

1. Jedna věta, co je hotové.
2. Odrážky, co se změnilo, s odkazem na soubor.
3. Co naživo ověřené není a přesný příkaz nebo cesta v aplikaci, kterou to Ondřej ověří.
4. Co potřebuješ rozhodnout.

Dlouhý rozbor patří do souboru v `docs/won-discounts/`, do zprávy jen odkaz. Výsledky testů uváděj čísly z výstupu.
