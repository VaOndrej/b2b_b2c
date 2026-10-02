#!/bin/bash
# usage: phase-b.sh <tag> — phase B (Pro); `shopify app dev` must run with NODE_ENV=development WON_DEV_PLAN=pro
cd "$(dirname "$0")/../../../../.." || exit 1
TAG=${1:?tag}; RUN=${WON_RUN_DIR:-${TMPDIR:-/tmp}/won-discounts-runs}; O=$RUN/$TAG; mkdir -p "$O"
HERE=apps/won-discounts/scripts/e2e/runbook; MC=apps/won-discounts/scripts/e2e/margin-collection.mjs
log(){ echo "$1" >> "$O/progress.txt"; }
for spec in "outlet:" "rewards-pro:" "tiers-pro:tiers" "margin-pro:margin" "shapes:"; do
  P=${spec%%:*}; FX=${spec#*:}; mkdir -p "$O/$P"
  if [ -n "$FX" ]; then
    node $MC --fixture "$FX" --out "$O" > "$O/$P/coll-dry.log" 2>&1; log "$P coll-dry exit=$?"
    node $MC --fixture "$FX" --live --out "$O" > "$O/$P/coll-live.log" 2>&1 || { log "$P coll-live FAILED"; continue; }; log "$P coll-live exit=0"
  fi
  bash $HERE/profile.sh "$P" "$TAG" pro || log "$P PROFILE-FAILED"
  if [ -n "$FX" ]; then node $MC --fixture "$FX" --delete --live --out "$O" > "$O/$P/coll-delete.log" 2>&1; log "$P coll-delete exit=$?"; fi
done
log "PHASE-B DONE"
