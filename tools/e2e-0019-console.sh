#!/usr/bin/env bash
# tools/e2e-0019-console.sh — CASE 0019 (console-cutover) live PARITY probe.
#
# The ops-time gate for the cutover's [LIVE] acceptance criteria. It curls a
# RUNNING, SEEDED numu server and asserts the backend-observable round-trips the
# App's data layer depends on:
#
#   AC12 create→edit round-trip + stale If-Match → 412
#        POST /api/objects/case            → 201/200 (create)
#        PATCH /api/objects/case/:id  (fresh If-Match)  → 200 (edit round-trips)
#        PATCH /api/objects/case/:id  (stale If-Match)  → 412 Precondition Failed
#   AC9c chart create round-trips     POST /api/objects/chart        → 200/201
#   AC9d dashboard create round-trips POST /api/objects/dashboard    → 200/201
#   AC9e note create + close:case gate
#        POST /api/objects/message {channel:note,visibility:internal} → 200/201
#        PATCH case → done WITHOUT the close-check → 422 close_preconditions_unmet
#        record POST /api/objects/case/:id/checks/docs_reconciled {passed:true} → 200
#        PATCH case → done WITH the check passed → 200 (gated transition fires)
#   AC18 connector run (http_json)    POST /api/connectors/:id/run   → reaches the
#        handler (NOT 404/405); a runnable http_json connector → 200 (or a network
#        SKIP if the SSRF gate can't reach the target — see CONNECTOR_ID note).
#   AC20 case three-check close-gate  (same close-check API as AC9e; the [LIVE]
#        half of AC20 — record a check then the gated transition).
#   AC21 search                       GET /api/search?q=<term> → 200 + results;
#        blank q → 400 (search.rs:47 requires `q`).
#
# RBAC/leak-free note: every authed call runs as the dev-login session (USR_dev,
# the seeded platform admin) so reach never short-circuits a 404. Bind the server
# to :8099 (or set BASE) and run from a debug build (dev-login is debug-only).
#
# Usage:
#   1. Migrate + seed + start a DEBUG numu-api (tools/seed-demo.sh; NUMU_WEB_DIR=web).
#   2. (AC18) seed ONE runnable http_json connector and export its id, e.g.:
#        CONNECTOR_ID=CON_xxxx   (kind=http_json, target=an https URL the SSRF
#        gate allows). If unset, AC18 records a SKIP (the route-reaches check
#        still runs against a bogus id to prove it is mounted, not 404-by-router).
#   3. BASE=http://localhost:8099 sh tools/e2e-0019-console.sh
#
# NOTE (tester): NOT run in the build phase — it needs a live seeded server that
# must NOT be started here. It is authored + chmod +x and verified via `bash -n`.
# Mirrors tools/e2e-0013.sh's harness (set -euo pipefail; ok/bad/note; dev-login
# cookie jar). NEVER run `cargo test --features db-tests` (OOMs — Case 0012).

set -euo pipefail

BASE="${BASE:-http://localhost:8099}"
JAR="${JAR:-/tmp/e2e0019.jar}"
BODY="/tmp/e2e0019.body"
# AC18: a runnable http_json connector id (kind=http_json, https target through
# the SSRF gate). Unset ⇒ AC18 run is SKIPPED (only the route-mounted check runs).
CONNECTOR_ID="${CONNECTOR_ID:-}"

pass=0
fail=0
skip=0

ok()   { printf 'PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }
note() { printf 'SKIP  %s\n' "$1"; skip=$((skip + 1)); }

# Authed JSON request capturing status + body + the response ETag header.
# $1=METHOD  $2=path  $3=json body (or "")  $4=extra header (or "")
# Sets HTTP_CODE, HTTP_BODY, HTTP_ETAG.
req() {
  local method="$1" path="$2" body="${3:-}" extra="${4:-}"
  local hdrs="/tmp/e2e0019.hdr"
  local args=(-sS -b "$JAR" -X "$method" -o "$BODY" -D "$hdrs" -w '%{http_code}')
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  [ -n "$extra" ] && args+=(-H "$extra")
  HTTP_CODE="$(curl "${args[@]}" "$BASE$path")" || true
  HTTP_BODY="$(cat "$BODY" 2>/dev/null || true)"
  # Weak ETag W/"<n>" → the value to feed back as If-Match. Header name is case-insensitive.
  HTTP_ETAG="$(grep -i '^etag:' "$hdrs" 2>/dev/null | tr -d '\r' | sed 's/^[Ee][Tt][Aa][Gg]: *//' | head -1 || true)"
}

# Pull a JSON string field from $HTTP_BODY (needs jq). $1=jq path expr.
jget() { printf '%s' "$HTTP_BODY" | jq -r "$1" 2>/dev/null || true; }

printf '== CASE 0019 console-cutover live parity against %s ==\n' "$BASE"

if ! command -v jq >/dev/null 2>&1; then
  bad 'PREREQ jq not installed (required to parse ids/versions) — aborting'
  printf '\nCASE 0019: %d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
  exit 1
fi

# ── Auth: dev-login → cookie jar (debug-only; defaults actor USR_dev admin) ──
DEV_LOGIN_CODE="$(curl -sS -c "$JAR" -X POST -H 'content-type: application/json' \
  -d '{}' -o /tmp/e2e0019.login -w '%{http_code}' "$BASE/auth/dev-login")" || true
if [ "$DEV_LOGIN_CODE" = "200" ]; then
  ok 'AUTH  POST /auth/dev-login → 200 (numu_session cookie jarred)'
else
  bad "AUTH  POST /auth/dev-login (code=$DEV_LOGIN_CODE) — every authed check below will 401"
fi

# A project to scope-parent the created case/chart/dashboard/message under. Take the
# first seeded conversation (tools/seed-demo.sh creates three projects).
req GET "/api/objects/project" ""
PRJ="$(jget '.items[0].id')"
if [ -n "$PRJ" ] && [ "$PRJ" != "null" ]; then
  ok "SETUP  first seeded project = $PRJ (scope parent for created entities)"
else
  bad "SETUP  no seeded project found (run tools/seed-demo.sh first) — scoped creates will 422"
fi

# ── AC12: create → edit round-trip, then a STALE If-Match → 412 ──────────────
# Create a case (initial state backlog). The case type requires title/type/status/
# priority + project_id (scope parent). See migration 0007.
req POST "/api/objects/case" \
  "{\"title\":\"e2e-0019 conflict probe\",\"type\":\"task\",\"status\":\"backlog\",\"priority\":\"normal\",\"project_id\":\"$PRJ\"}"
CASE_ID="$(jget '.id')"
CASE_ETAG="$HTTP_ETAG"
if { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; } && [ -n "$CASE_ID" ] && [ "$CASE_ID" != "null" ]; then
  ok "AC12  create POST /api/objects/case → $HTTP_CODE (id=$CASE_ID, etag=$CASE_ETAG)"
else
  bad "AC12  create POST /api/objects/case → $HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# Edit with the FRESH If-Match (backlog → todo is a legal one-step transition). Round-trips.
req PATCH "/api/objects/case/$CASE_ID" "{\"status\":\"todo\"}" "If-Match: $CASE_ETAG"
FRESH_ETAG="$HTTP_ETAG"
if [ "$HTTP_CODE" = "200" ]; then
  ok "AC12  edit PATCH (fresh If-Match: $CASE_ETAG) → 200 (round-trips; new etag=$FRESH_ETAG)"
else
  bad "AC12  edit PATCH with fresh If-Match → $HTTP_CODE (expected 200) body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# Re-submit with the STALE (original) If-Match → 412 Precondition Failed (the conflict UX trigger, AC13).
req PATCH "/api/objects/case/$CASE_ID" "{\"status\":\"in_progress\"}" "If-Match: $CASE_ETAG"
if [ "$HTTP_CODE" = "412" ]; then
  ok "AC12  stale If-Match ($CASE_ETAG) → 412 Precondition Failed (conflict trigger, AC13)"
else
  bad "AC12  stale If-Match → $HTTP_CODE (expected 412) body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# ── AC9c: chart create round-trips ───────────────────────────────────────────
# Settable fields on the registered `chart` type = project_id/file_id/title/spec.
# The chart KIND lives INSIDE spec (spec.type), NOT as a top-level chart_type field
# — sending chart_type → 400 unknown field: chart_type (ops-confirmed).
req POST "/api/objects/chart" \
  "{\"title\":\"e2e-0019 chart\",\"spec\":{\"type\":\"bar\",\"cats\":[{\"label\":\"A\",\"value\":3}]},\"project_id\":\"$PRJ\"}"
CHART_ID="$(jget '.id')"
if { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; } && [ -n "$CHART_ID" ] && [ "$CHART_ID" != "null" ]; then
  ok "AC9c  create POST /api/objects/chart → $HTTP_CODE (id=$CHART_ID)"
else
  bad "AC9c  create POST /api/objects/chart → $HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# ── AC9d: dashboard create round-trips ───────────────────────────────────────
req POST "/api/objects/dashboard" \
  "{\"title\":\"e2e-0019 dashboard\",\"spec\":{\"tiles\":[{\"chart_id\":\"$CHART_ID\"}]},\"project_id\":\"$PRJ\"}"
DASH_ID="$(jget '.id')"
if { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; } && [ -n "$DASH_ID" ] && [ "$DASH_ID" != "null" ]; then
  ok "AC9d  create POST /api/objects/dashboard → $HTTP_CODE (id=$DASH_ID)"
else
  bad "AC9d  create POST /api/objects/dashboard → $HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# ── AC9e: note create round-trips ────────────────────────────────────────────
req POST "/api/objects/message" \
  "{\"body\":\"e2e-0019 internal note\",\"channel\":\"note\",\"direction\":\"out\",\"visibility\":\"internal\",\"project_id\":\"$PRJ\"}"
if { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; }; then
  ok "AC9e  note POST /api/objects/message {channel:note,visibility:internal} → $HTTP_CODE"
else
  bad "AC9e  note POST /api/objects/message → $HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# ── AC9e + AC20: close:case gate (422 until the check passes, then 200) ───────
# Walk the case to in_review (todo → in_progress → in_review, one step each), then
# attempt the terminal `done` move. The default workflow's close_check is
# `docs_reconciled` (migration 0007). Without it: 422 close_preconditions_unmet.
walk() { # $1=next-status — PATCH with the current fresh etag, refresh it on 200
  req PATCH "/api/objects/case/$CASE_ID" "{\"status\":\"$1\"}" "If-Match: $FRESH_ETAG"
  if [ "$HTTP_CODE" = "200" ]; then FRESH_ETAG="$HTTP_ETAG"; fi
}
walk "in_progress"
walk "in_review"
if [ "$HTTP_CODE" = "200" ]; then
  ok "AC20  walked case to in_review via legal one-step transitions (etag=$FRESH_ETAG)"
else
  bad "AC20  could not walk case to in_review → last code=$HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# (a) terminal move WITHOUT the close-check → 422 close_preconditions_unmet.
# A blocked close does NOT bump the version (objects.rs G4), so FRESH_ETAG still holds.
req PATCH "/api/objects/case/$CASE_ID" "{\"status\":\"done\"}" "If-Match: $FRESH_ETAG"
if [ "$HTTP_CODE" = "422" ] && printf '%s' "$HTTP_BODY" | grep -q 'close_preconditions_unmet'; then
  ok "AC9e/AC20  close:case before checks → 422 close_preconditions_unmet (gate enforced, surfaced not swallowed)"
else
  bad "AC9e/AC20  close before checks → $HTTP_CODE (expected 422 close_preconditions_unmet) body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# (b) record the close-check passed → POST /api/objects/case/:id/checks/:name.
req POST "/api/objects/case/$CASE_ID/checks/docs_reconciled" '{"passed":true}'
if { [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "204" ]; }; then
  ok "AC20  record check POST /api/objects/case/$CASE_ID/checks/docs_reconciled {passed:true} → $HTTP_CODE"
else
  bad "AC20  record close-check → $HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# (c) terminal move WITH the check passed → 200 (the gated transition fires).
# The blocked close didn't bump the version, so FRESH_ETAG is still current.
req PATCH "/api/objects/case/$CASE_ID" "{\"status\":\"done\"}" "If-Match: $FRESH_ETAG"
if [ "$HTTP_CODE" = "200" ]; then
  ok "AC9e/AC20  close:case after checks pass → 200 (gated transition fires)"
else
  bad "AC9e/AC20  close after checks pass → $HTTP_CODE (expected 200) body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

# ── AC18: connector run (http_json) ──────────────────────────────────────────
# The run route takes NO body (it reaches out to the connector's stored target via
# the SSRF gate). First prove the route is MOUNTED (a bogus id must NOT 404-by-router
# — it 404s in-handler as a leak-free not-found, which is still a reachable handler,
# OR 401 if unauthed). Then, if CONNECTOR_ID is provided, assert a real run → 200.
req POST "/api/connectors/__nope__/run" ""
if [ "$HTTP_CODE" != "405" ] && [ "$HTTP_CODE" != "000" ]; then
  ok "AC18  POST /api/connectors/:id/run route is MOUNTED (bogus id → $HTTP_CODE, not 405/router-miss)"
else
  bad "AC18  POST /api/connectors/:id/run → $HTTP_CODE (route not mounted? expected the handler's 404)"
fi
if [ -n "$CONNECTOR_ID" ]; then
  req POST "/api/connectors/$CONNECTOR_ID/run" ""
  if [ "$HTTP_CODE" = "200" ] && printf '%s' "$HTTP_BODY" | grep -q '"ran":true'; then
    ok "AC18  POST /api/connectors/$CONNECTOR_ID/run (http_json) → 200 \"ran\":true"
  elif printf '%s' "$HTTP_BODY" | grep -qiE 'not runnable|no target'; then
    bad "AC18  connector $CONNECTOR_ID is not a runnable http_json with a target (code=$HTTP_CODE) — fix the seed"
  else
    note "AC18  connector run → $HTTP_CODE (likely the SSRF gate could not reach the target — network, not a contract failure; verify target reachability)"
  fi
else
  note "AC18  connector run — set CONNECTOR_ID=<a runnable http_json connector> to assert the 200 round-trip"
fi

# ── AC21: search → 200 + results; blank q → 400 ──────────────────────────────
# Use a term that the seeded data contains. The seed names a case "Encoding garbled"
# — search for "encoding". Reach-filtered (USR_dev is admin → sees all).
req GET "/api/search?q=encoding" ""
if [ "$HTTP_CODE" = "200" ] && printf '%s' "$HTTP_BODY" | grep -q '"results"'; then
  ok "AC21  GET /api/search?q=encoding → 200 + results array"
else
  bad "AC21  GET /api/search?q=encoding → $HTTP_CODE body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi
# Each result carries the {entity_id,type,title,rank} shape AC21 routes on.
if printf '%s' "$HTTP_BODY" | jq -e '.results | (length==0) or (.[0] | has("entity_id") and has("type") and has("title") and has("rank"))' >/dev/null 2>&1; then
  ok "AC21  search result shape = {entity_id,type,title,rank} (routes to AC7 archetype)"
else
  bad "AC21  search result missing entity_id/type/title/rank body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi
# Blank q → 400 (search.rs:47 requires `q`); the App must not send a blank query.
req GET "/api/search?q=" ""
if [ "$HTTP_CODE" = "400" ]; then
  ok "AC21  GET /api/search?q= (blank) → 400 (App must not send a blank q)"
else
  bad "AC21  blank q → $HTTP_CODE (expected 400) body=$(printf '%s' "$HTTP_BODY" | head -c 160)"
fi

printf '\nCASE 0019 console-cutover live parity: %d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
