# numu-ID — `<PREFIX>_<32-hex>`, the PK on every entity

numu ids are the primary key of every entity that matters: every `/api/objects/:type/:id` path
parameter, log line, `ref` field value, and `memberships`/`relations` edge uses them. There is
**no separate internal integer/UUID PK** — the id *is* the PK
(`entities.id text primary key`, no DB default; the inserting handler supplies it).

Source: [`crates/api/src/ids.rs`](../../crates/api/src/ids.rs). This doc replaces the role
`redpash-id.md` (the RedPash repo) plays in the
RedPash docs — same day-one rule, same handshake, two deliberate divergences (case, and a
time-sortable request-id lane) noted below.

## Format

```
CAS_5f3c7a21d8e94b6e92a1c0f4b3d7e0a2
^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
│   └─ 32-char UUID v4 (simple form, lowercase hex)
└── 3-char type prefix + `_` separator
```

| Segment | Length | Charset | Purpose |
|---|---|---|---|
| Prefix | 3 | `A–Z` | the type (`CAS`, `USR`, …) — globally **unique per type** (the day-one rule) |
| Separator | 1 | `_` | visual breakpoint; never appears in the body |
| Body | 32 | `0-9a-f` | `Uuid::new_v4().simple()` — **lowercase** |

**36 chars, URL-safe, never reused.** The prefix makes the type obvious at a glance in a log line
or a URL, and makes `kind(id)` a pure prefix→type lookup.

**Divergence from RedPash #1 — case.** RedPash upper-cased the body
(`.to_ascii_uppercase()` in its `id.rs`); numu's mint does **not** — the body is the lowercase hex
`simple()` renders. Ids are opaque, case-sensitive strings in both systems: never normalise,
never compare case-insensitively. A re-cased paste misses the index and 404s.

## Generation

```rust
// crates/api/src/ids.rs
pub fn mint(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4().simple())
}
```

`Uuid::new_v4()` draws 122 bits of randomness; collision is negligible (2⁻¹²² per insert), so
there is **no uniqueness-retry on PK conflict** — `mint` is called once and inserted. The unit
test pins the shape: `len == 4 + 32` for a 3-char prefix.

**Divergence from RedPash #2 — a second lane for request ids:**

```rust
pub fn request_id() -> String {
    format!("req_{}", Uuid::now_v7().simple())
}
```

Request ids are **v7 (time-sortable)** — they order log lines chronologically for free. They are
correlation values, not entity PKs; a client-supplied `X-Request-Id` is only shape-checked
(`valid_request_id`: ≤128 chars, `[A-Za-z0-9_-]`) and never trusted as a key.

### Two mint paths

1. **The generic registry** mints by the *type's* prefix —
   [`objects.rs:462`](../../crates/api/src/objects.rs): `let id = ids::mint(&td.id_prefix);`.
   `POST /api/objects/:type` therefore allocates a correct-prefix id for **any registered type,
   including every future custom type, with zero per-type code** — the "a type is a row" payoff.
2. **Dedicated call sites**, for rows created outside the generic handler:

   | Site | Prefix | Row |
   |---|---|---|
   | [`oauth.rs:225`](../../crates/api/src/oauth.rs) | `USR` | actor/user minted on first OAuth login |
   | [`auth.rs:51`](../../crates/api/src/auth.rs) | `SES` | session row |
   | [`relations.rs:107`](../../crates/api/src/relations.rs) | `REL` | relation edge |
   | [`orchestrator.rs:155`](../../crates/api/src/orchestrator.rs) | `FRN` | feature run |
   | [`oauth.rs:361`](../../crates/api/src/oauth.rs) | `st` | OAuth state nonce (transient, not a PK) |

## The prefix registry

Prefixes are **globally unique per type**. The canonical source is
`type_definitions.id_prefix` — a `UNIQUE` column; `POST /api/types` rejects a taken prefix with
`409` before the DB constraint backstops it. Adding a type is a seed row (or an API call), never
a migration on the PK.

### Registered types — live (seeds 0002–0015)

`user` is the planned rename of `actor` — same row, same `USR`, only `type_id` + display names
change (see [`CATALOG.md`](../../../object-model/CATALOG.md), locked decision 2).

| Prefix | Type | scope_parents | Storage |
|---|---|---|---|
| `USR` | user *(today: `actor`)* | `[]` | `entity_data` |
| `ORG` | workspace | `[]` | `entity_data` |
| `TEM` | team | `["workspace_id"]` | `entity_data` |
| `PRJ` | project | `[]` | `entity_data` |
| `CAS` | case | `["project_id"]` | `entity_data` + `cases` typed projection (workflow index/trigger) |
| `CMT` | comment | `["subject_id"]` (poly) | `entity_data` |
| `ATT` | attachment | `["subject_id"]` (poly) | `entity_data` |
| `SPC` | spec | `["case_id"]` | `entity_data` |
| `ACR` | acceptance_criterion | `["spec_id"]` | `entity_data` |
| `RBK` | runbook | `["case_id"]` | `entity_data` |
| `DEC` | decision | `[]` | `entity_data` |
| `CAP` | capability | `["project_id"]` | `entity_data` |
| `CON` | connector | `["project_id"]` | `entity_data` |
| `SEC` | secret | `["project_id"]` | `entity_data` |
| `SKL` | skill | `["project_id"]` | `entity_data` |
| `MIL` | milestone | `["subject_id"]` (poly) | `entity_data` |
| `NOT` | note — **retired, prefix reserved** | `["project_id"]` | `entity_data` |

### Registered types — planned (the universal catalog)

The 9 domain types designed in [`CATALOG.md`](../../../object-model/CATALOG.md); verified collision-free against
everything above.

| Prefix | Type | scope_parents |
|---|---|---|
| `PRD` | product | `["workspace_id"]` |
| `SVC` | service | `["workspace_id"]` |
| `ORD` | order | `["workspace_id"]` |
| `ITM` | order_item | `["order_id"]` |
| `TXN` | transaction | `["workspace_id"]` |
| `ADR` | address | `["subject_id"]` (poly) |
| `BKG` | booking | `["workspace_id"]` |
| `MSG` | message | `["subject_id"]` (poly) |
| `SHP` | shipment | `["workspace_id"]` |

Near-misses for human eyes (`ORD`/`ORG`, `SVC`/`SEC`, `ADR`/`ACR`, `BKG`/`RBK`) are flagged as
CATALOG.md open question 4 — machines are unaffected, `kind(id)` is exact.

### App-registered types — planned (the apps pass)

The consolidated-app proposals (`numu/docs/apps/DATA-MODEL.md`, 2026-07-04) — nouns above the
catalog floor, registered per app via `POST /api/types`. Collision-checked against the live
registry, the planned catalog, and the system lanes. Note: release deliberately mints `RLS`
because `REL` is the live relation-edge system prefix (the day-one rule).

| Prefix | Type | scope_parents | app |
|---|---|---|---|
| `APP` | app | `["workspace_id"]` | platform (the Store's noun) |
| `PLS` | playlist | `["workspace_id"]` | player |
| `CHT` | chart | `["workspace_id"]` | insights *(already minted by the console sim)* |
| `DSH` | dashboard | `["workspace_id"]` | insights |
| `RLS` | release | `["workspace_id"]` | releases |
| `CRD` | credit | `["release_id"]` | releases |
| `SPL` | split | `["release_id"]` | releases |

### System-table prefixes (minted, not registered types)

Rows minted by `ids::mint` but **not** in `type_definitions`: no RBAC identity of their own, they
inherit reach from what they attach to.

| Prefix | Row | Table |
|---|---|---|
| `SES` | session | `sessions` |
| `REL` | relation edge | `relations` |
| `FRN` | feature run | `feature_runs` |
| `st` | OAuth state nonce | transient (CSRF handshake) |
| `req` | request id (v7, time-sortable) | log correlation only |

### Non-prefixed system ids

The rest of the engine's machinery doesn't mint ids at all:

| Table | PK |
|---|---|
| `events` | `bigserial` (append-only audit) |
| `role_handoffs` | `bigserial` |
| `workflows` | slug (`workflow_id`, e.g. `default`) |
| `audit_runs` | `text` (tool-supplied) |
| `memberships` | composite `(object_id, member_id, role, context_role)` |
| `case_close_checks` | composite `(case_id, check_name)` |
| `cases` (projection) | `entity_id` FK → `entities.id` (the CAS_ id itself) |

## The day-one rule — one prefix, one type, forever

> RID prefixes are unique per type. The predecessor shared `FIL_` between file and dashboard and
> resolved by registry ordinal — a permanent trap for anyone minting or parsing ids.
> — RedPash `decisions/day-one.md` #1

Because every prefix is unique, `kind(id)` is a prefix→type lookup with **no disambiguation** —
parsing, routing, and the polymorphic `memberships`/`relations`/`subject_id` edges all rely on it.
Two lineage lessons carried into numu:

- **Never share a prefix** — RedPash runbook `0011-object-kind-prefix-mismatch` documents the
  incident class.
- **Never let the prefix and the type name drift** — numu seeded `actor` with prefix `USR`
  (RedPash's `user` prefix), and the mismatch was confusing enough to motivate the `actor → user`
  rename (CATALOG.md decision 2). Corollary: a retired type's prefix (`NOT`) stays **reserved** —
  old ids in refs, audit rows, and logs must keep resolving unambiguously.

## The entities handshake

For a registered type, the create path inserts the **`entities` row first, in the same
transaction** as the `entity_data` row — `entity_data.entity_id` FKs into `entities.id`, so the
registry row must exist before the data row. Delete goes the other way: removing the `entities`
row cascades the `entity_data` row, the `memberships`, and every edge that FKs into the registry.

## Assignment · validation · URLs

- **Assigned at insert, by the handler** — never a DB default. `entities.id` is `text primary key`
  with no default; a row can't exist without one, and it never changes after insert.
- **No checksum, no validation function.** A malformed id simply misses the index and returns no
  row → leak-free `404` (existence is never admitted to a caller without reach — the same
  RBAC-denial status, so a probe can't distinguish "bad id" from "no access").
- **Case-sensitive in URLs.** The body is lowercase hex; the backend never normalises. Copy ids
  verbatim.
