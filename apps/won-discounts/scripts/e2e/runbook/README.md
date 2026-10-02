# E2E runbook (MVP 3–5)

Shell wrappers around the seed / cost / cleanup scripts of `scripts/e2e/` and the theme matrix, so a run is the
same every time. Every live write goes through those scripts (dry-run first, backup in `$WON_RUN_DIR`).
Logs and progress go to `$WON_RUN_DIR` (default `${TMPDIR:-/tmp}/won-discounts-runs`); never into the repo.

| Script | What it does |
|---|---|
| `gate.sh <outDir>` | The gate, each command alone: test:packages, guard:test:core, test:unit, typecheck, lint, build, validate:shopify → `<outDir>/summary.txt` |
| `profile.sh <profile> <tag> free\|pro` | seed dry-run → live → (margin*/tiers*: cost pass dry-run → live) → the matrix (Horizon + Dawn, no bail) → cleanup → (costs clear) → verify-clean. Evidence to `$EVID` (default `docs/won-discounts/evidence/<tag>`) |
| `phase-b.sh <tag>` | Phase B (Pro): outlet (the sales started by `outlet.mjs` and ended + verified after the run), rewards-pro, tiers-pro, margin-pro, shapes Pro, with the fixture collections created and deleted around tiers-pro / margin-pro |
| `debug-run.sh <profile> <grep> [--only horizon\|dawn]` | One profile, only the tests matching `<grep>` (`e2e.grep.config.mjs`), evidence in `$WON_RUN_DIR/dbg` (not the repo) |

`shopify app dev` must run (Free: no `WON_DEV_PLAN`; Pro: `NODE_ENV=development WON_DEV_PLAN=pro`), started from the
repo root (`npm run dev -w won-discounts`, log to a file, never print it whole — it holds tokens). Never change
`extensions/` while it runs (a rebuild breaks the storefront dev assets until the next restart).
