# numu

**A self-contained, project-agnostic build-engine.** Pull numu into a fresh folder and you have
everything needed to start a new coding project *through* it — work tracking, multi-agent
coordination, an audit/enforcement spine, and a self-documenting knowledge layer — with **no need to
consult any other repo's docs**. numu is "database-as-a-framework": your project's objects are *data*
in a registry, not migrations you hand-write.

> **Status: design phase, non-UI first.** This repo holds the *design contract* — the object catalog
> ([`docs/OBJECTS.md`](docs/OBJECTS.md)), the HTTP surface ([`docs/HTTP.md`](docs/HTTP.md)), and the
> debuggability spine ([`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md)) — plus the first runnable
> artifact, the reusable [`http` skill](.claude/skills/http/SKILL.md). Backend code (migrations, seed,
> tools, agent roles) lands in follow-on slices.
>
> **Lost?** [`docs/DOCMAP.md`](docs/DOCMAP.md) is the map — every doc, what it governs, the code area
> it's the contract for, and the order to read them in.

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
| **Enforcement gates** | case-first · docs-currency (no `done` until docs reconciled) · capability-ledger (anti-amnesia) · agent-refs (orchestrator-reference audit) · debuggability (no bare 500 / dropped request-id) — all harness-agnostic, ratcheted in `ci.sh` |
| **Audit everything** | every meaningful action is an `events` row; audit runs/findings are queryable + diffable |
| **Self-documenting** | specs, acceptance criteria, runbooks, decisions (ADRs), and the capability ledger are **first-class registered objects** — queryable knowledge, not buried in commit messages |
| **Security by construction** | the `scope_parent_id` FK as an IDOR backstop; ownership is a membership edge ("no object without an owner"); leak-free 404 |
| **Uniform HTTP surface** | every object inherits the full safe verb set (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS) from the registry — **OPTIONS self-describes** (fields + your RBAC verdict); one generic handler, zero per-type code ([`docs/HTTP.md`](docs/HTTP.md)) |
| **Debuggable by construction** | a request-id from edge → log → `events` → error body; problem+json everywhere; `OPTIONS`/`HEAD`/`/healthz`/`/readyz`; a CI gate that fails a bare 500 ([`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md)) |

## Layout

```
numu/
├── README.md              ← this file
├── docs/
│   ├── DOCMAP.md          ← the map: docs ⇄ code-area + read order (scan first)
│   ├── OBJECTS.md         ← the object catalog (the enrichment surface) — START HERE
│   ├── HTTP.md            ← the uniform HTTP verb surface over the registry (locked decision)
│   ├── OBSERVABILITY.md   ← debuggable-by-construction: request-id, problem+json, the 5th CI gate
│   └── cases/             ← on-disk Case stubs (coordination fallback when no Cases backend)
├── .claude/
│   ├── skills/http/       ← the reusable RFC-9110 HTTP skill (SKILL.md + references/ + scripts/)
│   └── agents/            ← (next slice) the 5 role definitions (project-agnostic)
├── crates/api/            ← LIVE — the HTTP edge (Rust): the generic object handler + middleware
├── migrations/            ← LIVE — the SYSTEM tables + builtin-type seed (0001_init, 0002_seed)
├── tools/                 ← LIVE — ci.sh (the gate) + debuggability-audit; 4 more gates follow-on
└── CLAUDE.md              ← (next slice) the baked-in conventions
```

## Relationship to siblings

numu is the **full-fledged reusable** build-engine. Its leaner sibling is the *portfolio* build-engine
(stripped to the minimum to ship demo apps); numu is the superset you reach for to **start a real
customer project**. The two share the same registry-model DNA; numu adds the richer object model
(the G6 build-knowledge types), the deferred connector/secret/skill design, a generalized
comment/attachment that hang off any object, and a **uniform HTTP surface + a reusable `http` skill**
with debuggability baked in.

## Contributing

The immediate work is **enriching the object fields** in [`docs/OBJECTS.md`](docs/OBJECTS.md) — edit a
field table directly, add a field, or answer one of the open enrichment questions at the bottom.
Coordination for this lives in [`docs/cases/0001-object-catalog.md`](docs/cases/0001-object-catalog.md).
