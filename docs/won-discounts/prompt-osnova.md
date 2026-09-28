# Won Discounts — osnova promptu pro orchestrátora (návrh)

Návrh struktury. Samotný prompt se napíše, až osnovu odsouhlasíme.

## 1. Role a hranice

- Orchestrátor **řídí, nepíše většinu kódu.** Drží plán, rozděluje práci subagentům,
  kontroluje jejich výstup proti specu a pouští brány.
- Zdroj pravdy produktu: `docs/won-discounts-mvp-plan.md` (vznikne z `rozhodnuti.md`).
  Orchestrátor produkt **nemění**. Když prototyp vyvrátí rozhodnutí, zastaví se a zeptá.
- Práce přímo na `main`, commit + push po každém MVP se zelenou bránou. **Nikdy `shopify app deploy`.**
- Zápis jen do dev storu `b2b-b2c-store-development`. Žádný jiný store.

## 2. Předpoklady (udělá Ondřej před spuštěním)

Poučení z Won Toasts: autonomní běh tam nedokázal pustit živé E2E, protože nebyl aktivní embed.

- Shopify CLI přihlášené, `npm run config:link -w won-discounts` (interaktivní, vytvoří appku).
- `.env` s `SHOPIFY_ADMIN_API_TOKEN` pro seed a dev store.
- Heslo dev storu pro Playwright.
- Porty: žádný jiný `theme dev` / `app dev` neběží.

Orchestrátor si předpoklady na začátku ověří a chybějící vypíše jako přesné příkazy.

## 3. Povinná četba před prací

`AGENTS.md`, `CLAUDE.md`, `docs/nova-aplikace.md`, `docs/won-app-design-doctrine.md`,
`docs/won-toasts-mvp-plan.md` (vzor hloubky), `apps/won-toasts/` (vzor kódu a testů),
`@won/core/discount` + `margin`, karty Tiers / Rewards / Outlet / MarginGuard v roadmapě.

## 4. MVP žebřík (návrh pořadí)

| MVP | Obsah | Proč v tomhle pořadí |
|---|---|---|
| 0 | Klon templatu, config, **prototypy rizik** (25 funkcí → konsolidace, unikátnost kódu, věrný náhled v iframe, kód v košíku na Horizon/Dawn, dárek $0 v pokladně, počítání výprodeje z webhooků) | Rizika před stavbou; výsledek může změnit spec |
| 1 | Engine (kombinace, přednost, vysvětlení) + Slevy a kódy + detekce a přesun nativních slev + Vyzkoušet košík | Všechno ostatní stojí na enginu a „všechny slevy přes Won“ |
| 2 | Ochrana marže | Pojistka musí existovat dřív, než přibudou další slevy |
| 3 | Množstevní slevy + PDP blok + základ storefrontu (embed, předpřipravené vzhledy) | První viditelná plocha |
| 4 | Odměny (doprava, dárek, žebřík, prahy per trh) + košík (bar, dárek, kód + varování) | Nejsložitější storefront |
| 5 | Výprodej (Pro) | Jediný zápis do katalogu, samostatný |
| 6 | Kampaně (Pro) | Seskupuje hotové moduly |
| 7 | Onboarding na 3 minuty, Pro vlastní vzhled + AI návod, analytika, billing, BETA ceny na kartách, support docs, BFS kontrola | Dotažení do „Shipped“ (nenasazeno) |

Onboarding a Přehled rostou s každým MVP, MVP 7 je jen dotahuje.

## 5. Smyčka každého MVP

1. Plán MVP (skill `writing-plans`) → `docs/plans/<datum>-won-discounts-mvp<N>.md`.
2. Testy červené první (core `node:test`, contract, E2E spec podle specu, ne podle kódu).
3. Implementace subagenty paralelně po nezávislých částech (core / function / admin / storefront).
4. Brána: `test:packages`, `test:unit -w won-discounts`, `typecheck`, `lint`, `build`,
   `validate:shopify`, `guard:test:core` (b2b-companion nesmí zčervenat).
5. **Živé E2E Horizon + Dawn bez `--bail`**, embed zapnutý přes overlay testovacího tématu.
   „Pending live“ se nepřijímá.
6. Vizuální QA (`won-visual-qa`): 390 px + 1440 px, admin i storefront, porovnání s náhledem.
7. Nezávislá kontrola subagentem `won-auditor` → oprava nálezů.
8. Self-audit (AGENTS.md), roadmap sync, zápis do `docs/won-discounts-build-log.md`, commit.

## 6. Subagenti

- Stávající: `shopify-functions-dev`, `won-test-runner`, `won-auditor`.
- Per MVP podle potřeby: core engine, admin UI (Polaris), storefront (theme app extension),
  E2E / vizuální QA.
- Každý subagent dostane: úsek specu, soubory, které smí měnit, bránu, kterou musí projít,
  a formát výstupu (co udělal, důkaz, co neověřil).

## 7. Stav a pokračování

- `docs/won-discounts-build-log.md` = jediný stav běhu (hotová MVP, rozhodnutí, parkované
  otázky). Po kompakci kontextu nebo nové session orchestrátor začne čtením logu.

## 8. Kdy se zastavit a zeptat (autonomie: úplná, bez checkpointu po MVP 0)

- Prototyp vyvrátí rozhodnutí ze specu **a selže i předem schválený fallback** (mezery.md C).
- Chybí předpoklad, který orchestrátor neumí zajistit (přihlášení, token).
- Stejná brána selže 3× po sobě se stejnou příčinou.
- Cokoliv mimo dev store nebo mimo `apps/won-discounts` + sdílené `packages/`.

## 9. Definice hotovo

- MVP 0–7 zelené na bráně i živém E2E na obou tématech.
- Screenshoty ke každé ploše, roadmapa odpovídá realitě, build log kompletní.
- Závěrečný report: hotové a ověřené / hotové neověřené / vědomé kompromisy.
