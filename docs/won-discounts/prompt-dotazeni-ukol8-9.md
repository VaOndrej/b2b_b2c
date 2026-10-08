# Won Discounts — dotažení úkolů 8 a 9 (zadání pro novou inline session, stav k 8. 10. 2026)

## Chci mít

Úkoly 8 (Překlady, vzhled u modulů) a 9 (kontrola kombinací) jsou v `main` (`02f4adf` nebo novější) se zelenou bránou,
ale nejsou dotažené. Chci mít uzavřených **17 nálezů** níž, ve třech částech A → B → C. Další část nezačínej, dokud
předchozí není v `main` se zelenou bránou. Pracuješ **výhradně inline, bez subagentů**.

Pravidla práce, brána, důkazy, tvrdá omezení a formát závěrečné zprávy platí beze změny z původního zadání
[`prompt-ukol8-9.md`](prompt-ukol8-9.md). **Přečti ho celé jako první**, potom blok „CHECKPOINT“ a oddíl „Úkoly 8 a 9“
v [`../won-discounts-build-log.md`](../won-discounts-build-log.md) a [`navrh-preklady-a-vzhled.md`](navrh-preklady-a-vzhled.md).
Po každé kompakci kontextu přečti tohle zadání a checkpoint znovu; checkpoint přepisuj po každém uzavřeném nálezu.

## Je to v

- Repo `~/Development/WonCommerce/Apps/b2b_b2c`, aplikace `apps/won-discounts`, jádro `packages/core/src/discounts`.
- **Pracuj v hlavním adresáři na větvi `main`** (Ondřej to tak chce; běží nad ním `shopify app dev`, takže změny
  rozšíření jdou hned do dev obchodu). Začni `git status` a `git log origin/main..HEAD`. Když adresář není na čistém
  `main` shodném s `origin/main`, **nic neopravuj sám**, napiš Ondřejovi přesné příkazy a počkej.
- Starý pracovní adresář `../b2b_b2c-preklady` (větev `won-discounts-preklady`) je celý v `main`; nepoužívej ho.
- Kód, kterého se nálezy týkají: `app/lib/integration/combination-check.ts`, `combination-check.server.ts`,
  `looks.server.ts`, `translations.server.ts`, `app/components/looks/`, `app/components/model/looks.ts`,
  `packages/core/src/discounts/looks.ts`, `custom-look.ts`, `storefront-texts.ts`,
  `extensions/won-discounts-storefront/` (`blocks/`, `snippets/`, `assets/`).

## Část A — ověření naživo (bez ní nejsou úkoly 8 a 9 hotové)

Dev obchod, jen přes runbook (`apps/won-discounts/scripts/e2e/runbook/`), vždy nejdřív nanečisto, po doběhnutí `cleanup`
a `verify-clean` exit 0. Co najdeš rozbité, oprav a přidej test, který by to chytil.

1. **Texty podle jazyka na webu.** Rozšíření čte `app.metafields.won_discounts['tx_' + jazyk stránky]`. Ověř v obchodě,
   že změněný text se ukáže u tabulky, řádku na kartě, v košíku, v žebříčku Milníků (i při prvním vykreslení), u štítku
   výprodeje a u odpočtu kampaně, v jazyce stránky, a že jiný jazyk ukáže výchozí text. Když zápis s proměnným klíčem
   v Liquidu nefunguje, navrhni jiné čtení, změř ho a zapiš do `navrh-preklady-a-vzhled.md`.
2. **Vzhledy na webu.** Každý nový hotový vzhled (Milníky: Odškrtávací seznam, Jedna věta; Výprodej: Štítek s odpočtem,
   Pruh; Kampaň: Pruh, Karta) na Horizonu i Dawnu, 390 a 1440 px, včetně bliknutí nově dosaženého stupně a odpočtu
   u výprodeje s datem konce. Profily `rewards`, `rewards-pro`, `outlet`, `tiers`.
3. **Převod starého vzhledu.** Obchod s uloženým starým `storefront.custom` a `accent`: screenshot tabulky a žebříčku
   před převodem (commit `dd48a75`) a po něm musí být stejný.
4. **Svolení `read_locales`.** V Shopify adminu: tlačítko „Povolit čtení jazyků“, po udělení se seznam jazyků ukáže
   bez ručního načtení stránky. Když ne, oprav (`TranslationsScreen.tsx`, `webhooks.app.scopes_update.tsx`).
5. **Zkoušky v prohlížeči.** `tests/e2e/support/tiers.ts` má v typu zrušené pole `texts`; projdi `tests/e2e/` a
   `tests/e2e-preview/`, oprav, co počítá se stránkou Vzhled nebo s texty v nastavení pro web, a pusť
   `npm run test:e2e:preview` proti běžícímu náhledu. Přidej do něj Překlady, sekci vzhledu a „Časté kombinace“.
6. **Klikání v aplikaci** (Playwright proti `/dev/preview/*` nebo naživo): přidat a odebrat jazyk, stáhnout a nahrát
   CSV s jedním odmítnutým řádkem, uložit vzhled každého prvku, otevřít scénář v ručním košíku.

## Část B — kontrola kombinací podle zadání

7. **Kdy se počítá.** Zadání chce výpočet po uložení jakékoli slevy a jednou denně; dnes se počítá při každém
   otevření Přehledu i Vyzkoušet košík. Ulož výsledek (počty a scénáře) při uložení nastavení a v denní úloze, stránky
   ho jen čtou. Změř čas načtení Přehledu před a po a zapiš ho.
8. **Skutečné produkty i bez Ochrany marže.** Bez zrcadla nákupních cen dnes kontrola počítá s ukázkovým produktem
   za 500. Navrhni, odkud vzít ceny bez dotazu při otevření stránky (čtení při uložení nebo v denní úloze), a zapiš
   počet dotazů do Shopify.
9. **Slevy cílené na produkty a kolekce.** Scénáře dnes berou jen množstevní slevu, slevy na objednávku, kód a Milníky.
   Přidej produkt, na který míří sleva na produkt nebo kolekci (odkazy z `ProductTargetIndex`).
10. **Trhy.** Scénář má běžet v každém zapnutém trhu, kde se výsledek může lišit, tedy i tam, kde má běžná sleva
    jinou minimální útratu, ne jen u žebříčku.
11. **Nejprodávanější produkt.** Zadání ho chce „z přehledů, když jsou“. Zjisti, jestli ho jde získat z uložených dat;
    když ne, napiš to na stránce nápovědy a do build logu, nevymýšlej ho.
12. **Odkaz u upozornění** má vést na konkrétní slevu nebo stupeň, který ho způsobil, ne jen na stránku modulu.
13. **„Pokladna slevy zkrátí“** nemá test se skutečným košíkem. Sestav košík, který náhled pokladny opravdu zkrátí.

## Část C — úklid kódu

14. **Vzhled tabulky** je uložený jinak (`storefront.appearancePreset`, `accent`, `custom`) než ostatní tři prvky
    (`storefront.looks.<prvek>`), `LookSection.tsx` má kvůli tomu řadu větví a tabulka se ukládá dvěma tlačítky.
    Sjednoť uložení i sekci; převod uložených dat s testem na skutečném tvaru a „načíst a uložit dá stejný výsledek“.
15. **Co Pro ztratilo.** Vlastní CSS dřív platilo i pro košík (`.won-cart`), řádek na kartě (`.won-card-tier`) a pruh
    nahoře (`.won-topbar`); teď je stylovat nejde. Doporučení: pátý prvek „Košík a pruh“ se stejnou sekcí vzhledu.
    Rozhodni, zapiš proč, a převod starého CSS rozšiř tak, aby pravidla pro tyto prvky nezmizela.
16. **Odpočet kampaně se ovládá dvakrát:** zaškrtávátkem bloku v úpravě vzhledu obchodu a hotovým vzhledem „Pruh“.
    Nech jedno místo.
17. **Drobnosti:** stupeň Milníků se v `combination-check.ts` pozná podle předpony `"ms-"`, použij sdílenou funkci
    z jádra; otevření scénáře (`?scenario=`) počítá kontrolu dvakrát; texty vzhledu mají klíče `appearance.*` a test se
    jmenuje `combination-appearance.test.ts`; hotové vzhledy přebíjejí základ zdvojenou třídou (`.won-ms.won-ms`),
    po ověření pořadí stylů na webu (bod 2) to zjednoduš; stránka v jazyce mimo cs / sk / en dřív ukázala
    obchodníkovu angličtinu, teď výchozí text rozšíření: rozhodni, zapiš a řekni to na stránce Překlady.

## Hotovo je, když

- **A:** v `docs/won-discounts/evidence/` jsou screenshoty Horizon + Dawn, 390 a 1440 px, pro body 1 až 3, výstup
  runbooku s počty prošlých testů a `verify-clean` exit 0; `test:e2e:preview` prošel a jeho počet testů vzrostl.
- **B:** každý z bodů 7 až 13 má test, který před změnou padal; test „otevření stránky nedělá dotaz do Shopify
  navíc“ dál prochází; test porovnání scénáře s `planCart` pokrývá i nové scénáře.
- **C:** `grep` nenajde `"ms-"` mimo jádro ani klíče `appearance.*`; převod (bod 14 a 15) má test na skutečném tvaru
  nastavení; web po převodu vypadá stejně (screenshot před a po).
- **Vše:** brána zelená (sedm příkazů z původního zadání, každý zvlášť), počty testů neklesly proti výchozímu stavu
  (`test:packages` 941 + 53, `test:unit` 1 857 + cargo 102 + vitest 699, guard 301), počet testů **na soubor**
  porovnaný před a po u každého souboru, který přepisuješ skriptem; `git log origin/main..HEAD` prázdný; build log,
  checkpoint a tabulka „Stav implementace“ v [`feedback-2026-10-06-kolo3-plan.md`](feedback-2026-10-06-kolo3-plan.md)
  aktuální; u každého bodu napsáno, co naživo ověřené není.

## Nesahej na

- Funkci v pokladně (`extensions/won-discounts-engine/src` ani její sestavení): `git diff origin/main --stat` nad ní
  musí zůstat prázdný.
- `shopify app deploy`, limity (velikost nastavení pro web, váha skriptů: stránka produktu 11 796 B z 12 288 B),
  produktová rozhodnutí v `rozhodnuti.md`.
- Cizí rozpracované soubory a odložené úkoly v Second Brain vyjmenované v původním zadání.
- Zápisy do dev obchodu mimo runbook.

Když něco z bodů nejde bez rozhodnutí Ondřeje (hlavně 8, 14 a 15), napiš možnosti s čísly do
`docs/won-discounts/`, vyber doporučenou, pokračuj dalším bodem a v závěrečné zprávě to uveď jako věc k rozhodnutí.
