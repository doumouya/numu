# numu — DOCMAP (docs ⇄ code-area map)

> **The structural map.** numu's promise is "no need to consult any other repo's docs" — so the few docs
> it *does* ship must be navigable at a glance. This is that index: every doc, what it governs, the code
> area it is the contract for, and the order to read them in. Scan this first; dive from here.
>
> *(This is the project-agnostic successor to the redpash `REDMAP.md` convention — same job, generic name:
> "DOC" not "RED", because numu is the engine, not any one product.)*

## Read order

1. [`README.md`](../README.md) — what numu is + the one idea (two layers). *Orientation.*
2. **DOCMAP.md** (this) — where everything lives.
3. [`OBJECTS.md`](OBJECTS.md) — the object catalog. **The active enrichment surface** + the data contract.
4. [`HTTP.md`](HTTP.md) — how every registered type is exposed over HTTP (the uniform verb surface).
   - ⭐ [`CONTRACT.md`](CONTRACT.md) — **the one-page frozen surface for the frontend** (every type + endpoint + rule).
   - [`RUNNING.md`](RUNNING.md) — boot the binary + connect a frontend (CORS / proxy).
5. [`OBSERVABILITY.md`](OBSERVABILITY.md) — debuggable-by-construction: request-id spine, problem+json, the 5th gate.
6. [`cases/0001-object-catalog.md`](cases/0001-object-catalog.md) — the live coordination thread for the catalog work.
7. **Foundation / planning docs** — the [object model](numu-objects-schema.md), [data plane](numu-gluesql-postgres.md) + [CSV datatypes](numu-csv-flow-and-datatypes.md), [RBAC + operator access](numu-rbac-membership-design.md), and [legal/privacy](numu-legal-privacy-data-compliance.md) for the numu frontend + customer data. *Forward-looking.*

## The map — doc ⇄ code-area

Each contract doc is the spec for a code slice that lands later (numu is design-phase, non-UI first). When
that slice exists, **code becomes the source of truth and the doc reconciles in the same change** (the
docs-currency gate); until then, the doc *is* the contract.

| Doc | Governs | Code area it's the contract for | Status |
|---|---|---|---|
| [`README.md`](../README.md) | The pitch + the two-layer model (SYSTEM tables vs REGISTERED TYPES) | whole repo (orientation) | living |
| [`DOCMAP.md`](DOCMAP.md) | The doc index + read order (this file) | `docs/` | living |
| [`OBJECTS.md`](OBJECTS.md) | The data model: the registry spine, every builtin `[TYPE]`/`[SYSTEM]` table, the prefix registry, the seeded `default` workflow, the `relation` edge, omnisearch | `migrations/` (SYSTEM tables) · `seed/` (builtin `type_definitions` + `type_fields` rows) | design contract |
| [`HTTP.md`](HTTP.md) | The uniform verb surface over the registry: `/api/objects/:type`, the verb→status matrix, OPTIONS self-description, `If-Match` concurrency, two-stage leak-free RBAC, `method_policy`, + runtime **type administration** (`POST /api/types`, hot-reload) | `crates/api/src/{objects,types}.rs` (the generic handler set + the type-admin surface over the registry) | **LIVE** (objects + CASE 0007 type-registration) |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Debuggability (P-DEBUG): the request-id/trace-id spine, structured spans, problem+json envelope, `/healthz`·`/readyz`, the debug-echo | `api/` middleware (`request_id_layer` + `TraceLayer`) · `tools/debuggability-audit` (the 5th gate) | design contract |
| [`RBAC.md`](RBAC.md) | The two permission planes: the reach resolver (Plane A → 404), field perms (Plane B → 403), roles-as-data, the membership-management SEV-0 guards | `crates/api/src/{rbac,caller,members,field_perms}.rs` · `migrations/0003`,`0004` · `tools/rbac-audit` | **LIVE** (CASE 0005) |
| [`AUTH.md`](AUTH.md) | Sessions + the Caller extractor; social OAuth (Google/Apple/FB/TikTok), the HMAC state cookie, the SSRF gate, the enterprise-SSO seam | `crates/api/src/{auth,oauth,http_client}.rs` · `migrations/0005`,`0006` | **LIVE** (CASE 0005) |
| [`.claude/skills/http/`](../.claude/skills/http/SKILL.md) | **Generic** RFC-9110 HTTP technique (method/status/header/conditional-request semantics) — what `HTTP.md` *applies* | consumed by `api/` + connectors; reusable across projects | **shipped** (committed) |
| [`.claude/skills/type-registry/`](../.claude/skills/type-registry/SKILL.md) | How-to: add an object **type** (1 `type_definitions` + N `type_fields` rows; field grammar, `scope_parents`, engine-owned defaults) — *applies* `OBJECTS.md` | `crates/api/src/{registry,objects}.rs` · `migrations/` seeds | **shipped** |
| [`.claude/skills/rbac/`](../.claude/skills/rbac/SKILL.md) | How-to: gate access the two-plane, leak-free way (reach → 404, field perms → 403; roles-as-data; membership SEV-0 guards) — *applies* `RBAC.md` | `crates/api/src/{rbac,caller,members,field_perms}.rs` · `tools/rbac-audit` | **shipped** |
| [`.claude/skills/api-conventions/`](../.claude/skills/api-conventions/SKILL.md) | How-to: the handler house-style (one `AppError`→problem+json, no-unwrap, mutation events, `Caller`, `If-Match`) — *applies* `OBSERVABILITY.md` + `HTTP.md` | `crates/api/src/{error,auth,objects,db}.rs` · `tools/debuggability-audit` | **shipped** |
| [`.claude/skills/enforcement-gates/`](../.claude/skills/enforcement-gates/SKILL.md) | How-to: author a `tools/*-audit` gate (`ci.sh` auto-discovery, the ratchet) + the Rust-gate/DB-backstop doubling — *applies* `tools/README.md` | `tools/ci.sh` · `tools/*-audit/` · `migrations/0008` | **shipped** |
| [`cases/`](cases/) | On-disk Case stubs — the case-first fallback when no Cases backend is reachable | the coordination surface | living |
| [`decisions/0001-data-app-catalog.md`](decisions/0001-data-app-catalog.md) | The reconciliation ADR: D-CNV, file-as-typed-table, canonical names, note/report, the presentation layer, data_class-with-the-plane | the data-app plane below | accepted |
| [`decisions/0002-frontend-same-origin-serving.md`](decisions/0002-frontend-same-origin-serving.md) | The same-origin serving ADR: `ServeDir` fallback + `NUMU_WEB_DIR` so the `SameSite=Lax` session cookie works with zero CORS; the G1–G7 contract gaps (CASE 0013) | `web/` frontend · `crates/api/src/{lib,config}.rs` | accepted |
| [`decisions/0003-consent-sharing-aggregate.md`](decisions/0003-consent-sharing-aggregate.md) | The sharing ADR: **pure-consent** sharing (no privacy gate), share the materialized **aggregate** `source_file` not the raw, the narrowest-grant vs the field-perm over-grant anti-pattern, **informed-consent** visibility scopes (CASE 0018) | the object reach/sharing model · the data-app plane · legal/privacy | accepted (design; impl deferred) |
| [`decisions/0004-build-router-and-startup-self-check.md`](decisions/0004-build-router-and-startup-self-check.md) | The contract-shadow guard ADR: `build_router` as the ONE assembly point (so tests drive the real layered stack) + the boot self-check (`assert_options_routed` → `startup.contract_violation`, warn + keep serving); the custom preflight-accurate CORS layer that un-shadows OPTIONS (CASE 0017) | `crates/api/src/{lib,cors,config,registry,workflow,db}.rs` · `tests/options_routing.rs` | accepted |
| [`internal/specs/cors-contract-safety.md`](internal/specs/cors-contract-safety.md) | The CORS-contract-safety spec: the preflight-accurate explicit-allowlist credentialed CORS fix + the breach-class monitor (build_router + startup self-check + the no-DB regression test) + the `numu-http-contract-safety` skill — AC1–AC11, Parts A–F (CASE 0017) | `crates/api/src/{lib,cors,config}.rs` · `tests/options_routing.rs` · `tools/e2e-0013.sh` | implementing (Parts A–D) |

## Data-app plane (LIVE — README §3 Buckets 1–2, the numu-Console data layer)

The redpash data plane, merged into numu so the Console binds real data. Catalog + presentation + the CSV
upload pipeline + the conversation feed are **live**; the client-compute ops + wasm surface stay the
frontend's job (deferred). Rationale: [`decisions/0001-data-app-catalog.md`](decisions/0001-data-app-catalog.md).

| Doc | Governs | Code area it's the contract for | Status |
|---|---|---|---|
| [`numu-objects-schema.md`](numu-objects-schema.md) | the file/chart/dashboard/message catalog + `project` origin/case_id + the `context_view`/`role` presentation layer + `data_class` | `migrations/0016_data_app_catalog.sql` | **LIVE** |
| [`numu-csv-flow-and-datatypes.md`](numu-csv-flow-and-datatypes.md) | the CSV typing engine + `pipeline::upload_csv` + `POST /api/files` (`UploadOutcome`) | `crates/{data,shared}` · `crates/api/src/{pipeline,files}.rs` · `migrations/0017_project_files.sql` | **LIVE** (upload; connectors deferred) |
| [`numu-gluesql-postgres.md`](numu-gluesql-postgres.md) | the Postgres side of the split (registry + `project_files` projection + `project_steps` recipe + the on-disk blob); GlueSQL stays client | `crates/api/src/pipeline.rs` · `migrations/0017` | **LIVE** (server side) |
| feed + seed | `GET /api/conversations/:id/feed?lens=` + the demo R0 seed | `crates/api/src/conversations.rs` · `tools/seed-demo.sh` | **LIVE** |
| [`decisions/0002-frontend-same-origin-serving.md`](decisions/0002-frontend-same-origin-serving.md) | the bundled frontend served same-origin (`ServeDir` fallback + `NUMU_WEB_DIR`) + the `numu-data-client.js` shape normalization (G3–G6: `flatten()`/snake→camel) binding the Datacore rewrite to the live backend | `web/` (R-stage pages, `numu-data-client.js`, `_ds/`, `vendor/`) · `crates/api/src/{lib,config}.rs` · `web/tests/shapes.test.mjs` | **LIVE** (CASE 0013 — bound-live on R3 Shell; Console cutover deferred) |

## Foundation / planning docs (the numu frontend + customer data)

Forward-looking planning for numu as a **backend-office** (a frontend + client websites built on numu): the
**reconciled numu+redpash object model**, the data plane it inherits, and the RBAC + legal/privacy work for
**processing customer data**. Grounded in live introspection of both DBs (`numu_dev`, `redpash_prerelease`) +
redpash source; the operator-access and legal artifacts are **design/roadmap**, not yet built. Each gets a
real contract status as its slice lands.

| Doc | Governs | Code area it's the contract for | Status |
|---|---|---|---|
| [`numu-objects-schema.md`](numu-objects-schema.md) | The reconciled numu (17) + redpash (12) object catalog — every type, field, metadata — grouped by a forward context taxonomy + the naming-reconciliation matrix | `migrations/`·`seed/` (numu) + the redpash app catalog being reused | planning |
| [`numu-gluesql-postgres.md`](numu-gluesql-postgres.md) | The data plane numu inherits: GlueSQL (browser, ephemeral, per-user) vs Postgres (registry/metadata) + the immutable blob + step-replay | redpash `data` crate + `pipeline.rs` (to port) | planning |
| [`numu-csv-flow-and-datatypes.md`](numu-csv-flow-and-datatypes.md) | CSV ingest (upload + connector) + the storage/semantic datatype catalog + sentinels + `ColumnMeta` | redpash `crates/{data,shared}` (to port) | planning |
| [`numu-rbac-membership-design.md`](numu-rbac-membership-design.md) | RBAC/membership **today** (the two planes, reach resolver, roles-as-data, SEV-0 guards) + the **operator/customer-data** access design (`operator_access`, `access_audit`, purpose-limit) | `crates/api/src/{rbac,caller,members,field_perms}.rs` (Part 1 LIVE) + proposed tables (Parts 2–4) | Part 1 LIVE · Parts 2–4 design |
| [`numu-legal-privacy-data-compliance.md`](numu-legal-privacy-data-compliance.md) | Legal/privacy/GDPR posture: controller/processor, the privacy-audit ratchet, data-subject rights, the Article control-map + roadmap (claude-for-legal) | redpash privacy machinery (`tools/privacy-audit`, `me.rs`, `crypto.rs`) to port + legal artifacts | planning |

## Ops — running numu's own database in production (infrastructure)

How numu's **own** backing Postgres is run with redundancy, automatic failover, PITR, and monitoring on GCP
(distinct from the Postgres *connector*, which is a data-source conduit). Design docs landed 2026-06-29 from a
review-approved HA deliverable; the configs/monitoring/scripts (`ops/postgres/`) + the `postgres-ha` skill are
the follow-on phase. Six review open-items are tracked in the landing Case.

| Doc | Governs | Code area it's the contract for | Status |
|---|---|---|---|
| [`ops/postgres-ha.md`](ops/postgres-ha.md) | HA + monitoring for numu's own DB: 1+2 Patroni/etcd/HAProxy topology, quorum-sync RPO/RTO, pgBackRest→GCS PITR, the numu-aware monitoring (reach-CTE/`upload_csv`/`events`) + `db-health`→`audit_runs` | `ops/postgres/` (configs + monitoring) — follow-on phase | design (landed) |
| [`ops/postgres-ha-runbook.md`](ops/postgres-ha-runbook.md) | operational procedures: switchover, unplanned failover, replica rebuild/re-seed, PITR, backups, disk-fill, etcd-quorum-loss, drills | `ops/postgres/` + the runbook | design (landed) |

## Not-yet-written (planned slices, each its own Case)

These appear in [`README.md`](../README.md)'s layout and the [catalog case](cases/0001-object-catalog.md)'s
follow-on list. They get a DOCMAP row the moment they land:

| Artifact | Will be the contract/impl for | Doc home |
|---|---|---|
| `migrations/` | the SYSTEM tables (`OBJECTS.md` G1–G6 `[SYSTEM]`) | `OBJECTS.md` |
| `seed/` | builtin `type_definitions` + `type_fields` rows + the `default` workflow | `OBJECTS.md` |
| `tools/` + `ci.sh` | the gate audits (the 5-gate spine + `rbac-audit` + the 6 assessment gates, CASE 0014) + the per-audit baseline ratchet | [`../tools/README.md`](../tools/README.md) |
| `.claude/agents/` | the 5-role orchestrator (architect→tester→coder→reviewer→ops), project-agnostic | `OBJECTS.md` G5 |
| `CLAUDE.md` | the baked-in conventions (the gates as standing rules) | itself |
| `docs/decisions/`, `docs/runbooks/` | locked decisions + fixed-bug records | per the redpash cadence |

## The five gates (the enforcement spine, mapped)

numu's identity is that its disciplines are **queries, not prompts** — harness-agnostic, git/DB-enforced:

| Gate | Enforces | Where it's specified |
|---|---|---|
| **case-first** | non-trivial work opens a Case before it's coded | `CLAUDE.md` (planned) · `cases/` fallback |
| **docs-currency** | no Case reaches `done` until its docs are reconciled | `OBJECTS.md` G4 (`close_checks: ["docs_reconciled"]`) |
| **capability-ledger** | no capability lives only in memory (anti-amnesia) | `OBJECTS.md` G6 (`capability` `[TYPE]`) |
| **agent-refs** | every orchestrator reference resolves to a real artifact | `tools/` (planned) |
| **debuggability** | no bare 500, no dropped request-id | [`OBSERVABILITY.md`](OBSERVABILITY.md) §6 |

Beyond the spine, `ci.sh` auto-discovers **domain audits** — `rbac-audit` (CASE 0005) and the six
**assessment gates** (CASE 0014: `mask-unenforced` · `config-safety` · `ssrf-parity` · `upload-limit` ·
`caller-dev` · `stale-staging`), which ride a per-audit baseline ratchet. See [`../tools/README.md`](../tools/README.md).

## Rules for this map

- **Every doc has exactly one DOCMAP row.** A new doc without a row (or a row whose links don't resolve) is
  a finding — `tools/doc-coverage-audit` (a planned gate) fails CI on it, the same way redpash's does.
- **Code wins on disagreement.** Once a slice has code, the code is truth; a change that alters a documented
  surface reconciles its doc *in the same change* (docs-currency). A design-contract doc is authoritative
  only until its code lands.
- **Changing a "locked decision" doc** (`OBJECTS.md`/`HTTP.md`/`OBSERVABILITY.md` headers say so) **is an
  Em-level decision** — note it in the [catalog case](cases/0001-object-catalog.md) or its own Case.
