# numu — object schema (reconciled numu + redpash model)

> **Purpose.** The unified object model for **numu** — the backend-office that future numu frontends and
> client websites build on. It reconciles the two catalogs that exist today: **numu's own registry**
> (`numu_dev`, the build-engine types) and **redpash-rust-pwa's app catalog** (`redpash_prerelease`, the
> data-quality PWA types being reused as numu's foundation). Every object, its fields, and its metadata are
> grouped by a forward-looking **context taxonomy** so you can plan new objects and fields against a clear
> picture.
>
> **Source of truth.** Live introspection of both Postgres DBs (cluster 18, port 5433) on 2026-06-28, plus
> `numu/docs/OBJECTS.md`, `numu/crates/api/src/**`, and redpash `backend/{migrations,crates}/**`. Where a
> type lives in both catalogs the field set is **reconciled** (see [§2](#2-reconciliation-overlapping-concepts)).
>
> **Companion docs:** [numu-gluesql-postgres.md](numu-gluesql-postgres.md) (where the data lives) ·
> [numu-csv-flow-and-datatypes.md](numu-csv-flow-and-datatypes.md) (how tabular data + its types enter).

---

## 1. The registry model — "a type is a row"

Both catalogs share the same kernel: **declaring an object type is data, not a migration.** A type is one
row in `type_definitions` + N rows in `type_fields`; storage, CRUD, RBAC, audit, and the typed-field surface
come for free. Custom objects need **zero new code**.

- **Identity** — every object's id is `<PREFIX>_<32-hex>` (e.g. `CAS_9f3a…`). The `id_prefix` is globally
  unique, so `kind(id)` is an O(1) lookup. (redpash names the id column `redpash_id`; numu names it `id`.)
- **Storage** — non-builtin types live in `entity_data.data` (JSONB) keyed by field name; a handful of
  builtin types also project to a typed table (see each type's "physical columns").
- **`scope_parents`** — the reach tree: an ordered list of ref fields that cascade RBAC from a parent
  (`project → workspace`, `case → project`, `comment → subject`). Denial of reach is a **leak-free 404**;
  per-field denial (after reach is proven) is a **403**.
- **Concurrency** — every write carries `If-Match` with the row's `version` (ETag); lost-update protection is
  O(1). (numu: `entity_data.version`; redpash mirrors per typed table.)
- **Self-describe** — `GET /api/types` returns the catalog; `OPTIONS` on an object returns the RBAC verdict +
  the field metadata for the caller's role. **This is how a new field reaches the front automatically.**

**The two source catalogs:**

| Catalog | DB | Types | Character |
|---|---|---|---|
| **numu** | `numu_dev` | 17 | Build-engine / back-office: identity, work-tracking, **build-knowledge** (spec/decision/runbook/capability), integration. |
| **redpash** | `redpash_prerelease` | 12 | Data-quality PWA: identity, **data objects** (file/chart/dashboard), collaboration (case/channel/message), settings. |

`type_fields` differs slightly between them — numu carries `required · editable · perm_class · options ·
searchable`; redpash carries `data_type · perm_class · data_class · field_group · scope · rel_type ·
is_sortable · validate · options` (redpash derives required/editable from `perm_class`). The merged model
below keeps the **union** of useful metadata.

---

## 2. Reconciliation — overlapping concepts

Six concepts exist in **both** catalogs with naming/field drift. The merged numu model resolves each into one
object; the **naming choices marked ⚠ are open decisions** for Em.

| Concept | numu type | redpash type | Reconciliation |
|---|---|---|---|
| Human / agent principal | `actor` · **USR** | `user` · **USR** | Same prefix + concept. ⚠ pick `actor` vs `user`. Merge fields (below). |
| Top-level tenant (org root) | `workspace` · **ORG** | `company` · **CMP** | Same role. ⚠ pick name+prefix; map the other. |
| Group within a tenant | `team` · TEM | `team` · TEM | Same. `scope_parent` = the tenant choice (`workspace_id` vs `company_id`). |
| Project container | `project` · PRJ | `project` · PRJ | Union of fields (numu adds slug/status/repo_url/default_branch). |
| Work item | `case` · CAS | `case` · CAS | Reconcile enums (priority, type, origin/source) — see note. |
| External data source | `connector` · **CON** | `connection` · **CON** | Same prefix. numu has the rich field set; redpash's data lives in the `connectors` table. Merge. |

**Merged field proposals for the overlaps** (✅ = keep, ⚠ = decide):

- **Principal (USR):** `display_name` · `handle`/`username` ⚠ · `email` · `kind` (human/agent/service, numu
  only) · `platform_role`/`role` ⚠ (member/admin) · `status` (numu: active/invited/disabled; redpash:
  active/archived — **union**) · `avatar_url` · *(profile, from redpash `users` table:* `plan` · `locale` ·
  `default_project_id` · `google_sub`*)*.
- **Tenant (ORG/CMP):** `name` · `slug` (numu) · `status` (active/suspended, numu).
- **project (PRJ):** `tenant_id` ⚠ · `name` · `slug` · `status` (planning/active/paused/archived) ·
  `description` · `repo_url` · `default_branch`. (redpash today: only `name` + `created_at`.)
- **case (CAS):** `title` · `description` · `type` (⚠ numu adds `chore`) · `status`
  (backlog/todo/in_progress/in_review/done — identical) · `priority` (⚠ numu low/normal/high/urgent vs
  redpash low/medium/high/critical) · `origin`/`source` ⚠ · `visibility` (numu) · `workflow_id` (numu) ·
  `assignee_id` · `reporter_id` · `project_id` · `company_id` (redpash). redpash's `cases` table also has
  `error_message`, `attachments` (jsonb), `docs_gate_floor`.
- **connector (CON):** `name` · `kind` (⚠ union: numu http_json/webhook/sql/file + redpash
  postgres/mysql/kafka) · `target`/`config` ⚠ · `status` (draft/active/disabled/error) · `data_contract`
  (json) · `watermark` (redpash, incremental pulls) · `last_run_at` · `description`.

---

## 3. The object catalog, by context

A forward-looking **context taxonomy** (the user's "monitoring / systems / public …"). It is a planning lens,
not a DB column — see [§5](#5-how-the-taxonomy-maps-to-what-ships) for how it maps to the shipped apps/rail.

Field-table legend: **Req** (required) · **Edit** (editable after create; `set-once` = no) · **Perm**
(`perm_class`) · **Data** (`data_class`) · **Options** (enum vocab / ref target / default). Source tag: `[n]`
numu, `[r]` redpash, `[n+r]` both.

### 3.1 Public / Content
Objects that surface **on client websites** — the published, analyst-produced content.

#### `file` · FIL `[r]` — scope: `project_id`
The uploaded dataset. Registry surface (6 fields, all `readonly`): `filename · project_id · row_count ·
col_count · cleanness_pct · created_at`.
**Physical `project_files` columns the front actually reads** (wider than the registry surface):

| Column | Type | Notes |
|---|---|---|
| redpash_id, project_id, filename | text | identity + scope |
| file_type | text | `csv` \| `chart` \| `dashboard` (the table is shared by all three) |
| storage_path | text | `files/<FIL>.bin` on disk (immutable blob) |
| row_count, col_count | bigint, int | shape |
| cleanness_pct | real | quality score 0–100 |
| encoding, delimiter | text | parse provenance |
| **columns_meta** | jsonb | `ColumnMeta[]` — the per-column dtype catalog (see csv-flow doc) |
| spec | jsonb | chart/dashboard config (unused for csv) |
| source_file_id | text | chart → its source csv |
| is_public, is_favorite | bool | publish / pin flags |
| folder | text | dashboard grouping |
| created_at | timestamptz | |

#### `chart` · CHT `[r]` — scope: `project_id`
**0 seeded `type_fields`** (a gap — see [§6](#6-planning-notes)). Physically a `project_files{file_type:'chart'}`
row: `spec` (jsonb) = opaque chart config, `source_file_id` = the CSV it derives from, no bytes, no genesis
step. Created via the sealed `pipeline::create_chart`.

#### `dashboard` · DSH `[r]` — scope: `project_id`
**0 seeded `type_fields`** (gap). Physically `project_files{file_type:'dashboard'}`: `spec` = 15×10 layout,
`folder` for grouping, no `source_file_id`, no bytes. Created via `pipeline::create_dashboard`.

#### `note` · NOT `[n]` — scope: `project_id`

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| project_id | ref→PRJ | yes | set-once | standard | scope_parent |
| title | text | yes | yes | standard | |
| body | text | no | yes | standard | |
| pinned | bool | no | yes | standard | default false |

### 3.2 Identity & Access
Who exists and what they can reach.

#### `actor`/`user` · USR `[n+r]` — scope: `[]` (root)
Reconciled (see [§2](#2-reconciliation-overlapping-concepts)). numu `actor` fields:

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| display_name | text | yes | yes | standard | |
| handle | text | yes | yes | standard | validate `^[a-z0-9_-]+$` |
| email | text | no | yes | owner_grade | |
| kind | enum | yes | set-once | readonly | human · agent · service (def human) |
| platform_role | enum | yes | yes | owner_grade | member · admin (def member) |
| status | enum | yes | yes | standard | active · invited · disabled |
| avatar_url | text | no | yes | standard | |

redpash `user` adds/differs: `username` (readonly, personal), `email`/`display_name` are `data_class=personal`,
`role` ∈ user/admin, `status` ∈ active/archived; the `users` table carries `google_sub · plan · locale ·
default_project_id`.

> **Machine principals (`kind ∈ agent/service`).** Non-human actors have no OAuth identity — plan how they
> authenticate (e.g. issued credentials), and treat **agent/service operators the same as human operators**:
> an agent reaching customer data is bound by the same `operator_access` grant + purpose + `access_audit`
> rules ([numu-rbac-membership-design.md](numu-rbac-membership-design.md) Part 3). The Art. 22 "automated
> decisioning N/A" exemption ([legal](numu-legal-privacy-data-compliance.md) §3.3) is about *decisions*, and
> must **not** be read to exempt agent data *access*.

#### `workspace`/`company` · ORG/CMP `[n+r]` — scope: `[]` (root)
numu `workspace`: `name` (standard), `slug` (set-once, validate `^[a-z0-9-]+$`), `status` ∈ active/suspended
(owner_grade). redpash `company`: `name` only (+ table `created_at`).

#### `team` · TEM `[n+r]` — scope: `workspace_id` (numu) / `company_id` (redpash)

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| workspace_id / company_id | ref→ORG/CMP | yes | set-once | standard | scope_parent |
| name | text | yes | yes | standard | |
| kind | enum | yes | set-once* | standard/owner_grade | team · department |
| description | text | no | yes | standard | (numu only) |

\* numu `team.kind` is set-once `standard`; redpash `team.kind` is `owner_grade`.

#### `project` · PRJ `[n+r]` — scope: `workspace_id`/`company_id`
numu field set (redpash currently only `name` + `created_at`):

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| workspace_id | ref→ORG | no | set-once | standard | scope_parent |
| name | text | yes | yes | standard | |
| slug | text | yes | set-once | standard | validate `^[a-z0-9-]+$` |
| status | enum | no | yes | standard | planning · active · paused · archived |
| description | text | no | yes | standard | |
| repo_url | text | no | yes | standard | |
| default_branch | text | no | yes | standard | default `main` |

**Support tables:** `memberships` (object↔member role edge: `object_id · member_id · role · context_role`) ·
`roles` `[n]` (role tiers as data: viewer/member/admin/owner + rank) · `field_permissions` (sparse per-field
overrides: `type_id · field · role · can_read · can_write`) · `sessions` · `auth_identities` `[n]` /
`google_sub` `[r]` · `type_scope_roles` `[r]` · `company_rbac` `[r]` (versioned horizontal policy).

### 3.3 Work & Collaboration
Tracked work + async communication.

#### `case` · CAS `[n+r]` — scope: `project_id` (numu) / `project_id`,`company_id` (redpash)
numu field set (the richer one):

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| title | text | yes | yes | standard | |
| description | text | no | yes | standard | |
| type | enum | yes | yes | standard | bug · feature · task · epic · chore |
| status | enum | yes | yes | standard | backlog · todo · in_progress · in_review · done |
| priority | enum | yes | yes | standard | low · normal · high · urgent |
| origin | enum | no | yes | standard | ui · agent · import · email · web · phone · chat |
| visibility | enum | no | yes | standard | internal · public (def internal) |
| workflow_id | ref→workflows | yes | set-once | readonly | default `default` |
| assignee_id | ref→USR | no | yes | standard | |
| reporter_id | ref→USR | no | set-once | readonly | |
| project_id | ref→PRJ | yes | set-once | standard | scope_parent |

redpash `case` differs: `priority` ∈ low/medium/high/critical, `source` ∈ internal/external (≈ numu `origin`),
adds `company_id` (scope), and the `cases` table has `error_message · attachments(jsonb) · docs_gate_floor`.

#### `comment` · CMT `[n]` — scope: `subject_id`

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| subject_id | ref (any) | yes | set-once | standard | scope_parent |
| author_id | ref→USR | no | set-once | standard | |
| body | text | yes | yes | standard | |
| visibility | enum | no | yes | standard | internal · public |
| reply_to_id | ref→CMT | no | set-once | standard | threading |

(redpash equivalent is the `case_comments` table — `id · case_id · author_id · body · created_at`.)

#### `attachment` · ATT `[n]` — scope: `subject_id`
`subject_id` (ref, set-once) · `name` · `blob_ref` · `mime` · `size_bytes` · `uploaded_by` (ref→USR) — all
set-once/readonly. (redpash equivalent: `case_attachments` table, metadata-only, blob on disk.)

#### `milestone` · MIL `[n]` — scope: `subject_id`
`subject_id` (ref) · `name` · `kind` ∈ sla/deadline/checkpoint · `target_at` (date) · `completed_at` (date).
**`breached` is derived, not stored** (`now > target_at AND completed_at IS NULL`).

#### `channel` · CHN `[r]` — scope: `[]`
`name` · `kind` ∈ channel/dm · `created_at`. #### `message` · MSG `[r]` — scope: `channel_id`
`body` · `channel_id` (scope) · `author_id` · `created_at`.

**Support tables:** `workflows` `[n]` (workflow-as-data: states/transitions/initial/close_checks) ·
`case_close_checks` `[n]` (docs-currency gate state) · `case_docs_reconciled` `[r]` (same gate, redpash side) ·
`feature_runs` + `role_handoffs` `[n]` (the 5-role orchestrator state machine + circuit breaker) ·
`relations` `[n]` (generic typed entity↔entity edges) · `channel_reads` `[r]`.

### 3.4 Build Knowledge `[n]`
numu's queryable engineering memory — design, decisions, fixes, capability ledger.

| Type · prefix · scope | Fields |
|---|---|
| **spec** · SPC · `case_id` | case_id(ref→CAS, set-once) · title · body(markdown) · status(draft/approved/superseded) · approved_by(ref→USR, owner_grade) |
| **acceptance_criterion** · ACR · `spec_id` | spec_id(ref→SPC) · ordinal(int) · text · verified(bool, def false) · test_ref |
| **runbook** · RBK · `case_id`(opt) | case_id(ref→CAS, opt) · title · problem · root_cause · fix · status(open/fixed/wontfix) · date |
| **decision** (ADR) · DEC · `[]` | title · context · decision · consequences · status(proposed/accepted/superseded, owner_grade) · supersedes_id(ref→DEC) · date |
| **capability** · CAP · `project_id`(opt) | project_id(ref→PRJ, opt) · key (`category:name`) · status(live/gap/deferred) · description · evidence |

**Support table:** `changeset` `[n]` (docs-currency gate: one row per commit referencing a Case).

### 3.5 Integration
External sources, credentials, reusable procedures.

#### `connector`/`connection` · CON `[n+r]` — scope: `project_id`
> `[n+r]` = the **same CON concept under two names**: numu calls it `connector`, redpash calls it
> `connection` (one type per catalog, not two types per catalog). numu's `connector` field set is below;
> redpash's `connection` has no registry fields — its data lives in the `connectors` table.

| Field | Kind | Req | Edit | Perm | Options |
|---|---|---|---|---|---|
| project_id | ref→PRJ | no | set-once | standard | scope_parent |
| name | text | yes | yes | standard | |
| kind | enum | yes | yes | standard | http_json · webhook · sql · file *(+ redpash: postgres · mysql · kafka)* |
| target | text | yes | yes | standard | URL / external ref |
| status | enum | yes | yes | standard | draft · active · disabled · error |
| data_contract | json | no | yes | standard | default `{}` |
| last_run_at | date | no | set-once | readonly | |
| description | text | no | yes | standard | |

redpash `connectors` table adds `config` (jsonb, encrypted) + `watermark` (jsonb, incremental pulls); jobs
tracked in `connector_jobs` (`status` ∈ queued/running/succeeded/failed). See the csv-flow doc for the pull path.

#### `secret` · SEC `[n]` — scope: `project_id`
**Metadata-only — never the plaintext.** `name` · `provider` ∈ env/vault/aws_kms/gcp_sm · `external_ref`
(owner_grade) · `status` ∈ active/rotating/revoked · `rotation_at` · `description`.
> **Lifecycle obligations (multi-tenant processor).** Define **who rotates + cadence** (the AES-GCM crypto +
> rotation primitives exist — [legal](numu-legal-privacy-data-compliance.md) §3.4); on **revoke**, in-flight
> `connector_jobs` holding the old secret must **fail closed**; and an operator read of `external_ref`
> (already `owner_grade`) must land in `access_audit` ([RBAC](numu-rbac-membership-design.md) §3.5).

#### `skill` · SKL `[n]` — scope: `project_id`
`name` · `description` · `kind` ∈ procedure/playbook · `definition` (json) · `status` ∈ draft/active/deprecated.

### 3.6 System & Registry ("systems")
The engine spine + per-user config.

#### `preference` · PRF `[r]` — scope: `[]`
The settings registry surface. Each field carries `field_group` (the settings section) + `scope`
(user vs platform):

| Field | Type | Perm | Group | Scope | Options |
|---|---|---|---|---|---|
| theme | string | personal | Appearance | user | Dark(`new-dark`) · Light(`new-light`) |
| density | string | personal | Appearance | user | compact · default · comfortable |
| fontsize | string | personal | Appearance | user | sm · default · lg |
| workspace.page_rows | string | personal | Studio | user | 200 · 1000 · 5000 |
| app.studio.enabled | bool | owner_grade | Apps | platform | |
| app.admin.enabled | bool | owner_grade | Apps | platform | |

**Support tables:** `type_definitions` · `type_fields` (the registry itself) · `entities` (one id-space) ·
`entity_data` (all-JSONB polymorphic store) · `settings` `[r]` (behavior registry:
`scope_type · scope_id · key · value`) · `user_preferences` `[r]` · `user_sentinels` `[r]` (learned
missing-value tokens) · `_sqlx_migrations`.

### 3.7 Monitoring & Observability ("monitoring")
No entity types — append-only telemetry tables.

| Table | Source | Purpose |
|---|---|---|
| `events` | n+r | append-only activity log (`kind · entity_id · actor_id · payload · request_id · trace_id`) |
| `request_log` | r | HTTP request log (`route · status · latency_ms`) |
| `db_query_log` | r | DB query tracing (`query · latency_ms`) |
| `audit_runs` / `audit.run` | n / r | one row per audit-tool run (CI ratchet memory) |
| `audit_findings` / `audit.finding` | n / r | exploded findings (`severity · finding_key · detail`) |

---

## 4. Metadata reference (the vocabularies)

- **`perm_class`** — the field's permission tier: `system` (engine-managed) · `readonly` (visible, never
  user-set) · `standard` (normal edit) · `owner_grade` (only owner-rank may write) · `personal` (the owner's
  own data; redpash). Drives the `OPTIONS`/field-gate (403) plane.
- **`data_class`** (privacy tag: `none` · `personal` · `sensitive`) — **LIVE in numu** as of migration
  `0016` (landed with the data plane; tags message.body, file.columns_meta, actor.email, case.title/
  description, comment.body, note.body). Feeds export-scoping, log redaction, and the proposed operator
  read-audit ([RBAC](numu-rbac-membership-design.md) §3.5, [ADR 0001](decisions/0001-data-app-catalog.md)).
- **`kind`/`data_type`** — the value shape: `text/string` · `int` · `float` · `bool` · `date`/`datetime` ·
  `json` · `ref` (FK to another type by prefix) · `enum` (vocab in `options`).
- **`required` / `editable`** (numu) — create-mandatory / mutable-after-create (`editable=false` ⇒ set-once).
  redpash derives these from `perm_class` (`readonly` ⇒ not user-editable).
- **`options`** — enum vocab, `ref` target prefix, `default`, `validate` (regex). redpash splits some out:
  `rel_type`/`rel_multi` (ref target + cardinality), `validate`, `is_sortable`.
- **`searchable`** (numu) — feeds the omnisearch GIN index. **`field_group` + `scope`** (redpash) — settings
  section + user-vs-platform reach. **`is_builtin`** — numu-shipped (a reset re-seeds only these).
  **`ordinal`** — display order. **`method_policy`** (type_definitions) — per-type verb mask + delete-min-role.

---

## 5. How the taxonomy maps to what ships

The §3 contexts are a planning lens. They line up with the real surfaces so nothing is invented:

- **redpash apps** (`frontend/framework/boot/apps.js`): **Studio** (Workspace+Designer → file/chart/dashboard),
  **Admin** (Console/Registry/Cases/Monitoring → user/company/team/project/file/case + audit), **Messaging**
  (channel/message), **Settings** (preference). Server-driven nav via `GET /api/rail/:view`
  (`backend/crates/api/src/rail.rs`): workspace · org · registry · settings · console · cases · monitoring ·
  designer · messaging.
- **numu groups** (`numu/docs/OBJECTS.md`): G1 registry spine · G2 access/org · G3 audit · G4 work-tracking ·
  G5 orchestrator · G6 build-knowledge · G7 integration.

| §3 context | redpash app / rail | numu group |
|---|---|---|
| Public / Content | Studio (workspace, designer) | — (new for numu) |
| Identity & Access | Admin → Registry; org rail | G2 |
| Work & Collaboration | Admin → Cases; Messaging | G4, G5 |
| Build Knowledge | — | G6 |
| Integration | (connectors) | G7 |
| System & Registry | Settings; Console | G1 |
| Monitoring & Observability | Admin → Monitoring | G3 |

---

## 6. Planning notes (adding objects + fields for the numu frontend)

- **Add an object type** = 1 `type_definitions` row (`type_id · id_prefix · scope_parents · ordinal ·
  method_policy`) + N `type_fields` rows. Custom (non-builtin) types need **no migration** — they live in
  `entity_data`. A builtin-backed type (like `file`, with a typed table + special write path) also needs a
  migration + a sealed pipeline function.
- **Add a field** = 1 `type_fields` row. It surfaces to the front automatically via `GET /api/types` and the
  per-object `OPTIONS` response — no client change to *see* it; the client just renders the new field meta.
- **Gaps to fill before front work:**
  - `chart` + `dashboard` now have **seeded `type_fields`** in numu (migration `0016`: project_id/title/
    spec, +file_id on chart) — the 0-field gap is closed for them; **`connection` is still 0-field**. The
    `spec` stays opaque (recipe-only). **Trade-off:** an opaque object has **no `field_permissions` and
    no `data_class`** coverage — yet chart/dashboard `spec` is exactly where customer-derived data can leak
    (the closed F-E finding, [legal](numu-legal-privacy-data-compliance.md) §3.2). If kept opaque, enforce
    the "recipe-only, no customer data in `spec`" invariant another way (a spec-content check).
  - **Naming decisions (⚠):** `actor` vs `user` (USR), `workspace` vs `company` (ORG/CMP), `connector` vs
    `connection` (CON). Pick one canonical name per concept for the merged numu catalog; the others become
    aliases/migrations.
  - **Enum reconciliation:** `case.priority` (normal/urgent vs medium/critical), `case.type` (`chore`),
    `case.origin` vs `case.source`. Settle one vocabulary.
- **Client-website angle:** the **Public / Content** context (file/chart/dashboard/note + published
  project content) is what a client site renders; `is_public` on `project_files` is the existing publish flag.
  New public-facing objects should join this context and carry an explicit visibility/publish field.
  → **Settled in [decision 0003](decisions/0003-consent-sharing-aggregate.md) / [CASE 0018](cases/0018-consent-sharing-aggregate-source.md):**
  the `is_public` boolean becomes explicit visibility scopes (`private`·`organization`·`public`) reconciled with the
  `visibility` enum; sharing is **pure-consent** and carries the materialized **aggregate** `source_file` (PII-stripped),
  never the raw — so a shared chart/dashboard exposes only what it was built to show.
