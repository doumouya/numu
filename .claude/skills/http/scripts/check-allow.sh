#!/usr/bin/env bash
# check-allow.sh — send OPTIONS to a numu object endpoint and print the Allow header + self-description.
#
# Verifies a type's verb surface matches the registry expectation, and shows the caller's per-verb RBAC
# verdict (the "what can I do here, with these creds?" answer). A fast way to confirm method_policy masks
# took effect, or to debug a 403/405.
#
# Usage:
#   check-allow.sh /api/objects/case            # collection surface
#   check-allow.sh /api/objects/case/CAS_9      # item surface (incl. ETag + per-verb rbac)
#   BASE_URL=https://api.example.com NUMU_TOKEN=… check-allow.sh /api/objects/project/PRJ_1
#
# Env: BASE_URL (default http://localhost:8080) · NUMU_TOKEN (bearer)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

if [ "$#" -lt 1 ]; then
  echo "usage: check-allow.sh <PATH>   e.g. /api/objects/case/CAS_9" >&2
  exit 2
fi

PATH_ARG="$1"
case "$PATH_ARG" in
  http://*|https://*) URL="$PATH_ARG" ;;
  *) URL="${BASE_URL}${PATH_ARG}" ;;
esac

AUTH=()
[ -n "${NUMU_TOKEN:-}" ] && AUTH+=(-H "Authorization: Bearer ${NUMU_TOKEN}")

echo "→ OPTIONS ${URL}" >&2

# Headers (incl. Allow) to a temp file via -D; body to stdout. Then echo the Allow header and the body.
hdrs="$(mktemp)"
trap 'rm -f "$hdrs"' EXIT

body="$(curl -sS -X OPTIONS "${URL}" -H "Accept: application/json" -D "$hdrs" "${AUTH[@]}")"

# the verb surface — the headline of this tool
grep -i '^allow:' "$hdrs" || echo "(no Allow header returned)"
echo

# the self-description body, pretty-printed if jq is available
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$body" | jq . 2>/dev/null || printf '%s\n' "$body"
else
  printf '%s\n' "$body"
fi
