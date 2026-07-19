# Kernel · birama-engine — the engine architecture numu's backend continues

**Repo:** `github.com/doumouya/birama-engine` (private; sibling checkout at `~/birama-engine`).
**Its own docs:** `docs/DOCMAP.md → ARCHITECTURE / GETTING-STARTED / ENGINE / MCP` + the contract set
(`HTTP / RBAC / OBJECTS / OBSERVABILITY / AUTH`) in that repo. This page documents the **lineage and
the boundary** — what the engine architecture provides, how numu's `crates/api` relates to it, and
the rules for working across the two.

## Purpose (what the engine architecture provides)

A **headless, project-agnostic "database-as-a-framework" build engine** — the architecture both
repos share:

- **Objects as data** — a type is a `type_definitions` row + `type_fields` rows + `entity_data`
  storage; every registered type inherits the full HTTP verb set from ONE generic handler, zero
  per-type code.
- **Two-plane RBAC** — Plane A: *reach* (memberships × scope ancestors, roles-as-data rank ladder)
  with **leak-free 404** denials; Plane B: *field permissions* (perm-class floors) with 403 after
  existence. Creator gets an owner edge — no object without an owner. `context_role` is cosmetic.
- **Workflow-as-data** — states + close-checks are rows; an illegal transition is a `422
  illegal_transition`; nothing reaches `done` past an unmet close-gate.
- **The events spine** — every mutation writes an `events` row (actor, kind, payload, request-id).
- **Optimistic concurrency** — `ETag: W/"<version>"`; PUT/PATCH/DELETE demand `If-Match`
  (428 missing / 412 stale).
- **OPTIONS self-describe** — allowed verbs + per-field read/write verdict for *this caller*.

## Implementation (lineage: shared vs diverged)

**Lineage.** birama-engine was **extracted from numu @31532d9 (pre-frontend)** into a pure 3-crate
workspace — `engine` (wasm-clean decision core) · `api` (Axum edge) · `mcp` (a JSON-RPC tool surface,
13 tools, so AI agents drive builds through it). numu's `crates/api` **continues the same
architecture** in place; they are siblings from one design, not a dependency edge — numu does NOT
link birama crates. *(This is the **v1** posture. The **numu v2** design reverses it: a greenfield
workspace links `engine` + `birama-core` as pinned cargo deps and decorates them wrapper-only — see
[`NUMU-V2.md`](NUMU-V2.md), an Em-level decision in CAS_9f8ee4d490b446fb83e9895e1bab18cc.)*

| | birama-engine | numu `crates/api` |
|---|---|---|
| shape | 3 crates (engine/api/mcp), engine is wasm-clean | one api crate (edge + service together) |
| shares | registry · two-plane RBAC · workflow-as-data · events · ETag/If-Match · OPTIONS · problem+json · the gate/audit discipline | same, continued |
| adds | the **MCP tool surface** (agents-as-clients) · scrub/purity gates (provenance-neutral, no numu/redpash tokens) | the **product surfaces**: the domain catalog (CATALOG.md types) · nacl (phase B `/api/nacl`) · the CSV data plane · conversations/feed · the console seam (`docs/frontend/SEAM.md`) · OAuth/social auth · the orchestrator ledger |
| DB test feature | **`pg-tests`** | **`db-tests`** |

**The console angle:** phase A's in-browser engine sim (`web/sim/`) is a faithful JS restatement of
THIS architecture — which is why `docs/frontend/SEAM.md` can serve as the phase-B contract for
numu's Rust api without inventing semantics.

## Maintenance

- birama-engine has its own `tools/ci.sh` (scrub / wasm-purity / no-db-features gates) — run it there
  after any change; **NEVER `cargo test --features db-tests` in that repo** (its feature is
  `pg-tests`; the db-tests name OOMs nothing there but reintroducing it breaks its gate — and in
  EITHER repo never run the DB suite un-gated on this box).
- An architecture-level fix (RBAC semantics, workflow guard, events shape) discovered in one repo
  should be **assessed for the sibling** — same DNA, drift compounds. Note it in the Case.
- Keep birama provenance-neutral: its scrub gate forbids numu/redpash tokens in all text files —
  don't paste numu-specific prose into it.

## How to extend

- **A new engine-level capability** (new verb semantics, new plane, new guard): design it once,
  land it in numu (where the product pressure is), then decide whether birama absorbs it — record
  the decision in both repos' Cases.
- **A new agent tool**: that's birama's `mcp` crate (its MCP.md); numu's agent bus is the Cases
  engine itself.
- **A new registered type**: neither repo needs code — the `type-registry` skill; a type row + field
  rows (numu: `docs/api/OBJECTS.md`; birama: its OBJECTS.md).
