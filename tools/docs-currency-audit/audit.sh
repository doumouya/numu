#!/usr/bin/env bash
# docs-currency-audit — keep docs current with code (G4.4, the docs-currency discipline as a query). If the
# HEAD commit changes a documented surface (crates/ or migrations/), it must also touch docs/ in the same
# commit, OR declare "Docs: n/a" in the message. Checks HEAD (one-commit lag). Auto-run by ci.sh. (CASE 0006.)
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

if ! git rev-parse HEAD >/dev/null 2>&1; then
  echo "  docs-currency-audit: skipped (no git history)"
  exit 0
fi

files=$(git show --name-only --format= HEAD)
msg=$(git show -s --format=%B HEAD)
# documented surfaces: the backend (crates/, migrations/) AND the frontend's
# authored code (web/src, web/styles, web/index.html, the web tools). web/sim +
# web/data are design-SYNCED artifacts (mechanical, doctrine documented at the
# source) — a sync alone owes no doc edit.
code=$(printf '%s\n' "$files" | grep -E '^(crates/|migrations/|web/src/|web/styles/|web/index\.html|tools/web-|tools/design-sync)' || true)
docs=$(printf '%s\n' "$files" | grep -E '^docs/' || true)
na=$(printf '%s' "$msg" | grep -iE 'Docs: ?n/a' || true)

if [ -n "$code" ] && [ -z "$docs" ] && [ -z "$na" ]; then
  flag docs-currency "HEAD changes a documented surface (crates/, migrations/, web/src|styles|index.html, web tools) without touching docs/ or a 'Docs: n/a' note"
fi

if [ "$findings" -eq 0 ]; then
  echo "  docs-currency-audit: clean (0 findings)"
  exit 0
else
  echo "  docs-currency-audit: $findings finding(s)"
  exit 1
fi
