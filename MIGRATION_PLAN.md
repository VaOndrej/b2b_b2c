# Migrace: `b2b_b2c` → monorepo platforma `won-apps`

Status: **Fáze 0+1 hotová (commitnuto). Fáze 2 probíhá.**

## Cíl
Jeden monorepo repozitář se sdíleným, framework-free jádrem, kde `b2b-companion`
je první z více Shopify admin appek postavených na stejném základě. Maximum
sdílení včetně app skeletonu ("stejný základ, jiné funkce"). Bez duplikace,
sdílené testy, jeden dev store / validace, škálovatelné.

## Cílová struktura
```
won-apps/
├── package.json                    # JEDEN root package (viz rozhodnutí níže)
│   └── "imports": { "#core/*", "#adapter/*", "#app-kit/*", "#testing/*" }
├── tsconfig.json                   # paths zrcadlící imports mapu
├── packages/
│   ├── core/src/                   # doménový engine (framework-free)   → #core/*
│   ├── shopify-adapter/src/        # integrations/shopify (metafields, webhooks, client) → #adapter/*
│   ├── app-kit/src/                # sdílený admin skeleton (shopify.server, db.server, auth, root) → #app-kit/*
│   └── testing/src/                # sdílené fixtures + test helpery → #testing/*
└── apps/
    ├── b2b-companion/              # dnešní app/ functions/ extensions/ prisma/ config/ scripts/
    │   ├── shopify.app.toml
    │   └── ...
    └── _template/                  # startovací šablona pro příští appku
```

## Klíčové technické rozhodnutí (workspaces + tsx runner)

Zvolený model: **npm workspaces** (standardní monorepo, každá appka nezávislá) —
balíčky `@won/core`, `@won/shopify-adapter` s `exports` na `.ts` zdroje (bez build
stepu). Ověřeno experimenty, které vyloučily jednodušší varianty:

- **node subpath imports `#core/*` s vlastním package.json v appce** → cíl
  `../../packages/...` uniká z package → `ERR_INVALID_PACKAGE_TARGET`. Appka by
  nemohla mít vlastní package.json (Shopify CLI ho očekává). **Nefunguje pro víc appek.**
- **workspaces + `@won/core` pod `node --test --experimental-strip-types`** →
  symlink `node_modules/@won/core` → `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
  (node odmítá strippovat typy pod `node_modules`). **Runner node --test nefunguje.**
- **workspaces + `@won/core` + `tsx --test`** → tsx transformuje `.ts` sám (obchází
  node zákaz), resolvuje workspace balíček přes symlink + `exports`. Zachová
  `node:test`/`node:assert` API → **žádný přepis 305 assercí**. **Funguje.** ✓

Proto: workspace balíčky s `exports: { "./*": "./src/*.ts" }`, root `workspaces`,
runner `tsx --test`. `@won/*` resolvuje tsx (testy), vite/react-router i Shopify
function build (přes node_modules symlink + exports), TS přes `paths` + exports.
Každá appka má vlastní `package.json` a `shopify.app.toml`; extensions už jsou
workspace balíčky (`extensions/*`).

## Fáze (každá samostatně commitovatelná, každá končí zelenými testy)

- [x] **Fáze 0 — Skeleton.** Root `package.json` name→`won-apps`, `imports` mapa;
      tsconfig `paths`. Baseline `guard:test:core` = 305 pass ověřen PŘED zásahem.
- [x] **Fáze 1 — `packages/core`.** `git mv core packages/core/src`;
      `packages/core/package.json` (`@won/core`, metadata); codemod 93 importů
      v 50 souborech `../core/…ts` → `#core/…`. Brána: 305 pass, 0 fail.
- [x] **Fáze 2 — `packages/shopify-adapter`.** `integrations/shopify` (nezadrátovaný
      scaffolding, 0 importérů) → `packages/shopify-adapter/src`. Brána: 305 pass.
- [x] **Fáze 3a — package model → workspaces + tsx.** `@won/core` a
      `@won/shopify-adapter` jako workspace balíčky (exports na `.ts`); root
      `workspaces: [packages/*, extensions/*]`; `tsx` devDep; codemod 93 importů
      `#core`→`@won/core`, `#adapter`→`@won/shopify-adapter`; runner
      `guard:test:core` → `tsx --test`; tsconfig `paths` `@won/*`. Appka ZATÍM
      v rootu. Brána: 305 pass pod tsx, `@won/*` resolvuje v TS. ✓
- [x] **Fáze 3b — fyzický přesun appky do `apps/b2b-companion/`.** Přesunuto
      (git mv, sourozenci → relativní importy drží): `app/`, `functions/`,
      `extensions/`, `prisma/`, `database/`, `config/`, `scripts/`, `tests/`,
      `public/`, `env.d.ts`, `shopify.*.toml`, `vite.config.ts`, `.graphqlrc.ts`,
      `playwright*.ts`, `Dockerfile`, `.dockerignore`, `.env` (untracked), app docs.
      Split `package.json`: app = deps+scripts (+ `@won/core`/`@won/shopify-adapter`
      jako deps), root = workspaces orchestrátor (`packages/*`, `apps/*`,
      `apps/*/extensions/*`) + delegující scripty (`-w b2b-companion`). tsconfig:
      root `tsconfig.base.json` + app `tsconfig.json` (extends). `vite server.fs.allow`
      += `../../packages`, `../../node_modules`. `.gitignore` split (root + app).
      **Brány zelené:** `guard:test:core` 305 pass (tsx z app workspace) · `typecheck`
      čistý · wasm build funkce (Javy) success · `react-router build` (client+SSR)
      success. Pre-existing (NE regrese, byte-identické s HEAD): extension integrační
      vitest `margin-guard-cart-validation` 2 fail (výstup wasm ≠ fixture; není
      v `guard:test`). Ruční smoke (nejde headless): `shopify app dev`.
- [x] **Fáze 4 — `packages/app-kit`.** `@won/app-kit` se sdílenými *továrnami*:
      `createShopifyApp(prisma)` + `apiVersion`, `createHandleRequest` (SSR entry),
      `AppDocument` (root shell), `createAuthSplatRoute` (auth `/auth/*`),
      `createAppUninstalledAction` / `createScopesUpdateAction` (lifecycle webhooky).
      b2b přepojeno přes tenké soubory (import surface `../shopify.server` beze změny).
      **Per-app zůstává** `db.server` (svázané s generovaným Prisma clientem), `routes.ts`.
      **Login page se NEsdílí** — React Router vyžaduje, aby default (client) export
      route souboru neměl server-only závislost; `createLoginRoute` továrna to porušila,
      tak login page zůstává per-app (leaf boilerplate). Brána: typecheck 0, 305 pass
      (opraven contract test na nový zdroj pravdy app-kitu), `react-router build` ok.
- [x] **Fáze 5 — `apps/_template`.** Bootovatelný skeleton (`won-app-template`)
      importující `@won/app-kit` + `@won/core` (demo: `SEGMENTS` na home page),
      vlastní minimální Prisma schema (jen `Session`), vlastní vite/tsconfig/tomls.
      Brána: typecheck 0, `react-router build` ok, b2b nedotčeno.
      **Prisma pozn.:** template používá sdílený hoisted `@prisma/client` (buildí se);
      per-app output izolace zdokumentovaná v [README.md](README.md) pro druhou DB appku
      (generovaný client v `app/` jinak spadne na rollup bundlingu Prisma CJS exportů).

**Stav: monorepo připravené na stavbu dalších appek.** `@won/core` + `@won/adapter`
+ `@won/app-kit` sdílené, `apps/_template` ke klonování. Viz [README.md](README.md)
→ "Adding a new app".
- [ ] **Fáze 6 — úklid.** README, odstranit duplicity (`database/schema.prisma`
      vs `prisma/schema.prisma`), narovnat CI.

## Invarianty
- Žádná změna doménové logiky, Prisma schématu ani chování appky — čistě přesuny
  + přepis cest, chráněné testy po každém kroku.
- Přesuny přes `git mv` (zachovaná historie).
- Codemod pravidlo: `from '<rel>/<dir>/<path>(.ts|.js)?'` → `from '#<alias>/<path>'`
  (extensionless), aliasy mapované na `./packages/<pkg>/src/*.ts`.
