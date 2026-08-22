#!/usr/bin/env bash
# Stop hook — turn "it's green" from a claim into a fact.
#
# WHY THIS EXISTS
# A model asked "are you sure?" answers "yes" and moves on; self-assessment is
# not a control. What actually stops a wrong claim is a command that exits
# non-zero. This hook runs the static half of the `won-release-gate` checklist
# and refuses to let the turn end while it is red, feeding the real output back.
#
# It also enforces the rule from CLAUDE.md that a VISUAL change is not finished
# without a screenshot: mark-ui-change.sh drops a marker when admin UI is edited,
# and this hook blocks until `won-visual-qa` has produced a newer screenshot.
#
# DESIGN NOTES
#  - Honours stop_hook_active: never blocks twice in a row, so a stuck gate can't
#    trap the session in a loop.
#  - Skips entirely when the working tree hasn't changed since the last PASS, so
#    conversational turns and doc edits stay instant.
#  - Only runs the gate when files that the gate actually covers were touched.
#  - Never blocks on its own failure (missing npm, no git) — a broken hook must
#    not become a broken session.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STATE_DIR="$HERE/.."
UI_MARKER="$STATE_DIR/.ui-touched"
PASS_FILE="$STATE_DIR/.gate-pass"

input="$(cat 2>/dev/null || true)"

# ── loop protection ───────────────────────────────────────────────────────────
# If we already blocked once and the model is stopping again, let it through —
# it now has the failure text and it's the human's turn to decide.
case "$input" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;;
esac

cd "$REPO" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

block() {
  # decision:block feeds `reason` back to the model and keeps the turn alive.
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "$1" '{decision:"block", reason:$r}'
  else
    printf '{"decision":"block","reason":%s}' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/^/"/; s/$/"/')"
  fi
  exit 0
}

# ── 1. visual evidence gate ───────────────────────────────────────────────────
# TWO independent signals, because neither alone is sufficient:
#   a) the PostToolUse marker — catches edits that were committed mid-session, but
#      ONLY sees the Write/Edit tools. An edit made through Bash (sed, a python
#      heredoc) never reaches it.
#   b) git — tool-agnostic, sees any uncommitted UI change however it was made,
#      but goes blind the moment the work is committed.
# Together they cover each other's blind spot.
ui_from_git="$(git status --porcelain 2>/dev/null \
  | sed 's/^...//' \
  | grep -E '/app/(components|routes)/[^/]*\.tsx$' || true)"
if [ -n "$ui_from_git" ]; then
  printf '%s\n' "$ui_from_git" >> "$UI_MARKER" 2>/dev/null || true
fi

if [ -s "$UI_MARKER" ]; then
  # Screenshot locations won-visual-qa sanctions, plus the Playwright MCP default.
  newer=""
  for dir in "$REPO"/apps/*/build/qa "$REPO/.playwright-mcp" "$REPO/../.playwright-mcp"; do
    [ -d "$dir" ] || continue
    found="$(find "$dir" -type f \( -name '*.png' -o -name '*.jpeg' -o -name '*.jpg' \) -newer "$UI_MARKER" -print -quit 2>/dev/null)"
    if [ -n "$found" ]; then newer="$found"; break; fi
  done
  if [ -z "$newer" ]; then
    touched="$(sort -u "$UI_MARKER" 2>/dev/null | sed "s|^$REPO/||" | head -12)"
    block "BLOCKED — admin UI changed, no screenshot taken.

CLAUDE.md: \"Vizuální změnu neuzavírám bez screenshotu z Playwrightu ve viewportech 390px a 1440px.\"
\"Hotovo\" bez důkazu je nedokončená práce.

Files changed this session:
$touched

Do ONE of these before finishing:
  1. Run the visual QA properly — invoke the 'won-visual-qa' skill, screenshot the
     changed screens, and save them under apps/<app>/build/qa/.
  2. If the app is not running and you cannot screenshot it, say so PLAINLY in your
     reply — do not claim the visual work is done or verified — and clear the marker:
       rm .claude/.ui-touched
Do not clear the marker to silence this check while still claiming the work is verified."
  fi
  rm -f "$UI_MARKER"
fi

# ── 2. static gate ────────────────────────────────────────────────────────────
# What changed, tracked + untracked, excluding the state files this hook owns.
changed="$(git status --porcelain 2>/dev/null | grep -v '\.claude/\.\(ui-touched\|gate-pass\)' || true)"
[ -n "$changed" ] || exit 0

# Only files the static gate can actually judge.
# NB: here-string, not a pipe. `... | grep -q` makes grep exit on the first match,
# the writer takes SIGPIPE (141), and `set -o pipefail` turns that into a failing
# pipeline — so the `|| exit 0` fired even when the pattern DID match, and the
# gate silently never ran. A hook that quietly does nothing is worse than none.
grep -qE '\.(ts|tsx|js|mjs|cjs)$' <<< "$changed" || exit 0

# Fingerprint the tree; if it matches the last PASS, nothing to re-verify.
fingerprint="$(printf '%s' "$changed" | shasum 2>/dev/null | cut -d' ' -f1)"
if [ -n "$fingerprint" ] && [ -f "$PASS_FILE" ] && [ "$(cat "$PASS_FILE" 2>/dev/null)" = "$fingerprint" ]; then
  exit 0
fi

command -v npm >/dev/null 2>&1 || exit 0

if ! out="$(npm run typecheck:apps 2>&1)"; then
  block "BLOCKED — \`npm run typecheck:apps\` is RED. You may not end the turn claiming this is done.

$(printf '%s' "$out" | grep -E 'error|Error' | head -25)

Fix it, or state plainly in your reply that you are leaving the build broken and why."
fi

if ! out="$(npm run lint:standalone 2>&1)"; then
  block "BLOCKED — \`npm run lint:standalone\` is RED. You may not end the turn claiming this is done.

$(printf '%s' "$out" | grep -E '  error|  warning|problems' | head -25)

Fix it, or state plainly in your reply that you are leaving lint broken and why."
fi

[ -n "$fingerprint" ] && printf '%s' "$fingerprint" > "$PASS_FILE" 2>/dev/null

# Green — say so, so the pass is visible rather than silent.
printf '%s' '{"systemMessage":"Gate: typecheck + lint green."}'
exit 0
