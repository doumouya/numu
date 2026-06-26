# CASE 0005 — numu RBAC enforcement (turn the allow-all seam into real reach-based RBAC)

- **Status:** in_progress
- **Type:** feature
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Plan:** the re-sliced plan in `plans/hi-i-need-you-fizzy-nest.md` (review of `elegant-munching-tiger.md`)
- **Siblings:** `0003` backend foundation · `0004` CI gate (the `db` gate this builds its tests on)

## Goal

Turn numu's allow-all seam (`caller.rs` `require_action → true`, `Caller::dev()` always platform-admin)
into real **reach-based RBAC**, generalizing the proven RedPash model (roles-as-DATA, two planes,
leak-free 404→403). Built as the re-sliced sequence — each slice green, tested on the ephemeral-PG `db`
gate, committed and **held for Em's push**. RBAC core first: **A0 → B0 → B1 → B2 → C → D**.

## Slices & status

| Slice | Delivers | Status |
|---|---|---|
| **A0** | Data foundation: `roles` registry + memberships PK narrow + role FK + `actor`/`USR_dev` seed + `grant_owner` helper | **DONE (this batch)** |
| **B0** | Async-ify the `require_action` seam (mechanical; body still `Ok(true)`) | **DONE** (58e593b) |
| **B1** | Reach resolver + Plane A + reach-scoped LIST + `grant_owner` wiring + scope-required-on-create | **DONE** (e7344c7) |
| **B2** | `tools/rbac-audit` gate (require_action parity, grant_owner, context_role, deny_404) | **DONE** (this commit) |
| **C** | Object sharing `/:id/members` + the SEV-0 membership guards | **DONE** (this commit) |
| **D** | Field perms Plane B (rank-driven) + OPTIONS per-object verdict | **DONE** (a08dde2) |
| **A2** | Sessions + Caller extractor + dev-login + claim-admin; replace `Caller::dev()` | **DONE** (this commit) — enforcement is now real over HTTP |

(Auth/OAuth — A2, E0–E3, F — is the second track per the plan.)

## Delivered — A0 (data foundation)

- **`migrations/0003_rbac.sql`** — `roles(role,rank,is_builtin)` seeded `viewer/member/admin/owner` at
  contiguous ranks 1–4; narrowed `memberships` PK `(object_id,member_id,role,context_role)` →
  `(object_id,member_id)`, dropped the inline role CHECK, added FK `memberships.role → roles(role)`; seeded
  the **`actor` (USR)** type and the **`USR_dev`** entity (real `entities` + `entity_data` row). The PK fix
  is the correctness fix: role-stacking made demote / last-owner / only-owner-grants-owner unprovable.
- **`crates/api/src/db.rs`** — `grant_owner(tx, object_id, member_id)` UPSERT helper (staged
  `#[allow(dead_code)]`; wired into `coll_create` in B1).
- **`crates/api/tests/rbac_data.rs`** — 4 `#[sqlx::test]`s: roles well-formed (4 builtins, contiguous);
  role UPSERT replaces never stacks; a bogus role is a `23503` FK violation (→ 422, not a CHECK 500); the
  dev principal is a real actor.
- **`tools/ci.sh`** — the `db` gate now runs all `--features db-tests` (not just `db_smoke`), so RBAC
  matrices ride the gate as they land.
- **`docs/OBJECTS.md`** — G2 reconciled: the `roles` registry table + `memberships.role` is now an FK to it
  + the one-role-per-edge note + at-a-glance row (docs-currency).

## Verification (A0)

`bash tools/ci.sh` green with `DATABASE_URL` set: fmt ✓, clippy ✓ (`--locked -D warnings`), test 5/5 ✓,
**db ✓** (db_smoke 1 + rbac_data 4), debuggability-audit clean. Migration `0003` dry-run on a scratch DB
confirmed every A0 assertion before the Rust tests.

## Log

- **2026-06-26 — Torv:** Built A0 per the re-sliced plan. The headline fix is the `memberships` PK narrowing
  — without it every membership WRITE invariant (last-owner, only-owner-grants-owner, demote) is unprovable.
  All A0 assertions pass on the ephemeral PG. Committed on numu/main; held for Em's push. Next: B0 (async-ify
  the seam) → B1 (the reach resolver — where enforcement actually flips on).

- **2026-06-26 — Torv (B0+B1+B2, the object plane is live):** Em: proceed with the direct-edge-only NULL
  policy + "if ci is green always push without asking." Powered through the object-RBAC plane:
  - **B0** (58e593b): async-ified `require_action`/`permitted_verbs`/`rbac_verdict` + `options_body` and the
    10 call sites — pure churn, behavior unchanged.
  - **B1** (e7344c7): the reach resolver (`rbac::effective_rank` + `reachable_entity_ids`, recursive CTEs
    over team principals + the `scope_parent_id` cascade, depth-capped, cycle-safe); `require_action` now
    does admin-bypass → rank floor → reach; `coll_get` reach-filters the LIST; `coll_create` gates
    Create-reach on the scope parent, requires it (422), and `grant_owner`s the creator in-txn. Split a lib
    target so integration tests link the crate. `tests/rbac_reach.rs` (5 tests) proves cascade,
    cross-tenant→404, tier floors, team-inherited reach, list-scoping, admin bypass — all green.
  - **B2** (this commit): `tools/rbac-audit` (R1 require_action parity · R2 grant_owner · R3 context_role
    cosmetic · R4 leak-free deny_404), auto-discovered by ci.sh; self-tested to flag a gateless handler and
    a non-404 denial.

  **Enforcement is real for non-admin callers** at the resolver level (proven by `rbac_reach`); the handlers
  still pass `Caller::dev()` (admin) until **A2** wires the real `Caller` extractor — that's the next slice
  and is where the full HTTP-level matrix (a non-admin request → 404) becomes end-to-end testable. ci green
  with `DATABASE_URL` (fmt/clippy/test + db 10 + debuggability + rbac audits); pushed per the green-ci rule.
