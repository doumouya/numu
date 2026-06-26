#!/usr/bin/env bash
# curl-trace.sh — curl with a correlation-id and a timing breakdown, always.
#
# The debugging-first centerpiece: every numu HTTP example runs THROUGH this, so an X-Request-Id and a
# DNS/connect/TLS/TTFB/total timing table are always in front of you. The request-id it generates (or that
# you pass) is echoed by the server and lands in the `events` row + the problem+json `instance` — so a
# single id joins the wire to the full server trace.
#
# Usage:
#   curl-trace.sh <METHOD> <PATH> [extra curl args...]
#   BASE_URL=https://api.example.com curl-trace.sh GET /api/objects/case
#   curl-trace.sh PATCH /api/objects/case/CAS_9 --if-match 'W/"7"' -d '{"status":"review"}'
#   curl-trace.sh --trace POST /api/objects/case -d '{"title":"x"}'      # adds --trace-ascii
#   REQUEST_ID=req_manual123 curl-trace.sh GET /api/objects/case/CAS_9   # reuse a known id
#
# Convenience flags (consumed before curl args):
#   --trace            enable --trace-ascii to stderr (full wire dump)
#   --if-match <etag>  shorthand for -H "If-Match: <etag>"
#
# Env: BASE_URL (default http://localhost:8080) · REQUEST_ID (default generated) · NUMU_TOKEN (bearer)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

# --- generate a request id if none supplied (uuid if available, else timestamp+rand) ---
gen_id() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    printf 'req_%s' "$(tr -d - < /proc/sys/kernel/random/uuid)"
  elif command -v uuidgen >/dev/null 2>&1; then
    printf 'req_%s' "$(uuidgen | tr -d - | tr '[:upper:]' '[:lower:]')"
  else
    printf 'req_%s%s' "$(date +%s)" "${RANDOM}"
  fi
}
REQUEST_ID="${REQUEST_ID:-$(gen_id)}"

TRACE=0
EXTRA=()
# pull out our convenience flags; everything else is passed through to curl
while [ "$#" -gt 0 ]; do
  case "$1" in
    --trace) TRACE=1; shift ;;
    --if-match) EXTRA+=(-H "If-Match: $2"); shift 2 ;;
    *) break ;;
  esac
done

if [ "$#" -lt 2 ]; then
  echo "usage: curl-trace.sh [--trace] [--if-match <etag>] <METHOD> <PATH> [curl args...]" >&2
  exit 2
fi

METHOD="$1"; shift
PATH_ARG="$1"; shift

# absolute URL passed through; otherwise prefix BASE_URL
case "$PATH_ARG" in
  http://*|https://*) URL="$PATH_ARG" ;;
  *) URL="${BASE_URL}${PATH_ARG}" ;;
esac

[ -n "${NUMU_TOKEN:-}" ] && EXTRA+=(-H "Authorization: Bearer ${NUMU_TOKEN}")
[ "$TRACE" -eq 1 ] && EXTRA+=(--trace-ascii /dev/stderr)

# timing template: the numbers that actually explain a slow/hanging request
read -r -d '' WRITE_OUT <<'EOF' || true

——— timing (s) ———
 dns:        %{time_namelookup}
 connect:    %{time_connect}
 tls:        %{time_appconnect}
 ttfb:       %{time_starttransfer}
 total:      %{time_total}
 http_code:  %{http_code}   size: %{size_download}B
EOF

echo "→ ${METHOD} ${URL}" >&2
echo "  X-Request-Id: ${REQUEST_ID}" >&2

# -D - dumps response headers (so ETag / Allow / Retry-After / the echoed X-Request-Id are visible)
exec curl -sS -X "${METHOD}" "${URL}" \
  -H "X-Request-Id: ${REQUEST_ID}" \
  -H "Accept: application/json" \
  -D - \
  -w "${WRITE_OUT}" \
  "${EXTRA[@]}" "$@"
