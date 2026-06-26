# numu — RBAC (the two permission planes)

> **Locked decision.** numu's authorization is **roles-as-data + two orthogonal planes**, enforced at one
> chokepoint per plane so every registered type inherits it for free (O(1)). The data model is
> [`OBJECTS.md`](OBJECTS.md) G2; authentication (who the caller is) is [`AUTH.md`](AUTH.md). Changing this
> is an Em-level decision. (Built in CASE 0005, slices A0–D + A2.)

## 0. The shape

- **Roles are DATA** (`roles(role, rank, is_builtin)`), not a Rust enum. A custom role is a row with a
  rank; the builtins are `viewer<member<admin<owner` at contiguous ranks 1–4. The **effective** role on an
  object is `max(rank)` over the caller's edges; an `Action` floor is a rank threshold. (`migrations/0003`.)
- **Two planes meet at the role:**
  - **Plane A — object RBAC** (`rbac.rs` + `caller::require_action`): *can the caller View/Create/Edit/
    Delete this object?* Denial is a **leak-free 404**.
  - **Plane B — field perms** (`field_perms.rs`): *which fields may that role read/write?* Denial is a
    **403**, only after Plane A admitted existence; unreadable fields are **omitted** from reads (never 403).
- **`is_platform_admin` bypasses both** (resolved on the `Caller`, [`AUTH.md`](AUTH.md)), in O(1).

## 1. Plane A — the reach resolver

`rbac::effective_rank(pool, actor, object)` = `max(roles.rank)` over the memberships the caller's
**principals** hold on the object **or any scope ancestor**:

- **Principals** = the actor + every team it transitively belongs to (recursive over team membership edges).
- **Scope cascade** = climb `entity_data.scope_parent_id` up (depth-capped 8, set-deduped → cycle-safe). A
  top-level row (`scope_parent_id IS NULL`) is reachable **only via a direct edge** — NULLs are never
  blanket-included.
- **Floors** (policy, not data): `View→viewer(1)`, `Create/Edit→member(2)`, `Delete→admin(3)` (raisable to
  `owner` per type via `method_policy.delete_min_role`).
- **No reach → `Ok(false)` → 404** (the `scope_parent_id` FK makes a foreign-parent row unrepresentable —
  the IDOR backstop).

Wired into every object handler (`objects.rs`): the item gate is per-object; the **collection LIST** is
reach-filtered (`rbac::reachable_entity_ids` — anchors + scope descendants, so a caller sees only what it
reaches, the read-side leak guard); **CREATE** requires Create-reach on the scope parent (and the parent is
mandatory for a scoped type) and stamps the creator an `owner` edge in the same txn (`db::grant_owner` —
"no object without an owner").

## 2. Plane B — field perms (rank-driven)

A field's `perm_class` gives a floor `(read_min, write_min)` over the rank ladder (`standard` = read
viewer / write member; `owner_grade` = read admin / write owner; `system`/`readonly` = never user-written),
so a **custom role slots in by rank**. A sparse **`field_permissions(type_id, field, role, can_read,
can_write)`** row overrides a specific `(type, field)` (resolved role→rank). `require_write` gates each
written field (→ `403 field_forbidden`, after existence); `filter_readable` drops unreadable fields from
reads; OPTIONS `can_read` + the per-object verb verdict reflect the caller's real rank. (`migrations/0004`.)

## 3. Object sharing + the SEV-0 guards

`/api/objects/:type/:id/members` (`members.rs`) — one reach-aware surface for **every** object (one
Membership replaces N per-vertical junctions):

- **Manage authority** = admin+ reach (no reach → 404; reach-but-not-admin → 403).
- **No privilege escalation** — can't grant a role above your own rank (subsumes only-owner-grants-owner).
- **Last-owner guard** — can't demote/remove the sole owner (409).
- **Self-leave** — a member may remove their own edge without manage authority (but not the last owner).
- **Team-nesting cycle** — granting M on O where M already contains O → 409.
- **Audit event** on every grant/revoke/change; **`context_role`** is a cosmetic label, never read by a gate.

## 4. Enforcement points & the gate

`require_action` (Plane A, all object handlers + the members surface via `require_rank`) and
`require_write`/`filter_readable` (Plane B). `tools/rbac-audit` (a `ci.sh` gate) statically proves every
entity-touching handler gates, every create grants an owner, `context_role` is never read by enforcement,
and an object denial is a leak-free 404 — so a future handler **can't silently drop a gate**.

## 5. Tests (the proof)

`#[sqlx::test]` on the ephemeral-PG `db` gate: `rbac_data` (roles/PK), `rbac_reach` (cascade, cross-tenant
404, tier floors, team-inherited reach, list-scoping, admin bypass), `rbac_sharing` (the SEV-0 guards +
the full HTTP matrix unauth-401/no-reach-404/viewer-403), `field_perms` (write gate, read filter, override).

## 6. Deliberately deferred

The 60s `Caller` cache (v0 resolves per-request → revoke is immediate; see [`AUTH.md`](AUTH.md)); a
company/tenant **contract** layer (horizontal narrowing — v0 is tier-only); a `require_rule` per-type
escape hatch; the direct-vs-scope split materialization (v0 computes the max directly).
