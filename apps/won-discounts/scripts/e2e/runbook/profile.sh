#!/bin/bash
# usage: profile.sh <profile> <tag> free|pro — seed → (costs) → matrix → cleanup → verify-clean (see README.md)
set -o pipefail
cd "$(dirname "$0")/../../../../.." || exit 1
P=${1:?profile}; TAG=${2:?tag}; PLAN=${3:-free}
RUN=${WON_RUN_DIR:-${TMPDIR:-/tmp}/won-discounts-runs}; O=$RUN/$TAG; L=$O/$P; mkdir -p "$L"
E=${EVID:-$PWD/docs/won-discounts/evidence/$TAG}
if [ "$PLAN" = pro ]; then export NODE_ENV=development WON_DEV_PLAN=pro WON_E2E_PLAN=pro; else unset WON_DEV_PLAN; export WON_E2E_PLAN=free; fi
step(){ n=$1; shift; "$@" > "$L/$n.log" 2>&1; rc=$?; echo "$P $n exit=$rc" >> "$O/progress.txt"; return $rc; }
step seed-dry node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile "$P" --out "$O" || exit 1
step seed-live node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile "$P" --live --out "$O" || exit 1
COSTS=0; case $P in margin*|tiers*) COSTS=1;; esac
if [ $COSTS = 1 ]; then step costs-dry node apps/won-discounts/scripts/e2e/margin-costs.mjs --out "$O" || exit 1; step costs-live node apps/won-discounts/scripts/e2e/margin-costs.mjs --live --out "$O" || exit 1; fi
WON_E2E_PROFILE=$P WON_DISCOUNTS_E2E_EVIDENCE_DIR=$E/evidence WON_DISCOUNTS_E2E_SCREENSHOT_DIR=$E step e2e npm run test:e2e:local:all -w won-discounts
step cleanup node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live --out "$O"
[ $COSTS = 1 ] && step costs-clear node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear --live --out "$O"
WON_PROTO_OUT=$O/verify step verify-clean node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
echo "$P DONE" >> "$O/progress.txt"
