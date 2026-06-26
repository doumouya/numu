#!/usr/bin/env bash
# rbac-audit — the RBAC enforcement gate (slice B2). Static checks that the Plane-A invariants hold across
# crates/api/src, so a NEW handler can't silently drop a gate while CI stays green. Read-only grep/awk;
# exits 0 (clean) / 1 (+ a FINDING list). Auto-run by tools/ci.sh's tools/*-audit loop — no ci.sh edit.
# (docs/HTTP.md §4, plan slices B1/B2, CASE 0005.)
set -uo pipefail
cd "$(dirname "$0")/../.."
SRC=crates/api/src
findings=0
flag() { echo "  FINDING [$1] $2"; findings=$((findings + 1)); }

# R1 — every objects.rs handler that reads/writes entity data must call require_action (the object gate).
gateless=$(awk '
  /^async fn / { f=$3; sub(/\(.*/, "", f); db=0; g=0; next }
  f != "" && /entity_data|insert into entities|reachable_entity_ids/ { db=1 }
  f != "" && /require_action/ { g=1 }
  /^}/ { if (f != "" && db && !g) print f; f="" }
' "$SRC"/objects.rs)
for f in $gateless; do flag require-action-parity "handler '$f' reads/writes entity data without require_action"; done

# R2 — every create path (insert into entities) must grant the creator an owner edge (no ownerless object).
ownerless=$(awk '
  /^async fn / { f=$3; sub(/\(.*/, "", f); ins=0; g=0; next }
  f != "" && /insert into entities/ { ins=1 }
  f != "" && /grant_owner/ { g=1 }
  /^}/ { if (f != "" && ins && !g) print f; f="" }
' "$SRC"/objects.rs)
for f in $ownerless; do flag grant-owner "create path '$f' inserts an entity without db::grant_owner"; done

# R3 — context_role is cosmetic (day-one #9): the enforcement path must never read it.
if grep -n 'context_role' "$SRC"/rbac.rs "$SRC"/caller.rs 2>/dev/null; then
  flag context-role-cosmetic "context_role referenced in enforcement code (rbac.rs/caller.rs) — it must stay a cosmetic label"
fi

# R4 — an object-gate denial is a leak-free 404 (deny_404), never a 403/forbidden (Plane B is 403, after
# existence). Checks the line after each require_action denial returns deny_404.
badlines=$(awk '
  /!caller::require_action/ { pend=1; next }
  pend { if ($0 !~ /deny_404/) print FNR; pend=0 }
' "$SRC"/objects.rs)
for ln in $badlines; do flag leak-free-404 "a require_action denial near objects.rs:$ln does not return deny_404"; done

if [ "$findings" -eq 0 ]; then
  echo "  rbac-audit: clean (0 findings)"
  exit 0
else
  echo "  rbac-audit: $findings finding(s) — see docs/HTTP.md §4"
  exit 1
fi
