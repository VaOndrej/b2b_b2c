# Won Discounts — deploy to production (Fly.io + Postgres)

**Prepared, not deployed** (mezery A13). Nothing in this file has been run against a real Fly account. Verified
locally on 2026-10-04: `docker build -f apps/won-discounts/Dockerfile .` builds (image 2.33 GB: the whole workspace
with devDependencies), `prisma migrate deploy` in the image applies the baseline to a local Postgres, the server
starts and `/healthz` answers `ok`; the image holds no `.env`, no SQLite file and no `.git`
(`Dockerfile.dockerignore`). `npm run test:postgres -w won-discounts` runs the app's own code on Postgres (5/5).
Hosting files: `Dockerfile`, `fly.toml`, `docker-compose.yml`.

## What runs where

| Piece | Where | How it gets there |
|---|---|---|
| Admin, webhooks, app proxy, scheduler | the Fly machine (this image) | `fly deploy -c apps/won-discounts/fly.toml` from the repo root |
| Discount function (Rust → Wasm), theme app extension, app config (scopes, webhooks, proxy) | Shopify | `shopify app deploy` from a machine with Rust (`~/.cargo/bin`) |
| Database | Fly Postgres | `fly postgres attach` sets `DATABASE_URL`; `release_command` runs `prisma migrate deploy` |

## One instance

Run **exactly one machine**, always on (`fly.toml`: `min_machines_running = 1`, `auto_stop_machines = "off"`;
never `fly scale count 2`). These live in the process, not in the database:

- the per-shop config lock and sync queue (`app/lib/integration/lock.server.ts`, `app/lib/sync/sync.server.ts`);
- the scheduler (`app/lib/jobs/scheduler.server.ts`): sales ending by date, campaign boundaries and the product
  page's tier table switch, the daily billing reconcile, history pruning;
- the cost-mirror reconcile, the stale-claim sweep and the margin-impact cache.

Two machines would run every scheduled task twice and let two syncs of one shop interleave. A restart is safe:
the scheduler's state is in `JobState`, an interrupted sync is retried by the next one, an interrupted sale start
or end by `outlet.due`.

## 1. Database

The app is developed on SQLite; production is Postgres. `prisma/postgres/` (schema + one baseline migration) is
generated from `prisma/schema.prisma` by `node scripts/make-postgres-schema.mjs` and drift-tested. The Dockerfile
puts it in place of `prisma/`, so the image's Prisma client and `prisma migrate deploy` are Postgres.

After the first deploy, a schema change needs a new Postgres migration next to `0001_init` (generate it with
`prisma migrate diff` between the deployed and the new Postgres schema) — do not regenerate the baseline.

Amounts in `OrderDiscountFact` are 32-bit integers on Postgres (minor units, up to 2 000 000 000); the app stores
a larger amount as that maximum.

## 2. Release gate (before a deploy)

```bash
bash apps/won-discounts/scripts/e2e/runbook/gate.sh /tmp/won-gate      # every line of summary.txt exit=0
npm run test:postgres -w won-discounts                                # needs Docker
docker build -f apps/won-discounts/Dockerfile -t won-discounts .
```

## 3. Provision Fly + Postgres

```bash
fly apps create <app-name>                      # then set `app` in apps/won-discounts/fly.toml
fly postgres create --name <app-name>-db --region fra
fly postgres attach <app-name>-db -a <app-name>  # sets the DATABASE_URL secret
```

## 4. Secrets

```bash
fly secrets set -a <app-name> \
  SHOPIFY_API_KEY=<client id of the production app> \
  SHOPIFY_API_SECRET=<from the Partner Dashboard> \
  SHOPIFY_APP_URL=https://<app-name>.fly.dev \
  SCOPES=<the scopes of shopify.app.toml, comma separated>
```

`WON_DEV_PLAN` must not be set (it is ignored in a production build anyway: the override is compiled out).
Billing charges real money in production (`NODE_ENV=production` → `test: false`).

## 5. App config, then the two deploys

In the production app's `shopify.app.toml` set `application_url`, `auth.redirect_urls` and `app_proxy.url`
(`https://<app-name>.fly.dev/won-discounts`) to the Fly URL.

```bash
shopify app deploy                          # config + function + theme app extension as a version
fly deploy -c apps/won-discounts/fly.toml   # from the repo root; release_command migrates
```

## 6. After the deploy

- `https://<app-name>.fly.dev/healthz` answers `ok`.
- Install on a store, open the app once (the offline session the webhooks and the scheduler need).
- Onboarding → app embed on → first discount → **Try a cart** → a test order.
- Tarif: start the Pro trial (a real charge in production; use a development store to test).

## Later: orders (clearance quota from orders, analytics)

Needs **Protected customer data access** approved for the app in the Partner Dashboard. Then one step:

```bash
node apps/won-discounts/scripts/activate-orders.mjs          # dry-run: the diff of shopify.app.toml
node apps/won-discounts/scripts/activate-orders.mjs --live   # writes it; then `shopify app deploy`
```

It adds the `read_orders` scope and one subscription of `orders/create`, `orders/cancelled`, `refunds/create`
(`/webhooks/outlet`: the sale quota and the order facts of the reports). Until then the admin says that the quota is not counted and the reports
are empty — nothing is faked.
