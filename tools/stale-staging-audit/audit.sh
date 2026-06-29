#!/usr/bin/env bash
# stale-staging-audit — numu's own docs-currency discipline, pointed at staging/"v0" comments that outlived
# their slice. Once auth/A2 landed and require_action does real rank checks, headers like "require_action
# always allows" / "until A2 wires the real extractor" are factually false (assessment docs-drift). This
# gate flags the known staging phrases so a NEW one can't accrete and an old one can't silently persist past
# its fix. Read-only grep; ratchets against ./baseline (the current stale comments — fix them and shrink it).
# Auto-run by tools/ci.sh. (mirrors docs-currency-audit's intent at the comment level.)
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
HERE="$(cd "$(dirname "$0")" && pwd)"
FIN="$(mktemp)"; trap 'rm -f "$FIN"' EXIT
flag() { printf '[%s] %s\n' "$1" "$2" >>"$FIN"; }

# Targeted staging phrases (specific enough to avoid false positives; widen deliberately if needed).
PHRASES=('always allows' 'until A2' 'until auth lands')
for p in "${PHRASES[@]}"; do
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    file="${hit%%:*}"
    flag stale-staging "a staging phrase (\"$p\") survives in $(basename "$file") — reconcile it (the slice landed)"
  done < <(grep -rn "$p" "$SRC" 2>/dev/null || true)
done

# ── ratchet against ./baseline ──
sort -u "$FIN" -o "$FIN"
BASE="$HERE/baseline"
NEW="$(comm -23 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
GONE="$(comm -13 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
if [ -n "$NEW" ]; then
  echo "  stale-staging-audit: NEW finding(s) — reconcile the comment; or if intentional add to tools/stale-staging-audit/baseline:"
  printf '%s\n' "$NEW" | sed 's/^/    FINDING /'
  exit 1
fi
echo "  stale-staging-audit: clean ($(wc -l <"$FIN" | tr -d " ") baselined finding(s))"
[ -n "$GONE" ] && { echo "  note: baselined finding(s) resolved — drop from tools/stale-staging-audit/baseline:"; printf '%s\n' "$GONE" | sed 's/^/    /'; }
exit 0
