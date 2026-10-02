#!/bin/bash
# usage: gate.sh <outDir> — the gate, each command alone (zsh loops glue arguments); summary in <outDir>/summary.txt
cd "$(dirname "$0")/../../../../.." || exit 1
D=${1:?outDir}; mkdir -p "$D"
run(){ n=$1; shift; "$@" > "$D/$n.log" 2>&1; echo "$n exit=$?" >> "$D/summary.txt"; }
: > "$D/summary.txt"
run packages npm run test:packages
run guard npm run guard:test:core
run unit npm run test:unit -w won-discounts
run typecheck npm run typecheck -w won-discounts
run lint npm run lint -w won-discounts
run build npm run build -w won-discounts
run validate npm run validate:shopify
echo DONE >> "$D/summary.txt"
