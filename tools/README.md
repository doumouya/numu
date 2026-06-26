# tools/ — the numu immune system

`sh tools/ci.sh` is the gate; run it before every commit. It runs, in order: **fmt** (`cargo fmt --check`)
· **clippy** (`cargo clippy --all-targets -- -D warnings`) · **test** (`cargo test`) · the **audit
ratchet** — every `tools/*-audit/audit.sh` must exit 0. Adding a gate = appending a `gate` line in
`ci.sh` (and, for an auditor, a `tools/<name>-audit/`); `ci.sh` auto-discovers the audits.

## The five gates (numu's enforcement spine)

| Gate | Status | What it checks |
|---|---|---|
| **debuggability** | **live** (`debuggability-audit/`) | the P-DEBUG rules of [`../docs/OBSERVABILITY.md`](../docs/OBSERVABILITY.md) §6 — no bare 500 / unwrap on handler paths, one problem+json responder, request-id wired, every mutation emits an event, OPTIONS/HEAD/healthz/readyz wired, no secrets in logs |
| **case-first** | follow-on | a branch commit references a Case |
| **docs-currency** | follow-on | a commit that alters a documented surface reconciles its doc (or `Docs: n/a`) |
| **capability-ledger** | follow-on | no capability dropped/undocumented (the anti-amnesia ledger) |
| **agent-refs** | follow-on | the orchestrator's role/gate references resolve |

The four follow-on gates land as their substrate arrives (a Cases backend, the capability `[TYPE]`, the
agent chain). Each is a `tools/<name>-audit/audit.sh` that `ci.sh` picks up automatically — no `ci.sh` edit
beyond existing.

## Ratchet (follow-on)

The audits currently fail on **any** finding (the tree starts clean). When a real codebase accumulates
known/triaged findings, each audit will diff against a committed `baseline.json` and fail only on **new**
violations — the same ratchet pattern proven in the sibling build-engine. v0 keeps it simple: zero
findings = green.

## Conventions

- Audits are **read-only** static analyzers (grep/awk over source in v0; a `syn`-based Rust analyzer is a
  follow-on). They never mutate the repo.
- An audit exits `0` (clean) or `1` (+ a `FINDING [rule] message` list). `ci.sh` aggregates.
