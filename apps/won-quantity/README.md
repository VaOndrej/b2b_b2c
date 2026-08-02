# Won Quantity

Standalone Shopify app that enhances each theme's existing product quantity
input with shop, product and variant rules. It never renders a second product
form and keeps native Horizon/Dawn add-to-cart behavior.

## Ownership boundaries

- `@won/core/quantity` owns framework-free constraint resolution and tests.
- `won-quantity` owns its Shopify app record, SQLite database, admin routes,
  signed app-proxy endpoint, Theme App Extension and namespaced E2E data.
- `@won/testing` owns only the reusable Horizon/Dawn runner and Playwright
  contracts.
- Horizon and Dawn continue to own variant morphing, quantity controls, product
  forms and cart UI.

The full behavior contract is in
[`docs/feature-contract.md`](docs/feature-contract.md).

## Local setup

From the repository root:

```bash
npm install
npm run setup -w won-quantity
npm run typecheck -w won-quantity
npm run build -w won-quantity
npm run dev -w won-quantity
```

The app has its own `client_id`, app proxy (`/apps/won-quantity`), extension UID
and `DATABASE_URL`. Do not point it at the B2B Companion database or generated
Prisma client.

## Storefront test prerequisites

The dev store must contain unpublished themes named `Won Quantity — Horizon`
and `Won Quantity — Dawn`. In each theme, enable only the real Won Quantity app
embed and save. Pull the resulting files to:

- `tests/themes/horizon.settings_data.json`
- `tests/themes/dawn.settings_data.json`

Do not hand-write `shopify://apps/...` identifiers. The extension UUID must come
from Shopify's theme editor. The remote themes must remain unpublished.

The store also owns three dedicated, active storefront fixtures:

- `wq-e2e-default` — one default variant;
- `wq-e2e-step` — at least two variants for product/variant inheritance;
- `wq-e2e-maximum` — one default variant.

The app requires only `read_products`; E2E does not grant it `write_products`.
Global setup resolves the fixture IDs through the storefront, snapshots only
the matching Won Quantity database rows, seeds temporary rules, and teardown
restores the exact previous state. It never modifies B2B catalogs or products.

## Horizon + Dawn gate

Keep the app preview running in one terminal:

```bash
npm run dev -w won-quantity
```

Run the isolated matrix from another terminal:

```bash
npm run test:e2e:local:all -w won-quantity -- --dry-run
npm run test:e2e:local:all -w won-quantity -- --bail
```

The runner copies canonical checkouts to
`tmp/e2e-themes/won-quantity/{horizon,dawn}`, applies the app-specific overlay,
and uses ports 9881/9882. It never writes to the canonical theme repositories or
uses `--allow-live`.

Each theme runs the same desktop (`1440×1000`) and mobile (`390×844`) specs. The
gate covers extension/proxy loading, native form preservation, minimum/step/max,
manual normalization, variant morphing, add-to-cart quantity and relevant
console/page/network failures.

## Deterministic checks

```bash
npm run test:unit -w won-quantity
npm run lint -w won-quantity
npm run typecheck -w won-quantity
npm run build -w won-quantity
npm run validate:shopify
```

Before release, also test embed disable/enable and uninstall/reinstall. With the
extension disabled, missing or unreachable proxy, or incompatible native
constraints, the storefront must remain a functional native no-op.
