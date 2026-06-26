# numu — object catalog

> The object model for **numu**, the self-contained, project-agnostic build-engine you pull into a
> fresh folder to start any coding project. This file is the **enrichment surface**: the objects and
> their fields are laid out so you (and other sessions) can refine them directly — edit a cell, add a
> field, retire one — without reading any other repo's docs. Look for **`ENRICH:`** markers where a
> field set genuinely benefits from your domain judgment.
>
> Status: **DRAFT v0** — non-UI design first (no UI in scope yet). Storage/migrations land in a
> follow-on slice; this doc is the contract they implement.

---

## How to read this

numu has exactly **two layers**. Holding the distinction is the whole model:

- **SYSTEM tables** — the engine's own machinery. Fixed schema, created by migrations, the same in
  every project. You rarely touch these; they're listed here so the catalog is complete and
  self-contained. (Marked **`[SYSTEM]`**.)
- **REGISTERED TYPES** — objects-as-data. A type is **a row in `type_definitions` + its rows in
  `type_fields` + storage in `entity_data`** — *not* a migration. This is where your project's
  objects live, and where **the fields you enrich live**. (Marked **`[TYPE]`** with an `id_prefix`.)

The payoff — and the reason numu is "pull-and-go": **a customer project adds its own domain objects
(`invoice`, `patient`, `listing`, whatever) the exact same way numu's built-in types were added — a
type row + field rows, zero migrations.** numu ships the *build-coordination* types seeded; your
project stacks its *domain* types on top. The five enforcement gates
(case-first · docs-currency · capability-ledger · agent-refs · debuggability) ride along for free, because they're
defined over the system tables, not over any particular type.

### The field shape — the enrichment unit

Every `[TYPE]` is described by a table of fields. Each field row is one `type_fields` record:

| column | meaning |
|---|---|
| **field** | the machine name (snake_case) |
| **label** | human label for any future UI |
| **kind** | `text` · `int` · `bool` · `date` · `json` · `ref` · `enum` |
| **req** | required on create? |
| **edit** | user-editable after create? (`no` = set once / engine-owned) |
| **perm_class** | which permission column governs it (legend below) |
| **options · notes** | enum vocab, `ref→PREFIX` target, validation rule, default |

**perm_class legend** (the field-permission layer — *which role* may read/write a field, looked up by
the caller's membership role on the object):
- **`system`** — engine-maintained (`id`, `created_at`, `created_by`); never user-written.
- **`readonly`** — display-only / derived; surfaced, never written through the form.
- **`standard`** — read/write gated by the per-type×role field matrix (the normal case).
- **`owner_grade`** — only `owner`+ on the object may write (sensitive fields).

Each class is a **rank floor** `(read_min, write_min)` over the role ladder — `standard` = read `viewer`/
write `member`, `owner_grade` = read `admin`/write `owner`, `system`/`readonly` = never user-written — so a
**custom role slots in by rank** with zero code. A sparse **`field_permissions(type_id, field, role,
can_read, can_write)`** `[SYSTEM]` table overrides a specific `(type, field)` (resolved role→rank). The gate
runs AFTER the Plane-A object gate: a write violation is `403` (existence already admitted); reads omit
unreadable fields passively.

**kind = `ref`** stores another entity's id; the target type is given as `ref→PREFIX`. A `ref` whose
target is one of the type's `scope_parents` is also the **reach edge** (see `entity_data.scope_parent_id`).

### Common reusable fields — define a concept once, opt in per type

A field that means the same thing on more than one object is defined **once here** and adopted by
adding its row to a type — never re-coined as `is_published` on one type and `draft` on another. This
is the polymorphic-design discipline applied to *fields* (the same reason there's one `memberships`
edge, not a per-type one). The decision test for any new common field: **(1) reusable across entities,
and (2) a use-case not already covered.**

- **`visibility`** · enum · `standard` — the **audience / lifecycle-visibility axis**, orthogonal to a
  type's own lifecycle `status`. Canonical vocab `draft · published · internal · public · hidden ·
  archived`; a type adopts the **subset it needs** (`comment`/`case` → `internal · public`; the
  knowledge types → `draft · published · archived`). One field subsumes SF `CaseComment.IsPublished`
  generically — and any future "is it hidden / a draft / customer-visible?" need on *any* object.

*(Add the next common field here only when a SECOND type needs the exact same one — never duplicate.)*

---

## HTTP surface — every object speaks all (safe) HTTP methods

**The principle:** a type doesn't *earn* its HTTP verbs — it *inherits* them by being a row in
`type_definitions`. One generic handler dispatches the full method set over the registry, so
registering a type auto-wires its entire REST surface + RBAC + concurrency + audit — **zero per-type
code** (the same O(1) payoff as "a type is a row"). Full contract: [`HTTP.md`](HTTP.md); the
debuggability spine it leans on: [`OBSERVABILITY.md`](OBSERVABILITY.md).

- **Routes:** collection `/api/objects/:type`, item `/api/objects/:type/:id`.
- **Verbs (auto-wired per type):** `GET · HEAD · POST · PUT · PATCH · DELETE · OPTIONS`. **TRACE/CONNECT
  → 405** (TRACE = the Cross-Site-Tracing hole; CONNECT = proxy-only, no resource meaning). TRACE's
  legitimate debug value is re-homed to a gated `POST /api/_debug/echo` (platform-admin + `NUMU_DEBUG=1`).
- **OPTIONS = live self-description:** returns the caller's allowed verbs (`Allow` header), the per-verb
  RBAC verdict (+ the reach edge that granted it), the readable `type_fields`, enum vocab, validation,
  current `ETag`, and the workflow — the runtime mirror of this catalog (the "no other docs" promise).
- **PUT vs PATCH:** PUT = full `data` replace (engine fields preserved); PATCH = JSON Merge Patch (RFC 7386).
- **Concurrency:** every item carries an `ETag` (`W/"<version>"`); `If-Match` is **required** on
  PUT/PATCH/DELETE → `428` if absent, `412` if stale. GET/HEAD honor `If-None-Match` → `304`.
- **RBAC per verb (leak-free, two-stage):** GET/HEAD/OPTIONS→View, POST→Create, PUT/PATCH→Edit,
  DELETE→Delete. Object-gate denial → `404` (existence unprobeable, via the `scope_parent_id` IDOR FK);
  field-gate denial → `403` only *after* existence is admitted.
- **Opt-out without code:** `type_definitions.method_policy` masks verbs / raises the DELETE floor per
  type (default `'{}'` = the full surface).
- **Register a type at runtime:** `POST /api/types` (admin) writes the `type_definitions` + `type_fields`
  rows and **hot-reloads the registry**, so the new type's whole surface above is live with **no restart**
  (a seed migration still loads only at boot). `GET /api/types` lists the catalog. The spec is validated
  before the write (422 malformed · 409 taken `type_id`/`id_prefix`); the DB's unique constraints backstop
  it. See [`HTTP.md`](HTTP.md) §0 and CASE 0007.

---

## Catalog at a glance

| Group | Objects | Layer |
|---|---|---|
| **G1 · Registry spine** | type_definitions, entities, type_fields, entity_data | `[SYSTEM]` |
| **G2 · Access & org** | memberships, roles, field_permissions, sessions, relation `[SYSTEM]` · actor, team, workspace, project `[TYPE]` |
| **G3 · Audit & observability** | events, audit_runs, audit_findings, omnisearch (index + `search()`) | `[SYSTEM]` |
| **G4 · Work tracking (coordination core)** | workflows, case_close_checks `[SYSTEM]` · case, comment, attachment `[TYPE]` |
| **G5 · Orchestrator / feature pipeline** | feature_runs, role_handoffs | `[SYSTEM]` |
| **G6 · Build knowledge ("bake everything")** | changeset `[SYSTEM]` · spec, acceptance_criterion, runbook, decision, capability `[TYPE]` |
| **G7 · Deferred (designed-for, not built v1)** | connector, secret, skill, milestone | `[TYPE]` |

Prefix registry (each `id_prefix` is unique → makes `kind(id)` a pure lookup):
`USR` actor · `TEM` team · `ORG` workspace · `PRJ` project · `CAS` case · `CMT` comment ·
`ATT` attachment · `SPC` spec · `ACR` acceptance_criterion · `RBK` runbook · `DEC` decision ·
`CAP` capability · `CON` connector · `SEC` secret · `SKL` skill · `MIL` milestone.

> **Seeded LIVE (CASE 0008 B2).** `workspace`·`team` (G2) + `spec`·`acceptance_criterion`·`runbook`·
> `decision`·`capability` (G6) ship as registry rows (`migrations/0011_catalog.sql`), auto-wired through the
> generic handler — no engine code. An **optional** scope_parent (`runbook.case_id`, `capability.project_id`)
> may be absent → the object creates at root; a **required** one missing is a `422`. *(Still deferred per
> G5/G7: the orchestrator tables + `changeset`, and `connector`/`secret`/`skill`/`milestone`.)*

---

## G1 · Registry spine `[SYSTEM]`

The four tables that make "a type is a row, not a migration" true. These are numu's kernel; a project
never edits them by hand — it edits *rows* in them (that's what registering a type is).

### `type_definitions` — the catalog of types
One row = one registered object type. Adding a row is how a new object comes into existence.

| column | kind | notes |
|---|---|---|
| `type_id` | text PK | machine name, e.g. `case`, `project` |
| `id_prefix` | text **unique** | `CAS`, `PRJ`, … — the entity-id prefix; drives `kind(id)` |
| `display_name` | text | singular human label |
| `display_name_plural` | text | for list views |
| `scope_parents` | json | **ordered** parent fields the reach resolver climbs (e.g. `["project_id"]`) |
| `icon` | text | optional UI hint |
| `is_builtin` | bool | numu-shipped vs project-added (so a reset re-seeds only builtins) |
| `ordinal` | int | display order in any type picker |
| `method_policy` | json | per-type HTTP verb override: `{"mask":[verbs removed],"delete_min_role":"owner"}`; default `'{}'` = the full GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS surface (see [`HTTP.md`](HTTP.md)) |

### `entities` — the one id space
Every object of every type registers here first; cascades and FKs hang off it.

| column | kind | notes |
|---|---|---|
| `id` | text PK | `<PREFIX>_<hex>` (e.g. `CAS_9f3a…`) |
| `type` | text → type_definitions | which type this id is |
| `created_at` | timestamptz | `system` |
| `created_by` | text | actor id (nullable during bootstrap) |

### `type_fields` — the field shape per type
The rows you enrich. Mirrors the field-shape table above.

| column | kind | notes |
|---|---|---|
| `type_id` | text → type_definitions | the owning type |
| `field` | text | machine name (PK with type_id) |
| `label` | text | human label |
| `kind` | text | `text\|int\|bool\|date\|json\|ref\|enum` |
| `required` | bool | |
| `editable` | bool | |
| `ordinal` | int | field order |
| `perm_class` | text | `system\|readonly\|standard\|owner_grade` |
| `options` | json | enum vocab / `ref` target / default / validate rule |
| `searchable` | bool | feed this field into **omnisearch**'s index? (default false) — see G3 |

### `entity_data` — the all-JSONB store
Generic storage for every type. (The sole typed-table opt-in is `cases`, see G4 — it earns one
because the workflow engine needs typed `status`/indexes/triggers.)

| column | kind | notes |
|---|---|---|
| `entity_id` | text PK → entities | |
| `type_id` | text → type_definitions | |
| `data` | json | the field values keyed by `type_fields.field` |
| `scope_parent_id` | text → entities **ON DELETE SET NULL** | the real reach edge — **IDOR backstop** (a dangling or foreign parent is unrepresentable) |
| `version` | int | optimistic-lock counter, bumped on every write; source of the `ETag: W/"<version>"` (lost-update protection — see [`HTTP.md`](HTTP.md)) |
| `updated_at` | timestamptz | last-write time; the `Last-Modified` source |

---

## G2 · Access & org

### `memberships` `[SYSTEM]` — the one polymorphic access edge
Ownership and sharing are **edges, never an `owner_id` column** ("no object without an owner": the
creator gets an `owner` membership in the same transaction). One edge type covers Case Teams, Project
Teams, Departments, and per-object sharing — the member end may itself be a team (nesting).

| column | kind | notes |
|---|---|---|
| `object_id` | text → entities | what is shared |
| `member_id` | text → entities | who gets access (an actor **or a team**) |
| `role` | text → roles | the tier; **FK to the `roles` registry** (so a custom role grants). **One role per `(object_id, member_id)`** — the PK; a role change is a single-row update, never a stacked second row |
| `context_role` | text | cosmetic label (job title, "reporter") — **never read by enforcement** |
| `created_at` | timestamptz | `system` |

> Reach resolves later via one generated recursive CTE over `scope_parents` (server-only; the portable
> subset resolves it in Rust→wasm for client demos). Schema must support it now; the resolver is a
> follow-on slice.

> **`context_role`** is also numu's whole answer to SF `CaseContactRole` (and `OpportunityContactRole`,
> and every other `XxxContactRole`): *one* cosmetic role label on *one* edge, on *any* object — no
> per-type role junction.

### `roles` `[SYSTEM]` — the tier registry (roles-as-data)
A role is a **row**, not a Rust enum, so a project adds a custom role with zero code. The **effective**
role on an object is `max(rank)` over the caller's edges; an `Action` floor (View/Edit/Delete) is a rank
threshold. Seeded **contiguous** so the resolver never sees a gap.

| column | kind | notes |
|---|---|---|
| `role` | text PK | `viewer` · `member` · `admin` · `owner` (builtins) + any custom role |
| `rank` | int unique | higher = more authority; builtins `1·2·3·4` |
| `is_builtin` | bool | the 4 above; a custom role is a row with its own rank |

`memberships.role` is an FK into this table, so a non-registered role is a mapped FK violation (→ `422`),
never a silent grant.

### `relation` `[SYSTEM]` — the one generic entity↔entity edge
The M:N counterpart to `memberships` (which is entity↔*principal*). A single typed edge so numu never
grows SF-style per-pair junction objects (`CaseArticle`, related-cases, duplicate-of, blocks…): the
*concept* lives in `relation_type`, the *shape* is always the same two ids.

| column | kind | notes |
|---|---|---|
| `subject_id` | text → entities | the "from" entity |
| `object_id` | text → entities | the "to" entity |
| `relation_type` | text | registered vocab: `relates-to · duplicates · blocks · references · article-of · parent-of` |
| `created_by` | text → entities | `system` |
| `created_at` | timestamptz | `system` |

**Unique** `(subject_id, object_id, relation_type)` — no duplicate edges. **RBAC:** a relation is
readable iff the caller can reach *both* endpoints, writable iff they can edit the `subject` — so an
edge never leaks an entity the caller couldn't already see.

> **LIVE (CASE 0008).** `crates/api/src/relations.rs`: `POST /api/relations` (write = edit subject) ·
> `GET /api/relations?entity=<id>[&type=<rel>]` (each edge returned only if the caller also reaches the
> other end) · `DELETE /api/relations/:id`. `relation_type` is the registered vocab above (unknown → 422);
> the unique triple is the 409 backstop. `migrations/0010_relations.sql`.

> Why an edge, not a `ref` field: `ref` fields cover **1:N** (a case's one `project_id`). `relation`
> covers **M:N, typed** (this runbook `references` 3 cases; this case `duplicates` that one) — the gap
> that, left unfilled, becomes a pile of bespoke junctions. This is SF `CaseArticle` generalized: link
> any knowledge object to any work item without a `CaseArticle` / `SpecArticle` / … per pair.

### `actor` `[TYPE]` · `USR` — a human or agent principal
ENRICH: this is the identity record; add whatever a project needs to attribute work and route notices.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `display_name` | Name | text | yes | yes | standard | |
| `handle` | Handle | text | yes | yes | standard | unique-ish; validate `^[a-z0-9_-]+$` |
| `email` | Email | text | no | yes | owner_grade | validate email |
| `kind` | Kind | enum | yes | no | readonly | `human` · `agent` · `service` |
| `platform_role` | Platform role | enum | yes | yes | owner_grade | `member` · `admin` (the platform-admin gate; **distinct from `memberships.role`**, the per-object reach tier — two different "role" concepts, two different names) |
| `status` | Status | enum | yes | yes | standard | `active` · `invited` · `disabled` |
| `avatar_url` | Avatar | text | no | yes | standard | |
| `created_at` | Created | date | — | no | system | |

ENRICH ideas: `timezone`, `agent_model` (for `kind=agent`), `last_seen_at`, `default_workspace_id`.

### `team` `[TYPE]` · `TEM` — a group principal
A team can be granted a role on any object (everyone in it inherits the reach). `kind` distinguishes a
plain team from an HR-style department.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `name` | Name | text | yes | yes | standard | |
| `kind` | Kind | enum | yes | no | standard | `team` · `department` (one department per member per workspace) |
| `workspace_id` | Workspace | ref | yes | no | standard | `ref→ORG`; scope_parent |
| `description` | Description | text | no | yes | standard | |
| `created_at` | Created | date | — | no | system | |

### `workspace` `[TYPE]` · `ORG` — the top-level tenant/org container
The root of the scope tree (everything climbs to a workspace). ENRICH: this is your multi-tenancy
boundary — add billing/region/policy fields here if a project needs them.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `name` | Name | text | yes | yes | standard | |
| `slug` | Slug | text | yes | no | standard | unique; URL-safe |
| `status` | Status | enum | yes | yes | owner_grade | `active` · `suspended` |
| `created_at` | Created | date | — | no | system | |

### `project` `[TYPE]` · `PRJ` — **the customer-project container**
The object a new build folder maps to. Cases, specs, runbooks, etc. scope up to a project. ENRICH:
this is the most project-shaped object — repo/stack/lifecycle fields are where your conventions go.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `name` | Name | text | yes | yes | standard | |
| `slug` | Slug | text | yes | no | standard | unique within workspace |
| `workspace_id` | Workspace | ref | yes | no | standard | `ref→ORG`; scope_parent |
| `status` | Status | enum | yes | yes | standard | `planning` · `active` · `paused` · `archived` |
| `description` | Description | text | no | yes | standard | |
| `repo_url` | Repository | text | no | yes | standard | validate URL |
| `default_branch` | Default branch | text | no | yes | standard | default `main` |
| `created_at` | Created | date | — | no | system | |

ENRICH ideas: `stack` (json — languages/frameworks), `lead_id` (`ref→USR`), `target_date`, `visibility`.

---

## G3 · Audit & observability `[SYSTEM]`

The append-only memory of the engine. Render-ready so a later Monitoring UI is a pure renderer.

### `events` — the append-only activity log
Every meaningful action lands one row (the "audit everything" axis). Filter by level for the *view*;
capture is never filtered.

| column | kind | notes |
|---|---|---|
| `id` | bigserial PK | |
| `entity_id` | text → entities ON DELETE SET NULL | subject |
| `actor_id` | text | who did it |
| `kind` | text | event type, e.g. `case.status_changed`, `membership.granted` |
| `at` | timestamptz | (time-partition later) |
| `payload` | json | structured detail |
| `request_id` | text | the edge-stamped correlation id (`X-Request-Id`); indexed — joins a wire error to its full server trace (see [`OBSERVABILITY.md`](OBSERVABILITY.md)) |
| `trace_id` | text | root tracing-span id; the join key to the live log stream |

> Every unsafe HTTP verb (POST/PUT/PATCH/DELETE) writes one `events` row carrying the field diff + the
> request's `request_id`, so a user-reported error id (`instance` in the problem+json body) resolves the
> whole mutation. The `request_id`/`trace_id` columns are the schema half of P-DEBUG — see
> [`OBSERVABILITY.md`](OBSERVABILITY.md).

### `audit_runs` — one row per tool run (the CI ratchet's memory)
| column | kind | notes |
|---|---|---|
| `id` | text PK | |
| `tool` | text | which audit (`agent-refs`, `case-coverage`, …) |
| `ran_at` | timestamptz | |
| `git_sha` | text | commit audited |
| `git_branch` | text | |
| `stats` | json | counts per category |
| `payload` | json | full run detail |

### `audit_findings` — individual findings within a run
Diffing two runs by `finding_key` yields `new \| fixed \| regressed \| improved \| unchanged` — the
ratchet fails CI only on **new** vs the committed baseline.

| column | kind | notes |
|---|---|---|
| `run_id` | text → audit_runs | |
| `tool` | text | |
| `kind` | text | finding category |
| `finding_key` | text | stable identity across runs (for the diff) |
| `severity` | enum | `info \| warn \| error` |
| `detail` | json | location + message |

### omnisearch — registry-native universal search `[SYSTEM]`
A starting-pack **builtin** — the *logic* baked in now, UI later. Because every object is a row in one
registry, **one search covers every type for free** (the DB-as-a-framework payoff). Three data-driven
parts, no per-type search code:

1. **`type_fields.searchable`** (bool) — each type declares which fields feed the index; a new type
   becomes searchable the instant it sets the flag.
2. **The index** — a `tsvector` (Postgres GIN; the client subset runs the *same* logic in Rust→wasm over
   the on-device store) built from the `searchable` slice of each entity's `entity_data`, refreshed on
   write. It lives beside `entity_data` — not a second store.
3. **`search(query, caller)`** — full-text match → **reach-filtered** (only entities the caller can
   reach, via the same `scope_parents` cascade RBAC uses, so search can't leak) → ranked
   `(entity_id, type, snippet, rank)`. Reach-aware by construction, like every other read.

So omnisearch isn't a feature bolted onto one screen; it's a property of the registry the whole app
inherits. **Surface (when wired):** a reach-filtered `GET /api/search?q=<text>&type=<optional>` — a
sibling of the `/api/objects/:type` routes, leak-free by the same reach gate ([`HTTP.md`](HTTP.md)).

---

## G4 · Work tracking — the agent-coordination core

The heart of numu: Cases are the handoff bus between sessions/agents, with workflow **as data** and a
DB-enforced close gate.

> **Engine status (CASE 0006).** G4.1 is **live**: the `default` workflow + `case` type are seeded; a
> `workflow` cache validates status changes (illegal move → `422 illegal_transition`); the typed `cases`
> table is a synced projection of `entity_data` (the engine + status index operate on it). The
> `cases_guard` close-gate trigger (G4.2) and `comment`/`attachment` (G4.3) follow.

### `workflows` `[SYSTEM]` — workflow-as-data
A new workflow is a row, not a recompile. Transitions are **permissive** (forward + one-step-back +
reopen — kanban drag), terminality is "last element of `states`", and `close_checks` are the named
preconditions the terminal entry requires.

| column | kind | notes |
|---|---|---|
| `workflow_id` | text PK | |
| `states` | json | **ordered** array; last element = terminal |
| `transitions` | json | `{ "<from>": ["<to>", …] }` (permissive) |
| `initial` | text | starting state |
| `close_checks` | json | ordered named close preconditions (e.g. `["docs_reconciled"]`) |

**numu seeds one `default` workflow** (every project inherits it; a new workflow is added the same way — a row, no recompile):

| field | value |
|---|---|
| `workflow_id` | `default` |
| `states` | `["backlog","todo","in_progress","in_review","done"]` — terminal = `done` |
| `transitions` | permissive: forward one step · one step back · reopen from `done`; an illegal *skip* (e.g. `backlog → done`) → **422** |
| `initial` | `backlog` |
| `close_checks` | `["docs_reconciled"]` — the docs-currency gate, so a `done` Case is *honest* |

This is the workflow `case.workflow_id` defaults to, and the source of `case.status`'s enum
(`status` ∈ these `states`). A project that wants a different lifecycle seeds its own workflow row and
points its type at it — the engine never changes.

### `case_close_checks` `[SYSTEM]` — per-case state of each close precondition
The engine flips `passed=true` as each gate clears; the `cases_guard` trigger refuses terminal entry
(`422 close_preconditions_unmet`) until all pass. This is what makes a `done` Case *honest*.

| column | kind | notes |
|---|---|---|
| `case_id` | text → cases | |
| `check_name` | text | matches a `workflows.close_checks` entry |
| `passed` | bool | |
| `note` | text | |
| `at` | timestamptz | |

### `case` `[TYPE]` · `CAS` — the unit of tracked work
The richest enrichment target. **Storage exception:** `case` is the *one* builtin backed by a typed
`cases` table (the workflow engine needs typed `status`/`workflow_id`, an index, and the guard
trigger). Its `type_fields` still drive validation + any future form. The `cases` table mirrors
`entity_data`'s `version`/`updated_at` columns, so the ETag/`If-Match` concurrency contract
([`HTTP.md`](HTTP.md)) is identical for cases.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `title` | Title | text | yes | yes | standard | |
| `description` | Description | text | no | yes | standard | markdown; the plan goes here |
| `type` | Type | enum | yes | yes | standard | `bug` · `feature` · `task` · `epic` · `chore` |
| `status` | Status | enum | yes | yes | standard | from the workflow's `states` |
| `priority` | Priority | enum | yes | yes | standard | `low` · `normal` · `high` · `urgent` |
| `origin` | Origin | enum | no | yes | standard | how it arrived: `ui · agent · import · email · web · phone · chat` (generalizes SF `Origin`) |
| `visibility` | Visibility | enum | no | yes | standard | common field; `internal · public` (default `internal`) — customer-visible vs internal cases |
| `workflow_id` | Workflow | ref | yes | no | readonly | `ref→workflows`; default `default` |
| `assignee_id` | Assignee | ref | no | yes | standard | `ref→USR` (or `→TEM`) |
| `reporter_id` | Reporter | ref | no | no | readonly | `ref→USR` |
| `project_id` | Project | ref | yes | no | standard | `ref→PRJ`; **scope_parent** |
| `created_at` | Created | date | — | no | system | |
| `updated_at` | Updated | date | — | no | system | |

ENRICH ideas: `labels` (json), `estimate`/`points` (int), `due_date`, `parent_case_id` (`ref→CAS`,
for epics), `blocked_by` (json of CAS ids), `source` (`ui` · `agent` · `import`).

### `comment` `[TYPE]` · `CMT` — a threaded note on *any* object
Generalized beyond cases (richer than the portfolio's case-only comments): `subject_id` can point at a
case, spec, runbook — anything — so the activity thread is uniform across the engine.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `subject_id` | On | ref | yes | no | standard | `ref→` any entity; **scope_parent** |
| `author_id` | Author | ref | yes | no | readonly | `ref→USR` |
| `body` | Body | text | yes | yes | standard | markdown |
| `visibility` | Visibility | enum | no | yes | standard | common field; `internal · public` (default `internal`) — the customer-facing-vs-internal note split (SF `CaseComment.IsPublished`) |
| `reply_to_id` | Reply to | ref | no | no | standard | `ref→CMT` (threading) |
| `created_at` | Created | date | — | no | system | |

### `attachment` `[TYPE]` · `ATT` — file metadata on any object
Metadata-only (the blob lives in a storage mirror; numu stores the reference). Also generalized to any
subject.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `subject_id` | On | ref | yes | no | standard | `ref→` any entity; **scope_parent** |
| `name` | Filename | text | yes | no | standard | |
| `blob_ref` | Blob ref | text | yes | no | readonly | storage key |
| `mime` | Type | text | no | no | readonly | |
| `size_bytes` | Size | int | no | no | readonly | |
| `uploaded_by` | Uploaded by | ref | no | no | readonly | `ref→USR` |
| `created_at` | Created | date | — | no | system | |

---

## G5 · Orchestrator / feature pipeline `[SYSTEM]`

The 5-role chain's state, **in the DB** (source of truth; any on-disk ledger is a derived cache for
MCP-down). The circuit breaker is a `SELECT`, not agent discipline — prompt-discipline drifts.

### `feature_runs` — one row per orchestrated run
| column | kind | notes |
|---|---|---|
| `id` | text PK | |
| `case_id` | text → cases ON DELETE SET NULL | the Case it advances |
| `title` | text | |
| `phase` | text | `spec` · `test` · `code` · `review` · `ops` |
| `status` | text | `active` · `landed` · `escalated` · `abandoned` |
| `started_at` / `updated_at` | timestamptz | |

### `role_handoffs` — the handoff bus + breaker counters
| column | kind | notes |
|---|---|---|
| `id` | bigserial PK | |
| `feature_run_id` | text → feature_runs | |
| `role` | enum | `architect \| tester \| coder \| reviewer \| ops` |
| `attempt` | int | |
| `gate` | text | which gate this hop concerned |
| `outcome` | text | `pass \| fail \| test-drift \| escalate` |
| `kind` | text | `gate \| test-drift` (breaker discriminator) |
| `retries` / `hops` | int | breaker caps: **≤3 retries/gate, ≤8 hops/run** |
| `note` | text | |
| `at` | timestamptz | |

---

## G6 · Build knowledge — numu's "bake everything"

This is the differentiator: the **reasoning** of a build is stored as queryable, render-ready objects,
not buried in commit messages or a wiki. Each is a `[TYPE]` — so they're listable, linkable, and
gate-able like any other object. Together they make a project self-documenting from day one, with
**no external docs to consult**.

### `changeset` `[SYSTEM]` — the docs-currency gate's data
One row per commit that references a Case; records whether docs were reconciled. The `→ done`
transition reads this (`docs_reconciled` close-check) — refusing terminal entry if a documented
surface changed without its doc.

| column | kind | notes |
|---|---|---|
| `commit_sha` | text PK | |
| `case_id` | text → cases | |
| `touched_docs` | bool | did the commit touch `docs/`? |
| `docs_ack` | text | `reconciled` or `n/a — <reason>` |
| `at` | timestamptz | |

### `spec` `[TYPE]` · `SPC` — the approved design for a Case
ENRICH: the architect's output; the contract every other role builds against.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `title` | Title | text | yes | yes | standard | |
| `case_id` | Case | ref | yes | no | standard | `ref→CAS`; **scope_parent** |
| `body` | Body | text | yes | yes | standard | markdown: context, contracts, risks |
| `status` | Status | enum | yes | yes | standard | `draft` · `approved` · `superseded` |
| `approved_by` | Approved by | ref | no | yes | owner_grade | `ref→USR` (Checkpoint 1) |
| `created_at` | Created | date | — | no | system | |

### `acceptance_criterion` `[TYPE]` · `ACR` — one testable criterion of a spec
1:1 with a red test (the tester maps each to a failing test). Makes "is it done?" a query.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `spec_id` | Spec | ref | yes | no | standard | `ref→SPC`; **scope_parent** |
| `ordinal` | # | int | yes | yes | standard | criterion number |
| `text` | Criterion | text | yes | yes | standard | |
| `verified` | Verified | bool | no | yes | standard | flips when its test is green |
| `test_ref` | Test | text | no | yes | standard | path::test_name |

### `runbook` `[TYPE]` · `RBK` — a durable record of a non-trivial bug + fix
The bug→case→runbook cadence: reasoning survives here, not in `git log`.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `title` | Title | text | yes | yes | standard | |
| `problem` | Problem | text | yes | yes | standard | symptom |
| `root_cause` | Root cause | text | yes | yes | standard | the *why* |
| `fix` | Fix | text | yes | yes | standard | what changed + why it holds |
| `case_id` | Case | ref | no | no | standard | `ref→CAS`; **scope_parent** |
| `status` | Status | enum | yes | yes | standard | `open` · `fixed` · `wontfix` |
| `date` | Date | date | yes | yes | standard | |

### `decision` (ADR) `[TYPE]` · `DEC` — an architectural decision record
ENRICH: the locked decisions a future session must not silently reverse.

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `title` | Title | text | yes | yes | standard | |
| `context` | Context | text | yes | yes | standard | the forces |
| `decision` | Decision | text | yes | yes | standard | what was chosen |
| `consequences` | Consequences | text | yes | yes | standard | trade-offs accepted |
| `status` | Status | enum | yes | yes | owner_grade | `proposed` · `accepted` · `superseded` |
| `supersedes_id` | Supersedes | ref | no | yes | standard | `ref→DEC` |
| `date` | Date | date | yes | yes | standard | |

### `capability` `[TYPE]` · `CAP` — the anti-amnesia ledger as data
Every capability is a row; the `capability-audit` gate fails CI on a dropped or undocumented
capability. "No capability lives only in memory."

| field | label | kind | req | edit | perm_class | options · notes |
|---|---|---|---|---|---|---|
| `key` | Key | text | yes | no | standard | `category:name` (e.g. `cases:close-gate`) |
| `status` | Status | enum | yes | yes | standard | `live` · `gap` · `deferred` |
| `description` | Description | text | yes | yes | standard | |
| `evidence` | Evidence | text | no | yes | standard | path/test/commit proving it |
| `project_id` | Project | ref | no | no | standard | `ref→PRJ`; **scope_parent** |

---

## G7 · Deferred — designed-for, NOT built in v1

Flagged so the schema/registry anticipates them, but they ship only when a project needs them
(disposability: don't build scale/transport infra early).

- **`connector` `[TYPE]` · `CON`** — an external-source conduit `(caller, target, bytes) → pipeline`.
  Carries the SSRF/TLS gate, async job rows, and a saved data-contract. Connectors call the framework
  layer (RBAC-aware upload pipeline), never storage directly.
- **`secret` `[TYPE]` · `SEC`** — a reference to a credential (never the plaintext; envelope-encrypted
  at rest, rotation metadata). Needed before connectors are real.
- **`skill` / `playbook` `[TYPE]` · `SKL`** — a reusable procedure an agent can invoke; the
  build-knowledge analog of a connector for *process* rather than *data*. *(Distinct from a Claude-Code
  `SKILL.md` — harness tooling, e.g. the `http` skill numu ships at `.claude/skills/http/`. The
  `[TYPE] skill` is a DB-registered, agent-invokable procedure; the SKILL.md is editor tooling. Both can
  coexist.)*
- **`milestone` `[TYPE]` · `MIL`** — a **generic time-bound obligation** off
  *any* `subject_id` (SF `CaseMilestone`, minus the EntitlementProcess machinery). Reusable across
  entities + a use-case numu doesn't yet cover (deadlines / SLAs for customer cases *and* the apps numu
  supports). Fields:

  | field | label | kind | req | edit | perm_class | options · notes |
  |---|---|---|---|---|---|---|
  | `subject_id` | On | ref | yes | no | standard | `ref→` any entity; **scope_parent** |
  | `name` | Name | text | yes | yes | standard | e.g. "First response", "Resolution SLA" |
  | `kind` | Kind | enum | yes | yes | standard | `sla · deadline · checkpoint` |
  | `target_at` | Target | date | yes | yes | standard | when it's due |
  | `completed_at` | Completed | date | no | yes | standard | null until met |
  | `breached` | Breached | bool | — | no | readonly | derived: `now > target_at AND completed_at IS NULL` |

---

## What numu deliberately does NOT model (and why)

The lean win is as much what's *absent* as present. The rest of SF's Case family maps to an existing
numu primitive or an orthogonal feature — none earns a bespoke object:

- **No `Account` / `Contact` object** — the *account* is the `workspace` (or `project`) the case scopes
  to; the *contact* is the case's `reporter_id` (an `actor`). The scope tree already is the customer
  hierarchy.
- **No `CaseOwnerSharingRule` / sharing-rule engine** — sharing IS a `memberships` edge + the
  `scope_parents` cascade: grant a team a role on a parent and it cascades to the children. SF needs a
  declarative rule object; numu's one orthogonal edge makes it structurally unnecessary.
- **No `CaseHistory` / `CaseHistory2`** — `events` is the single append-only change-log for every type
  (a `field_changed` event carries `{field, old, new}`). Two history objects is SF redundancy.
- **No per-type `…ContactRole`** — one `memberships.context_role` labels any principal's role on any
  object.
- **No `CaseArticle` / `…Article` junctions** — the generic `relation` edge links any knowledge object
  to any work item; the knowledge stays a typed object (`runbook`/`decision`/`spec`), not a generic
  "article", because those are distinct *shapes*, not renamings.

The rule behind all of these: **a contextual role that already has a home becomes a field or an edge,
never a new object with a new name** — exactly the duplication that grows SF's object count into the
thousands.

---

## Open enrichment questions (for Em / other sessions)

1. **`workspace` vs `project` depth** — is two levels (`ORG → PRJ`) the right scope tree, or do some
   projects need an intermediate (e.g. `team`/`epic`) tier? The `scope_parents` model supports either;
   the question is the *default* numu ships.
2. **`actor.kind=agent`** — what minimum fields does an agent principal need to be useful for
   coordination (model id? capabilities? a home Case)? G2 has a starter; enrich.
3. **`case.type` vocab** — is `bug/feature/task/epic/chore` the right default enum, or do build
   projects want a different set (e.g. `spike`, `incident`)?
4. **Knowledge objects as comments vs first-class** — `spec`/`runbook`/`decision` are first-class
   `[TYPE]`s here (queryable, gate-able). Confirm that's worth it vs. keeping them as markdown files;
   the bet is that *queryable* knowledge is what makes numu self-contained.
5. **Which builtins (if any) beyond `case` earn a typed table** — everything else is `entity_data`
   JSONB today. Promote one to a typed table only when a real query proves it needs it.

---

*This catalog is the contract for numu's `migrations/` (system tables) + `seed` (builtin type rows +
`type_fields`). Edit fields freely here first — the seed implements whatever this doc settles on.*
