#!/usr/bin/env bash
# access-audit — the read-accountability gate (docs/kernel/GOVERNANCE.md #2 · CASE 0017).
# Read-only static check that classified-read evidence can't silently unwire:
#   • R1 the 0019 substrate exists (access_audit, insert-only by code: no UPDATE/DELETE on it
#     anywhere in the crates).
#   • R2 both generic read paths (item GET + collection GET) flow through the record_access hook —
#     the chokepoint property GOVERNANCE #2 promises.
#   • R3 the hook records field NAMES + the request id, never values (OBSERVABILITY §6 rule 6:
#     the insert carries field_names/request_id and no data-bearing bind).
# v0 is grep/awk (under-claims, never false-positives). Exits 0 (clean/dormant) or 1 (+ FINDINGs).
# Auto-discovered by tools/ci.sh — no ci.sh edit.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# ── R0 · dormancy — arms with the read-hook slice ───────────────────────────────
if ! grep -Rql 'access_audit' migrations 2>/dev/null; then
  echo "  access-audit: dormant (access_audit not yet in schema) — arms with the read-hook slice"
  exit 0
fi

# ── R1 · substrate exists + insert-only in code ─────────────────────────────────
grep -Rq "create table access_audit" migrations ||
  flag "no-audit-table" "access_audit table missing from migrations"
if grep -Rqi "update access_audit\|delete from access_audit" crates; then
  flag "audit-mutated" "code updates/deletes access_audit rows — the table is INSERT-ONLY evidence"
fi

# ── R2 · both generic read paths flow through the hook ──────────────────────────
# The item GET records inline; the collection GET AND the nacl read plane (nacl.rs read:<type>) both
# choke through `list_core` (SLICE 2b refactor — the shared, gated, audited list core), where the hook
# now lives. Assert the hook is in item_get and list_core, and that coll_get can't bypass the core.
OBJ=crates/api/src/objects.rs
for fn_name in item_get list_core; do
  awk "/async fn $fn_name/,/^}/" "$OBJ" | grep -q "record_access" ||
    flag "unhooked-read" "$fn_name does not flow through db::record_access ($OBJ)"
done
awk '/async fn coll_get/,/^}/' "$OBJ" | grep -q "list_core" ||
  flag "unhooked-read" "coll_get does not delegate to the audited list_core ($OBJ)"

# ── R3 · names + request id, never values ───────────────────────────────────────
DB=crates/api/src/db.rs
insert=$(awk '/pub async fn record_access/,/^}/' "$DB")
grep -q "field_names" <<<"$insert" ||
  flag "no-field-names" "record_access does not carry field_names ($DB)"
grep -q "request_id" <<<"$insert" ||
  flag "no-request-id" "record_access does not carry the request id ($DB)"

if [ "$findings" -eq 0 ]; then
  echo "  access-audit: clean (0 findings)"
  exit 0
fi
echo "  access-audit: $findings finding(s) — see docs/kernel/GOVERNANCE.md #2"
exit 1
