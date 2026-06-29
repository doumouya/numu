#!/usr/bin/env bash
# mask-unenforced-audit — the data-plane SEAL gate. `method_policy.mask` is the registry-native lever that
# seals a verb on an engine-owned type (e.g. `file`/`message` must be created only via pipeline::upload_csv,
# never the generic POST /api/objects/:type). Today the mask is consulted ONLY in caller.rs (the OPTIONS
# body + Allow header) — the four mutating handlers in objects.rs gate on require_action alone and execute
# the write regardless, so the seal is advisory on the write path (the C1 seal-bypass finding). This gate
# asserts: a handler that mutates entity_data/entities must consult masked_verbs before it writes. Static
# grep/awk over crates/api/src; ratchets against ./baseline so it's green today and fails on a NEW unsealed
# mutating handler. Auto-run by tools/ci.sh. (assessment C1/M4; the fix is the Rust 405-on-masked-verb gate
# + an entity_data trigger backstop — see tools/README.md.)
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
HERE="$(cd "$(dirname "$0")" && pwd)"
FIN="$(mktemp)"; trap 'rm -f "$FIN"' EXIT
flag() { printf '[%s] %s\n' "$1" "$2" >>"$FIN"; }   # line-number-free fingerprint

# Each `async fn` in objects.rs that writes entity rows (insert/update/delete on entity_data/entities) must
# reference the mask (masked_verbs / permitted_verbs / verb_allowed) somewhere in its body. Same handler-
# scoped awk idiom as rbac-audit R1/R2.
unsealed=$(awk '
  /^async fn / { f=$3; sub(/\(.*/, "", f); mut=0; mask=0; next }
  f != "" && /insert into entity_data|insert into entities|update entity_data|delete from entities/ { mut=1 }
  f != "" && /masked_verbs|permitted_verbs|verb_allowed/ { mask=1 }
  /^}/ { if (f != "" && mut && !mask) print f; f="" }
' "$SRC"/objects.rs)
for f in $unsealed; do
  flag mask-unenforced "mutating handler '$f' writes entity rows without consulting masked_verbs (the verb seal is advisory)"
done

# ── ratchet against ./baseline (known/triaged findings; line-number-free). Shrink it as handlers are fixed.
sort -u "$FIN" -o "$FIN"
BASE="$HERE/baseline"
NEW="$(comm -23 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
GONE="$(comm -13 "$FIN" <(sort -u "$BASE" 2>/dev/null))"
if [ -n "$NEW" ]; then
  echo "  mask-unenforced-audit: NEW finding(s) — seal the verb (405 on masked) or, if triaged, add to tools/mask-unenforced-audit/baseline:"
  printf '%s\n' "$NEW" | sed 's/^/    FINDING /'
  exit 1
fi
echo "  mask-unenforced-audit: clean ($(wc -l <"$FIN" | tr -d " ") baselined finding(s))"
[ -n "$GONE" ] && { echo "  note: baselined finding(s) resolved — drop from tools/mask-unenforced-audit/baseline:"; printf '%s\n' "$GONE" | sed 's/^/    /'; }
exit 0
