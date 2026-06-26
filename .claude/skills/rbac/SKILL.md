---
name: rbac
description: >-
  Use whenever access control touches numu — adding or gating an endpoint that reads/writes entity or
  membership data, sharing an object, adding/removing a member, introducing a role, restricting a field, or
  reasoning about WHY a request returned 404 vs 403 vs 200. numu's RBAC is two planes: object reach (Plane
  A → leak-free 404) and field perms (Plane B → 403 after existence). Reach for this any time you write
  `require_action`/`require_rank`, a `grant_owner`, a membership change, a `perm_class`, or a reach query —
  and any time you're tempted to return 403 for "you can't see this" (that's a 404 in numu) or to read
  `context_role` in a gate (it's cosmetic). Covers the reach resolver, the NULL-parent policy, the IDOR
  backstop, roles-as-data, the membership SEV-0 guards, and the `rbac-audit` gate. NOT for authentication
  (who you are — that's the `Caller` extractor in the api-conventions skill).
---

# rbac — two planes, leak-free

numu answers two different questions with two different mechanisms, and conflating them is the classic
security bug:

- **Plane A — can you reach this object at all?** If not, the answer is **404**, identical to "doesn't
  exist." Existence itself is privileged; a 403 here would let an attacker map your data by status code.
- **Plane B — of the fields on an object you *can* reach, which may you read/write?** A write you're not
  ranked for is **403 naming the field** — safe, because existence is already admitted.

> The contract is [`docs/RBAC.md`](../../../docs/RBAC.md). This skill is the how-to and the gotchas; read
> RBAC.md for the full model. Gate ordering on the HTTP surface is in
> [`docs/HTTP.md`](../../../docs/HTTP.md).

## The leak-free contract (locked — do not "improve")

| Situation | Status | Where |
|---|---|---|
| No reach to the object (Plane A denies) | **404** `deny_404` | [`objects.rs`](../../../crates/api/src/objects.rs) ~`:58`, [`members.rs`](../../../crates/api/src/members.rs) `require_rank` |
| Reach, but rank below the action floor (membership ops) | **403** `forbidden` | `members.rs` `require_rank` |
| Reach the object, but not ranked to write a field | **403** `forbidden_field("x")` | [`field_perms.rs`](../../../crates/api/src/field_perms.rs) `require_write` |
| Reach the object, but not ranked to read a field | field is **silently omitted** (never 403) | `field_perms.rs` `filter_readable` |

The single rule that generates this table: **an object-level denial is indistinguishable from non-existence,
a field-level denial is not.** `require_action` returns `Ok(false)` and the handler maps it to `deny_404` —
never `forbidden`. This is enforced by `rbac-audit` rule **R4** (every `!require_action` ⇒ `deny_404`).

## Plane A — the reach resolver

[`rbac.rs`](../../../crates/api/src/rbac.rs) is two recursive CTEs:

- **principals** = the caller + every team it transitively belongs to (climb `memberships` edges where the
  object is a `team`).
- **reach** = a principal holds a membership on the object **or on any scope ancestor** of it (climb
  `entity_data.scope_parent_id`, depth-capped at 8, set-deduped so cycles can't loop).

Key functions (call these; don't hand-roll a query):

```rust
effective_rank(pool, actor_id, object_id) -> AppResult<Option<i32>>   // max rank over reach; None = no reach
reachable_entity_ids(pool, actor_id, type_id) -> AppResult<Vec<String>>  // for reach-filtered LIST
rank_of(pool, role) -> AppResult<Option<i32>>                          // role → rank via the registry
principals_contain(pool, root_id, target_id) -> AppResult<bool>        // cycle guard (see below)
```

The verb gate is [`caller::require_action`](../../../crates/api/src/caller.rs):

```rust
require_action(pool, caller, td, object_id, action) -> AppResult<bool>
//  Action::View   -> rank >= 1 (viewer)
//  Action::Create -> rank >= 2 (member)   Action::Edit -> rank >= 2
//  Action::Delete -> rank >= 3 (admin), or 4 (owner) if method_policy.delete_min_role == "owner"
//  platform_admin short-circuits true;  object_id = None (LIST / root CREATE) is admitted.
```

### NULL-parent policy (subtle, load-bearing)
A top-level row (`scope_parent_id IS NULL`) is reachable **only via a direct membership edge** — NULL is
*never* a blanket "everyone reaches roots." Forgetting this is how you accidentally make every root object
world-readable. The CTE encodes it: the climb starts at the object and only ascends real edges.

### scope_parent_id is the IDOR backstop
`entity_data.scope_parent_id` is a real FK to `entities(id)` ([`migrations/0001_init.sql`](../../../migrations/0001_init.sql)),
not a denormalized copy. An object whose parent was deleted can't be represented, and a request for an
object you don't reach returns 404 at the gate — there is no "guess the id" hole. Always derive reach from
this column; never trust a parent id from the request body for authorization.

## Roles are data, not an enum

[`migrations/0003_rbac.sql`](../../../migrations/0003_rbac.sql):

```sql
create table roles (role text primary key, rank integer not null unique, is_builtin boolean not null default false);
insert into roles (role, rank, is_builtin) values ('viewer',1,true),('member',2,true),('admin',3,true),('owner',4,true);
```

A caller's **effective role is `max(rank)`** over all their reach edges. Ranks are contiguous (1..N, no
gaps) so a custom role is just a new row at a rank — **zero code** to add `('lead', 3, false)`. Gates
compare *ranks*, never role *strings*, so custom roles slot in by rank automatically.

## Plane B — field perms

[`field_perms.rs`](../../../crates/api/src/field_perms.rs). Each field's `perm_class` sets default
`(read_min, write_min)` rank floors:

```rust
class_ranks(perm_class) -> (i32, i32)
//  "standard"            => (1, 2)         read viewer+, write member+
//  "owner_grade"         => (3, 4)         read admin+,  write owner
//  "readonly" | "system" => (1, i32::MAX)  read viewer+, never user-writable
```

A sparse `field_permissions(type_id, field, role, can_read, can_write)` row
([`0004`](../../../migrations/0004_field_perms.sql)) overrides a field's floors for a role — resolved at
check time by rank, so custom roles need no code. Use the helpers, don't inline rank math:

```rust
require_write(pool, caller, td, object_id, &written, ctx) -> AppResult<()>  // 403 forbidden_field on a violation
filter_readable(pool, caller, td, object_id, data) -> AppResult<Value>      // drops unreadable fields, never 403
readable_set(pool, caller, td, object_id) -> AppResult<HashSet<String>>     // for OPTIONS can_read
```

## Wiring a gated handler (the order that matters)

A mutating handler over entity data must, in order:

1. **resolve type** → 404 on unknown.
2. **Plane A**: `require_action(... Action::Edit)` → `deny_404` on false. *(Existence check happens here —
   you load the row only after this passes.)*
3. **If-Match** concurrency check (see the **api-conventions** skill) → 412/428.
4. validate the payload against the registry.
5. **Plane B**: `require_write(... &written_fields ...)` → 403 on a forbidden field.
6. execute the write, **emit an event** with the request-id.

On **CREATE**: a root type (`scope_parents = []`) is open to any authenticated caller; a scoped type
**must** name its parent (422 if absent) and the caller needs `Create` reach **on that parent**. Then, in
the same transaction, **`db::grant_owner(&mut tx, &id, &caller.actor_id)`** — *no object is ever created
without an owner* (rbac-audit **R2**).

## Membership management — the SEV-0 guards

[`members.rs`](../../../crates/api/src/members.rs) (`/:type/:id/members`) is the highest-stakes surface;
each guard prevents a way to brick or hijack an object. Preserve all of them:

- **last-owner**: can't demote/remove the final `owner` (the object would become unadministrable).
- **no-escalation**: you can't grant a role higher than your own effective rank.
- **cycle**: granting `member_id` a membership on `object_id` would cycle iff `object_id` can already reach
  *up* to `member_id` through team edges — so the check is
  **`principals_contain(object_id, member_id)`** (reject if true). The argument order is the bug here: it
  is `(object_id, member_id)`, not the reverse.
- **self-leave** vs **require_rank**: reads/writes gate through `require_rank` — *no reach → `deny_404`
  (404); reach but under the floor → `forbidden` (403)* — the same leak-free split as objects.
- **`context_role` is cosmetic.** It's a display label only and is **never** read by an enforcement path
  (rbac-audit **R3**). Don't reach for it in a gate.

## The gate that keeps it honest — `rbac-audit`

[`tools/rbac-audit/audit.sh`](../../../tools/rbac-audit/audit.sh) (run by `ci.sh`) statically enforces:

| rule | checks |
|---|---|
| **R1** require-action parity | every handler over entity/membership data gates via `require_action`/`require_rank` |
| **R2** grant-owner | every `insert into entities` create path calls `db::grant_owner` |
| **R3** context-role cosmetic | `context_role` is never read in `rbac.rs`/`caller.rs` |
| **R4** leak-free-404 | every `!require_action` denial returns `deny_404` |

If you add an entity-touching handler, expect R1/R2/R4 to fail until it's gated and grants an owner — that
failure is the gate doing its job. To add a *new* rule of this shape, see the **enforcement-gates** skill.

## The bug that proves the model — the memberships PK

Originally the memberships PK was `(object_id, member_id, role, context_role)`, which let a member hold
*several* roles on one object (role-stacking). That made demote and last-owner **unprovable** — you can't
reason about "the" role of a member when they have a set. [`0003`](../../../migrations/0003_rbac.sql)
narrowed it to **`(object_id, member_id)`** (one role per pair) and added the FK to `roles`. Lesson: an
authorization model is only as sound as the uniqueness its schema guarantees — if a guard needs "the role
of X on Y" to be singular, the PK must make it singular.
