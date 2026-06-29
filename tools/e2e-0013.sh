#!/usr/bin/env bash
# tools/e2e-0013.sh — CASE 0013 live E2E (the DB-path stand-in; do NOT run cargo
# test --features db-tests — it OOMs this box, CASE 0012 env limit).
#
# This curls a RUNNING numu server and asserts the backend-observable acceptance
# criteria that need a live app+DB:
#   AC2  GET /api/health           → 200, body has "status":"ok"
#   AC1  GET /api/types/file       → body has "context_view"  (+ /api/types list half)
#   AC1  OPTIONS /api/objects/file → body has "context_view"  (Checkpoint-1 parity)
#   AC3  GET /<sentinel static>    → 200 from NUMU_WEB_DIR, AND /api/types still JSON
#        (i.e. the ServeDir fallback is mounted AFTER /api/*, so the API wins)
#
# RED TODAY (before the coder lands G1/G2/serving):
#   /api/health         → 404
#   context_view        → absent from /api/types/file and OPTIONS /api/objects/file
#   the sentinel static → no static route at all
#
# Usage:
#   1. seed + start the binary (see tools/seed-demo.sh; bind to :8099 or set BASE).
#      Point NUMU_WEB_DIR at a dir containing the sentinel file (default ./web).
#   2. drop a sentinel:  printf 'probe-ok\n' > "$NUMU_WEB_DIR/probe.txt"
#   3. BASE=http://localhost:8099 sh tools/e2e-0013.sh
#
# NOTE (tester): do NOT run this in the build phase — it needs a live server you
# should not start here. It is created + chmod +x and verified by reading only.

set -euo pipefail

BASE="${BASE:-http://localhost:8099}"
SENTINEL_PATH="${SENTINEL_PATH:-/probe.txt}"
# Cookie jar for the SameSite=Lax;HttpOnly numu_session cookie. dev-login writes it
# here (-c) and the authed checks read it back (-b). Unauthed checks (/api/health,
# the static sentinel) do NOT pass the jar.
JAR="${JAR:-/tmp/e2e0013.jar}"

pass=0
fail=0
skip=0

ok()   { printf 'PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }
note() { printf 'SKIP  %s\n' "$1"; skip=$((skip + 1)); }

# GET with status + body captured separately. Unauthed (no cookie).
http_get() {   # $1=path  → sets HTTP_CODE, HTTP_BODY
  HTTP_BODY="$(curl -sS -o /tmp/e2e0013.body -w '%{http_code}' "$BASE$1")" || true
  HTTP_CODE="$HTTP_BODY"
  HTTP_BODY="$(cat /tmp/e2e0013.body 2>/dev/null || true)"
}

# Authed GET — sends the dev-login session cookie from the jar.
http_get_auth() {   # $1=path  → sets HTTP_CODE, HTTP_BODY
  HTTP_BODY="$(curl -sS -b "$JAR" -o /tmp/e2e0013.body -w '%{http_code}' "$BASE$1")" || true
  HTTP_CODE="$HTTP_BODY"
  HTTP_BODY="$(cat /tmp/e2e0013.body 2>/dev/null || true)"
}

# Authed OPTIONS — sends the dev-login session cookie from the jar.
http_options_auth() { # $1=path → sets HTTP_CODE, HTTP_BODY
  HTTP_CODE="$(curl -sS -b "$JAR" -X OPTIONS -o /tmp/e2e0013.body -w '%{http_code}' "$BASE$1")" || true
  HTTP_BODY="$(cat /tmp/e2e0013.body 2>/dev/null || true)"
}

printf '== CASE 0013 live E2E against %s ==\n' "$BASE"

# ── Auth: dev-login → cookie jar (debug-only route; defaults actor USR_dev) ──
# POST /auth/dev-login (crates/api/src/auth.rs:104,116) mints the numu_session
# cookie into $JAR (-c). All /api/types*, OPTIONS, conversations/feed/upload checks
# below run as this session. /api/health + the static sentinel stay unauthed.
DEV_LOGIN_CODE="$(curl -sS -c "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{}' -o /tmp/e2e0013.login -w '%{http_code}' "$BASE/auth/dev-login")" || true
if [ "$DEV_LOGIN_CODE" = "200" ]; then
  ok 'AUTH  POST /auth/dev-login → 200 (numu_session cookie jarred)'
else
  bad "AUTH  POST /auth/dev-login (got code=$DEV_LOGIN_CODE) — authed checks will 401"
fi

# ── AC2: GET /api/health → 200, "status":"ok" ───────────────────────────────
http_get "/api/health"
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$HTTP_BODY" | grep -q '"status":"ok"'; then
  ok 'AC2  GET /api/health → 200 + "status":"ok"'
else
  bad "AC2  GET /api/health (got code=$HTTP_CODE body=$HTTP_BODY)"
fi

# ── AC1: GET /api/types/file carries context_view (authed) ───────────────────
http_get_auth "/api/types/file"
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$HTTP_BODY" | grep -q '"context_view"'; then
  ok 'AC1  GET /api/types/file → body has "context_view"'
else
  bad "AC1  GET /api/types/file missing context_view (code=$HTTP_CODE)"
fi

# ── AC1: GET /api/types (catalog) carries context_view per entry (authed) ─────
http_get_auth "/api/types"
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$HTTP_BODY" | grep -q '"context_view"'; then
  ok 'AC1  GET /api/types → catalog entries carry "context_view"'
else
  bad "AC1  GET /api/types catalog missing context_view (code=$HTTP_CODE)"
fi

# ── AC1-OPTIONS-parity: KNOWN ISSUE (Case 0016), DESCOPED from 0013 ──────────
# OPTIONS /api/objects/:type SHOULD echo context_view in its options_body
# (objects.rs emits it at the handler), but tower_http::cors::CorsLayer (lib.rs,
# outermost) short-circuits ALL OPTIONS as CORS preflight before the router, so
# coll_options/item_options never run → empty 200. Pre-existing (CORS landed Case
# 0009), filed as Case 0016. Em descoped OPTIONS-parity from 0013; the frontend
# reads context_view from GET /api/types/:type (above, LIVE-GREEN). This is a
# SKIP, NOT a FAIL — it does not count toward the failure exit.
http_options_auth "/api/objects/file"
if printf '%s' "$HTTP_BODY" | grep -q '"context_view"'; then
  ok 'AC1  OPTIONS /api/objects/file → options_body has "context_view" (parity, Case 0016 fixed)'
else
  note 'AC1-OPTIONS-parity — blocked by Case 0016 (CorsLayer shadows OPTIONS); frontend uses GET /api/types/:type'
fi

# ── AC3: sentinel static served by ServeDir (mounted AFTER /api/*) ───────────
http_get "$SENTINEL_PATH"
if [ "$HTTP_CODE" = "200" ]; then
  ok "AC3  GET $SENTINEL_PATH → 200 (ServeDir from NUMU_WEB_DIR)"
else
  bad "AC3  GET $SENTINEL_PATH not served (code=$HTTP_CODE) — no static route?"
fi

# ── AC3: /api/types STILL hits the API (not the file server) — ordering proof ─
http_get_auth "/api/types"
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$HTTP_BODY" | grep -q '"types"'; then
  ok 'AC3  GET /api/types still returns API JSON (API wins over ServeDir)'
else
  bad "AC3  GET /api/types not served by API (code=$HTTP_CODE body head=$(printf '%s' "$HTTP_BODY" | head -c 80))"
fi

printf '\nCASE 0013 E2E: %d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"

# =============================================================================
# AC8 [MANUAL-E2E] — the killer flow (run by hand on the R3 Shell proof page).
# These are NOT automated here (no headless page harness on lean); follow them
# manually against the seeded live DB, same-origin served by the binary.
#
#   0. Seed + serve:   tools/seed-demo.sh ; start the DEBUG binary (dev-login is
#      compiled in only under debug_assertions — auth.rs:115) with NUMU_WEB_DIR
#      pointing at numu/web. The automated checks above POST /auth/dev-login (no
#      env flag needed — the route exists in any debug build).
#   1. Dev-login:      open the app same-origin; confirm the SameSite=Lax;HttpOnly
#      session cookie is set; network panel shows /api/* 200s with the cookie.
#   2. Seam is live:   on "R3 Shell.dc.html" confirm AutoClient.isLive() === true
#      (the page must be flipped makeClient("fixture") → makeClient("auto"), G7).
#   3. Conversations:  the conversations list binds to the seeded tenants/projects.
#   4. Open dossier:   open the seeded `dossier.csv` conversation → the feed
#      renders real, time-ordered items (messages ∪ artifacts ∪ events).
#   5. Lens filter:    lens = customer | mine | all filters the feed live
#      (a WHERE on visibility — internal items hidden under `customer`).
#   6. Bogus id → 404: requesting a non-existent object id yields a 404 (leak-free).
#   7. Upload:         upload a CSV → POST /api/files → UploadOutcome renders
#      (encoding, cleanness, columns).
#   8. Archetype:      list/detail pick the right archetype via contextView (G1)
#      — e.g. file → "table", project → "thread".
#   9. Edit:           edit a record → update() sends If-Match: W/"<version>" built
#      from the flattened _version (G4); the write succeeds and bumps the version.
#  10. Stale → 412:    re-submit with a stale version → 412 Precondition Failed.
# =============================================================================

[ "$fail" -eq 0 ]
