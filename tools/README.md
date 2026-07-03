# tools/ — the numu immune system

`bash tools/ci.sh` is the gate; run it before every commit (the script is bash — `set -o pipefail` /
`local` — so don't invoke it with a POSIX `sh`). It runs, in order: **fmt** · **clippy** · **test** ·
**db** (conditional) · **web-build** + **web-test** (conditional) · then the **audit gate** — every
`tools/*-audit/audit.sh` must exit 0. `ci.sh` **auto-discovers** the audits: adding a gate is adding a
`tools/<name>-audit/` directory, no `ci.sh` edit. `NUMU_CI_STRICT=1` turns any **skip** (missing
toolchain, absent `DATABASE_URL`, no node / sibling amenan-ui checkout) into a failure — set it in real
CI so a hole can't pass as green.

## The live gates (13 when nothing skips)

| Gate | Kind | What it checks |
|---|---|---|
| **fmt / clippy / test** | cargo | `cargo fmt --check` · `cargo clippy --locked --all-targets -- -D warnings` · `cargo test --locked` |
| **db** | cargo (conditional) | the DB-backed smoke (`cargo test --features db-tests`) — only when `DATABASE_URL` is set, keeping a fresh clone green |
| **web-build** | web (conditional) | `tools/web-build.sh`: strict `tsc --noEmit` + the esbuild bundle + the `tokens.css` closure; needs node + the sibling amenan-ui |
| **web-test** | web (conditional) | `node --test web/tests/*.test.*` — the pure frontend modules (nacl autocomplete staging) |
| **case-first** | audit | the HEAD commit, if it touches `crates/`/`migrations/`, references a Case (`CASE NNNN`/`CAS_` or a `docs/cases/` file) |
| **css-drift** | audit | frontend CSS discipline (the four queries): tokens-only colors in `web/src`+`app.css` · app CSS owns only `.nu-*` (`.is-*` states ride a `.nu-*` owner) · every `var(--x)` resolves in the built token closure · every composed `.amu-*` class has its sheet in the build ([`../docs/frontend/THEME.md`](../docs/frontend/THEME.md)) |
| **debuggability** | audit | the P-DEBUG rules of [`../docs/api/OBSERVABILITY.md`](../docs/api/OBSERVABILITY.md) §6 — no bare 500 / unwrap on handler paths, one problem+json responder, request-id wired, every mutation emits an event, OPTIONS/HEAD/healthz/readyz wired, no secrets in logs |
| **docs-currency** | audit | a HEAD commit changing a documented surface — `crates/`, `migrations/`, **or the frontend's authored code** (`web/src`, `web/styles`, `web/index.html`, the web tools) — also touches `docs/`, or declares `Docs: n/a` (design-synced `web/sim`+`web/data` artifacts are exempt) |
| **rbac** | audit | Plane-A invariants: every entity/membership handler gates via `require_action`/`require_rank`, every create grants an owner edge, `context_role` stays cosmetic, an object-gate denial is a leak-free 404 ([`../docs/api/RBAC.md`](../docs/api/RBAC.md)) |
| **sim-verbatim** | audit | every design-synced file (`web/sim/*`, doctrine, demo data, logos) hash-matches `web/.sync-manifest` — a local fork of the design project fails CI with the re-sync instruction ([`../docs/frontend/DESIGN-SYNC.md`](../docs/frontend/DESIGN-SYNC.md)) |
| **stale-staging** | audit | no placeholder / "until X lands" scaffolding prose and no `Caller::dev()` call site in shipped (non-test) code — the header-drift class caught 2026-07-03 can't recur; escape a deliberate line with `// staging-ok` |

## Follow-on gates (land with their substrate)

| Gate | Arrives with |
|---|---|
| **capability-ledger** | the capability `[TYPE]` (anti-amnesia: no capability lives only in memory) |
| **agent-refs** | the agent chain (every orchestrator role/gate reference resolves) |

## Web tooling (not gates — the build the gates check)

- `web-build.sh` — vendor copy · `tokens.css` cat (amenan base → numu overlay → the numu themes →
  skins → the component sheets in use) · typecheck · bundle · cache-bust.
- `web-dev-server.mjs` — static `web/` + the `/api` proxy (phase A: the sim node server; phase B: the
  Rust api).
- `design-sync.sh` — pulls the verbatim sim/doctrine/data/logos from the numu Design System dump and
  pins sha256 hashes into `web/.sync-manifest` (what sim-verbatim enforces).

## Ratchet (follow-on)

The audits currently fail on **any** finding (the tree starts clean). When a real codebase accumulates
known/triaged findings, each audit will diff against a committed `baseline.json` and fail only on **new**
violations. v0 keeps it simple: zero findings = green.

## Conventions

- Audits are **read-only** static analyzers (grep/awk over source in v0; a `syn`-based Rust analyzer is
  a follow-on). They never mutate the repo.
- An audit exits `0` (clean) or `1` (+ a `FINDING [rule] message` list). `ci.sh` aggregates.
- Trailing `#[cfg(test)]` modules are excluded from prod-line audits; a deliberate exception carries a
  trailing `// staging-ok`.
