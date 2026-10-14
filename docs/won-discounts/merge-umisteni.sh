#!/usr/bin/env bash
# Before merging `won-discounts-umisteni` into `main` (run from this worktree, after the other AI has finished on main).
# Read-only: a trial merge in memory (git merge-tree) and the migration numbers. With --fix it renumbers this branch's
# Postgres migration when main took its number, and commits that ON THIS BRANCH (never on main).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
FIX="${1:-}"
BASE="${BASE:-main}"
APP=apps/won-discounts
OURS_PG="0007_theme_tags"

echo "== $BASE: $(git log --oneline -1 "$BASE")"
echo "== trial merge (nothing is written):"
if out=$(git merge-tree --write-tree --name-only "$BASE" HEAD); then
  echo "   no conflicts"
else
  echo "   CONFLICTS in:"; echo "$out" | tail -n +2 | sed '/^$/,$d' | sed 's/^/     /'
fi

echo "== Postgres migrations on main:"
main_pg=$(git ls-tree --name-only "$BASE:$APP/prisma/postgres/migrations" | grep -E '^[0-9]{4}_' || true)
echo "$main_pg" | tail -3 | sed 's/^/     /'
if echo "$main_pg" | grep -q '^0007_' && ! echo "$main_pg" | grep -qx "$OURS_PG"; then
  last=$(echo "$main_pg" | sed -E 's/^([0-9]{4})_.*/\1/' | sort -n | tail -1)
  next=$(printf "%04d" $((10#$last + 1)))
  echo "   COLLISION: main already has 0007 → this branch's migration must become ${next}_theme_tags"
  if [ "$FIX" = "--fix" ]; then
    git mv "$APP/prisma/postgres/migrations/$OURS_PG" "$APP/prisma/postgres/migrations/${next}_theme_tags"
    git commit -q -m "Won Discounts, umístění na webu: Postgres migrace přečíslovaná na ${next} (main mezitím vzal 0007)"
    echo "   renumbered and committed on $(git branch --show-current)"
  fi
else
  echo "   no collision for $OURS_PG"
fi

echo "== SQLite migrations newer than ours on main (order is by name; a later one of main's is fine):"
git ls-tree --name-only "$BASE:$APP/prisma/migrations" | grep -E '^[0-9]{14}_' | awk '$0 > "20261014120000"' | sed 's/^/     /'
echo "== then: git merge main into this branch, run the gates (README of the brief), merge back."
