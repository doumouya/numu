# tools/ — the numu immune system

`bash tools/ci.sh` is the gate; run it before every commit (the script is bash — `set -o pipefail` /
`local` — so don't invoke it with a POSIX `sh`). It runs, in order: **fmt** (`cargo fmt --check`) ·
**clippy** (`cargo clippy --locked --all-targets -- -D warnings`) · **test** (`cargo test --locked`) ·
**db** (conditional — a DB-backed smoke when `DATABASE_URL` is set, else skipped, keeping a fresh clone
green) · the **audit gate** — every `tools/*-audit/audit.sh` must exit 0. Adding a gate = appending a
`gate` line in `ci.sh` (and, for an auditor, a `tools/<name>-audit/`); `ci.sh` auto-discovers the audits.
`NUMU_CI_STRICT=1` turns any **skip** (missing fmt/clippy, or an absent `DATABASE_URL`) into a failure —
set it in real CI so a hole can't pass as green.

## The five gates (numu's enforcement spine)

| Gate | Status | What it checks |
|---|---|---|
| **debuggability** | **live** (`debuggability-audit/`) | the P-DEBUG rules of [`../docs/OBSERVABILITY.md`](../docs/OBSERVABILITY.md) §6 — no bare 500 / unwrap on handler paths, one problem+json responder, request-id wired, every mutation emits an event, OPTIONS/HEAD/healthz/readyz wired, no secrets in logs |
| **case-first** | **live** (`case-first-audit/`) | the HEAD commit, if it touches `crates/`/`migrations/`, references a Case (a `CASE NNNN`/`CAS_` mention or a `docs/cases/` file) |
| **docs-currency** | **live** (`docs-currency-audit/`) | a HEAD commit that changes `crates/`/`migrations/` also touches `docs/`, or declares `Docs: n/a` |
| **capability-ledger** | follow-on | no capability dropped/undocumented (the anti-amnesia ledger) |
| **agent-refs** | follow-on | the orchestrator's role/gate references resolve |

case-first + docs-currency went **live** with the Cases engine (CASE 0006); the remaining two
(capability-ledger · agent-refs) land as their substrate arrives (the capability `[TYPE]`, the agent
chain). Each is a `tools/<name>-audit/audit.sh` that `ci.sh` picks up automatically — no `ci.sh` edit.

**Domain audits (live).** Beyond the spine, `ci.sh` auto-discovers code-correctness audits under
`tools/*-audit/`: **debuggability-audit** (above) and **rbac-audit** (slice B2) — every entity handler
gates via `require_action`, every create grants an owner edge, `context_role` stays cosmetic, and an
object-gate denial is a leak-free 404 (not a 403). Both fail on any finding today (binary).

**Assessment gates (live, ratcheted).** Six more audits, added from the 2026-06 codebase assessment + its
review, each carrying a committed per-audit `baseline` of its known/triaged findings — **green today, red on
a NEW violation**:

| Gate | What it checks |
|---|---|
| **mask-unenforced** | the data-plane **seal**: a handler that writes entity rows must consult `masked_verbs` before it writes (the C1 seal-bypass — 4 handlers baselined pending the 405-on-masked Rust gate + an `entity_data` trigger backstop) |
| **config-safety** | no `*SECRET/KEY/TOKEN/PASS` env var falls back to a value, and the `dev-insecure-secret-change-me` literal isn't reachable (S-1 — pair with a boot-time guard + a `#[cfg(not(debug_assertions))]` test that `Config::from_env()` Errs when `NUMU_SECRET` is unset) |
| **ssrf-parity** | no `reqwest::` outside `http_client.rs` — generalizes the SSRF gate (clean ⇒ binary) |
| **upload-limit** | a `Multipart` surface declares an explicit `DefaultBodyLimit` (S-2) |
| **caller-dev** | `Caller::dev()` (admin) is `cfg`-gated and never called on a prod path (S-4) |
| **stale-staging** | staging/"v0" comments (`always allows` · `until A2` · `until auth lands`) don't outlive their slice (docs-drift) |

## Ratchet (per-audit baseline)

The spine + the older domain audits (debuggability · rbac · case-first · docs-currency) stay **binary** — the
tree is clean for them, so any finding is a real regression. The **assessment gates** ride a **per-audit
baseline**: each `tools/<name>-audit/baseline` lists that gate's known, triaged findings as line-number-free
fingerprints, and the audit diffs its current findings against it, failing only on a **NEW** one. Fix a
finding → the gate prints a `resolved — drop from baseline` note → shrink the baseline (it only ratchets
*down*, never up). This is the per-audit form of the `baseline.json` pattern proven in the sibling
build-engine; a unified JSON baseline can fold these in later.

## Conventions

- Audits are **read-only** static analyzers (grep/awk over source in v0; a `syn`-based Rust analyzer is a
  follow-on). They never mutate the repo.
- An audit exits `0` (clean) or `1` (+ a `FINDING [rule] message` list). `ci.sh` aggregates.
