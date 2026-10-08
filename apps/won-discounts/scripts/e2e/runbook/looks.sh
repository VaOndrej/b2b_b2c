#!/bin/bash
# usage: looks.sh <profile> <tag> [--texts] [--looks <element>=<look>[+blink],…] [--old-look] [--only horizon|dawn]
# The merchant's storefront texts and ready-made looks on top of a profile's seed (scripts/e2e/looks-fixture.mjs):
# seed dry-run → live → tests/e2e/storefront.looks.spec.ts alone (Horizon + Dawn) → cleanup → verify-clean.
# Evidence to $EVID (default docs/won-discounts/evidence/<tag>); logs to $WON_RUN_DIR/<tag>/<profile>[-<looks>].
set -o pipefail
cd "$(dirname "$0")/../../../../.." || exit 1
P=${1:?profile}; TAG=${2:?tag}; shift 2
SEED=(); MATRIX=(); TEXTS=0; LOOKS=""; OLD=0
while [ $# -gt 0 ]; do
  case $1 in
    --texts) TEXTS=1; SEED+=(--texts); shift;;
    --looks) LOOKS=${2:?looks}; SEED+=(--looks "$LOOKS"); shift 2;;
    --old-look) OLD=1; SEED+=(--old-look); shift;;
    --only) MATRIX+=(--only "${2:?theme}"); shift 2;;
    *) echo "unknown argument $1" >&2; exit 2;;
  esac
done
[ ${#SEED[@]} -gt 0 ] || { echo "nothing to check: pass --texts, --looks or --old-look" >&2; exit 2; }
RUN=${WON_RUN_DIR:-${TMPDIR:-/tmp}/won-discounts-runs}; O=$RUN/$TAG; N=$P${LOOKS:+-$(echo "$LOOKS" | tr -c 'a-z0-9\n' '-')}; [ $OLD = 1 ] && N=$N-old-look; L=$O/$N; mkdir -p "$L"
E=${EVID:-$PWD/docs/won-discounts/evidence/$TAG}
case $P in *-pro|outlet|campaign) export NODE_ENV=development WON_DEV_PLAN=pro WON_E2E_PLAN=pro;; *) unset WON_DEV_PLAN; export WON_E2E_PLAN=free;; esac
step(){ n=$1; shift; "$@" > "$L/$n.log" 2>&1; rc=$?; echo "$N $n exit=$rc" >> "$O/progress.txt"; return $rc; }
step seed-dry node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile "$P" "${SEED[@]}" --out "$O" || exit 1
step seed-live node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile "$P" "${SEED[@]}" --live --out "$O" || exit 1
(cd apps/won-discounts && WON_E2E_PROFILE=$P WON_E2E_TEXTS=$TEXTS WON_E2E_LOOKS=$LOOKS WON_E2E_OLD_LOOK=$OLD WON_E2E_SPEC=tests/e2e/storefront.looks.spec.ts WON_DISCOUNTS_E2E_EVIDENCE_DIR=$E/evidence WON_DISCOUNTS_E2E_SCREENSHOT_DIR=$E step e2e node ../../packages/testing/scripts/run-theme-matrix.mjs --config e2e.grep.config.mjs "${MATRIX[@]}")
step cleanup node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup --live --out "$O"
WON_PROTO_OUT=$O/verify step verify-clean node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live
echo "$N DONE" >> "$O/progress.txt"
