# numu

**A chat-driven, on-device data workspace on a "database-as-a-framework" engine.** You talk to your
org's objects in a conversation thread using a command language called **nacl**; data (CSVs, records,
media, dashboards) materializes as blocks in the feed and opens in a right-hand context panel.
Multi-tenant, RBAC-scoped, audit-everything. Your project's objects are *data* in a registry, not
migrations you hand-write.

> **Status: backend LIVE (15 migrations — RBAC · auth/OAuth · the cases engine · type-admin ·
> orchestrator · debug/config/rate-limit) + the web console phase A LIVE on the in-browser engine
> sim (`web/`, branch work). Phase B binds the console to this backend — the contract is
> [`docs/frontend/SEAM.md`](docs/frontend/SEAM.md).**
>
> **New here?** [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md) takes you zero → a running
> console + api (every step executed before it was written). **Lost?**
> [`docs/DOCMAP.md`](docs/DOCMAP.md) is the map — every doc, what it governs, the code area it's the
> contract for, and the order to read them in. The baked working rules live in [`CLAUDE.md`](CLAUDE.md).

## The layers (read order = build order)

numu stands on two **kernel** repos and adds three layers of its own:

| layer | what | where |
|---|---|---|
| **0 · kernel** | [amenan-ui](https://github.com/doumouya/amenan-ui) — the zero-dependency TS UI framework + theme platform. [birama-engine](https://github.com/doumouya/birama-engine) — the agnostic build/workflow engine numu's backend architecture continues. | [`docs/kernel/`](docs/kernel/) |
| **0.5 · substrate** | the one Postgres under everything: HA, backups/PITR, DB-level observability (forward-looking; current = single-node dev) | [`docs/ops/DATABASE.md`](docs/ops/DATABASE.md) |
| **1 · api** | the generic object service: registry, two-plane RBAC, workflow-as-data, events, the uniform HTTP verb surface | [`docs/api/`](docs/api/) · `crates/api/` |
| **2 · console** | the product surface on amenan-ui: Object Rail · feed · nacl composer · context viewers · Store · Settings · the operator-only **Impersonation Rail** | [`docs/frontend/`](docs/frontend/) · `web/` |
| **3 · nacl** | the command language (`action:target.attribute=value`) | [`docs/nacl/`](docs/nacl/) |

## The one idea: two layers of data

- **SYSTEM tables** — the engine's fixed machinery (the registry spine, the access edge, audit,
  workflows, the orchestrator ledger). Created by migrations; identical in every project.
- **REGISTERED TYPES** — objects-as-data. A type is **a row in `type_definitions` + rows in
  `type_fields` + storage in `entity_data`** — *not* a migration.

Starting a customer project = registering its domain objects (`invoice`, `patient`, `booking`, …)
the same way numu's built-ins were registered: a type row + field rows, zero migrations — and RBAC,
audit, the close-gate, and the agent chain apply to them for free.

## What numu bakes in

| Capability | Shape |
|---|---|
| **Work tracking** | Cases with **workflow-as-data** (a workflow is a row; illegal transition → 422; no `done` until the close-checks pass) |
| **Agent coordination** | the Case = the handoff bus; a 5-role orchestrator with a **circuit breaker that is a DB query** |
| **Enforcement gates** | a 13-gate `tools/ci.sh` (fmt/clippy/test/db · web-build/web-test · case-first · docs-currency · debuggability · rbac · css-drift · sim-verbatim · stale-staging) — disciplines are queries, not prompts ([`tools/README.md`](tools/README.md)) |
| **Audit everything** | every meaningful action is an `events` row; queryable + diffable |
| **Security by construction** | two-plane RBAC (reach → leak-free 404; fields → 403), the `scope_parent_id` IDOR backstop, "no object without an owner", explicit + logged operator impersonation ([`docs/frontend/IMPERSONATION.md`](docs/frontend/IMPERSONATION.md)) |
| **Uniform HTTP surface** | every registered object inherits the full verb set; **OPTIONS self-describes** (fields + your RBAC verdict); one generic handler, zero per-type code ([`docs/api/HTTP.md`](docs/api/HTTP.md)) |
| **Debuggable by construction** | request-id from edge → log → `events` → error body; problem+json everywhere; a CI gate that fails a bare 500 ([`docs/api/OBSERVABILITY.md`](docs/api/OBSERVABILITY.md)) |
| **On-device data plane** | the console runs a faithful engine sim in the browser (registry + CSV pipeline + nacl); `?http=1` flips the same page to a server with zero code change ([`docs/frontend/SEAM.md`](docs/frontend/SEAM.md)) |

## Layout

```
numu/
├── README.md               ← this file
├── CLAUDE.md               ← the baked conventions (case-first · docs-currency · the gates)
├── docs/
│   ├── DOCMAP.md           ← the map (scan first)
│   ├── kernel/             ← LAYER 0 · amenan-ui + birama-engine: what numu stands on
│   ├── ops/                ← LAYER 0.5 · the Postgres substrate (HA/backup/DB-observability)
│   ├── api/                ← LAYER 1 · the backend contracts (OBJECTS · HTTP · RBAC · AUTH ·
│   │                          OBSERVABILITY · CONTRACT · RUNNING)
│   ├── frontend/           ← LAYER 2 · the console (CONSOLE · SEAM · THEME · DESIGN-SYNC ·
│   │                          IMPERSONATION)
│   ├── nacl/               ← LAYER 3 · the command language
│   ├── foundation/         ← forward-looking planning (object model · data plane · operator
│   │                          access · legal/privacy)
│   └── cases/              ← the on-disk Case ledger (0001…)
├── crates/api/             ← LIVE · the Rust backend (generic objects · RBAC · auth · cases ·
│                              type-admin · orchestrator · observability middleware)
├── migrations/             ← LIVE · the SYSTEM tables + builtin seeds (0001…0015)
├── web/                    ← LIVE (phase A) · the console on amenan-ui over the NumuClient seam
│   ├── src/ · styles/      ← the vanilla-TS app (one .nu-* namespace)
│   ├── sim/ · data/        ← the design-project engine sim + doctrine, VERBATIM (design-synced)
│   └── assets/ · vendor/   ← brand logos · echarts + bootstrap-icons
├── tools/                  ← ci.sh (the 13-gate immune system) + the audit gates + web tooling
└── .claude/skills/         ← the how-tos: http · type-registry · rbac · api-conventions ·
                               enforcement-gates
```

## Relationship to the kernel siblings

- **amenan-ui** is where numu's LOOK lives: the `numu` + `numu-blue` themes (including the numu-family
  structural retune) are theme files IN that repo; the console consumes the framework by source alias.
  Boundary rules + maintenance: [`docs/kernel/AMENAN-UI.md`](docs/kernel/AMENAN-UI.md).
- **birama-engine** is the agnostic build/workflow engine extracted from numu pre-frontend; numu's
  `crates/api` continues the same architecture (registry · two-plane RBAC · workflow-as-data · events)
  and adds the product surfaces (nacl, the data plane, the console seam). Lineage + shared-vs-diverged:
  [`docs/kernel/BIRAMA-ENGINE.md`](docs/kernel/BIRAMA-ENGINE.md).

## Contributing

Start at [`docs/DOCMAP.md`](docs/DOCMAP.md); the working rules are [`CLAUDE.md`](CLAUDE.md). Register a
type via the `type-registry` skill, gate access via `rbac`, author a gate via `enforcement-gates`.
`bash tools/ci.sh` must be green before every commit.
