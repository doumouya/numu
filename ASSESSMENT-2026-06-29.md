# numu — Codebase Assessment

**Date:** 2026-06-29
**Scope reviewed:** the Rust workspace at `crates/{api,shared,data}`, `migrations/0001_init.sql`, and the design contract in `docs/` (README, DOCMAP, and the per-module case references). Static reading only — the code was not compiled or run from this environment (the WSL mount blocks shell access here).
**Dimensions:** architecture & design · security · code quality · completeness vs. spec.

---

## 1. Executive summary

numu is an unusually disciplined codebase. The central thesis — *"a type is a row, not a migration," served by one generic HTTP handler* — is genuinely realized in code, not just described in docs. The two-layer model (fixed SYSTEM tables + objects-as-data) holds together, the security model is coherent and largely correct, and the engineering house-style (single error responder, leak-free 404s, optimistic concurrency, an audit row per mutation, RAII cleanup) is applied consistently across every module.

It reads like a backend built by someone who has internalized RFC 9110/9457 and the OWASP IDOR/SSRF failure modes. The security-critical paths — the SSRF gate, the membership guards, the reach resolver, SQL parameterization, and the type-registration validator — are well-built and would survive a serious review.

The findings below are mostly hardening and scaling items, not structural defects. The single most important one is operational: a hardcoded fallback HMAC secret with no boot-time guard. The most *interesting* one is that the project violates its own headline discipline — several module doc comments are stale relative to the code, which the "docs-currency gate" is supposed to prevent.

**Overall:** strong design, strong security posture, high code quality, and a clear (well-documented) line between what is LIVE and what is deferred. Production-readiness gaps are concentrated in (a) the one secret-handling issue, (b) per-request RBAC query cost at scale, and (c) upload limits.

---

## 2. Architecture & design

### What works

**The generic handler is real.** `objects.rs` exposes the full safe verb set (`GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS`) for *every* registered type through one set of functions, reading each type's shape from the in-process registry (`registry.rs`) rather than per-type code. `OPTIONS` self-describes (fields, validation, the caller's per-verb RBAC verdict, the concurrency ETag). This is the design's load-bearing claim and it is delivered cleanly.

**Runtime type registration with hot reload.** `POST /api/types` validates an admin-supplied spec, writes `type_definitions` + `type_fields` in one transaction, then atomically swaps the registry snapshot via `ArcSwap` (`state.rs`) — the new type's entire CRUD surface is live with no restart. This is the "database-as-a-framework" promise working end-to-end.

**Clean crate boundaries.** `api` is the edge; `shared` holds DTOs; `data` is a pure-compute CSV typing engine (polars) with no web dependencies, invoked off the async runtime via `spawn_blocking` in `pipeline.rs`. The separation is principled and the blocking/CPU work is correctly isolated.

**Two-plane access control, cleanly separated.** Plane A (object reach → leak-free `404`) lives in `rbac.rs`/`caller.rs`; Plane B (per-field read/write → `403` after existence is admitted) lives in `field_perms.rs`. The reach resolver is a recursive CTE over `memberships` + `scope_parent_id`, depth-capped at 8 and set-deduped against cycles.

**Observability is structural, not bolted on.** A request-id middleware (`request_id.rs`) generates/propagates `X-Request-Id`, opens a tracing span, echoes it on the response, and stamps every `events` row with it (`db.rs`). The error responder (`error.rs`) emits RFC 9457 problem+json and "airlocks" 5xx — the real detail is logged, only the canonical reason goes on the wire.

**Optimistic concurrency is enforced in SQL.** Mutations require `If-Match`; the `UPDATE … WHERE version = $expected` makes the version check atomic, and `rows_affected() == 0` maps to `412`. ETag round-tripping is unit-tested.

### Design risks / trade-offs

| Area | Observation |
|---|---|
| **Per-request RBAC cost** | Every gated call runs recursive-CTE reach queries; `OPTIONS`, `filter_readable`, and `readable_set` call `field_floors` **once per field**, and `coll_get` calls `filter_readable` **once per row** — an N+1 (fields × rows) pattern on list reads. Correct, but it will not scale without the field-floor lookup being batched/cached. |
| **Reach via `= any($array)`** | `reachable_entity_ids*` materializes the full reachable-id set into a Rust `Vec` and binds it back as an array filter. For principals with large reach this is a big parameter and a large intermediate set on every list/search. |
| **Session resolved per request** | `auth.rs` hits the DB on every request (deliberately — instant revocation). The documented 60s cache is still a TODO and *must* invalidate on revoke when added (`members.rs` carries the reminder). |
| **Dynamic/stringly-typed core** | Kinds (`"text"`, `"int"`, …) and `serde_json::Value` flow throughout. Inherent to a data-driven registry, so acceptable — but it pushes correctness onto the validators rather than the type system. |

---

## 3. Security review

### Strengths (verified by reading the relevant module)

- **SSRF gate (`http_client.rs`)** — the standout. HTTPS-only, redirects disabled, DNS resolved then the IP **pinned** into the client (closes the rebinding/TOCTOU window), every resolved address checked against a blocklist that covers private/loopback/link-local, the `169.254.169.254` metadata endpoint, CGNAT `100.64/10`, IPv4-mapped IPv6, and IPv6 ULA/link-local. Body cap (1 MiB) and timeout (10s). Reused by both OAuth and the connector-run action.
- **SQL injection** — none found. Every query uses bound parameters. `search.rs`'s `format!` only assembles fixed clauses; all user input (`q`, type filter, reach set, limit) is bound, and the query text goes through `websearch_to_tsquery`. The type/field registration path validates identifiers against `^[a-z][a-z0-9_]*$` / `^[A-Z][A-Z0-9]+$` and an allowlist of kinds/perm-classes/reserved names **before** any insert.
- **IDOR** — the `scope_parent_id` FK (`migrations/0001`) is the schema-level backstop; reads, lists, and search are reach-filtered, and denials are leak-free `404`s with generic detail.
- **Auth (`auth.rs`)** — opaque 256-bit session token, only its SHA-256 is stored, `401` on absent/expired with no dev fallback, `dev-login` compiled out of release (`#[cfg(debug_assertions)]`), and a race-free atomic first-admin claim.
- **OAuth (`oauth.rs`)** — stateless HMAC-signed state cookie for CSRF with constant-time verification and TTL; identity bound by `(provider, sub)`, never email; Apple's `id_token` verified against JWKS (kid match, audience, issuer, `exp`, and per-flow `nonce`).
- **Membership SEV-0 guards (`members.rs`)** — manage-authority (admin+), no privilege escalation (can't grant above your own rank), last-owner guard, self-leave, and a team-nesting cycle guard, each with an audit event.
- **Upload write-path (`pipeline.rs`)** — on-disk blob name is a minted `FIL_…` id, not the user filename (no path traversal); an RAII `BlobGuard` removes the orphan blob if the transaction fails.

### Findings

| # | Severity | Location | Finding | Recommendation |
|---|---|---|---|---|
| S-1 | **Medium** | `oauth.rs::secret()` + `config.rs` | The OAuth state HMAC key falls back to the hardcoded literal `"dev-insecure-secret-change-me"` when `NUMU_SECRET` is unset, and **nothing validates it at boot**. In a release deploy that forgot the env var, the CSRF state cookie is forgeable by anyone. | Fail `Config::from_env()` in release builds if `NUMU_SECRET` is unset or equal to the dev default. Load the secret once into `Config`, not via `std::env` at call time. |
| S-2 | **Low–Med** | `files.rs` / `pipeline.rs` | No explicit request-size limit; uploads ride axum's **default 2 MB** body cap (confirmed — no `DefaultBodyLimit` anywhere). So real CSVs >2 MB silently 413, and the cap isn't configurable or intentional. | Set an explicit, configurable `DefaultBodyLimit` for `/api/files` and return a clear `413` with the limit. Decide the real ceiling for CSV ingest. |
| S-3 | **Low** | `orchestrator.rs::record_handoff` | The circuit breaker reads `count(*)` then inserts without a transaction or row lock; concurrent handoffs on one run could both read the same hop/retry count and slip past `MAX_HOPS`/`MAX_RETRIES_PER_GATE`. | Wrap read-decide-write in one tx with `SELECT … FOR UPDATE` on the `feature_runs` row, or guard the `feature_runs` update with an expected-version check. |
| S-4 | **Low** | `caller.rs::Caller::dev()` | `pub fn dev()` returns `is_platform_admin: true`. Only used by tests today, but it's a footgun — any accidental handler use would mint an admin caller. | Gate it behind `#[cfg(test)]` (or `#[cfg(debug_assertions)]`). |
| S-5 | **Info** | `auth.rs` / `members.rs` | Planned session cache must invalidate on membership revoke to avoid stale authority. The reminder exists in-code; flagging so it isn't lost when the cache lands. | Make revoke paths invalidate the cache key; add a test. |
| S-6 | **Info** | `lib.rs` (CORS) | Correctly avoids `*` with credentials and defaults to localhost dev origins only. No action — noted as a positive. Ensure `NUMU_CORS_ORIGINS` is set in prod. | — |

No high/critical issues were found in the reviewed surface.

---

## 4. Code quality

High and consistent.

- **Error handling** — one `AppError` → one problem+json responder; `From<sqlx::Error>` maps FK/unique/custom-sqlstate violations to the right 4xx instead of leaking 500s; handler paths deliberately avoid `unwrap`/`panic` (e.g. `type_descriptor` returns `null` rather than panicking on the "impossible" serialize error).
- **Idioms** — RAII (`BlobGuard`), `ArcSwap` for lock-free hot config, lock-poison recovery in the rate limiter, `spawn_blocking` for CPU work, `async_trait` `Fetcher` seam so OAuth is testable with a mock.
- **Tests** — inline unit tests for the fiddly bits (merge-patch, ETag parsing, SSRF blocklist, HMAC state tamper) plus a broad integration suite (`tests/`: rbac_reach, rbac_sharing, rbac_data, field_perms, oauth, oauth_apple, cases, types, catalog, orchestrator, relations, search, ops, db_smoke). Coverage of the security-critical logic is genuinely good.
- **Docs-in-code** — every module opens with a comment tying it to the design case it implements; this is excellent for maintainability.

Minor nits: some duplication between `item_put` and `item_patch` (sequence is near-identical aside from the data-build step); pervasive `serde_json::Value` threading (inherent to the dynamic registry); the data crate was ported from a sibling repo (`redpash`) and only a thin slice was reviewed here.

### Docs-currency drift (notable, given the project's thesis)

numu markets a "docs-currency gate — no `done` until docs reconciled," yet several module headers are stale relative to the code they describe:

- `rbac.rs` header: *"v0 is single-user dev: `require_action` always allows"* — but `require_action` now performs real rank checks.
- `members.rs` and `caller.rs`: *"Handlers use `Caller::dev()` until A2 wires the real extractor"* — A2 **is** wired; the real `FromRequestParts` extractor in `auth.rs` is what handlers use.
- `field_perms` test comment carries the same stale "until A2" framing.

Low risk, but worth a cleanup pass precisely because the project holds itself to this standard.

---

## 5. Completeness vs. spec

The `docs/DOCMAP.md` status column is honest. Mapping it to what the code actually contains:

**LIVE and present in code:** generic object CRUD + OPTIONS; runtime type registration with hot reload; two-plane RBAC; sessions + social OAuth (Google live; Apple/Facebook/TikTok wired, with TikTok's `client_key` param rename flagged as the one app-review TODO); object-sharing/membership management; workflow-as-data engine + close-gate; the 5-role orchestrator with the SQL circuit breaker; registry-native omnisearch; the CSV upload pipeline (`data` engine + `project_files`/`project_steps`); connectors (`http_json` run action, SSRF-gated); the observability spine; and the `/auth` rate limiter.

**Deferred / partial (per docs, and consistent with the code):**

- Operator/customer-data access design (`operator_access`, `access_audit`, purpose-limit) — Parts 2–4 of the RBAC doc are design-only.
- Legal/privacy/GDPR machinery (controller/processor, privacy-audit, data-subject rights) — planning; to be ported from the sibling repo.
- Client-compute / wasm data ops — intentionally the frontend's job.
- Connector kinds beyond `http_json` — `422` until each runtime is chosen.
- The session cache (S-5), a detached event-write task, and the batched field-floor lookup — all flagged as follow-ons.
- Some enforcement gates (agent-refs, doc-coverage) and the `.claude/agents/` + `CLAUDE.md` slices — planned.
- The `cases_guard` trigger / DB-level close-gate backstop lives in a later migration (0008) referenced by the code.

Nothing reviewed claimed to be done while being absent; the deferrals are labeled.

---

## 6. Prioritized recommendations

1. **(S-1, do first)** Add a boot-time guard: refuse to start a release build with a missing/default `NUMU_SECRET`, and thread the secret through `Config`.
2. **(S-2)** Set an explicit, configurable upload body limit and return a clear `413`.
3. **(Perf)** Batch the per-field `field_floors` lookups (one query per `(type, object)` instead of per field), and reconsider the `= any($array)` reach filter for large principals before this hits real data volumes.
4. **(S-3)** Make the orchestrator handoff transactional with a row lock.
5. **(S-4)** `#[cfg(test)]`-gate `Caller::dev()`.
6. **(Hygiene)** Reconcile the stale "v0 / until A2" doc comments — the project's own gate calls for it.
7. **(S-5)** When the session cache lands, wire revoke-time invalidation and a test.

---

*Reviewer's note:* this assessment is based on static reading of the working tree. It does not substitute for running the test suite, a dependency/`cargo audit` pass, or a review of the migrations beyond `0001` and the `data`-crate internals beyond the parse entry point. The PR referenced separately (`doumouya/numu#1`) could not be retrieved — the repo appears to be private — so this covers the local tree, which presumably contains the same code.
