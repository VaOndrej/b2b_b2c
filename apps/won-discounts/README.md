# Won Discounts

Slevová appka pro Shopify: pravidla slev v jedné funkci (`extensions/won-discounts-engine`, Rust), admin
v React Router 7 s Polaris web komponentami (`s-*`) a App Bridge. Doktrína adminu je v
[`docs/ADMIN-UX-PRINCIPLES.md`](docs/ADMIN-UX-PRINCIPLES.md).

## Mapa frontendu

Každá položka menu a záložka pod „Slevy“. Cesty jsou od `app/`, testy od `tests/`. Harness ukáže obrazovku bez
Shopify na `/dev/preview/<harness>`. Že každá cesta v tabulce existuje, hlídá `tests/ui/readme-map.test.ts`.

<!-- map:start -->
| Obrazovka | Kódové jméno | Route | Obrazovka a části | Model | Integrace | Testy |
|---|---|---|---|---|---|---|
| Přehled | `overview` | `routes/app._index.tsx` | `components/screens/OverviewScreen.tsx` | `components/model/module-status.ts`, `components/model/signals.ts` | `lib/integration/pages.server.ts` | `ui/overview-model.test.ts`, `integration/overview.test.ts` |
| Onboarding | `onboarding` | `routes/app.onboarding.tsx` | `components/screens/OnboardingScreen.tsx` | `components/model/rule-form.ts` | `lib/integration/pages.server.ts` | `integration/overview.test.ts` |
| Slevy a kódy | `discounts` | `routes/app.discounts._index.tsx` | `components/screens/DiscountsScreen.tsx`, `components/RuleTable.tsx`, `components/MoveDialog.tsx` | `components/model/rule-status.ts`, `components/model/rule-table.ts` | `lib/integration/pages.server.ts`, `lib/integration/native.server.ts` | `ui/rule-status.test.ts`, `ui/rule-table.test.ts`, `integration/native-move.test.ts` |
| Editor slevy | `rule-editor` | `routes/app.discounts.$id.tsx` | `components/screens/RuleEditorScreen.tsx`, `components/rule-editor/` | `components/model/rule-form.ts`, `components/model/describe.ts` | `lib/integration/pages.server.ts` | `ui/rule-form.test.ts`, `ui/describe.test.ts`, `integration/rule-save.test.ts` |
| Množstevní slevy | `tiers` | `routes/app.tiers.tsx` | `components/screens/TiersScreen.tsx`, `components/tiers/` | `components/model/tiers.ts` | `lib/integration/tiers.server.ts` | `ui/tiers.test.ts`, `ui/tier-exceptions.test.ts`, `integration/tiers.test.ts` |
| Milníky | `rewards` / `milestones` | `routes/app.rewards.tsx` | `components/screens/MilestonesScreen.tsx`, `components/rewards/` | `components/model/milestones.ts` | `lib/integration/rewards.server.ts` | `ui/rewards.test.ts`, `integration/rewards.test.ts` |
| Výprodej | `outlet` | `routes/app.outlet.tsx` | `components/screens/OutletScreen.tsx` | `components/model/outlet.ts`, `components/model/outlet-web.ts` | `lib/integration/outlet-admin.server.ts` | `ui/outlet-web-line.test.ts`, `integration/outlet-admin.test.ts` |
| Kampaně | `campaigns` | `routes/app.campaigns.tsx` | `components/screens/CampaignsScreen.tsx` | `components/model/campaigns.ts` | `lib/integration/campaigns-admin.server.ts` | `integration/campaigns-admin.test.ts` |
| Umístění na webu | `placements` | `routes/app.placements.tsx` | `components/screens/PlacementsScreen.tsx` | `components/model/placements.ts` | `lib/integration/placements.server.ts` | `integration/placements.test.ts`, `e2e-preview/admin.placements-guide.spec.ts` |
| Ochrana marže | `margin` | `routes/app.margin.tsx` | `components/screens/MarginScreen.tsx`, `components/margin/` | `components/model/margin.ts` | `lib/integration/margin.server.ts` | `ui/margin.test.ts`, `integration/margin.test.ts` |
| Vyzkoušet košík | `try-cart` | `routes/app.try-cart.tsx` | `components/screens/TryCartScreen.tsx`, `components/try-cart/` | `components/model/try-cart-form.ts` | `lib/integration/try-cart.server.ts` | `ui/try-cart-form.test.ts`, `ui/try-cart-combinations.test.ts`, `integration/try-cart.test.ts` |
| Přehledy | `analytics` | `routes/app.analytics.tsx` | `components/screens/AnalyticsScreen.tsx` | `components/model/analytics.ts` | `lib/integration/analytics-admin.server.ts` | `lib/analytics/analytics.test.ts` |
| Překlady | `translations` | `routes/app.translations.tsx` | `components/screens/TranslationsScreen.tsx` | `components/model/translations.ts` | `lib/integration/translations.server.ts` | `ui/translations.test.ts`, `integration/translations.test.ts` |
| Nastavení | `settings` | `routes/app.settings.tsx` | `components/screens/SettingsScreen.tsx` | `components/model/combination.ts`, `components/model/markets-overview.ts` | `lib/integration/settings.server.ts` | `integration/settings.test.ts` |
| Tarif | `plan` | `routes/app.plan.tsx` | `components/screens/PlanScreen.tsx` | `components/model/plan.ts` | `lib/integration/plan-admin.server.ts` | `integration/plan-admin.test.ts` |
| Sčítá se s | `combine` | `routes/app.combine.tsx` (jen akce) | `components/shell/ModuleCombine.tsx`, `components/shell/CombineTypes.tsx` | `components/model/combine.ts` | `lib/integration/combine.server.ts` | `integration/module-combine.test.ts`, `ui/combination-switches.test.ts` |
| Vzhled prvků | `looks` | `routes/app.looks.tsx` (jen akce) | `components/looks/` | `components/model/looks.ts` | `lib/integration/looks.server.ts` | `ui/looks.test.ts`, `integration/looks.test.ts` |
<!-- map:end -->

Napříč obrazovkami: menu a záložky `components/model/modules.ts` + `components/shell/SubNav.tsx` (`ui/nav.test.ts`),
PageGuide `components/model/page-guides.ts` + `components/shell/PageGuide.tsx` (`ui/page-guide.test.ts`), harness
`routes/dev.preview.$.tsx` (`ui/harness-screens.test.ts`, `e2e-preview/`), texty `i18n/cs.ts` a `i18n/en.ts` (`ui/i18n.test.ts`).
Dlaždice a stav na Přehledu i modulech `ui/tiles.test.ts`, trhy napříč obrazovkami `ui/markets-and-tiles.test.ts`, stejné věci
stejně na všech obrazovkách `ui/screen-consistency.test.ts`, kliknutí na stránkách modulů `e2e-preview/admin.module-pages.spec.ts`
a `e2e-preview/admin.views.spec.ts`.

### Shell: odkud se skládá vzhled

Obrazovky skládají tyto kusy a barvy berou jen z `components/shell/tokens.ts` (lint hlídá hex mimo shell):

| Kus | Soubor | Kdy |
|---|---|---|
| Sekce se stavem | `components/shell/WonSection.tsx` (`WonSection`, `WonRow` řádek s akcí, `RowNote`) | každý blok stránky, řádek seznamu |
| Štítek stavu | `components/shell/StatusBadge.tsx` (mapování `components/model/status-badge.ts`) | Aktivní, Vyžaduje pozornost, Neuplatní se, Vypnuto, Naplánováno, umístění |
| Karta, volba, dva sloupce | `components/shell/Surface.tsx` (`Card`, `selectableStyle`, `TwoColumns`) | box obsahu, vybraná věc, nastavení s náhledem; výjimky vlastního vizuálu jsou vypsané v hlavičce |
| Poznámka Pro | `components/shell/ProSell.tsx`, štítek `components/shell/PlanBadge.tsx` | jedna zmínka Pro na sekci |
| Dlaždice | `components/shell/ModuleTile.tsx` | Přehled a pohledy stránek modulů |
| Jedno uložení | `components/shell/one-save.tsx` (model `components/model/one-save.ts`) | formulář se Save Barem a části s vlastní akcí |

## Glosář: jeden pojem, víc jmen

Soubory se nepřejmenovávají, tabulka říká, které jméno patří k čemu.

| Česky v adminu | V kódu |
|---|---|
| Milníky | route a složka `rewards` (`app.rewards.tsx`, `components/rewards/`), obrazovka a model `milestones` |
| Výprodej | `outlet` |
| Množstevní slevy | `tiers` |
| Sčítá se s | `combine` (route, `ModuleCombine`, `CombineTypes`), `combination` (nastavení obchodu v `model/combination.ts`) |
| Vzhled prvků | `looks` (akce, složka), `appearance` (stará route, jen přesměruje) |
| Slevy a kódy | `discounts`, jedna sleva = `rule` (`RuleEditorScreen`, `rule-form`, `rule-status`) |
| Kampaně | `campaigns` |

## Vrstvy

```
routes/app.*.tsx               loader/action, autentizace, předání do integrace (20–70 ř.)
lib/integration/*.server.ts    hranice backendu: čtení a zápisy do Shopify a DB
components/screens/            rozvržení stránky, skládá shell a části
components/<část>/             sekce obrazovky (rule-editor/, tiers/, margin/, looks/, rewards/, try-cart/)
components/shell/              sdílené prvky: WonSection, ModuleTile, SubNav, PageGuide, tokens.ts
components/model/              čisté funkce: stav, popis, formuláře (unit testy v tests/ui/)
```

**Hranice backendu:** `lib/integration/**`, `lib/**/*.server.ts`, Prisma, `extensions/`, webhooky a tvar dat
odesílaných do akcí se při úpravách frontendu nemění. Routa smí měnit jen to, co skládá formulář a vykresluje.

## Won Discounts: build, dev a testy

Slevová funkce (`extensions/won-discounts-engine`) je v Rustu, detaily v jejím
[`README.md`](extensions/won-discounts-engine/README.md). Rust je nainstalovaný
přes rustup mimo výchozí PATH, skripty si `~/.cargo/bin` přidají samy.

- `npm run dev`: `shopify app dev` s cargo na PATH, funkce se při změně přestaví.
- `npm run build`: jen appka (react-router). CI (`build:apps`) Rust nepotřebuje.
- `npm run build:functions`: jen slevová funkce (cargo, pak trampoline CLI).
- `npm run build:all`: funkce, pak appka.
- `shopify app deploy` si funkci staví sám, takže taky potřebuje cargo na PATH:
  `PATH="$HOME/.cargo/bin:$PATH" npx shopify app deploy`.
- `npm run test:unit`: node testy a testy funkce (cargo test, pak vitest). Potřebuje
  Rust s cílem `wasm32-unknown-unknown`. CI testy funkce nespouští.

## Storefront extension: pravidla napříč theme

Theme app extension v `extensions/*` se drží cross-theme pravidel z
[`docs/nova-aplikace.md` §8](../../docs/nova-aplikace.md) — jinak to spadne na
Dawn (nebo na variant morphu v Horizonu):

- Storefront JS reagující na variantu **rescanuj na `shopify:product:select`**
  (Horizon morphuje formulář in-place; `change`/MutationObserver to nechytí).
- Formulář hledej přes `input.form`, **ne** přes `ancestor::form` — Dawn váže
  input přes `form` atribut, ne vnořením.
- Asset servíruj **čitelně**, bez minifikace/buildu (je to malý soubor přímo
  z `assets/`).
- V E2E používej sdílené helpery `quantityForm` / `quantityStepper` z
  `@won/testing/playwright`, ne vlastní XPath předpokládající vnoření.
- Před shipnutím spusť matrix **bez `--bail`**, ať proběhne i Dawn leg.
