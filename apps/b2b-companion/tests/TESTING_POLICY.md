## Test Policy (Mandatory)

For every change in pricing or Shopify Function behavior, include all layers:

1. Unit test
- Pure rule logic (discount, margin, segment, floor).

2. Contract test
- Input query shape and generated config payload must stay compatible.
- Required query variables must have a guaranteed value path.

3. Runtime integration test
- Builder output must be consumable by the target runtime function.

If one layer is missing, the change is incomplete.

## Storefront E2E run procedure (Playwright)

`npm run test:e2e:storefront` (also part of `guard:test`) drives a real storefront. It
needs (a) a running app instance so the App Proxy resolves the visibility script, and
(b) a storefront target. Without both it **skips gracefully — a skip is not a failure**.

Two supported run modes:

1. **Live store**
   - Keep `npm run dev` running (the store's App Proxy then points at your local app via the tunnel).
   - `SHOPIFY_E2E_STOREFRONT_BASE_URL=https://<shop>.myshopify.com` (default already in `.env`).

2. **Local theme dev (localhost)**
   - Keep `npm run dev` AND `shopify theme dev` running. The "Margin Guard Visibility" app embed must be enabled on the previewed theme.
   - `SHOPIFY_E2E_STOREFRONT_BASE_URL=http://127.0.0.1:9292` (the URL `shopify theme dev` prints).
   - `SHOPIFY_E2E_SHOP_DOMAIN=<shop>.myshopify.com` so Admin-API handle resolution still targets the real shop (the local origin does not match the offline session shop).

Test scenarios are picked from existing restrictive rules in Prisma, or forced via
`SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY|STEP|MAX|VARIANT` and `SHOPIFY_E2E_COLLECTION_HANDLE`.
If none resolve, the suite skips. Collection-listing scenarios push the
`margin_guard.storefront_projection` metafield to the live shop and restore it afterwards.

When asked to run these for a locally-started dev server, the agent locates the theme dev
port (`lsof -nP -iTCP -sTCP:LISTEN | grep -E '9292|ruby|shopify'`), points
`SHOPIFY_E2E_STOREFRONT_BASE_URL` at it, sets `SHOPIFY_E2E_SHOP_DOMAIN`, then runs the suite.
Full env reference: `tests/e2e/README.md`.
