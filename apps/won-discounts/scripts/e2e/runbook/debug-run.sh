#!/bin/bash
# usage: debug-run.sh <profile> <grep> [--only horizon|dawn] — seed → matching tests only → cleanup → verify (evidence outside the repo)
cd "$(dirname "$0")/../../../../.." || exit 1
P=${1:?profile}; G=${2:?grep}; shift 2
RUN=${WON_RUN_DIR:-${TMPDIR:-/tmp}/won-discounts-runs}; O=$RUN/dbg; L=$O/$P; mkdir -p "$L"
case $P in *-pro) export NODE_ENV=development WON_DEV_PLAN=pro WON_E2E_PLAN=pro;; *) export WON_E2E_PLAN=free;; esac
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile "$P" --out "$O" > "$L/seed-dry.log" 2>&1 || exit 1
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile "$P" --live --out "$O" > "$L/seed-live.log" 2>&1 || exit 1
(cd apps/won-discounts && WON_E2E_PROFILE=$P WON_E2E_GREP="$G" WON_DISCOUNTS_E2E_EVIDENCE_DIR=$L/evidence WON_DISCOUNTS_E2E_SCREENSHOT_DIR=$L/shots node ../../packages/testing/scripts/run-theme-matrix.mjs --config e2e.grep.config.mjs "$@" > "$L/e2e.log" 2>&1)
node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live --out "$O" > "$L/cleanup.log" 2>&1; echo "cleanup $?" >> "$L/done.txt"
WON_PROTO_OUT=$O/verify node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live > "$L/verify.log" 2>&1; echo "verify $?" >> "$L/done.txt"
echo DONE >> "$L/done.txt"
