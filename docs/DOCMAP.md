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
5. [`OBSERVABILITY.md`](OBSERVABILITY.md) — debuggable-by-construction: request-id spine, problem+json, the 5th gate.
6. [`cases/0001-object-catalog.md`](cases/0001-object-catalog.md) — the live coordination thread for the catalog work.

## The map — doc ⇄ code-area

Each contract doc is the spec for a code slice that lands later (numu is design-phase, non-UI first). When
that slice exists, **code becomes the source of truth and the doc reconciles in the same change** (the
docs-currency gate); until then, the doc *is* the contract.

| Doc | Governs | Code area it's the contract for | Status |
|---|---|---|---|
| [`README.md`](../README.md) | The pitch + the two-layer model (SYSTEM tables vs REGISTERED TYPES) | whole repo (orientation) | living |
| [`DOCMAP.md`](DOCMAP.md) | The doc index + read order (this file) | `docs/` | living |
| [`OBJECTS.md`](OBJECTS.md) | The data model: the registry spine, every builtin `[TYPE]`/`[SYSTEM]` table, the prefix registry, the seeded `default` workflow, the `relation` edge, omnisearch | `migrations/` (SYSTEM tables) · `seed/` (builtin `type_definitions` + `type_fields` rows) | design contract |
| [`HTTP.md`](HTTP.md) | The uniform verb surface over the registry: `/api/objects/:type`, the verb→status matrix, OPTIONS self-description, `If-Match` concurrency, two-stage leak-free RBAC, `method_policy` | `api/` (one generic Axum handler set over the registry) | design contract |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Debuggability (P-DEBUG): the request-id/trace-id spine, structured spans, problem+json envelope, `/healthz`·`/readyz`, the debug-echo | `api/` middleware (`request_id_layer` + `TraceLayer`) · `tools/debuggability-audit` (the 5th gate) | design contract |
| [`.claude/skills/http/`](../.claude/skills/http/SKILL.md) | **Generic** RFC-9110 HTTP technique (method/status/header/conditional-request semantics) — what `HTTP.md` *applies* | consumed by `api/` + connectors; reusable across projects | **shipped** (committed) |
| [`cases/`](cases/) | On-disk Case stubs — the case-first fallback when no Cases backend is reachable | the coordination surface | living |

## Not-yet-written (planned slices, each its own Case)

These appear in [`README.md`](../README.md)'s layout and the [catalog case](cases/0001-object-catalog.md)'s
follow-on list. They get a DOCMAP row the moment they land:

| Artifact | Will be the contract/impl for | Doc home |
|---|---|---|
| `migrations/` | the SYSTEM tables (`OBJECTS.md` G1–G6 `[SYSTEM]`) | `OBJECTS.md` |
| `seed/` | builtin `type_definitions` + `type_fields` rows + the `default` workflow | `OBJECTS.md` |
| `tools/` + `ci.sh` | the five gate audits + the ratchet | (a `tools/` README, next slice) |
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

## Rules for this map

- **Every doc has exactly one DOCMAP row.** A new doc without a row (or a row whose links don't resolve) is
  a finding — `tools/doc-coverage-audit` (a planned gate) fails CI on it, the same way redpash's does.
- **Code wins on disagreement.** Once a slice has code, the code is truth; a change that alters a documented
  surface reconciles its doc *in the same change* (docs-currency). A design-contract doc is authoritative
  only until its code lands.
- **Changing a "locked decision" doc** (`OBJECTS.md`/`HTTP.md`/`OBSERVABILITY.md` headers say so) **is an
  Em-level decision** — note it in the [catalog case](cases/0001-object-catalog.md) or its own Case.
