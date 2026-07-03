# CASE 0004 — numu CI gate (tools/ci.sh + debuggability-audit)

- **Status:** done
- **Type:** task
- **Opened:** 2026-06-26
- **Owner:** Torv (for Em)
- **Case:** `CAS_9E9069EF022E4EC2B685B4B6E0E039BF`
- **Sibling:** `CAS_A6AF92` (backend foundation — [`0003`](0003-backend-foundation.md))

## Goal

Em asked "is `ci.sh` implemented?" — it wasn't. Build the gate (proactive tooling, not a proposal).

## Delivered

- **`tools/ci.sh`** — the gate, run before every commit: **fmt** (`cargo fmt --check`) · **clippy**
  (`cargo clippy --all-targets -- -D warnings`) · **test** (`cargo test`) · the **audit ratchet**
  (auto-discovers every `tools/*-audit/audit.sh`; each must exit 0). Aggregates results, exits non-zero on
  any red.
- **`tools/debuggability-audit/audit.sh`** — the **5th gate** (the first one wired), a read-only static
  analyzer over `crates/api/src` enforcing [`OBSERVABILITY.md`](../api/OBSERVABILITY.md) §6: no bare-panic on a
  handler path (unwrap/expect), one problem+json responder (no ad-hoc error JSON), `request_id_layer`
  wired, ≥1 event per mutation handler, OPTIONS/HEAD/`/healthz`/`/readyz` wired, no credential in a
  log/span. Excludes `#[cfg(test)]` modules (panics in tests are fine).
- **`tools/README.md`** — the immune-system doc: the five gates (debuggability live; case-first /
  docs-currency / capability-ledger / agent-refs follow-on as their substrate lands), the auto-discovery +
  ratchet conventions.

## Verification

- `bash tools/ci.sh` → **green**: fmt ✓, clippy ✓ (`-D warnings`), test 5/5 ✓, db (skipped — no `DATABASE_URL`) ✓, debuggability-audit clean ✓.
- Adversarial: confirmed the audit's test-exclusion is meaningful — `objects.rs` has 2 `unwrap()` in its
  test module, **0** in production code; the auditor would flag a real prod panic.

## Follow-on

The 4 other gates (case-first · docs-currency · capability-ledger · agent-refs) land as their substrate
arrives (a Cases backend, the capability `[TYPE]`, the agent chain) — each a `tools/<name>-audit/audit.sh`
that `ci.sh` auto-discovers. The per-audit `baseline.json` ratchet (fail only on NEW findings) is a
follow-on; v0 = zero findings is green.

## Log

- **2026-06-26 — Torv:** Built `tools/ci.sh` + `debuggability-audit` + `tools/README.md`; formatted the
  crate (`cargo fmt`) and confirmed clippy `-D warnings` clean so the gate is green from day one. Updated
  the README layout (crates/migrations/tools now LIVE). Committed on numu/main; held for Em's push.

- **2026-06-26 — Torv (ci.sh review → hardening):** Em reviewed `ci.sh`; applied the high-value findings:
  **S1a** a conditional `db` gate + a `db-tests` feature + `crates/api/tests/db_smoke.rs` (a `#[sqlx::test]`
  asserting migrations + seed apply and a query runs — closes the gap that CI never executed the schema;
  skips cleanly with no `DATABASE_URL`). **S2** made `debuggability-audit`'s test-exclusion sound (new R0
  flags any file with >1 `#[cfg(test)]`; `prod()` can no longer silently under-scan past a mid-file
  cfg(test)). **S3** docs now invoke `bash tools/ci.sh` (the script is bash; `/bin/sh`=dash aborted the old
  `sh` command on `set -o pipefail`). **S4** `--locked` on clippy/test/build. **S5** `NUMU_CI_STRICT=1`
  turns a skip into a failure. **S6** R2 now scans every module except `main.rs`. **S8** "audit gate"
  (the baseline ratchet is still a follow-on). Follow-on: S1b (CRUD/RBAC integration tests), S7
  (shellcheck self-gate), S9 (per-verb event check via the `syn` analyzer).
