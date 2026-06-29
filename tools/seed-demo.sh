#!/bin/sh
# seed-demo.sh — the R0 enabler (README §3 / numu-rewrite-plan R0): seed the demo tenants the frontend
# census validates against, against a RUNNING numu-api. Real seeded data is the validator — self-authored
# fixtures can't falsify the model. Idempotent enough for a fresh DB; re-running creates duplicates.
#
# Usage:  sh tools/seed-demo.sh [BASE_URL] [DOSSIER_CSV]
#   BASE_URL     default http://127.0.0.1:8099
#   DOSSIER_CSV  a CSV to upload into the first conversation (optional; skipped if absent)
#
# Needs: a debug build of numu-api running with dev-login enabled (it logs in as the seeded USR_dev admin).
set -eu

BASE="${1:-http://127.0.0.1:8099}"
DOSSIER="${2:-}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

j() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }

echo "→ waiting for $BASE/readyz"
until curl -fsS "$BASE/readyz" >/dev/null 2>&1; do sleep 1; done

echo "→ dev-login (USR_dev)"
curl -fsS -c "$JAR" -X POST "$BASE/auth/dev-login" -H 'content-type: application/json' -d '{}' >/dev/null

# A workspace (tenant) + a project (conversation) per demo client. Names mirror the Console census.
first_prj=""
seed_tenant() {
  name="$1"; slug="$2"; pname="$3"; pslug="$4"; origin="$5"
  ws=$(curl -fsS -b "$JAR" -X POST "$BASE/api/objects/workspace" -H 'content-type: application/json' \
        -d "{\"name\":\"$name\",\"slug\":\"$slug\",\"status\":\"active\"}" | j "['id']")
  prj=$(curl -fsS -b "$JAR" -X POST "$BASE/api/objects/project" -H 'content-type: application/json' \
        -d "{\"name\":\"$pname\",\"slug\":\"$pslug\",\"workspace_id\":\"$ws\",\"origin\":\"$origin\"}" | j "['id']")
  echo "  ✓ $name  → workspace $ws · conversation $prj"
  [ -z "$first_prj" ] && first_prj="$prj" || true
}

echo "→ seeding tenants"
seed_tenant "ORVCLE Studio" "orvcle"     "Aria Vex — Midnight Run" "aria-vex-midnight-run" "email"
seed_tenant "Maison Réts"   "maison-rets" "EU VAT on checkout"      "eu-vat-checkout"       "email"
seed_tenant "Kestrel"       "kestrel"     "Instagram token expired" "ig-token-expired"      "case"

if [ -n "$DOSSIER" ] && [ -f "$DOSSIER" ]; then
  echo "→ uploading $DOSSIER into the first conversation"
  curl -fsS -b "$JAR" -X POST "$BASE/api/files" -F "file=@$DOSSIER" -F "project=$first_prj" -F "tld=fr" \
    | j "['rid']" | sed 's/^/  ✓ file /'
else
  echo "→ (no dossier CSV given — skipping the upload; pass a path as the 2nd arg to include it)"
fi

echo "→ done. Feed: $BASE/api/conversations/$first_prj/feed?lens=all"
