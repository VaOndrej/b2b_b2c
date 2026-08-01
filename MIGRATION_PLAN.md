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

## Klíčové technické rozhodnutí (proč NE npm workspaces)

Core testy běží přes `node --test --experimental-strip-types` a importují moduly
jako `.ts`. Ověřeno experimentem:

- **npm workspaces + balíček `@won/core`** → symlink do `node_modules/@won/core` →
  node hodí `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (odmítá strippovat typy
  pod `node_modules`). **Nefunguje.**
- **Jeden root `package.json` + node subpath imports** `#core/*` →
  `./packages/core/src/*.ts` → cíl je MIMO `node_modules` → stripping projde.
  Ověřeno z rootu i z vnořených `apps/` složek. **Funguje.**

Proto: **jeden root package.json**, žádné per-package `exports`, žádný build step
pro sdílené balíčky. `#`-importy resolvují node (přes `imports` pole), TS (přes
`imports` + `paths`) i vite/react-router (nativně `imports` pole). Pro tenhle
use-case ("stejný stack, jiné funkce") je jeden dependency set výhoda, ne
omezení — žádný verzový drift mezi appkami. Každá appka má vlastní
`shopify.app.toml`; extensions/functions mají vlastní package.json (už dnes).

## Fáze (každá samostatně commitovatelná, každá končí zelenými testy)

- [x] **Fáze 0 — Skeleton.** Root `package.json` name→`won-apps`, `imports` mapa;
      tsconfig `paths`. Baseline `guard:test:core` = 305 pass ověřen PŘED zásahem.
- [x] **Fáze 1 — `packages/core`.** `git mv core packages/core/src`;
      `packages/core/package.json` (`@won/core`, metadata); codemod 93 importů
      v 50 souborech `../core/…ts` → `#core/…`. Brána: 305 pass, 0 fail.
- [ ] **Fáze 2 — `packages/shopify-adapter`.** `integrations/shopify` →
      `packages/shopify-adapter/src`; `#adapter/*` mapa; codemod importů.
      Brána: testy zelené.
- [ ] **Fáze 3 — přesun appky do `apps/b2b-companion/`.** `app/`, `functions/`,
      `extensions/`, `prisma/`, `config/`, `scripts/`, `shopify.app.toml`, `.env`,
      `database/`. Přepis root skriptů; `shopify app dev` z app složky.
      Brána: `typecheck` + `guard:test` + reálný **build funkcí/extensions (wasm)**.
- [ ] **Fáze 4 — `packages/app-kit`.** Vytáhnout framework-generický skeleton
      (`shopify.server`, `db.server`, `entry.server`, auth routes, `root.tsx` base,
      `utils`) → `#app-kit/*`. Brána: app běží (`shopify app dev`, health, e2e smoke).
- [ ] **Fáze 5 — `apps/_template`.** Minimální appka importující `#core` + `#app-kit`.
      Brána: `_template` nastartuje.
- [ ] **Fáze 6 — úklid.** README, odstranit duplicity (`database/schema.prisma`
      vs `prisma/schema.prisma`), narovnat CI.

## Invarianty
- Žádná změna doménové logiky, Prisma schématu ani chování appky — čistě přesuny
  + přepis cest, chráněné testy po každém kroku.
- Přesuny přes `git mv` (zachovaná historie).
- Codemod pravidlo: `from '<rel>/<dir>/<path>(.ts|.js)?'` → `from '#<alias>/<path>'`
  (extensionless), aliasy mapované na `./packages/<pkg>/src/*.ts`.
