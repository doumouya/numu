# numu — RBAC & membership design (today + operator/customer-data evolution)

> **Purpose.** How authorization works **today** (built, in both numu and redpash-rust-pwa) and how it must
> **evolve** for **numu as a backend-office** — where numu *operators* (staff) can reach a *customer's* data
> to run the service. Part 1 is the shipped model; Parts 2–4 are a **design proposal** (decisions flagged ⚠
> for Em), not yet implemented.
>
> **Sources.** numu `docs/RBAC.md`, `docs/AUTH.md`, `crates/api/src/{rbac,caller,members,field_perms,
> objects}.rs`, `migrations/0003_rbac.sql`, `0004_field_perms.sql`; redpash `backend/crates/api/src/{rbac,
> field_perms,session}.rs`, `docs/internal/runbooks/objects-scope-parent-idor.md`, `docs/decisions/day-one.md`.
> **Companions:** [numu-objects-schema.md](numu-objects-schema.md) · [numu-legal-privacy-data-compliance.md](numu-legal-privacy-data-compliance.md)
> (operator access ↔ data-protection obligations).

---

## Part 1 — How it works today (BUILT)

> Authorization is **roles-as-data + two orthogonal planes**, enforced at one chokepoint per plane, so every
> registered type inherits it for free (O(1)). (numu CASE 0005; redpash mirrors it.)

### 1.1 Roles are data
`roles(role, rank, is_builtin)` — builtins `viewer < member < admin < owner` at contiguous ranks **1–4**; a
custom role is just a row with a rank. The **effective** role on an object is `max(rank)` over the caller's
edges; an `Action` floor is a rank threshold. (numu `migrations/0003_rbac.sql`; redpash carries the ladder as
a Rust `Role` enum today.)

### 1.2 Plane A — object reach (deny = leak-free **404**)
`rbac::effective_rank(pool, actor, object)` = `max(roles.rank)` over the memberships the caller's
**principals** hold on the object **or any scope ancestor** — a recursive CTE over two axes:

- **Principals** = the actor + every team it transitively belongs to (recursive over team-membership edges).
- **Scopes** = the object + its `entity_data.scope_parent_id` ancestors (depth-capped **8**, set-deduped →
  cycle-safe). A top-level row (`scope_parent_id IS NULL`) is reachable **only via a direct edge** — NULLs are
  never blanket-included.
- **Floors:** `View → viewer(1)`, `Create/Edit → member(2)`, `Delete → admin(3)` (raisable to `owner` per type
  via `method_policy.delete_min_role`).
- **No reach → 404.** The `scope_parent_id` **FK** makes a foreign-parent row unrepresentable — the IDOR
  backstop. Denial is indistinguishable from "doesn't exist."

Wiring (`objects.rs`): the **item** gate is per-object; the **LIST** is reach-filtered
(`rbac::reachable_entity_ids` — anchors + scope descendants); **CREATE** requires Create-reach on the
(mandatory) scope parent and stamps the creator an `owner` edge in the same txn (`db::grant_owner` — "no
object without an owner").

### 1.3 Plane B — field permissions (deny = **403**, after existence)
A field's `perm_class` gives a `(read_min, write_min)` floor on the rank ladder. **numu's built classes**
(`migrations/0004_field_perms.sql`) are `standard` = read viewer / write member; `owner_grade` = read admin /
write owner; `system`/`readonly` = never user-written. A sparse **`field_permissions(type_id, field, role,
can_read, can_write)`** row overrides a specific cell. `require_write` gates each written field (→ `403
field_forbidden`); `filter_readable` **omits** unreadable fields from reads (never a 403); `OPTIONS`
self-describes the caller's real read/write verdict. (redpash's `field_perms.rs` adds two classes —
`collaborative` = write member+ and `personal` = owner-only — and its `standard`/`owner_grade` rank floors
differ, so scope the class set to the engine: numu has **no `personal` class**.)

### 1.4 Membership = one polymorphic edge + the SEV-0 sharing guards
`memberships` has a narrowed PK `(object_id, member_id)` — **one role per edge** (a role change is a single
UPDATE, never a stacking INSERT). `member_id` is an **actor OR a team**. `context_role` is a **cosmetic
label, never read by a gate** (an invariant the `rbac-audit` CI gate proves). `/api/objects/:type/:id/members`
(`members.rs`) is the one sharing surface for every object, guarding:
- **Manage** = admin+ reach (no reach → 404; reach-but-not-admin → 403).
- **No privilege escalation** — can't grant a role above your own rank.
- **Last-owner guard** — can't demote/remove the sole owner (409).
- **Self-leave** — remove your own edge without manage authority (but not as last owner).
- **Team-nesting cycle** — granting team M on object O where M already contains O → 409.
- **Audit event** on every grant/revoke/change.

### 1.5 Platform admin + auth
`is_platform_admin` (numu: `actor.platform_role == 'admin'` — `member` is the non-admin default, so a plain
member is **not** a platform admin; `{member, admin}` is just the column's enum domain. redpash:
`users.role == 'admin'`) is resolved on the `Caller` at auth time and **bypasses both planes in O(1)**. It is distinct from `memberships.role` (per-object
reach). Auth itself (OAuth `openid email profile`, sessions, dev-login) is in `docs/AUTH.md`. redpash adds a
horizontal **`company_rbac`** versioned contract (effective = tier ∩ contract) + `type_scope_roles`; numu v0
is tier-only (contract layer deliberately deferred — `RBAC.md` §6).

### 1.6 Fixed hazards (learned patterns to keep)
From the redpash IDOR runbook + numu CASE 0008: **(1)** reach-gate the scope parent before write + FK backstop
(scope-injection); **(2)** leak-free 404 everywhere (no existence-oracle via error message); **(3)** narrow PKs
(one role per edge); **(4)** team-cycle / last-owner / no-grant-above-own-rank guards; **(5)** a static
`rbac-audit` CI gate proving every entity-touching handler gates and a denial is a 404. **These invariants
carry into everything below.**

---

## Part 2 — The new actor: numu operators over customer data (THE GAP)

Today's model gates **end-users against each other** inside a tenant (workspace/company): a project member
sees project-scoped data; a viewer can't edit; cross-tenant reach is a leak-free 404. That is correct and
sufficient **for customers**.

**numu as a backend-office introduces a second actor class: numu staff/operators** who may need to reach a
**customer's entire workspace** — to support, remediate, restore, or audit. Under data-protection law numu is
a **processor** of that customer data ([numu-legal-privacy-data-compliance.md](numu-legal-privacy-data-compliance.md)),
so operator access must be **least-privilege, purpose-limited, time-bound, and provable**. The current model
has only one staff path — `is_platform_admin`, which **bypasses both planes permanently and silently**. The
concrete gaps:

| Gap | Today | Why it matters (processor duty) |
|---|---|---|
| No operator role distinct from customer membership | staff would have to be added as a customer `member`/`admin` | leaks staff into the customer's @mentions / listings / routing; conflates "support" with "user" |
| No least-privilege staff tier | only `admin`-bypass or nothing | a support read shouldn't grant write/delete on the whole tenant |
| No purpose limitation | access has no recorded reason | GDPR Art. 5(1)(b)/28 — access needs a documented, instruction-bound purpose |
| No time-bound / break-glass | `is_platform_admin` is permanent + binary | sessions should expire + be revokable |
| **Reads are not audited** | `events` logs **writes only** (POST/PUT/PATCH/DELETE) | can't answer "who at numu saw customer PII, when, which fields" |
| `data_class` not enforced at read | it's metadata (drives export) | a read of a `personal`/`sensitive` field should be logged |
| No accountability view | no "what did operator X do in workspace Y" | security review / incident retro / DSAR support |
| Bypass is silent | admin bypass emits no distinct trail | a processor must evidence staff access |
| "Data-never-leaves-device" is a property, not a control | GlueSQL keeps cell data client-side by design | an operator export still pulls bytes server-side — unenforced |

---

## Part 3 — Proposed operator-access design (DESIGN — decisions ⚠ for Em)

Principle: **operators reach customer data through an explicit, expiring, purpose-tagged, fully-audited grant
— never by becoming a customer member, never by a silent admin bypass.** Reuse the existing machinery (the
registry, the reach resolver, the event spine) — add no second enforcement chokepoint.

### 3.1 Operator access ≠ membership
A separate **`operator_access`** edge (proposed table), distinct from `memberships`:

```
operator_access(
  operator_id   text  -- a numu staff actor (kind='service' or platform_role='admin')
  workspace_id  text  -- the customer tenant root (ORG) the grant covers
  level         text  -- 'operator_viewer' | 'operator_editor'  (NOT the customer ladder)
  purpose       text  -- ⚠ free-text or enum: support|incident|audit|maintenance + ticket ref
  authorized_by text  -- who approved (a numu admin / the customer, ⚠ decide consent model)
  granted_at    timestamptz
  expires_at    timestamptz  -- time-bound; NULL disallowed
  revoked_at    timestamptz  -- null until revoked
)
```
Resolved on the `Caller` alongside reach: an operator's effective access on a customer object = their
`operator_access` grant on the object's `workspace` ancestor, **only while `now() < expires_at AND revoked_at
IS NULL`**. Because it's a *separate* edge, the operator never appears in the customer's membership listings,
@mentions, or routing.

### 3.2 Least-privilege operator tiers
- **`operator_viewer`** — read-only diagnostic reach (View only) across the granted workspace.
- **`operator_editor`** — scoped remediation (Create/Edit), still **no** member-management / delete-tenant.
- ⚠ Decide: model these as **rows in the `roles` registry** (new ranks/flags) vs a **dedicated
  `operator_access.level`** checked *in addition to* the reach role. Recommendation: a dedicated level (keeps
  the customer ladder and the staff ladder from colliding; an operator is never "owner").

### 3.3 Purpose limitation + break-glass (replacing the silent bypass)
Every operator session carries a **purpose + authorization ref**; the UI shows a banner ("access to
<customer> until <time> — reason <ticket>, granted by <name>") with a **revoke** action. ⚠ **Revocation
rides on session propagation** — today sessions resolve per-request with an `expires_at` but there is **no
server-side revocation list** (`AUTH.md` flags the session/membership-invalidation hook as not-yet-wired), so
decide: *immediate* revoke (force a session-kill / short operator-grant TTL) vs *eventually-consistent*. The
legacy `is_platform_admin` bypass is **retained for backward-compat but reclassified**: under a `strict_operator_mode`
config flag it must go through `operator_access` too; otherwise it still works but emits a distinct
`operator.legacy_bypass` audit event (never silent).

### 3.4 Read-access audit (the missing trail)
A **separate `access_audit`** stream (proposed), distinct from `events` (which stays write-only):

```
access_audit(entity_id, actor_id, action /* View|List|Export */, field_names text[], at, request_id, purpose)
```
Written when an **operator** reads a customer object (sampling/async to avoid hot-path cost). Answers "who saw
what, when, why" and "did operator X touch workspace Y today." It is **insert-only** (no operator
UPDATE/DELETE — it is *evidence*, not telemetry) with a retention **floor** independent of general partition
rotation; this is a blocking dependency on the legal doc's retention schedule (Art. 5(1)(e) / Art. 30, F-C).

### 3.5 `data_class`-aware enforcement
Reads of fields tagged `data_class ∈ {personal, sensitive}` (see [numu-objects-schema.md](numu-objects-schema.md)
§4) by an operator **auto-append** to `access_audit` and surface a "this field is logged" UI affordance. This
makes `data_class` an *enforced* control for staff access, not just export metadata. **Prereq:** numu's
`type_fields` has **no `data_class` column yet** (it's a redpash field — see
[legal doc](numu-legal-privacy-data-compliance.md) §3.1, [objects-schema](numu-objects-schema.md) §4);
porting it is step 1 of this design.

### 3.6 Accountability
An **operator-access report** (platform-admin / a `compliance` role only): per operator × workspace × window,
the grants used + the `access_audit` + the `events` they generated — exportable for an auditor or a DSAR.

### 3.7 Tenant-isolation invariant (restated as the cross-customer wall)
The `scope_parent_id` FK + leak-free-404 (Part 1.2/1.6) is the wall between customers; operator grants are the
**only** sanctioned hole through it, and every passage is logged. The GlueSQL "customer cell data stays on the
device" posture ([numu-gluesql-postgres.md](numu-gluesql-postgres.md)) becomes an **enforceable** operator
control: operator sessions read via the client where possible, and any server-side export is a high-value
`access_audit` event (⚠ optionally blocked in `operator_viewer`).

---

## Part 4 — Migration & compatibility (DESIGN)

- **Phased, non-breaking.** Existing `is_platform_admin` keeps working (now emitting `operator.legacy_bypass`);
  new staff get `operator_access` grants. Flip `strict_operator_mode` once staff are migrated.
- **Reuses, doesn't replace.** `operator_access`/`access_audit` are **registry/data + the same reach resolver
  + the same event spine** — no new chokepoint, so the `rbac-audit` gate keeps proving coverage.
- **New CI invariants to add** (extend `rbac-audit`): an operator grant is always time-bound (`expires_at NOT
  NULL`); an operator read of a `personal`/`sensitive` field always writes `access_audit`; a legacy bypass
  always emits its event; **`access_audit` is insert-only** (no operator UPDATE/DELETE).
- **Open decisions (⚠):** customer **consent model** for operator access (notice-only vs opt-in per session);
  `operator_access.purpose` free-text vs enum; whether `operator_editor` may export; default grant TTL.

> **Status:** Part 1 is **built**. Parts 2–4 are a **design proposal** — no `operator_access`/`access_audit`
> table or operator tier exists yet. The data-protection rationale is in
> [numu-legal-privacy-data-compliance.md](numu-legal-privacy-data-compliance.md).
