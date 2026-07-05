# numu — RBAC (the three permission planes)

> **Locked decision.** numu's authorization is **roles-as-data + orthogonal planes**, enforced at one
> chokepoint per plane so every registered type inherits it for free (O(1)). The data model is
> [`OBJECTS.md`](OBJECTS.md) G2; authentication (who the caller is) is [`AUTH.md`](AUTH.md). Changing this
> is an Em-level decision. (Planes A+B built in CASE 0005, slices A0–D + A2; Plane C in CASE 0016.)

## 0. The shape

- **Roles are DATA** (`roles(role, rank, is_builtin)`), not a Rust enum. A custom role is a row with a
  rank; the builtins are `viewer<member<admin<owner` at contiguous ranks 1–4. The **effective** role on an
  object is `max(rank)` over the caller's edges; an `Action` floor is a rank threshold. (`migrations/0003`.)
- **Three planes:**
  - **Plane A — object RBAC** (`rbac.rs` + `caller::require_action`): *can the caller View/Create/Edit/
    Delete this object?* Denial is a **leak-free 404**.
  - **Plane B — field perms** (`field_perms.rs`): *which fields may that role read/write?* Denial is a
    **403**, only after Plane A admitted existence; unreadable fields are **omitted** from reads (never 403).
  - **Plane C — capability confinement** (§2b, `caller::plane_c_admit`): *may the acting SURFACE
    (console | app | agent) perform this at all?* Console is default-allow; app/agent are
    **default-deny** — a `capability_grant` (+ optional `condition`) admits them. Denial is the same
    leak-free 404.
- **`is_platform_admin` bypasses A and B** (resolved on the `Caller`, [`AUTH.md`](AUTH.md)), in O(1).
  It does **NOT** bypass C: a powerful principal acting through a confined surface stays confined
  (the confused-deputy rule). **Effective = A ∩ B ∩ C.**

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

## 2b. Plane C — capability confinement of the acting surface

The **acting surface** is WHO/WHAT the request arrives through, orthogonal to the principal: the
session extractor resolves it from the actor's `kind` — a human session is `console` (`'*'`); an
`agent`/`service` principal **is its own confined surface** (`agent`, its actor id); app faces tag
`app` via app tokens when the faces land (a cookie session can never claim `app`). Substrate
(`migrations/0018`): `capability_grant(surface_kind, surface_id, type_id|'*', action|'*',
scope_id?, condition_id?)` — default-deny for app/agent, absence of a matching row = denied — and
`condition(kind ∈ kyc_verified | purpose_limited | ttl | owner_grade | max_data_class, params)`,
pure predicates over present facts (evaluable in the Rust gate AND the wasm sim).

- **Gate order**: `require_action` runs Plane C **before** the platform-admin bypass; a Plane-C
  refusal is the same leak-free 404 as no reach.
- **`purpose_limited`** binds the request's declared purpose (`X-Numu-Purpose`, shape-checked,
  self-declared — it binds, it doesn't prove); **`ttl`** compares the grant's issue time
  (expired ⇒ fail closed); **`kyc_verified`** reads the actor's `kyc_status`.
- **`max_data_class`** is field-level: the extractor resolves the surface's strictest ceiling
  (severity order `public < internal < personal < sensitive`, 0016) onto
  `caller.data_class_ceiling`; `field_perms` then drops fields above the ceiling from reads and
  refuses writes — **regardless of rank, admin included**. "Billing Watch may read transactions
  but never `actor.email`" is one grant + the seeded `no_sensitive` condition, not code.
- **Every read/write surface is confined, not just the object handlers**: the membership surface
  (`members.rs require_rank`) requires an `edit` grant on the object's type; **omnisearch**
  restricts results to the surface's admitted `view` grants (grantless ⇒ empty set, wildcard ⇒
  unrestricted) — on the admin branch too.
- *Gate:* `tools/capability-audit` — the substrate exists, Plane C precedes the admin bypass, the
  extractor resolves surfaces (and never `app` from a cookie), the ceiling is wired in all three
  field paths, and the members + search surfaces stay confined.

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

`require_action` (Planes A + C, all object handlers + the members surface via `require_rank`) and
`require_write`/`filter_readable` (Plane B + the Plane-C ceiling). `tools/rbac-audit` (a `ci.sh` gate)
statically proves every entity-touching handler gates, every create grants an owner, `context_role` is
never read by enforcement, and an object denial is a leak-free 404; `tools/capability-audit` proves the
Plane-C wiring — so a future handler **can't silently drop a gate**. Classified reads leave evidence:
`db::record_access` appends an insert-only `access_audit` row when a read returns any
`personal|sensitive` field ([GOVERNANCE #2](../kernel/GOVERNANCE.md); `tools/access-audit`).

## 5. Tests (the proof)

`#[sqlx::test]` on the ephemeral-PG `db` gate: `rbac_data` (roles/PK), `rbac_reach` (cascade, cross-tenant
404, tier floors, team-inherited reach, list-scoping, admin bypass), `rbac_sharing` (the SEV-0 guards +
the full HTTP matrix unauth-401/no-reach-404/viewer-403), `field_perms` (write gate, read filter, override),
`plane_c` (default-deny, grant scope, wildcard, admin-stays-confined, ttl/purpose conditions, the
data-class ceiling, the access-audit row shape).

## 6. Deliberately deferred

The 60s `Caller` cache (v0 resolves per-request → revoke is immediate; see [`AUTH.md`](AUTH.md)); a
company/tenant **contract** layer (horizontal narrowing — v0 is tier-only); a `require_rule` per-type
escape hatch; the direct-vs-scope split materialization (v0 computes the max directly).
