#!/usr/bin/env bash
# PostToolUse(Write|Edit) — record that admin UI was touched this session.
#
# Half of the "no visual claim without a screenshot" gate. This half is cheap and
# runs on every write; the expensive judgement lives in gate.sh at Stop time.
#
# Writes the touched path into .claude/.ui-touched. gate.sh later refuses to let
# the turn end unless a screenshot newer than this marker exists.
#
# Exits 0 unconditionally — a marker failure must never block an edit.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="$HERE/../.ui-touched"

input="$(cat 2>/dev/null || true)"

# Prefer jq; fall back to a permissive grep so a missing jq degrades to "no marker"
# rather than to a wrong one.
if command -v jq >/dev/null 2>&1; then
  file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
else
  file="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi

[ -n "${file:-}" ] || exit 0

# Only merchant-facing admin UI counts. Server code, tests, docs and the
# storefront runtime are covered by the test gates instead — a screenshot proves
# nothing about them.
case "$file" in
  *"/app/components/"*.tsx|*"/app/routes/"*.tsx)
    printf '%s\n' "$file" >> "$MARKER" 2>/dev/null || true
    ;;
esac

exit 0
