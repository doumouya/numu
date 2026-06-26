# numu

**A self-contained, project-agnostic build-engine.** Pull numu into a fresh folder and you have
everything needed to start a new coding project *through* it — work tracking, multi-agent
coordination, an audit/enforcement spine, and a self-documenting knowledge layer — with **no need to
consult any other repo's docs**. numu is "database-as-a-framework": your project's objects are *data*
in a registry, not migrations you hand-write.

> **Status: design phase, non-UI first.** This repo currently holds the *design contract*. The first
> concrete artifact is the **object catalog** → [`docs/OBJECTS.md`](docs/OBJECTS.md). Code
> (migrations, seed, tools, agent roles) lands in follow-on slices.

## The one idea: two layers

- **SYSTEM tables** — the engine's fixed machinery (the registry spine, the access edge, audit,
  workflows, the orchestrator ledger). Created by migrations; identical in every project.
- **REGISTERED TYPES** — objects-as-data. A type is **a row in `type_definitions` + rows in
  `type_fields` + storage in `entity_data`** — *not* a migration.

So starting a customer project = registering its domain objects (`invoice`, `patient`, `listing`, …)
**the same way numu's own built-in types were registered: a type row + field rows, zero migrations.**
numu ships the *build-coordination* types seeded; your project stacks its *domain* types on top, and
RBAC, audit, the close-gate, and the agent chain all apply to them for free.

## What numu bakes in

| Capability | Shape |
|---|---|
| **Work tracking** | Cases with **workflow-as-data** (a workflow is a row, illegal transition → 422) |
| **Agent coordination** | the Case = the handoff bus; a 5-role orchestrator (architect→tester→coder→reviewer→ops) with a **circuit breaker that is a DB query**, not agent discipline |
| **Enforcement gates** | case-first · docs-currency (no `done` until docs reconciled) · capability-ledger (anti-amnesia) · agent-refs (orchestrator-reference audit) — all harness-agnostic, ratcheted in `ci.sh` |
| **Audit everything** | every meaningful action is an `events` row; audit runs/findings are queryable + diffable |
| **Self-documenting** | specs, acceptance criteria, runbooks, decisions (ADRs), and the capability ledger are **first-class registered objects** — queryable knowledge, not buried in commit messages |
| **Security by construction** | the `scope_parent_id` FK as an IDOR backstop; ownership is a membership edge ("no object without an owner"); leak-free 404 |

## Layout (planned)

```
numu/
├── README.md              ← this file
├── docs/
│   ├── OBJECTS.md         ← the object catalog (the enrichment surface) — START HERE
│   └── cases/             ← on-disk Case stubs (coordination fallback when no Cases backend)
├── migrations/            ← (next slice) the SYSTEM tables
├── seed/                  ← (next slice) builtin type_definitions + type_fields rows
├── tools/                 ← (next slice) ci.sh + the 4 gate audits + the ratchet
├── .agents/               ← (next slice) the 5 role definitions (project-agnostic)
└── CLAUDE.md              ← (next slice) the baked-in conventions
```

## Relationship to siblings

numu is the **full-fledged reusable** build-engine. Its leaner sibling is the *portfolio* build-engine
(stripped to the minimum to ship demo apps); numu is the superset you reach for to **start a real
customer project**. The two share the same registry-model DNA; numu adds the richer object model
(the G6 build-knowledge types), the deferred connector/secret/skill design, and a generalized
comment/attachment that hang off any object.

## Contributing

The immediate work is **enriching the object fields** in [`docs/OBJECTS.md`](docs/OBJECTS.md) — edit a
field table directly, add a field, or answer one of the open enrichment questions at the bottom.
Coordination for this lives in [`docs/cases/0001-object-catalog.md`](docs/cases/0001-object-catalog.md).
