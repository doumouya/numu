#!/usr/bin/env bash
# method-policy-audit — `method_policy.mask` must be ENFORCED at the mutation handler, not merely
# advertised in the OPTIONS `Allow` set (HTTP.md §7; the data-plane seal, CAS_57309651). Before the
# seal, `masked_verbs()` fed only `permitted_verbs` (OPTIONS), so a masked verb (e.g. PUT/PATCH on the
# append-only pt_event/feedback) still executed. This gate asserts every objects.rs mutation handler
# calls `caller::require_verb_unmasked` so a masked verb is a 405, not a silent success.
# Read-only grep/awk; exit 0 (clean) / 1 (+ FINDINGs). Auto-discovered by tools/ci.sh.
set -uo pipefail
cd "$(dirname "$0")/../.."
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

OBJ=crates/api/src/objects.rs
for fn_name in coll_create item_put item_patch item_delete; do
  awk "/async fn $fn_name/,/^}/" "$OBJ" | grep -q "require_verb_unmasked" ||
    flag "unmasked-mutation" "$fn_name does not call caller::require_verb_unmasked — method_policy.mask would be advisory ($OBJ)"
done

# the helper itself must actually consult the mask (guard against a stubbed no-op).
awk '/pub fn require_verb_unmasked/,/^}/' crates/api/src/caller.rs | grep -q "masked_verbs" ||
  flag "mask-helper-inert" "require_verb_unmasked does not consult masked_verbs() (crates/api/src/caller.rs)"

if [ "$findings" -eq 0 ]; then
  echo "  method-policy-audit: clean (0 findings)"
  exit 0
fi
echo "  method-policy-audit: $findings finding(s) — masked verbs must 405, not execute (HTTP.md §7)"
exit 1
