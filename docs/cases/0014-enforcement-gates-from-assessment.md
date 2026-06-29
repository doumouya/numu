# CASE 0014 — assessment findings → enforcement gates

- **Status:** in_review
- **Type:** task
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **Branch:** `feat/numu-frontend-integration`
- **Trigger:** a 2026-06 external codebase assessment + a deep PR review of the data-app plane surfaced a set
  of findings (a CRITICAL seal-bypass, a hardcoded HMAC secret, an unbounded upload, docs drift, …). Rather
  than fix-and-forget, turn each grep-able finding into a **ratcheted gate** — numu's identity that
  *disciplines are queries, not prompts*. ("yes audit and improve for integration to ci.sh.")

## Goal

Add `tools/*-audit/audit.sh` gates that `ci.sh` auto-discovers (no `ci.sh` edit), so a **new** handler/commit
can't silently reintroduce a triaged finding. Correct the two broken greps in the original suggestion, add
the gate it omitted (the C1 seal-bypass — the most important one), and implement the **per-audit baseline
ratchet** the `tools/README.md` had marked a follow-on so the gates are green today and red only on a
regression. Gates **detect/prevent**; the actual fixes are deferred (below).

## Delivered (six gates, each green + self-tested)

- **`mask-unenforced-audit`** — the data-plane **seal** (C1). An `async fn` in `objects.rs` that writes entity
  rows (`insert/update/delete` on `entity_data`/`entities`) must consult `masked_verbs` before it writes.
  Same handler-scoped awk idiom as `rbac-audit`. **Baselines the 4 mutating handlers** (`coll_create`,
  `item_put`, `item_patch`, `item_delete`) pending the real fix. *(The suggestion omitted this — it's the
  one finding that most needs a gate.)*
- **`config-safety-audit`** — no `*SECRET/KEY/TOKEN/PASS` env var may fall back to a value (multi-line-aware,
  since `oauth.rs::secret()` is `unwrap_or_else` across lines — the original suggested grep was a
  **false-negative**), and the `dev-insecure-secret-change-me` literal must not be reachable. (S-1.)
- **`ssrf-parity-audit`** — no `reqwest::` outside `http_client.rs` (excluding the `reqwest::Url` builder),
  generalizing the SSRF gate. Keys on the crate token, **not** a bare `.get(`/`.post(` (which flooded 69:0
  against axum routers + `HashMap`/`Value::get`). Clean today ⇒ binary (no baseline).
- **`upload-limit-audit`** — if `Multipart` is present, an explicit `DefaultBodyLimit` must be configured
  (don't ride axum's silent 2 MB default). (S-2.)
- **`caller-dev-audit`** — `Caller::dev()` (mints `is_platform_admin`) must be `cfg`-gated and never called on
  a prod path. Copies `prod()` from `debuggability-audit`; the cfg check **walks up past doc-comments** to the
  nearest attribute (a naive `grep -B1` would false-flag a correctly-gated `dev()`). (S-4.)
- **`stale-staging-audit`** — staging/"v0" comments (`always allows` · `until A2` · `until auth lands`) must
  not outlive their slice. Mirrors `docs-currency` intent at the comment level. (docs-drift.)

**The ratchet (the README "follow-on", now live).** Each gate carries a committed per-audit `baseline` of its
known/triaged findings as line-number-free fingerprints; the gate diffs current findings against it and fails
only on a **NEW** one. Fixing a finding prints a `resolved — drop from baseline` note → shrink the baseline
(ratchets *down* only). The spine + older domain audits stay binary.

## Verification

`tools/ci.sh` audit loop — **all 10 gates exit 0**: the 4 existing (rbac · debuggability · case-first ·
docs-currency, untouched) + the 6 new (mask-unenforced 4 · config-safety 2 · ssrf-parity 0 · upload-limit 1 ·
caller-dev 1 · stale-staging 3 baselined). Self-tested both ways:

- **Planted** a new unsealed mutating handler (`evil_unsealed_create`) in `objects.rs` → `mask-unenforced`
  went **red** (exit 1) flagging it; reverted → green. *(a gate that can't fail is worse than none.)*
- **Shrank** a baseline → the dropped finding became "new" → **red**; restored → green.

- **Known env limitation (same as 0012):** the `fmt`/`clippy`/`test` ci.sh stages were **not** run — the api
  crate + polars OOM the dev box on build (the crash that started this thread). The audit gates are pure
  grep/awk and don't compile, so they were run directly; the Rust portions of the fixes below need a
  RAM-adequate machine or real CI.

## Deferred (the gates flag these; closing them is follow-on work)

The gates **track** today's findings; they don't fix them. Each baseline shrinks as its fix lands:

- **C1 seal-bypass (the headline).** `mask-unenforced` only *prevents new* unsealed handlers. Closing it needs
  the **Rust-gate + DB-backstop pair** (per the `enforcement-gates` skill): a 405-on-masked-verb check in
  each of the 4 handlers (matching what OPTIONS/`Allow` already advertise) **and** an `entity_data` trigger
  mirroring `0008_cases_guard` (sqlstate → status in `error.rs`) + a test. Then drop the 4 baseline lines.
- **S-1 secret.** The real fix is behavioural: load `NUMU_SECRET` into `Config` once and **fail release boot**
  if unset/equals the dev literal, plus a `#[cfg(not(debug_assertions))]` test that `Config::from_env()` Errs
  (the test is the true guarantee — not added here; needs a build).
- **S-2 / S-4 / docs-drift / the data-plane mediums** (feed Plane-B filtering, blob-orphan on delete, etc.) —
  see the unified punch list. The other gates' baselines drop as each is fixed.

## Log

- **2026-06-29 — Torv:** Reviewed the "turn findings into gates" suggestion (sound philosophy; 2 broken greps,
  1 missing gate). Authored 6 corrected gates + the per-audit baseline ratchet; 10/10 audit loop green;
  self-tested planted-finding + ratchet. Updated `tools/README.md` (gate table + ratchet section). Live Cases
  backend unreachable (server down post-rebuild) → recorded on-disk (case-first fallback). → in_review.
