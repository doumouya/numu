# CLAUDE.md — numu conventions (baked, enforced)

> The standing rules for working in numu. Most are a **CI query** (`tools/ci.sh`), not a prompt — a
> discipline that can be a query *is* a query, so it rides along on any project numu is pulled into. If a
> rule here and the code disagree, **code wins** and you reconcile the doc in the same change
> (docs-currency). Referenced by [`README.md`](README.md) and [`docs/DOCMAP.md`](docs/DOCMAP.md).

## The one model (why the rules are shaped this way)

Two layers: **SYSTEM tables** (fixed engine machinery, in `migrations/`) + **REGISTERED TYPES**
(objects-as-data — a `type_definitions` row + `type_fields` rows + `entity_data` storage, **never a
migration**). Starting a project = registering its domain types the same way numu's builtin types were
registered; RBAC, audit, the close-gate, and the agent chain apply to them for free.

## Working rules

1. **Case-first.** Non-trivial work (touches `crates/` or `migrations/`) opens a Case *before* it's coded
   and logs plan → decisions → outcome. Reference it in the commit (`CASE NNNN` / `CAS_<hex>`) or touch a
   `docs/cases/` file. Trivial / one-line / docs-only / read-only is exempt. *Gate: case-first.*
2. **Docs before (or with) code.** A commit changing `crates/` or `migrations/` also touches `docs/`, or
   declares `Docs: n/a — <reason>` in the message. A design-contract doc is authoritative until its code
   lands; then **code is truth** and the doc reconciles in the same change. *Gate: docs-currency (incl. web).*
3. **Per-named-file commits, docs first.** One logical change per commit; docs commits land before the
   code they document. Keep git history legible.
4. **Never push without Em's OK.** Commit on the branch freely; pushing is Em's call. No exceptions.
5. **Locked-decision docs** — `OBJECTS.md` · `HTTP.md` · `OBSERVABILITY.md` (and these conventions) —
   change only by an Em-level decision, noted in a Case.
6. **Green before commit.** `bash tools/ci.sh` passes. It's **bash** (`set -o pipefail`, `local`) — run it
   with bash, never a POSIX `sh`.

## The gate (`tools/ci.sh` — the immune system)

Runs in order, fails on any red. `ci.sh` **auto-discovers** every `tools/*-audit/audit.sh` — adding a gate
is adding a directory, no `ci.sh` edit. `NUMU_CI_STRICT=1` (real CI) turns any *skip* (missing toolchain,
absent `DATABASE_URL`, no sibling checkout) into a failure so a hole can't pass as green.

| Gate | Enforces |
|---|---|
| **fmt / clippy / test** | `cargo fmt --check` · `cargo clippy --locked --all-targets -- -D warnings` · `cargo test --locked` |
| **db** (conditional) | DB-backed smoke — `cargo test --features db-tests` — **only when `DATABASE_URL` is set** (see below) |
| **web-build / web-test** | typecheck + bundle (+ `tokens.css`) then the pure-module tests; needs node + the sibling amenan-ui checkout |
| **case-first** | HEAD touching `crates/`·`migrations/` references a Case |
| **docs-currency** | HEAD touching `crates/`·`migrations/` also touches `docs/` (or `Docs: n/a`) — web scope included |
| **debuggability** | P-DEBUG (`OBSERVABILITY.md` §6): no bare 500 / unwrap on a handler path, one problem+json responder, request-id wired, every mutation emits an event, OPTIONS/HEAD/healthz/readyz, no secrets in logs |
| **rbac** | Plane-A: every entity/membership handler gates via `require_action`, every create grants an owner edge, `context_role` stays cosmetic, an object-gate denial is a leak-free 404 |
| **css-drift** | numu ⇄ amenan-ui token/structure drift (the four queries) |
| **sim-verbatim** | design-sync'd `sim/`·`data/` files stay verbatim (no fork) |
| **stale-staging** | no placeholder / "until X" scaffolding prose or `Caller::dev()` call site in shipped code |

Follow-on gates land with their substrate: **capability-ledger** (anti-amnesia) · **agent-refs**
(orchestrator references resolve). Each is a `tools/<name>-audit/audit.sh`; `ci.sh` picks it up.

**Audit shape.** Read-only static analyzers (grep/awk over source in v0). Exit `0` (clean) or `1` (+ a
`FINDING [rule] message` list); never mutate the repo. Trailing `#[cfg(test)]` modules are excluded; a
deliberate line escapes with a trailing `// staging-ok`. The ratchet (diff vs a committed `baseline.json`)
is a follow-on — today, **zero findings = green**.

## DB-backed tests (the `db` gate)

numu's DB-backed integration tests are gated behind the crate feature **`db-tests`**
(`crates/api/Cargo.toml`; the `tests/*.rs` suite uses `#![cfg(feature = "db-tests")]`). The `db` gate runs
`cargo test --features db-tests` **only when `DATABASE_URL` is set**, so a bare clone stays green and a
plain `cargo test` never touches a database. Set `DATABASE_URL` + `NUMU_CI_STRICT=1` in real CI to make it
mandatory.

> **Kernel note.** The sibling **birama-engine** repo names its equivalent feature **`pg-tests`** — never
> cross the wires: numu is `db-tests`, birama-engine is `pg-tests`, and a birama-engine change must not
> reintroduce a `db-tests` name there.

## Production environment (required)

- **`NUMU_SECRET`** — the session / HMAC signing secret. In **release** builds the process must refuse to
  boot when it is unset or equals the dev literal; dev keeps a loud-warn fallback. Documented in
  [`docs/api/AUTH.md`](docs/api/AUTH.md) + [`docs/api/RUNNING.md`](docs/api/RUNNING.md); enforced by
  CASE 0013 §5b. Never log it (debuggability §6 rule 6).

## Pointers (link, don't duplicate)

- **Map of every doc** → [`docs/DOCMAP.md`](docs/DOCMAP.md). Object model → `docs/api/OBJECTS.md`. HTTP
  surface → `docs/api/HTTP.md`. Debuggability → `docs/api/OBSERVABILITY.md`. RBAC → `docs/api/RBAC.md`.
  Auth → `docs/api/AUTH.md`. **DB substrate** → `docs/ops/DATABASE.md`. (Paths reflect the layered tree;
  pre-restructure they live at `docs/` root.)
- **How-to** lives in `.claude/skills/*` — `http` · `type-registry` · `rbac` · `api-conventions` ·
  `enforcement-gates`. Author a new gate via the enforcement-gates skill; register a type via
  type-registry. Don't restate them here.
