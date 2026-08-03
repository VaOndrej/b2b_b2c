# Vytvoření nové aplikace z templatu

Kanonický postup pro novou Shopify appku v tomhle monorepu. Cíl: co nejvíc
znovupoužít sdílený základ (`@won/*`) a **nevytvářet nové věci, které už sdíleně
existují** — hlavně E2E témata a produkty.

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
