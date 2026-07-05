#!/usr/bin/env bash
# capability-audit — the Plane-C confinement gate (docs/api/RBAC.md · CASE 0016). Read-only static
# check that the capability plane can't silently unwire:
#   • R1 the DB substrate exists — capability_grant + condition with CHECK-pinned vocabularies
#     (0018); dropping either is schema drift this gate catches at the seam the DB can't.
#   • R2 the object gate consults Plane C BEFORE the platform-admin bypass — a confined deputy
#     stays confined whoever drives it (the confused-deputy rule).
#   • R3 the session extractor resolves an acting surface, and a session can never claim the `app`
#     surface (app faces authenticate with app tokens, not cookies).
#   • R4 the field loop enforces the max_data_class ceiling in all three paths (read filter,
#     readable set, write gate).
# v0 is grep/awk (under-claims, never false-positives). Exits 0 (clean/dormant) or 1 (+ FINDINGs).
# Auto-discovered by tools/ci.sh — no ci.sh edit.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# ── R0 · dormancy — arms with the Plane-C slice ────────────────────────────────
if ! grep -Rql 'capability_grant' migrations 2>/dev/null; then
  echo "  capability-audit: dormant (capability_grant not yet in schema) — arms with the Plane-C slice"
  exit 0
fi

# ── R1 · the DB guard exists ────────────────────────────────────────────────────
grep -Rq "create table capability_grant" migrations ||
  flag "no-grant-table" "capability_grant table missing from migrations"
grep -Rq "surface_kind in ('console','app','agent')" migrations ||
  flag "no-surface-check" "capability_grant.surface_kind CHECK vocabulary missing"
grep -Rq "create table condition" migrations ||
  flag "no-condition-table" "condition table missing from migrations"
grep -Rq "'kyc_verified','purpose_limited','ttl','owner_grade','max_data_class'" migrations ||
  flag "no-condition-vocab" "condition.kind CHECK vocabulary missing/changed — reconcile the gate + docs"

# ── R2 · Plane C runs before the admin bypass in require_action ─────────────────
CALLER=crates/api/src/caller.rs
body=$(awk '/pub async fn require_action/,/^}/' "$CALLER")
if ! grep -q "plane_c_admit" <<<"$body"; then
  flag "gateless-object-gate" "require_action does not consult plane_c_admit ($CALLER)"
else
  c_line=$(grep -n "plane_c_admit" <<<"$body" | head -1 | cut -d: -f1)
  a_line=$(grep -n "is_platform_admin" <<<"$body" | head -1 | cut -d: -f1)
  if [ -n "$a_line" ] && [ "$c_line" -gt "$a_line" ]; then
    flag "admin-bypasses-plane-c" "require_action checks is_platform_admin before plane_c_admit — a confined deputy must stay confined"
  fi
fi

# ── R3 · the extractor resolves a surface; sessions never claim `app` ───────────
AUTH=crates/api/src/auth.rs
grep -q "SurfaceKind::Agent" "$AUTH" ||
  flag "no-surface-resolution" "the session extractor does not resolve an agent surface ($AUTH)"
if grep -q "SurfaceKind::App" "$AUTH"; then
  flag "session-claims-app" "a cookie session must never claim the app surface — app faces use app tokens ($AUTH)"
fi

# ── R4 · the field ceiling is enforced in all three field paths ─────────────────
FP=crates/api/src/field_perms.rs
for fn_name in filter_readable readable_set require_write; do
  awk "/pub async fn $fn_name/,/^}/" "$FP" | grep -q "ceiling_admits" ||
    flag "ceiling-unwired" "$fn_name does not consult ceiling_admits ($FP)"
done

# ── R5 · the membership surface is confined ─────────────────────────────────────
MEM=crates/api/src/members.rs
awk '/async fn require_rank/,/^}/' "$MEM" | grep -q "plane_c_admit_type" ||
  flag "members-unconfined" "members require_rank does not consult plane_c_admit_type ($MEM)"

# ── R6 · omnisearch is confined to the surface's view grants ────────────────────
SRCH=crates/api/src/search.rs
grep -q "plane_c_view_types" "$SRCH" ||
  flag "search-unconfined" "omnisearch does not consult plane_c_view_types ($SRCH)"

if [ "$findings" -eq 0 ]; then
  echo "  capability-audit: clean (0 findings)"
  exit 0
fi
echo "  capability-audit: $findings finding(s) — see docs/api/RBAC.md (Plane C)"
exit 1
