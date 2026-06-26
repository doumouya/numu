#!/usr/bin/env bash
# case-first-audit — the case-first discipline as a query (G4.4, unblocked by the Cases engine). The HEAD
# commit, if it's non-trivial (touches crates/ or migrations/), must reference a Case: a "CASE NNNN" /
# "CAS_<hex>" mention in the message, OR a touched docs/cases/ file. A going-forward gate; it checks the
# last commit (one-commit lag is fine for numu's direct-main flow). Auto-run by ci.sh. (CASE 0006.)
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

if ! git rev-parse HEAD >/dev/null 2>&1; then
  echo "  case-first-audit: skipped (no git history)"
  exit 0
fi

files=$(git show --name-only --format= HEAD)
msg=$(git show -s --format=%B HEAD)
nontrivial=$(printf '%s\n' "$files" | grep -E '^(crates/|migrations/)' || true)

if [ -n "$nontrivial" ]; then
  refs_case=$(printf '%s' "$msg" | grep -iE 'CASE [0-9]|CAS_[0-9A-Fa-f]' || true)
  touches_case=$(printf '%s\n' "$files" | grep -E '^docs/cases/' || true)
  if [ -z "$refs_case" ] && [ -z "$touches_case" ]; then
    flag case-first "HEAD touches crates/ or migrations/ but references no Case (a 'CASE NNNN'/'CAS_' mention or a docs/cases/ file)"
  fi
fi

if [ "$findings" -eq 0 ]; then
  echo "  case-first-audit: clean (0 findings)"
  exit 0
else
  echo "  case-first-audit: $findings finding(s)"
  exit 1
fi
