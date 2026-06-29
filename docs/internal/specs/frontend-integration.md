# Spec: frontend integration — bind the Datacore rewrite to the live numu backend
Case: docs/cases/0013-frontend-integration.md  ·  type: feature  ·  area: crates/api + numu/web

## Problem / intent

The finished Datacore frontend (vanilla JS, in OneDrive) was built against fixtures while the backend was
unbuilt. CASE 0012 (`feat/numu-data-plane`) shipped the data plane it was waiting on. The frontend's whole
design is a single seam — `numu-data-client.js`'s `makeClient("fixture"|"http"|"auto")` — so binding fixtures
→ live should be "one switch, zero UI churn." It is not yet, because `HttpClient` is a faithful 1:1 endpoint
map but does NOT normalize response **shapes** to what the fixture-built UI consumes. The work: close seven
precise contract gaps (G1–G7) and serve the frontend same-origin from the binary. **Scope = bind-live only**
on the R3 Shell proof page; the `numu Console.dc.html` cutover is deferred.

## Acceptance criteria (numbered — tests map 1:1 to these)

> Each AC names its **verification path**: `[RUST-IT]` = a Rust integration test (backend-observable),
> `[JS-UNIT]` = a Node/JS assertion over before→after fixtures (the HttpClient shape maps; no Rust test
> exists for these), `[MANUAL-E2E]` = a documented manual check against the seeded live DB.

- **AC1 (G1 — context_view on the wire)** `[RUST-IT]`: `GET /api/types/:type` for a type whose
  `type_definitions.context_view` is non-default (e.g. `file` → `"table"`, `project` → `"thread"`) returns a
  body containing the `context_view` key with that value. `GET /api/types` returns each catalog entry with a
  `context_view` key. (Both verified **LIVE-GREEN** by ops 2026-06-29.) **OPTIONS parity DESCOPED (Em,
  Checkpoint 2):** the Checkpoint-1 `OPTIONS /api/objects/:type` parity is moved to **Case 0017** — ops found
  `tower_http::cors::CorsLayer` short-circuits ALL OPTIONS before the router, a pre-existing bug (Case 0009)
  that shadows the whole OPTIONS self-description feature, not just 0013. The `options_body` `context_view`
  line (objects.rs:327) STAYS in place (correct + forward-compatible — it'll surface once Case 0017 fixes the
  CORS layer). The frontend reads `context_view` from `GET /api/types/:type`, so 0013 needs nothing from
  OPTIONS.

- **AC2 (G2 — health alias)** `[RUST-IT]`: `GET /api/health` returns `200` with body
  `{"status":"ok","version":"<pkg-version>"}` — identical to `/healthz` (it aliases `health::healthz`).
  Today `/api/health` is unrouted → `404`, which makes `AutoClient` always fall back to fixtures.

- **AC3 (serving — ServeDir same-origin)** `[RUST-IT]`: with `NUMU_WEB_DIR` pointing at a directory holding a
  test asset, a `GET` for that asset path (e.g. `GET /R3 Shell.dc.html` or a sentinel `GET /probe.txt`)
  returns `200` with the file's bytes; the static fallback is mounted AFTER `/api/*` so a `GET /api/types`
  still hits the API handler (not the file server). Today there is no static route.

- **AC4 (G3 — list shape)** `[JS-UNIT]`: `HttpClient.list(type, q)` returns `{rows, total}` where `rows` is
  the backend `items` array with each item **flattened** (per AC5's flatten rule) and `total === items.length`
  (documented as the page count, not a grand total — the backend list carries no count). Verified against a
  recorded `{items:[…],limit,offset}` fixture; result must be byte-identical in shape to `FixtureClient.list`.

- **AC5 (G4 — item shape / flatten)** `[JS-UNIT]`: `HttpClient.get`/`create`/`update` return
  `{id, type, ...data, _version: String(version)}` — the nested `{id,type,data,version,etag}` envelope
  flattened so the UI's `row._version` reads and `update(type,id,patch,row._version)` If-Match calls work
  unchanged. `_version` is a **string** (matches `FixtureClient`). Verified against a recorded envelope fixture.

- **AC6 (G5 — types/options casing)** `[JS-UNIT]`: `HttpClient.types()` and `HttpClient.options(type)` return
  camelCase keys (`type`, `idPrefix`, `displayName`, `displayNamePlural`, `contextView`, `scopeParents`)
  mapped from the backend snake_case (`type_id`, `id_prefix`, `display_name`, `display_name_plural`,
  `context_view`, `scope_parents`), with `fields` passed through unchanged (already shape-compatible incl.
  `options.role`). Verified against a recorded `GET /api/types` + `GET /api/types/:type` fixture.

- **AC7 (G6 — conversations mapping)** `[JS-UNIT]`: `HttpClient.conversations()` maps the
  `/api/objects/project` envelope (`{items:[{id,type,data,version,etag}],…}`) to
  `[{id, title, origin, channel, status}]` where `title = data.title || data.name` (live project's label is
  `name`), `origin = data.origin`, `channel = data.channel_group || "Clients"` (fixture default when absent),
  `status = data.status`; a `data:null` item is guarded (`var d = it.data || {}`) so it yields a sane row.
  Verified against a recorded project-list fixture. NOTE: it must consume the SAME enveloped+flatten path as
  AC4/AC5, not a parallel one.

- **AC8 (G7 + bind — seam flips live)** `[JS-UNIT]` + `[MANUAL-E2E]`:
  - `[JS-UNIT]`: `NUMU_CLIENT.makeClient("auto")` returns an `AutoClient` (today `makeClient` only handles
    `"http"`/`"fixture"` and silently returns a `FixtureClient` for `"auto"` — this MUST be fixed).
  - `[MANUAL-E2E]`: against the seeded live DB, served same-origin by the binary, opening
    `http://localhost:<port>/R3 Shell.dc.html` yields `AutoClient.isLive() === true`, the network panel shows
    `/api/*` 200s with the session cookie attached, and the **killer flow** runs: conversations list binds
    (seeded tenants) → open the seeded `dossier.csv` conversation → feed renders real ordered items →
    `lens=customer|mine|all` filters live → a bogus id → 404 → upload a CSV → `UploadOutcome` renders →
    list/detail pick the right archetype via `contextView` (G1) → edit a record → `update()` sends
    `If-Match: W/"<version>"` from the flattened `_version` (G4) → a stale version → 412.

> The R3 Shell page must be flipped from `makeClient("fixture")` to `makeClient("auto")` for AC8's E2E.

## API contracts (exact — no guessing)

### G1 — `TypeDef.context_view` (Rust, `crates/api/src/registry.rs`)
- `TypeDef` (registry.rs:40-49) gains a field. The DB column is `type_definitions.context_view text`, added by
  migration 0016 with a CHECK constraint over the 11-archetype census (`'record'` is the default for
  no-archetype types; `'table'`, `'thread'`, etc. otherwise — note `'none'` is NOT in the CHECK set). Add:
  ```rust
  pub context_view: String,   // mirrors type_definitions.context_view (0016); 'record' default
  ```
- `TypeDefCache::load` SELECT (registry.rs:96-97) must add `context_view` to the column list and populate it
  (`context_view: r.try_get("context_view")?`).
- `get_type` (types.rs:262-273) serializes the whole `TypeDef` via `type_descriptor` (types.rs:372-377 ⇒
  `serde_json::to_value(td)`) — so `context_view` flows onto the wire **automatically** once it's a `TypeDef`
  field. No change to `get_type` itself.
- `list_types` (types.rs:241-258) builds its JSON **manually** (not via serde of `TypeDef`) — it MUST add the
  key explicitly: `"context_view": t.context_view,`.
- Wire result (`GET /api/types/:type`), additive — existing keys unchanged:
  ```jsonc
  { "type_id":"file", "id_prefix":"FIL", "display_name":"File", "display_name_plural":"Files",
    "scope_parents":[…], "is_builtin":true, "method_policy":{…},
    "context_view":"table",                    // ← NEW (G1)
    "fields":[ … ] }
  ```

### G2 — `GET /api/health` (Rust, `crates/api/src/lib.rs`)
- `health::healthz` (health.rs:11-13) takes no extractor args, so the alias is a one-liner alongside the
  existing routes (lib.rs:126-127):
  ```rust
  .route("/api/health", get(health::healthz))
  ```
- Response: `200` `application/json` `{"status":"ok","version":"<CARGO_PKG_VERSION>"}` — byte-identical to
  `/healthz`. Keeps the published client contract (`numu-data-client.js:308` probes `/api/health`) untouched.

### Serving — ServeDir fallback + `NUMU_WEB_DIR` (Rust, `crates/api/src/{lib,config}.rs` + Cargo.toml)
- **Cargo.toml** (workspace root, line 17): `tower-http`'s **`fs` feature must be added** — it currently has
  only `["trace","cors"]`. `ServeDir` lives behind `fs`. This is a real edit, not optional.
- **config.rs**: add a field + env read mirroring `data_dir`:
  ```rust
  pub web_dir: std::path::PathBuf,        // static frontend root; NUMU_WEB_DIR, default ./web
  ```
  ```rust
  web_dir: std::env::var("NUMU_WEB_DIR")
      .map(std::path::PathBuf::from)
      .unwrap_or_else(|_| std::path::PathBuf::from("./web")),
  ```
- **lib.rs**: mount the static server as the router **fallback**, AFTER all `/api/*` + `/auth` + health
  routes, so the API always wins on `/api/*`:
  ```rust
  .fallback_service(tower_http::services::ServeDir::new(&cfg.web_dir))
  ```
  Ordering rule: `.fallback_service(...)` only handles paths no prior route matched, so precedence is correct
  by construction. (Confirm whether a `fallback` vs `fallback_service` + layering interaction with the CORS /
  trace layers needs the ServeDir mounted on the inner `Router` before `.layer(...)` — coder's call; the
  invariant the tester checks is AC3: API wins, static serves files.)
- No CORS change: same-origin serving makes the `SameSite=Lax; HttpOnly` cookie work; the existing CORS layer
  (lib.rs:89-112) is moot for the bundled frontend.

### G3 — list shape (JS, `numu/web/numu-data-client.js`, `HttpClient.prototype.list`)
- **Backend** (`coll_get`, objects.rs:347-397): `{ "items":[ <entity_json>… ], "limit":N, "offset":N }`,
  where each `entity_json` (objects.rs:115-117) = `{ "id", "type", "data":{…fields…}, "version":int, "etag" }`.
- **FixtureClient.list** (numu-data-client.js:192-197): `{ rows:[ {…flat fields…, _version} ], total:int }`.
- **After (HttpClient.list must return):**
  ```jsonc
  { "rows": items.map(flatten), "total": items.length }   // flatten = the G4 rule below
  ```
  Comment in code: `items.length` is the page count, not a grand total (the backend list carries no count).

### G4 — item flatten (JS, `HttpClient.prototype.{get,create,update}` + a shared `flatten()` helper)
- **Backend item** (entity_json): `{ "id","type","data":{…},"version":int,"etag" }`; `version` is in the BODY
  (no need to read the ETag header). ETag is weak `W/"<v>"` (objects.rs:61-63); update requires `If-Match`
  (HTTP.md §3 — 428 absent, 412 stale).
- **FixtureClient** rows are flat `{…fields…, _version:"<n>"}` (numu-data-client.js:205,212).
- **After (the `flatten` helper):**
  ```jsonc
  { "id": <id>, "type": <type>, ...<data>, "_version": String(<version>) }   // _version is a STRING
  ```
- `update(type,id,patch,version)` already sends `If-Match: W/"<version>"` (numu-data-client.js:272-277); the
  flattened `_version` is what the shell passes back as that `version` arg — so flatten closes the loop.

### G5 — types/options casing (JS, `HttpClient.prototype.{types,options}`)
- **Backend** emits snake_case (registry/types serde). Map per key:
  | backend (snake) | frontend (camel) |
  |---|---|
  | `type_id` | `type` |
  | `id_prefix` | `idPrefix` |
  | `display_name` | `displayName` |
  | `display_name_plural` | `displayNamePlural` |
  | `context_view` | `contextView` |
  | `scope_parents` | `scopeParents` |
  - `fields` passed through unchanged — already shape-compatible incl. `options.role` (0016 set role tags on
    `file/chart/dashboard/message`; `project`/`case` fall back to `kind`, deferred polish).
- `HttpClient.options(type)` reads from `GET /api/types/:type` (numu-data-client.js:262) — so after G1 it
  carries `context_view`, which this mapping renames to `contextView` (the renderer dispatches archetype off
  `contextView`).

### G6 — conversations mapping (JS, `HttpClient.prototype.conversations`)
- **Backend** `GET /api/objects/project` returns the standard enveloped list `{items:[<entity_json>…],…}`.
  The `?origin=` query param in the current client (numu-data-client.js:278) is **ignored** by the generic
  list (no server-side filter); harmless, keep or drop.
- **Live `project` fields** (confirmed): `name`,`slug`,`status`,`description`,`repo_url` (0002_seed.sql:9-14)
  + `origin`,`case_id` (0016_data_app_catalog.sql:30-31). There is **no `title` field** and **no
  `channel_group` field** on the live project — only the fixture has them.
- **After:**
  ```jsonc
  items.map(it => {
    var d = it.data || {};                   // guard a null `data` (malformed item ⇒ sane row, not a throw)
    return {
      id:      it.id,
      title:   d.title || d.name,             // live: data.name (no title field)
      origin:  d.origin,
      channel: d.channel_group || "Clients",  // no channel_group on the live project ⇒ fixture default "Clients"
      status:  d.status
    };
  })
  ```
  Reuse the G4 flatten path where convenient, but the output is the conversation projection, not a flat row.

### G7 — `makeClient("auto")` + the seam flip (JS, `numu-data-client.js` + `R3 Shell.dc.html`)
- **Current** `makeClient` (numu-data-client.js:296): `mode === "http" ? new HttpClient() : new FixtureClient()`
  — `"auto"` falls through to `FixtureClient`, so the plan's flip would silently stay offline. **Fix:**
  ```js
  makeClient: function (mode) {
    if (mode === "http") return new HttpClient();
    if (mode === "auto") return new AutoClient();
    return new FixtureClient();
  }
  ```
  (`AutoClient` is defined at numu-data-client.js:305-319; it probes `/api/health` and delegates to
  `HttpClient` when live, else `FixtureClient`. Note: `AutoClient` has `this.live` but the plan/E2E reference
  `AutoClient.isLive()` — add an `isLive()` accessor returning `this.live === true`, or have the E2E read
  `.live`; the spec's AC8 accepts either, coder picks one and the manual check follows it.)
- **R3 Shell.dc.html**: change `makeClient("fixture")` → `makeClient("auto")`.

## Scope boundaries

- **In:** G1–G7; same-origin `ServeDir` serving + `NUMU_WEB_DIR` + the `tower-http` `fs` feature; copy the
  Datacore static assets into `numu/web/`; run `tools/seed-demo.sh`; the killer-flow E2E on `R3 Shell.dc.html`;
  an ADR (`docs/decisions/`) for the monorepo same-origin decision; DOCMAP reconciliation (docs-currency gate).
- **Out:** the `numu Console.dc.html` cutover; `project`/`case` role-tagging; Bucket 4
  (operator-access/audit/breach); connector→file ingest; the wasm client-compute crate; production
  cross-site CORS (moot while same-origin).
- **Reuses (don't reinvent):**
  - Backend: `health::healthz` (alias, not a new handler); `type_descriptor` (auto-serializes `TypeDef`);
    the existing `entity_json` envelope; `config.rs`'s `data_dir` pattern for `web_dir`.
  - Frontend: the existing `AutoClient`/`HttpClient`/`FixtureClient` trio; a single shared `flatten()` helper
    consumed by `list`/`get`/`create`/`update`/`conversations` (one mapper, not five).
  - Seed: `tools/seed-demo.sh` (already exists, CASE 0012 slice 3.5).

## Risks / open questions for Em

- **(a) project conversation label** — RESOLVED by inspection: live `project` uses `name`, not `title`
  (0002_seed.sql:10; 0016 adds only `origin`+`case_id`). G6's `data.title || data.name` is correct. Confirm
  the displayed conversation label should be the project `name`.
- **(b) branch** — `feat/numu-frontend-integration` (new) vs continuing `feat/numu-data-plane`. Already
  chosen; confirm.
- **(c) context_view in OPTIONS** — **RESOLVED (Em, Checkpoint 1): YES.** Add `context_view` to
  `OPTIONS /api/objects/:type` `options_body` (objects.rs:324-332) in addition to `GET /api/types/:type`.
  Folded into AC1.
- **(d) tower-http `fs` feature** — RESOLVED: not currently enabled (Cargo.toml:17 has `["trace","cors"]`);
  must be added for `ServeDir`. No decision needed, just recording it as a required dependency edit.
- **(e) `AutoClient.isLive()` + `makeClient("auto")`** — **CORRECTION (orchestrator): both ALREADY exist.**
  `numu-data-client.js` reassigns `window.NUMU_CLIENT.makeClient` at :322-326 with an `"auto"` branch, and
  defines `AutoClient.prototype.isLive` at :320 — the architect read only the earlier `makeClient` def at
  :296 and missed the override. AC8's `makeClient("auto")` test is a **confirm-it-still-works**, NOT a fix;
  the coder must NOT "repair" the working override or re-add `isLive()`.

## Process constraints (recorded for the build phase)

- Branch `feat/numu-frontend-integration`; commit **per-named-files** (never `git add -A`); commit messages
  end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; **push only on Em's explicit OK**.
- Touching `crates/` triggers case-first + docs-currency → this Case + the DOCMAP/ADR reconciliation in the
  same change.
- Run the safe `tools/ci.sh` gates (fmt/clippy/test + the audits) + the live E2E. **Do NOT** run
  `cargo test --features db-tests` — it OOMs this dev box (CASE 0012 env limit); the live E2E is the
  DB-path stand-in.
