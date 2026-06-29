# CASE 0013 — frontend integration (bind the Datacore rewrite to the live numu backend)

- **Status:** in_progress
- **Type:** feature
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **Branch:** `feat/numu-frontend-integration`
- **Trigger:** the approved plan (`plans/hi-i-need-you-fizzy-nest.md`, Em-approved via ExitPlanMode) + Em's `/feature`.

## Goal

Bind the finished Datacore frontend rewrite to the live numu backend shipped in CASE 0012
(`feat/numu-data-plane`). **Scope = bind-live only:** prove the `makeClient` seam binds to the live
backend and the killer flow runs on real data **on the R3 Shell proof page**. Serving = move the
frontend into the numu repo, served same-origin by the binary (`tower_http::services::ServeDir`),
which makes the `SameSite=Lax; HttpOnly` session cookie just work with **zero CORS changes**.

The integration is much smaller than the rewrite docs imply (they predate CASE 0012). The real work is
(1) close seven precise contract gaps (G1–G7) between `numu-data-client.js` and the live backend, and
(2) serve the frontend same-origin from the binary.

Full spec + numbered acceptance criteria + exact contracts:
[`../internal/specs/frontend-integration.md`](../internal/specs/frontend-integration.md).

## Plan (sliced — each to be committed per-named-files)

- **Serving** — copy the Datacore static assets into `numu/web/`; add a `ServeDir` fallback to the axum
  router (mounted AFTER `/api/*`); add `NUMU_WEB_DIR` (default `./web`) to `config.rs`; **add the
  `tower-http` `fs` feature** (currently only `trace`,`cors`). Record an ADR for the monorepo/same-origin
  decision (`docs/decisions/`).
- **Backend gaps (numu repo):**
  - **G1** — expose `context_view`: add the field to `TypeDef` + the `TypeDefCache::load` SELECT + the
    `list_types` JSON. Auto-serializes into `GET /api/types/:type` (which serializes the whole `TypeDef`).
  - **G2** — health alias: add `GET /api/health` → `health::healthz` in `lib.rs`.
- **Frontend gaps (`numu/web/numu-data-client.js` — make HttpClient shapes === FixtureClient shapes):**
  - **G3** list: `{items,limit,offset}` → `{rows: items.map(flatten), total: items.length}`.
  - **G4** get/create/update: `{id,type,data,version,etag}` → `{id, type, ...data, _version: String(version)}`.
  - **G5** types/options: snake→camel; pass `fields` through.
  - **G6** conversations(): map the `/api/objects/project` envelope → `[{id, title, origin, channel, status}]`
    (title from `data.title || data.name` — live project's label field is `name`, confirmed 0002_seed.sql).
  - **G7** seam flip: extend `makeClient` to support `"auto"` (today it only handles `"http"`/`"fixture"`),
    then flip the R3 Shell page's `makeClient("fixture")` → `makeClient("auto")`.
- **Seed + verify:** run `tools/seed-demo.sh` against live Postgres; start the binary; open
  `http://localhost:<port>/R3 Shell.dc.html`; confirm `AutoClient.isLive() === true` + the killer flow.

## Verification

- **Rust integration tests** for the backend-observable ACs (context_view on the wire; `/api/health` 200;
  ServeDir serves an index file).
- **JS-unit / manual-E2E** for the HttpClient shape mappings (G3–G7) — these have **no Rust test**; a tiny
  Node assertion file (`web/tests/shapes.test.mjs`) over the documented before→after fixtures, plus the
  documented manual E2E against the seeded DB.
- `tools/ci.sh` safe gates: fmt · clippy `-D warnings` · test · rbac-audit · debuggability-audit ·
  case-first-audit · docs-currency-audit. **Do NOT** run `cargo test --features db-tests` (OOMs this box —
  CASE 0012 env limit); the live E2E is the DB-path stand-in.

## Deferred (not this case)

Porting the R-spine into `numu Console.dc.html` (the Console cutover); `project`/`case` role-tagging polish;
Bucket 4 (operator-access/audit/breach); connector→file ingest; the wasm client-compute crate; production
CORS for a truly cross-site deploy (moot while same-origin).

## Open questions for Em (Checkpoint 1)

- **(a) project title field** — RESOLVED by inspection: live `project` has `name` (0002_seed.sql:10), not
  `title`; 0016 only adds `origin`+`case_id`. G6 uses `data.title || data.name`, which is correct. Confirm
  the displayed conversation label should be the project `name`.
- **(b) branch** — new branch `feat/numu-frontend-integration` (vs continuing `feat/numu-data-plane`).
  Already chosen; confirm.
- **(c) context_view in OPTIONS** — **RESOLVED (Em, Checkpoint 1): YES, add parity.** Surface
  `context_view` in `OPTIONS /api/objects/:type` `options_body` (objects.rs:324-332) in addition to
  `GET /api/types/:type`. One extra key; avoids a future gap. Now part of AC1.
- **(d) tower-http `fs` feature** — RESOLVED: `fs` is NOT enabled (workspace Cargo.toml:17 has only
  `trace`,`cors`). It must be added for `ServeDir`. Flagged; no decision needed beyond awareness.

## Log

- **2026-06-29 — Torv (architect):** Formalized the approved plan into this Case + the spec doc with eight
  numbered acceptance criteria (AC1–AC8) mapped to G1–G7 + serving + verify. Confirmed every contract
  against source (registry.rs, types.rs, objects.rs, lib.rs, config.rs, health.rs, Cargo.toml, 0002/0016
  migrations, numu-data-client.js). → awaiting Checkpoint 1 (Em).
- **2026-06-29 — CHECKPOINT-1 APPROVED by Em:** "Approve — proceed to tester" + "Add to OPTIONS too
  (parity)". (c) resolved → AC1 now also covers `OPTIONS /api/objects/:type`. Orchestrator correction:
  `makeClient("auto")` and `AutoClient.isLive()` ALREADY exist (numu-data-client.js:320,322-326 — the
  architect read only the earlier def at :296); AC8's `makeClient("auto")` is a **confirm**, not a fix —
  the coder must not "repair" the working override.
- **2026-06-29 — tester:** RED tests landed (AC1 compile-red in registry.rs; AC4–AC7 node-red + AC8 guard
  in web/tests/shapes.test.mjs; AC2/AC3/AC1-app in tools/e2e-0013.sh, documented-red). 
- **2026-06-29 — coder:** GREEN (node 5/5; cargo check clean). Slices 440b215/4ad2c73/b6a46d2/e37b312/5e05f30.
  Orchestrator re-verified node 5/5 + cargo check.
- **2026-06-29 — review (3 specialists, read-only) findings + triage:**
  - **FIX-NOW (fold into a coder/tester round):**
    1. `conversations()` (numu-data-client.js): guard `it.data` (throws on null) + `channel: d.channel_group
       || "Clients"` — live `project` has NO `channel_group`, so today every live conversation groups under
       `undefined` in the rail (breaks the first killer-flow step). Spec G6 + the AC7 test updated to match.
    2. Wire `node web/tests/shapes.test.mjs` into `tools/ci.sh` (AC4–AC8 currently gate nothing in CI).
    3. `context_view` default is `'record'` not `'none'` (0016 CHECK has no `'none'`) — fix registry.rs
       comment + spec wording for accuracy.
    4. ServeDir: warn-log at boot if `web_dir` is missing (else silent blanket 404s — debuggability).
  - **DEFER (follow-up Case / known limitations — NOT blocking bind-live):**
    - AutoClient probe hits unauthed/no-DB `/api/health` → can mask 401/500 as "offline" and serve fixtures
      indistinguishably; R3 Shell read paths lack `.catch`; offline shown only by a dot. (Pre-existing rewrite
      seam degradation design + production hardening — belongs to the Console-cutover effort.)
    - `list ?q=` no-ops live (no server-side filter); `isLive()` returns a Promise (manual-E2E must `await`);
      a state-free `oneshot` router test for AC2/AC3 (live E2E is this milestone's stand-in per spec).
- **2026-06-29 — tester (fix): AC7** updated to expect `channel: "Clients"` fallback + a `data:null` no-throw
  case (RED → coder). **coder (fix): commit `4ce195c`** — `conversations()` guard + "Clients" fallback;
  `node web/tests/shapes.test.mjs` wired into `tools/ci.sh`; `context_view` doc `'none'`→`'record'`;
  `web_dir`-missing boot warn. node 5/5, cargo check + clippy + fmt clean.
- **2026-06-29 — reviewer (Checkpoint 2): SHIP.** `sh tools/ci.sh` (DATABASE_URL unset → db gate skipped per
  the OOM constraint): fmt ✓, clippy -D warnings ✓, cargo test 9/9 api + 18/18 data ✓, js shape gate 5/5
  (AC4–AC8) ✓, all 11 embedded audits clean/baselined (rbac 0, ssrf-parity 0, mask-unenforced 4-baselined
  held — that's CASE 0015's debt, docs-currency 0, case-first 0, debuggability 0). No `tools/ci-audit/check.sh`
  in numu — audits embed in ci.sh. Verified the 4 FIX-NOW items landed (4ce195c); DEFER items documented.
  Security pass clean: ServeDir (tower-http 0.6.11 `fs`) confines to root + no symlink follow; fallback mounted
  after all routes so the API wins (AC3); `/api/health` no-auth/no-DB liveness acceptable; `context_view` is
  static schema metadata behind an authenticated `Caller` (no PII/IDOR). AC coverage: AC4–AC8-unit + AC1-serde
  gate-covered; **AC2/AC3/AC1-catalog+OPTIONS/AC8-killer-flow are live-E2E-only** (`tools/e2e-0013.sh` vs a
  seeded live server) per the OOM design — that E2E is the remaining proof for ops. ONE new LOW/non-blocking
  flag: the AC1 default test still names/asserts `'none'` (should be `'record'`); it still passes (proves
  key-present only) → cleanup on next touch / fold into 0015. → Checkpoint 2 (Em).
- **2026-06-29 — CHECKPOINT 2 (Em): "run live E2E first, push if green."**
- **2026-06-29 — ops live E2E: LIVE-RED (12/13), do NOT push (yet).** Built `numu-api` (no OOM, ~14GiB free),
  served same-origin on :8099 with `NUMU_WEB_DIR=web` against a fresh Postgres (`numu_0013_live`), dev-login
  cookie, `seed-demo.sh` ✓. **PASS:** AC2 `/api/health` 200; AC1 `GET /api/types/file`→`context_view:"table"`
  + catalog 21/21; AC3 static `/probe.txt` 200 + `/api/types` API-wins; AC8 conversations(3), feed
  (lens=all/customer, bogus→404, bad-lens→400), upload→`UploadOutcome{cleanness:100,encoding:utf-8,cols}`,
  `GET /R3 Shell.dc.html` 200 same-origin. **FAIL (1):** AC1 OPTIONS-parity — `OPTIONS /api/objects/:type`
  returns 200 **empty**. **Root cause (pre-existing, not 0013):** `tower_http::cors::CorsLayer` (lib.rs:145,
  outermost) short-circuits ALL OPTIONS as preflight before the router, so `coll_options`/`item_options`
  (objects.rs:508/794 — which DO emit `context_view` at :327) are never reached. Same on `main` (CORS landed
  Case 0009); the db-tests hit the router directly, bypassing the layer, so it was never caught. Impact on
  0013: NONE for bind-live — the frontend reads `context_view` from `GET /api/types/:type` (passes). Also:
  `tools/e2e-0013.sh` sends no cookie → its `/api/types*` checks spuriously 401 (tester-owned script bug).
  → escalate the fix-direction decision to Em (drop OPTIONS-parity from 0013 + file CORS bug separately, vs
  fix CORS now, vs remove CORS for same-origin).
- **2026-06-29 — Em decision: "Drop OPTIONS-parity from 0013, file CORS bug separately."** AC1 descoped to the
  GET endpoints (both LIVE-GREEN). OPTIONS parity + the CORS-shadows-OPTIONS fix → new **Case 0016**. The
  `options_body` context_view line stays (forward-compatible). 0013 is now **LIVE-GREEN**. → tester cleans up
  `tools/e2e-0013.sh` (cookie auth + OPTIONS check → skip-with-0016-ref) and the AC1 `'none'`→`'record'` test
  flag; then push (Em pre-authorized "push if green"). → tester starts (Step 2).
