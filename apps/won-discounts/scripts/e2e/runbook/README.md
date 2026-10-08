# E2E runbook (MVP 3–5)

Shell wrappers around the seed / cost / cleanup scripts of `scripts/e2e/` and the theme matrix, so a run is the
same every time. Every live write goes through those scripts (dry-run first, backup in `$WON_RUN_DIR`).
Logs and progress go to `$WON_RUN_DIR` (default `${TMPDIR:-/tmp}/won-discounts-runs`); never into the repo.

| Script | What it does |
|---|---|
| `gate.sh <outDir>` | The gate, each command alone: test:packages, guard:test:core, test:unit, typecheck, lint, build, validate:shopify → `<outDir>/summary.txt` |
| `profile.sh <profile> <tag> free\|pro` | seed dry-run → live → (margin*/tiers*: cost pass dry-run → live) → the matrix (Horizon + Dawn, no bail) → cleanup → (costs clear) → verify-clean. Evidence to `$EVID` (default `docs/won-discounts/evidence/<tag>`) |
| `phase-b.sh <tag>` | Phase B (Pro): outlet (the sales started by `outlet.mjs` and ended + verified after the run), rewards-pro, tiers-pro, margin-pro, shapes Pro, with the fixture collections created and deleted around tiers-pro / margin-pro |
| `looks.sh <profile> <tag> [--texts] [--looks <element>=<look>[+blink],…] [--old-look] [--only horizon\|dawn]` | The merchant's storefront texts, ready-made looks or a look stored before the split on top of the profile's seed (`scripts/e2e/looks-fixture.mjs`): seed dry-run → live → `tests/e2e/storefront.looks.spec.ts` alone → cleanup → verify-clean. Evidence to `$EVID`. The store answers HTTP 429 after a few runs in a row: wait some minutes, then repeat the theme that failed with `--only` |
| `debug-run.sh <profile> <grep> [--only horizon\|dawn]` | One profile, only the tests matching `<grep>` (`e2e.grep.config.mjs`), evidence in `$WON_RUN_DIR/dbg` (not the repo) |

Výprodej 5b (OFF until the app may read orders, F-O1): `WON_E2E_ORDERS=1 profile.sh outlet <tag> pro` adds the
order specs (quota sold out by Bogus orders, a cancelled order back in the quota); leftover test orders of the run:
`node apps/won-discounts/scripts/e2e/outlet-orders.mjs --since <run start ISO>` (dry-run) then `--live`. Activation
steps: `docs/plans/2026-10-02-won-discounts-mvp5.md` „Aktivace 5b“.

`shopify app dev` must run (Free: no `WON_DEV_PLAN`; Pro: `NODE_ENV=development WON_DEV_PLAN=pro`), started from the
repo root (`npm run dev -w won-discounts`, log to a file, never print it whole — it holds tokens). Never change
`extensions/` while it runs (a rebuild breaks the storefront dev assets until the next restart).
