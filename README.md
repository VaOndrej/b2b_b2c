# won-apps — Shopify apps monorepo

A single repo of Shopify apps built on one shared, framework-free core. Apps stay
independent (own `shopify.app.toml`, own dev store flow); the reusable logic and
skeleton live in shared packages.

## Layout

```
won-apps/
├── package.json            # workspaces root + orchestration scripts
├── tsconfig.base.json      # shared TS options + @won/* path aliases
├── packages/
│   ├── core/               # @won/core — framework-free domain engine
│   │                       #   (pricing, discount, margin, catalog, segment,
│   │                       #    quantity, visibility, storefront). NO Shopify/
│   │                       #    React/Prisma imports. Unit-tested in isolation.
│   ├── shopify-adapter/    # @won/shopify-adapter — admin GraphQL / metafields / webhooks
│   └── app-kit/            # @won/app-kit — shared app skeleton (shopify app
│                           #   factory, SSR entry, root shell, auth splat,
│                           #   lifecycle webhooks)
└── apps/
    ├── b2b-companion/      # the original B2B/B2C app (margin guard, catalogs, …)
    └── _template/          # copy this to start a new app
```

## Conventions

- **Package manager:** npm workspaces. Run `npm install` from the repo root.
- **Cross-package imports:** always the package name — `@won/core/...`,
  `@won/app-kit/...` — never a relative `../../packages/...` path. Resolution
  works in TS, vite, and the test runner via the workspace symlink + each
  package's `exports` map (which points straight at `src/*.ts`, no build step).
- **Tests:** the shared engine is tested with `node:test` run through **`tsx`**
  (`tsx --test ...`). We use tsx (not bare `node --test`) because node refuses to
  strip types for files resolved under `node_modules`, which is where workspace
  symlinks live. See [MIGRATION_PLAN.md](MIGRATION_PLAN.md) for the why.
- **Adding shared logic:** if two apps would copy the same code, it belongs in a
  package. Pure domain logic → `@won/core`. Shopify plumbing → `@won/app-kit`
  or `@won/shopify-adapter`.

## Root scripts (delegate to an app workspace)

```bash
npm run dev                 # b2b-companion dev (shopify app dev)
npm run build               # b2b-companion build
npm run typecheck
npm run guard:test          # b2b-companion full gate (core + e2e)
npm run guard:test:core     # tsx core tests
# target another app explicitly:
npm run <script> -w <app-name>     # e.g. -w won-app-template
```

## Adding a new app

1. **Copy the template**
   ```bash
   rsync -a \
     --exclude build \
     --exclude .react-router \
     --exclude .env \
     --exclude app/generated \
     --exclude .shopify \
     --exclude node_modules \
     --exclude test-results \
     apps/_template/ apps/<your-app>/
   ```
2. **Name it** — set `"name"` in `apps/<your-app>/package.json` and `name` in
   `apps/<your-app>/shopify.app.toml`.
3. **Install** — `npm install` from the repo root (registers the new workspace,
   links `@won/*`).
4. **Link a Shopify app** — `npm run config:link -w <your-app>` (creates the app
   in your Partner org, fills `client_id` / URLs). Copy `.env.example` → `.env`.
5. **Build your feature**
   - Put pure business rules in `packages/core/src/<domain>/` with `node:test`
     tests, then consume them from the app via `@won/core/<domain>/...`.
   - Add routes under `apps/<your-app>/app/routes/`.
   - Add Shopify Functions / extensions under `apps/<your-app>/extensions/`
     (each is its own workspace with its own `package.json`).
6. **Own the test contract** — replace the placeholders in
   `e2e.app.config.mjs`, add at least one app-specific `tests/e2e/*.spec.ts`, and
   use `@won/testing/playwright` for shared Horizon/Dawn fixtures. The template's
   `test:e2e` intentionally fails until both pieces exist.
7. **Verify** — `npm run test:unit -w <your-app>`,
   `npm run typecheck -w <your-app>`, `npm run build -w <your-app>`, and
   `npm run test:e2e:local:all -w <your-app>`.
8. **Run** — `npm run dev -w <your-app>`.

### Prisma in the monorepo (read before adding a second DB-backed app)

Every standalone app generates Prisma into its own source-local ignored
directory. This prevents one workspace's schema from overwriting another app's
runtime client:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../app/generated/prisma"   // per-app, not the hoisted client
}
```

Import it in `db.server.ts` from that path, and externalize it from the SSR
bundle in `vite.config.ts` (a generated client under `app/` is otherwise pulled
into the rollup bundle and fails on Prisma's dynamic CJS exports):

```ts
// vite.config.ts
build: {
  rollupOptions: {
    external: [/\/app\/generated\/prisma/];
  }
}
```

The template already ships with this isolated output and matching Vite
externalization. Keep that contract when scaffolding every new app.

```

```
