# Vytvoření nové aplikace z templatu

Kanonický postup pro novou Shopify appku v tomhle monorepu. Cíl: co nejvíc
znovupoužít sdílený základ (`@won/*`) a **nevytvářet nové věci, které už sdíleně
existují** — hlavně E2E témata a produkty.

## 0. Povinný brainstorming → rozpad na MVP (GATE)

**Žádná appka nezačne kódem (ani klonem) dřív, než projde tímhle gate.** Každá
appka: **brainstorming → rozpad na MVP**, sepsaný do `docs/<appka>-mvp-plan.md`
a odsouhlasený se zadavatelem. Vzorový výstup: [`won-toasts-mvp-plan.md`](won-toasts-mvp-plan.md).

### a) Brainstorming (divergentní, pak kritický) musí pokrýt

- **Produktové principy** (8–12) a **problémy zákazníka vs. merchanta** odděleně.
- **Config = jediný zdroj pravdy:** kompletní surface toho, co půjde měnit v
  Shopify adminu (žádné magic numbers v kódu; každá hodnota = pole s defaultem,
  validované, bezpečné i při neúplné/starší konfiguraci).
- **Datový model:** posoudit **rules engine (`Rule[]`) vs. plochý config** —
  u čehokoliv s eventy/pravidly preferovat verzovaný layered model
  (`global` / `theme` / `rules` / `locales` / `targeting`) s migracemi, ne stovky
  plochých polí.
- **Preview parity:** admin renderuje **tentýž** komponent/renderer jako
  storefront, krmený neuloženým stavem formuláře. U appek s vizuálním výstupem i
  **Scenario Lab** (realistické scénáře, ne jeden prvek).
- **Priorita & konflikty:** deterministické řešení, když nastane víc eventů
  naráz (pořadí, slučování, potlačení, souhrn, cooldown, stav milníků, per
  session/cart/customer).
- **Surface ≠ jen jeden UI prvek:** rozhodnout, kdy je vhodnější inline/banner/
  progress/žádná zpráva místo násilného zobrazení.
- **Tarify Free/Pro dělené podle _rozsahu_, ne kvality:** základní použitelnost,
  přístupnost, spolehlivost a základní design **nesmí být ve Free zmrzačené**.
- **Guardrails**, **kompatibilita/adapter vrstva**, **analytics lifecycle** (stabilní
  ID + měřitelný lifecycle už v modelu, sběr může přijít později).
- **Kritická analýza:** co zachovat / zjednodušit / odložit / odstranit. Nezaměňuj
  počet funkcí za kvalitu; slučuj duplicity; označ předpoklady a nejasnosti.

### b) Rozpad na MVP

Žebřík MVP0…N, kde **každá fáze** má: zákaznickou hodnotu · merchant hodnotu ·
technický rozsah · admin rozsah · preview rozsah · testovací scénáře (TDD
**červené první**) · **exit criteria**. Config je **verzovaný od MVP0**, aby nové
eventy/pravidla nešly proti breaking migracím. Badge appky v roadmapě postupuje
`Spec → Scaffold → Alpha → Beta → Shipped`.

### c) Standing goals (platí pro každou Won appku)

- **Shopify-native → Built for Shopify:** embedded (App Bridge latest + session
  tokens), Polaris, theme app extension (žádné ScriptTag/Asset API), managed
  billing, GDPR webhooky, perf budget. BFS je post-launch cíl; architektura ho
  nikdy nesmí blokovat.
- Gate každého MVP: `test:unit -w <appka> && typecheck && build && validate:shopify`.
- E2E minimálně na **Dawn + Horizon** přes `@won/testing/playwright`, vlastní
  markery, ne DOM tématu.

### d) Výstupy gate

1. `docs/<appka>-mvp-plan.md` (brainstorming + MVP žebřík + exit criteria).
2. Karta v [`product-roadmap.html`](product-roadmap.html) s badge a rozpadem.
3. Odsouhlasení zadavatelem → teprve pak pokračuj bodem 1 níž.

## 1. Naklonuj template

```bash
rsync -a \
  --exclude build --exclude .react-router --exclude .env \
  --exclude app/generated --exclude .shopify --exclude node_modules \
  --exclude test-results \
  apps/_template/ apps/<tvoje-appka>/
```

## 2. Pojmenuj + nainstaluj

- `name` v `apps/<tvoje-appka>/package.json` a `name` v `shopify.app.toml`.
- `npm install` z rootu (zaregistruje workspace, nalinkuje `@won/*`).

## 3. Databáze — funguje sama

Žádný ruční `.env` netřeba: `prisma:migrate:deploy` (a tím i `shopify app dev`)
si při prvním běhu sám vytvoří `prisma/.env` s lokálním SQLite fallbackem a
založí DB. Contract test to hlídá pro každou appku.

## 4. Napoj Shopify app

```bash
npm run config:link -w <tvoje-appka>   # vytvoří app v Partner org, vyplní client_id/URL
cp apps/<tvoje-appka>/.env.example apps/<tvoje-appka>/.env   # doplň jen co potřebuješ
```

## 5. Postav feature

- Čistá byznys logika → `packages/core/src/<doména>/` s `node:test` testy,
  konzumuj přes `@won/core/<doména>/…`.
- Routes → `apps/<tvoje-appka>/app/routes/`.
- Shopify Functions / extensions → `apps/<tvoje-appka>/extensions/*`.

## 6. E2E — sdílená témata a sdílené produkty (DŮLEŽITÉ)

Tady se **nic per-app nevytváří**, pokud to není nezbytně nutné.

### Témata: jedno sdílené Horizon + jedno Dawn

Používají se **sdílené kanonické checkouty** `b2b_b2c_themes/Horizon` a
`/Dawn` — stejné pro všechny appky. Runner je kopíruje do izolované
`tmp/e2e-themes/<app>/…` a servíruje lokální kopii, takže se appky navzájem
neovlivní.

- V `e2e.app.config.mjs` nech `remoteName: "Horizon"` / `"Dawn"` (žádná
  „<App> — Horizon" témata).
- Zapni **app embed své appky** v theme editoru na sdíleném Horizon i Dawn a ulož.
  Pak už není potřeba žádný per-app `settingsDataOverlay` — embed je v kanonickém
  tématu. (Overlay použij jen tehdy, když opravdu potřebuješ appce izolovaný stav
  tématu.)
- Pokud embed zapomeneš zapnout, test spadne na chybějícím
  `[data-won-quantity-embed]` — což je záměrná pojistka.

### Produkty: sdílený katalog `@won/testing/e2e-products`

Existuje **jeden sdílený set produktů** (`WON_E2E_PRODUCTS`), vytvořený ve storu
jednou a přeused všemi appkami. Jsou **read-only fixtures** — appka na ně jen
klíčuje svoje DB pravidla, nikdy je nemění, takže je bezpečné je sdílet.

**Nevytvářej nové produkty.** Namapuj role své appky na existující katalog:

```ts
import { WON_E2E_PRODUCTS } from "@won/testing/e2e-products";

const HANDLES = {
  simple: WON_E2E_PRODUCTS.simpleA.handle,        // 1 varianta
  variants: WON_E2E_PRODUCTS.twoVariants.handle,  // 2 varianty
  multiaxis: WON_E2E_PRODUCTS.multiAxis.handle,   // Size × Color (4)
} as const;
```

Katalog dnes obsahuje: `simpleA`, `simpleB` (1 varianta), `twoVariants` (2),
`multiAxis` (4), `spare` (rezerva).

**Když existující tvary nestačí:** produkt **enhancuj**, nezakládej nový handle,
pokud to nejde jinak. Uprav `packages/testing/src/e2e-products.js` (přidej
option/variantu k existujícímu produktu, nebo v krajním případě přidej nový
záznam) a znovu spusť seed — je **idempotentní** (`productSet` upsertuje podle
handle, takže re-run existující produkty jen doplní, neduplikuje):

```bash
SHOPIFY_ADMIN_API_TOKEN=<shpat_…> npm run seed:e2e-products
```

Token potřebuje `write_products` + publikaci na Online Store. Nikdy ho necommituj
(je jen v gitignored `.env`).

## 7. Ověř a spusť

```bash
npm run test:unit -w <tvoje-appka>
npm run typecheck -w <tvoje-appka>
npm run build -w <tvoje-appka>

# Terminál A                         # Terminál B
npm run dev -w <tvoje-appka>         npm run test:e2e:local:all -w <tvoje-appka> -- --bail
```

**Jednorázový prerekvizit pro browser E2E** (na každém novém stroji): stáhni
Playwright browsery **přes appkin vlastní playwright**, ať sedí revize
(headless režim potřebuje i `chromium-headless-shell`):

```bash
npm exec -w <tvoje-appka> -- playwright install chromium chromium-headless-shell
```

Statický/CI gate (`test:packages`, `typecheck:apps`, `build:apps`,
`validate:shopify`, secret scan) je v `.github/workflows/ci.yml`; merchant-backed
browser E2E se pouští lokálně proti dev storu (viz výše).

## 8. Cross-theme pravidla (Horizon + Dawn) — ať to jede na první dobrou

Horizon a Dawn skládají produktový formulář **odlišně** a obojí je validní HTML.
Tyhle rozdíly opakovaně rozbily E2E i storefront chování, tak je respektuj hned:

### Storefront JS (theme app extension), který reaguje na změnu varianty

- **Rescanuj na `shopify:product:select`.** Horizon po výběru varianty fetchne
  sekci a **morphuje formulář in-place** — `input[name='id']` nastaví přes
  `.value` property (žádný `change` event) a nativní `min/step` přes atributy.
  Ani `change`, ani `MutationObserver({childList})` to nechytí, takže bez tohohle
  eventu zůstane aplikované staré (product/global) pravidlo místo variant pravidla.
  Vzor (viz `apps/won-quantity/.../assets/won-quantity.js`): na
  `shopify:product:select` počkej na `event.promise` (Horizon ho resolvne po
  domorfování) a pak spusť rescan; fallback bez promise = debounced rescan.
- **Formulář hledej přes `input.form`, ne přes DOM-předka.** Na Dawn input v
  `<form action="/cart/add">` **není vnořený** — váže se přes `form="<id>"`
  atribut. `input.form || input.closest("form[action*='/cart/add']")` funguje na
  obojím; samotný `closest`/`ancestor::form` na Dawn vrátí null.
- Asset servíruj **čitelně** (žádná minifikace / build step) — je to malý soubor
  přímo z `extensions/*/assets/`.

### E2E helpery — nikdy nepředpokládej DOM-nesting

Používej **sdílené** helpery z `@won/testing/playwright`, nepiš si vlastní
XPath `ancestor::form`:

```ts
import { quantityForm, quantityStepper } from "@won/testing/playwright";

const input = await readyQuantityInput(page);
const form = await quantityForm(input);          // /cart/add form (form-attr i nesting)
const stepper = quantityStepper(input);          // kontejner s plus/minus
await stepper.locator("button[name='plus']").click();
const id = await form.locator("input[name='id']").inputValue();
```

- **`id` input + submit** jsou uvnitř formu na obou tématech → přes `quantityForm`.
- **plus/minus** jsou na Dawn v `<quantity-input>` **mimo form** → přes
  `quantityStepper`, ne přes form.
- Když téma na maximu **disabluje** tlačítko plus (Horizon), netestuj klik na něj
  (timeout) — ověř invariant „hodnota nepřekročí max" (klikni jen když je enabled).

### Vždy prověř obě témata

`--bail` se zastaví u Horizonu a k Dawn se nedostane — před shipnutím spusť
matrix **bez** `--bail`, ať Dawn leg vážně proběhne (`✓ Horizon` i `✓ Dawn`
v summary). Dawn lze ověřit i izolovaně proti ručně spuštěnému
`shopify theme dev --path tmp/e2e-themes/<app>/dawn --theme Dawn --port 9882` s
`SHOPIFY_E2E_STOREFRONT_BASE_URL=http://127.0.0.1:9882 npm run test:e2e`.
