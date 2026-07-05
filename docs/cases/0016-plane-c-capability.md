# CASE 0016 — Plane C: capability confinement of the acting surface

**Origin:** the RBAC/metadata slice roadmap (`plane-c-capability-migration-draft.md`) +
[`../api/RBAC.md`](../api/RBAC.md) §2b. Theme: **who/what the request arrives THROUGH is confined
independently of who drives it** — console default-allow, app/agent default-deny, effective =
A ∩ B ∩ C.

## Landed

- **`migrations/0018_capability_plane.sql`** — `capability_grant` (surface × type × action, `'*'`
  wildcards, optional scope + condition) and `condition` (`kyc_verified · purpose_limited · ttl ·
  owner_grade · max_data_class`, CHECK-pinned), + three seeded reusable conditions.
- **`caller.rs`** — `Surface`/`SurfaceKind` on the `Caller`; `plane_c_admit` runs in
  `require_action` **before the platform-admin bypass** (a confined deputy stays confined);
  `condition_holds` evaluates pure predicates (unknown kind ⇒ fail closed; TTL via epoch seconds).
- **`auth.rs`** — the extractor resolves the surface from the actor's `kind` (human → console;
  `agent`/`service` → its own agent surface — `numu-sync` is confined from this commit on), the
  declared purpose (`X-Numu-Purpose`, shape-checked), and the surface's strictest `max_data_class`
  ceiling (severity-ordered, not alphabetical). A cookie session can never claim `app`.
- **`field_perms.rs`** — `ceiling_admits`: fields above the surface ceiling drop from
  `filter_readable`/`readable_set` and are refused by `require_write` — regardless of rank.
- **The non-object surfaces confined too** (found adversarially before commit): `members.rs
  require_rank` gains the Plane-C step (membership management = `edit` on the object's type —
  before the admin bypass); `search.rs` restricts omnisearch to the surface's admitted view
  grants at the SQL level (`plane_c_view_types`: grantless ⇒ empty results, wildcard ⇒
  unrestricted), on the platform-admin branch as well.
- **`tools/capability-audit/`** — R1 substrate exists · R2 Plane C precedes the admin bypass ·
  R3 the extractor resolves surfaces and never mints `app` from a cookie · R4 the ceiling is wired
  in all three field paths · R5 members confined · R6 search confined. Self-arming; auto-discovered.
- **Tests** (`tests/plane_c.rs`): default-deny despite owner reach · grant admits exactly its
  (type, action) · wildcard · **admin-stays-confined** · expired ttl fails closed ·
  purpose_limited binds the declared purpose · the ceiling drops `actor.email` for a capped agent
  while console reads it.

## Decisions

- **Plane C before the admin bypass** — the confused-deputy rule: the bypass expresses the
  principal's power; Plane C confines the surface. They compose, never override.
- **Surface from `actor.kind`** — real enforcement today (service accounts), no placeholder: app
  faces arrive with app tokens (DISTRIBUTION phase B) and simply populate the same tag.
- **The ceiling is surface-global** (strictest across the surface's grants), resolved once in the
  extractor — per-grant ceilings can land later without schema change if a surface ever needs
  split ceilings.
- `docs/api/RBAC.md` (locked) gains §2b in this Case — Em-level decision = the approved slice
  roadmap ("go", 2026-07-05).

## Follow-on (recorded)

`operator_access` (GOVERNANCE #3) rides the same `condition` kinds (purpose + TTL) at the reach
resolver; the `appScopes` UI becomes grant-management over `capability_grant`; `/api/nacl`
(phase B) inherits Plane C because it lowers to the same `require_action`.
