# CASE 0013 — staging truth + the NUMU_SECRET boot guard

**Origin:** the 2026-07-03 docs-verification fan-out + the two reviewer handoffs (plan review ·
ops/persistence). Theme: **shipped code must not carry staging-era claims, and a release must not
boot on a dev secret.**

## Landed

- **Stale staging prose fixed** across `crates/api`: the `caller.rs` / `members.rs` module headers
  (described the pre-A2 "always allows"/"Caller::dev until A2" world — the opposite of shipped),
  the `is_platform_admin` doc (it is load-bearing, not a staged seam), `error.rs::unavailable`
  (used by the log-level 503), the `oauth.rs` header (four live providers, Apple shipped), the
  `members.rs` cache note, and both DB-test file headers.
- **`Caller::dev()` REMOVED** — zero call sites in the workspace (handlers resolve `Caller` from
  the session extractor; tests build callers directly).
- **`NUMU_SECRET` boot guard** (`config.rs::validate_secret`, unit-tested): a **release** build
  refuses to boot when the secret is unset or equals the dev literal (the OAuth state cookie would
  be forgeable — ASSESSMENT S-1); dev keeps the fallback with a loud stderr warning. The literal is
  single-sourced (`config::DEV_SECRET`; `oauth.rs` consumes it). Documented in `api/AUTH.md` +
  `api/RUNNING.md` + `CLAUDE.md`.
- **New gate `tools/stale-staging-audit/`**: bans "always allows / until X lands / placeholder"
  prose and `Caller::dev()` call sites from production lines (test modules excluded;
  `// staging-ok` escape) — the drift class this Case fixes cannot recur silently.

## Deferred (recorded, not lost)

- **S-2** — no explicit upload body limit (rides axum's default): lands with the phase-B `/api/files`
  route (noted in `api/HTTP.md`).
- The `db-health` collector + `monitoring` schema (`ops/DATABASE.md`) — its own Case when the
  self-host slice starts.

## Landed

Crate work committed with this Case (staging-truth headers · `Caller::dev()` removal ·
`config::validate_secret` + unit tests · the stale-staging gate · the docs-path re-point);
verified by the full 13-gate ci run.
