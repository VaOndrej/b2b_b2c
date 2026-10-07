# Won Discounts — úkol 7: Milníky (zadání pro novou session, 7. 10. 2026)

## Kdo jsi a co je cíl

Jsi vývojář Shopify aplikace `won-discounts`. Máš přestavět stránku **Odměny** na **Milníky**: jeden žebříček stupňů podle hodnoty košíku, v aplikaci i na webu. Je to dávka D třetího kola feedbacku (body 9 a 10). Majitel aplikace (Ondřej) není u počítače. Co je rozhodnuté, je níž; kde ti něco chybí, rozhodni sám, zapiš to do build logu a pokračuj. Ptej se jen před nevratným krokem mimo tento seznam.

Pracuješ **výhradně inline, bez subagentů**. Je to jeden úkol na jednu session. Úkoly 8 (Překlady) a 9 (scénáře košíku) do ní nepatří.

## Kde to je

- Repo: `~/Development/WonCommerce/Apps/b2b_b2c` (monorepo). Aplikace `apps/won-discounts`, sdílené jádro `packages/core/src/discounts`.
- `main` je pushnutý; poslední commit s kódem je `cdc9f64`, po něm už jen tohle zadání. Udělej si z `main` novou větev, například `won-discounts-milniky`.
- Stav běhu: `docs/won-discounts-build-log.md`, oddíl „Aktuální stav“. **Začni tím, že ho přečteš**, a po každé kompakci kontextu znovu.
- Dev náhled bez přihlášení: `http://localhost:<port>/dev/preview/<obrazovka>`. Port zjistíš:

```
for p in $(lsof -iTCP -sTCP:LISTEN -P | grep node | awk '{print $9}' | sed 's/.*://' | sort -u); do
  [ "$(curl -s -m 5 "http://localhost:$p/dev/preview/overview?state=modules" | grep -c data-won-tile)" -gt 0 ] && echo $p
done
```

  Dev servery sám nespouštěj ani nerestartuj. Když náhled neběží, udělej screenshoty ze staticky vykreslených stránek (viz „Důkazy“).
- Seznam obrazovek a stavů náhledu je v komentáři na začátku `apps/won-discounts/app/routes/dev.preview.$.tsx`.

## Co si přečti, než začneš

1. `docs/won-discounts-build-log.md` — „Aktuální stav“ (úkoly 1 až 6 ze 7. 10.).
2. `docs/won-discounts/feedback-2026-10-06-kolo3-plan.md` — kapitoly 9 a 10, „Rozhodnuto 6. 10. 2026“ a tabulka „Stav implementace“.
3. `docs/won-discounts/prompt-kolo3.md` — původní zadání třetího kola (dávka D).
4. `docs/won-discounts/navrh-castky-podle-trhu.md` — jak se dnes ukládají částky. Milníky na tom stojí.
5. `docs/won-discounts/rozhodnuti.md` — produktová rozhodnutí, neměň je.
6. `docs/won-app-design-doctrine.md`, oddíly §16 až §19.
7. Kód dnešní stránky: `app/components/screens/RewardsScreen.tsx`, `app/components/model/rewards.ts`, `app/lib/integration/rewards.server.ts`; jádro `packages/core/src/discounts/rewards.ts`, `plan-rewards.ts`, `plan-gate.ts`.

## Co je rozhodnuto

- Název je **Milníky** / **Milestones**. Adresa `/app/rewards` zůstává.
- Odměna u stupně je jedna z: **dárek zdarma** (výběr varianty, v Pro až 3 na výběr), **doprava zdarma**, **sleva na celou objednávku** (procenta nebo částka). Sleva na produkty nebo kolekci v první verzi není.
- Limity: **Free 2 stupně, Pro 6**.
- „Co se počítá do hodnoty košíku“ (před slevami, nebo po nich) zůstává jedno nastavení pro celý žebříček.
- Doprava zdarma jde jako typ stupně vybrat jen jednou.
- Uložené odměny se stanou stupni automaticky a nic se neztratí. Převod má test.

## Tvrdé omezení: funkce v pokladně se nesmí zvětšit

Slevová funkce (`extensions/won-discounts-engine`, Rust) má po úkolu 6 **255 677 B z 256 000 B (zbývá 323 B)** a rezervu instrukcí asi **0,05 bodu**. Do funkce proto **nesahej**.

- Dárek a doprava zdarma: pokladna je umí, mění se jen formulář a případně tvar nastavení.
- **Sleva z objednávky jako stupeň:** postav ji z toho, co pokladna umí dnes, tedy z automatické slevy na objednávku s minimální útratou v `modules.codes.rules`. Navrhovaná cesta: pravidla, která patří Milníkům, poznáš podle předpony id (například `ms-`), stránka Milníky je vlastní a stránka „Slevy a kódy“ je neukazuje jako běžné slevy (nebo je ukáže jen jako odkaz na Milníky). Když najdeš lepší cestu bez zásahu do funkce, použij ji a zapiš proč.
- Ověř testem proti referenčnímu výpočtu (`planCart`) a fixtures funkce: dva stupně se slevou (5 % od 1 000 Kč, 10 % od 2 000 Kč) → platí jen vyšší; práh slevy se počítá stejně jako práh dárku (pozor na `minimum.scope` a na „před slevami / po slevách“); chování se slevovým kódem a s ochranou marže. Kde se chování liší od dárku, řekni to obchodníkovi větou u stupně.
- Kdyby ses bez zásahu do funkce neobešel, **zastav se**, zapiš čísla a možnosti do `docs/won-discounts/` a dodej Milníky bez slevy z objednávky.

## Částky jsou podle trhu

Od úkolu 6 má každý trh vlastní částku, i když sdílí měnu s jiným trhem.

- Aplikace pracuje s jedním sloupcem na trh: `currencyViews()` a `enabledCurrencies()` v `app/components/model/markets.ts` vrací klíče sloupců (`CZK`, a kde dva zapnuté trhy sdílejí měnu, `EUR@sk` a `EUR@de`). `loadConfig` částky do sloupců rozbalí, uložení je sbalí (`packages/core/src/discounts/market-amounts.ts`). Pole pojmenuj podle trhu: „Slovensko (EUR)“.
- V textech nikdy neukazuj klíč. `{currency}` v překladech se zobrazí jako měna samo; pro přípony polí použij `amountKeyCurrency()`; pro souhrnné věty předej jádru názvy trhů (`amountLabels()`).
- Dev náhled se dvěma trhy v eurech: `?markets=shared` (dnes u `tiers`, `rewards`, `settings`). Milníky v něm musí fungovat.
- Přepínač v Nastavení „Zákazník ze země mimo vaše trhy“ (`engine.unknownMarketLowest`) se Milníků týká také: prahy stupňů jdou stejnou cestou jako ostatní částky, nic navíc nestav, jen to ověř testem.

## Co má být hotové

### A. Stránka Milníky (bod 9)

1. **Jeden žebříček stupňů** seřazený podle částky v měně obchodu. Stupeň = částka pro každý trh + typ odměny + její nastavení.
2. **Částky v tabulce:** řádek = stupeň, sloupec = trh. Obchodník vyplní sloupec měny obchodu a tlačítko **„Navrhnout ostatní trhy“** doplní zbytek k potvrzení: z ručního kurzu trhu (`readAmountSuggest` → `marketRates`, pak kurz měny), jinak řekne, že kurz není. Nic se neuloží bez potvrzení. Na 390 px se tabulka nesmí posouvat do strany: sloupce se skládají pod sebe.
3. **Náhled žebříčku** nahoře tak, jak ho uvidí zákazník; mění se s každou úpravou.
4. **Limity** Free 2 / Pro 6: v rozhraní i na serveru (`plan-gate.ts`). Uložené stupně nad limit zůstávají vidět a jdou odebrat, jen neplatí (§14a, §16).
5. **Po uložení** řekni, co zákazník uvidí a co ještě chybí, s tlačítkem (dnes sekce „Co dál“ v `RewardsScreen.tsx`).
6. **Chybějící trh** je věc k vyřešení na dlaždici, v seznamu „Vyžaduje pozornost“ na úvodní stránce i v přehledu trhů v Nastavení (dnes `rewardsOverviewOf`, `rewardsStatus`, `model/markets-overview.ts`).
7. **Průvodce prvním nastavením** dnes při cíli „Doprava zdarma nebo dárek“ vede na `/app/rewards?start=shipping#shipping` (`REWARDS_FIRST_HREF` v `OnboardingScreen.tsx`). Má vést na první stupeň Milníků s předvyplněnou částkou.
8. **Přejmenování:** dlaždice na úvodní stránce, podmenu, nadpis stránky, texty stavů a dokumentace z „Odměny“ na „Milníky“. Po změně textů stavů a voleb přegeneruj dokumentaci: `npm run docs:gen -w won-discounts`.
9. Výjimky z úkolu 5 a návrh částky z úkolu 3 jsou hotové vzory: úrovně jako očíslované karty, chyby až po pokusu, návrh ve vlastním rámečku (`TierSetEditor.tsx`, `ProTierSets.tsx`, `shell/AmountSuggestions.tsx`).

### B. Milníky na webu (bod 10)

1. Jedna komponenta žebříčku ve třech velikostech: **pruh** (jedna věta a tenký ukazatel, pruh nahoře na webu), **kompaktní** (ukazatel se značkami stupňů a věta o nejbližším; stránka produktu, boční košík), **plná** (všechny stupně s názvem odměny, splněné odškrtnuté; stránka košíku).
2. Ukazuje všechny tři typy odměn, tedy i stupně se slevou z objednávky. Aktualizuje se po změně košíku bez načtení stránky.
3. Dnešní stav: blok `rewards_progress.liquid`, snippet `won-progress.liquid`, pruh nahoře v `won_discounts_embed.liquid`, blok `cart_rewards`, skripty `won-discounts.js`, `won-discounts-cart.js`, `won-discounts-blocks.js`. Data pro web staví `packages/core/src/discounts/storefront-config.ts`.
4. Částky čti podle trhu zákazníka: klíč `měna@trh` z `localization.market.handle`, pak klíč měny; záporná hodnota znamená „v tomto trhu se nenabízí“ (vzor je v `won-progress.liquid` a ve funkci `plan` v `won-discounts.js`).
5. Na stránce Milníky sekce „Kde je to vidět na webu“: čtyři umístění, každé se štítkem a tlačítkem (vzor `StorefrontPlacements`).
6. Vzhled žebříčku (styl ukazatele, vlastní CSS) patří do úkolu 8. Teď použij jeden výchozí vzhled a barvu zvýraznění `--won-tiers-accent`.
7. Hlídej limity skriptů: `tests/contracts/perf-budget.contract.test.ts` (stránka produktu má 10 800 B z 12 288 B po kompresi). Čísla před a po zapiš.

## Pravidla práce

- **Cizí rozpracované soubory nech být:** `apps/won-discounts/DEPLOY.md`, `apps/won-discounts/railway.json`, `apps/won-toasts/railway.json`, `docs/product-roadmap.html`, `docs/railway-hosting.md`, `docs/won-companion/`, `docs/won-discounts/paralelizace.md`. Nikdy `git add .`, `git add -A` ani `git add apps/won-discounts`. Přidávej konkrétní složky a před commitem zkontroluj `git status --short`.
- **Žádný prettier ani jiný formátovač.** Před commitem se podívej na `git diff --stat`.
- **React 18 a pole Shopify (`s-*`):** funguje jen `onClick`. Změny čti nativními událostmi `input` / `change` na formuláři. Neměň atributy pole (`value`, `error`), zatímco do něj obchodník píše; hlášky kresli vedle pole.
- **V inline stylech nemíchej zkrácený a plný zápis téže vlastnosti** (`border` spolu s `borderColor`).
- **Server je autorita:** každé omezení v rozhraní má stejnou kontrolu na serveru.
- **Texty česky i anglicky:** každý nový klíč do `app/i18n/cs.ts` i `en.ts`. Obchodníkovi se vyká. Krátké konkrétní věty. Žádný žargon: „téma“, „editor tématu“, „blok“, „synchronizace“, „práh“, „recept“, „cílení“, „strop slevy“. Slovníček náhrad je v `docs/won-discounts/audit-dlazdice-trhy-2026-10-06.md`, kapitola 6.
- **Štítek „Pro“** je na dlaždici Pro části vidět na každém tarifu.
- **Rozšíření za běhu `shopify app dev`:** každá změna v `extensions/` se hned nahraje do dev obchodu. Po změnách ověř, že se soubory na webu načítají: `node apps/won-discounts/scripts/check-storefront-assets.mjs the-inventory-not-tracked-snowboard` (exit 0). Když hlásí chybějící soubory, napiš Ondřejovi, ať dev server restartuje.
- **Zápisy do dev obchodu:** Ondřej 7. 10. povolil zkoušky na Horizonu a Dawnu přes runbook (`scripts/e2e/runbook/`). Vždy nejdřív dry-run, podívej se, co přepíše, pak naostro; po doběhnutí musí být obchod vrácený ze zálohy (`cleanup`, `verify-clean` exit 0). Jiné zápisy do Shopify bez svolení nedělej. `shopify app deploy` nepouštěj.
- **Slučování:** po zelené bráně posuň `main` bez slučovacího commitu a pushni (`git push origin HEAD:main`, pak `git fetch . HEAD:main`). Žádný `--force`.
- **Second Brain:** `node /Users/ondrej/Development/second-brain/src/cli.mjs list`. Práce patří k úkolu `won-discounts-kolo3`. Po dokončení tam zapiš poznámku (`note-add won-discounts-kolo3 "…" --no-llm`; nepiš do ní data ve tvaru „7. 10.“, nástroj je čte jako připomínku).

### Brána (před každým commitem do `main`)

Z kořene repa, všechno musí skončit s kódem 0:

```
npm run test:packages
npm run test:unit -w won-discounts
npm run typecheck -w won-discounts
npm run lint -w won-discounts
npm run build -w won-discounts
npm run guard:test:core
npm run validate:shopify
```

Výchozí stav 7. 10. (kód `cdc9f64`): `test:unit` 1 766 + cargo 101 + vitest 643, `test:packages` 912 + 53, guard 301, lint 0 chyb a 6 starších varování, `validate:shopify` 0 nálezů.

### Důkazy (bez nich úkol není hotový)

- **Aplikace:** screenshoty 390 px a 1440 px každého nového stavu, bez vodorovného posuvu. Ukládej do `~/Development/WonCommerce/Apps/.playwright-mcp/milniky/`. Když dev náhled běží, vzor je `~/Development/WonCommerce/Apps/.playwright-mcp/audit-fix-shots.mjs`. Když neběží: `npx tsx apps/won-discounts/scripts/static-preview.ts <složka> <název>=<obrazovka?dotaz>` a potom `node ~/Development/WonCommerce/Apps/.playwright-mcp/dotazeni-static-shots.mjs <složka> <výstup> [název:panel]`.
- **Logika:** výstup testu s čísly, ne tvrzení.
- **Web:** všechna čtyři umístění na Horizonu i Dawnu, 390 a 1440 px, a zkouška průchodu stupni (rozšiř `tests/e2e/storefront.rewards.spec.ts`, profily `rewards` a `rewards-pro`). Zkouška má volat `assertExtensionAssetsLoaded` z `@won/testing/playwright`.
- **Pokladna:** parita s referenčním výpočtem na všech fixtures (`npm test -w won-discounts-engine`), i když se funkce nemění: scénáře pro stupně se slevou přidej do `tests/scenarios.js` a přegeneruj `npm run fixtures -w won-discounts-engine`.
- U každé části napiš, co jsi naživo neověřil.

Po každé části zapiš stav do build logu a do tabulky „Stav implementace“ v plánu třetího kola.

## Hotovo, když

1. Stránka Milníky ukládá a načítá všechny tři typy odměn, limity platí v rozhraní i na serveru a uložené odměny z doby před přestavbou se načtou jako stupně beze ztráty (test na skutečných tvarech nastavení).
2. Tabulka stupeň × trh funguje se dvěma trhy stejné měny a na 390 px se neposouvá do strany.
3. Žebříček je na webu ve třech velikostech na čtyřech místech, na Horizonu i Dawnu, a sleduje košík bez načtení stránky.
4. Funkce v pokladně má stejnou velikost jako před úkolem a parita s referenčním výpočtem drží.
5. Brána je zelená, `main` je pushnutý, build log a plán jsou aktuální.

## Mimo rozsah

- Úkol 8 (Překlady a přesun Vzhledu k modulům) a úkol 9 (Vyzkoušet košík se scénáři).
- Odložené v Second Brain, nezakládej je znovu: `won-discounts-overeni-po-nasazeni`, `won-discounts-billing-nazivo`, `won-discounts-pristup-k-objednavkam`, `won-discounts-preklady-nastaveni-rozsireni`.
- Nasazení (`shopify app deploy`) dělá Ondřej.

## Závěrečná zpráva

Krátce, česky, pro Ondřeje, v tomto pořadí:

1. Jedna věta, co je hotové.
2. Odrážky, co se změnilo, s odkazem na soubor.
3. Co naživo ověřené není a přesný příkaz nebo cesta v aplikaci, kterou to Ondřej ověří.
4. Co potřebuješ rozhodnout.

Dlouhý rozbor patří do souboru v `docs/won-discounts/`, do zprávy jen odkaz. Výsledky testů uváděj čísly z výstupu.
