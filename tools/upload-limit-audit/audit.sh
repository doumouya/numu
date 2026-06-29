#!/usr/bin/env bash
# upload-limit-audit — a multipart upload surface must declare an explicit request-body cap, not ride
# axum's silent 2 MB default (assessment S-2/#11: real CSVs >2 MB silently 413, and the cap is neither
# intentional nor configurable). Conditional: only fires when `Multipart` is actually used. Read-only grep;
# ratchets against ./baseline. Auto-run by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
HERE="$(cd "$(dirname "$0")" && pwd)"
FIN="$(mktemp)"; trap 'rm -f "$FIN"' EXIT
flag() { printf '[%s] %s\n' "$1" "$2" >>"$FIN"; }

# Only require a body cap if there is a multipart upload to cap (no Multipart ⇒ 0 findings, don't nag).
if grep -rlq 'Multipart' "$SRC" 2>/dev/null; then
  if ! grep -rqE 'DefaultBodyLimit|RequestBodyLimit' "$SRC" 2>/dev/null; then
    flag upload-cap "Multipart upload present but no explicit DefaultBodyLimit/RequestBodyLimit — relies on axum's 2MB default; set a configurable cap → clean 413"
  fi
fi

# ── ratchet against ./baseline ──
sort -u "$FIN" -o "$FIN"
BASE="$HERE/baseline"
NEW="$(comm -23 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
GONE="$(comm -13 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
if [ -n "$NEW" ]; then
  echo "  upload-limit-audit: NEW finding(s) — add an explicit DefaultBodyLimit to the upload route:"
  printf '%s\n' "$NEW" | sed 's/^/    FINDING /'
  exit 1
fi
echo "  upload-limit-audit: clean ($(wc -l <"$FIN" | tr -d " ") baselined finding(s))"
[ -n "$GONE" ] && { echo "  note: baselined finding(s) resolved — drop from tools/upload-limit-audit/baseline:"; printf '%s\n' "$GONE" | sed 's/^/    /'; }
exit 0
