# Won Toasts — deploy to production (Fly.io + Postgres)

Path A launch (no `orders/create`, scope = `read_themes` only). The app moved from
SQLite to **Postgres** (fan-out ready). Config lives in `shopify.app.toml`, hosting
in `Dockerfile` / `fly.toml` / `docker-compose.yml`.

> ✅ The `Dockerfile` builds end to end (verified via `docker build` 2026-08-13).
> `fly.toml` itself is not yet exercised by a real `fly deploy` — that needs your
> Fly account + secrets (steps 3–5).

## 0. Migrations — already regenerated for Postgres ✅

The old SQLite migrations were replaced with a single Postgres baseline
(`prisma/migrations/20260813191052_init/`, `migration_lock.toml` → postgresql),
generated offline via `prisma migrate diff`. Nothing to reset — just **apply** them:

```bash
# local
docker compose -f apps/won-toasts/docker-compose.yml up -d db
export DATABASE_URL="postgresql://won:won@localhost:5432/won_toasts?schema=public"
npm run prisma:migrate:deploy -w won-toasts
```

Prod: Fly's `release_command` runs `prisma migrate deploy` automatically.
(Future schema changes: `prisma migrate dev --name <change>` against local Postgres.)

## 1. Local dev now needs Postgres

`shopify app dev` no longer falls back to SQLite. Keep the docker Postgres running
and `DATABASE_URL` pointed at it (see `.env.example`).

## 2. Release gate (before deploy)

```bash
npm run test:packages
npm run test:unit -w won-toasts
npm run typecheck:apps && npm run lint:standalone && npm run build:apps && npm run validate:shopify
# E2E against a live store (authoritative F1):
SHOPIFY_E2E_STOREFRONT_BASE_URL="https://<devstore>.myshopify.com" npm run test:e2e -w won-toasts
```

## 3. Provision Fly + Postgres

```bash
fly launch --no-deploy -c apps/won-toasts/fly.toml   # or `fly apps create <name>`
fly postgres create --name won-toasts-db --region fra
fly postgres attach won-toasts-db -a <your-app>      # sets DATABASE_URL secret
```

## 4. Secrets (production)

```bash
fly secrets set -a <your-app> \
  SHOPIFY_API_KEY=2c3e1a8e739b256784c30bfcefd0ec90 \
  SHOPIFY_API_SECRET=<from Partner Dashboard> \
  SHOPIFY_APP_URL=https://<your-app>.fly.dev \
  SCOPES=read_themes
# DATABASE_URL is set by `fly postgres attach`.
```

## 5. Point the app config at production, then deploy the app version

In `shopify.app.toml` replace the placeholders with the Fly URL:
`application_url`, `auth.redirect_urls` (`.../api/auth`), `app_proxy.url`
(`https://<your-app>.fly.dev/won-toasts`, subpath stays `won-toasts`).

```bash
shopify app deploy          # registers config + theme app extension as a version
fly deploy -c apps/won-toasts/fly.toml   # from repo root; release_command migrates
```

## 6. Distribution + install on the client store

Partner Dashboard → Distribution → **Public (unlisted)** (fan-out) or **Custom**
(single store) → generate install link → install on the client store (OAuth,
approve `read_themes`).

## 7. Enable embed + configure + verify

Client admin → Won Toasts → onboarding "Go live" deep-links the theme editor →
enable the **app embed**. Configure Design/Markets/Targeting, enable. Verify:
add-to-cart fires a toast, no console errors, `/apps/won-toasts/config` resolves,
`/health` OK. Then let it run hands-off (F2).

## Later: turn on order-data features (path B)

When Protected customer data access is granted in the Partner Dashboard:
re-add `write_products,read_orders` to `[access_scopes]`, uncomment the
`orders/create` block in `shopify.app.toml`, redeploy. Unlocks social proof +
order.summary + popularity metafields together.
