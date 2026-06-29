# Spec: durably restore the Cases MCP (`redpash-slack`)
Case: CAS_C5AB84FB95E141B995983BE68C38984E  ·  type: feature  ·  area: `redpash-rust-pwa/tools/mcp-server/` (Node adapter) + `~/.claude.json` (MCP config) + numu `tools/` (supervisor/seed scripts) + `docs/cases/`  ·  branch: `feat/*`

## Problem / intent
The Cases MCP (`redpash-slack`) is the multi-session coordination bus between agents, and it keeps going
down. Em: "make fixing it a priority — we need it back, we created the objects now." It is a Node stdio MCP
whose `case_*` handlers `fetch()` the RedPash Axum backend on `:8080`; that backend is **unsupervised**, so
when its process dies every case tool fails (ECONNREFUSE, or a 401 when the self-minted session can't be
issued) — and it fails *silently*, only surfacing when a tool is invoked. Postgres stays up, so case state is
safe; the outage is purely the backend process. Phase 0 (a stopgap restart) is DONE. This spec is the
**durable** fix with three goals, in priority order:
1. **Resilience** — supervise whichever case backend the MCP points at so it survives crash/reboot.
2. **Repoint to numu** — consolidate onto numu's now-built Cases engine ("we created the objects now").
3. **Seed the already-opened cases** — so the restored MCP serves live state, not an empty board.

## Diagnosis (established — cited, not re-derived)
- The MCP launcher is `node /home/mansa/rust-project/redpash-rust-pwa/tools/mcp-server/dist/server.js`, env
  `REDPASH_SLACK_DIR=/home/mansa/Internal-Slack`, configured under `redpash-slack` in `/home/mansa/.claude.json`.
- The `case_*` bridge lives in `redpash-rust-pwa/tools/mcp-server/dist/cases.js`. It targets
  `${REDPASH_API_BASE:-http://localhost:8080/api}` and hits RedPash routes:
  `POST /cases`, `GET /cases/:rid`, `GET /cases`, `POST /cases/:rid/comments`, `PATCH /cases/:rid`
  (`cases.js:163-190`). It self-mints an `rp_session` cookie via `POST /auth/dev-login`, caches it in module
  state, and retries once on 401 (`cases.js:59-160`).
- The `slack_*` tools are filesystem-only against `REDPASH_SLACK_DIR` — **unaffected** by this work; do not touch them.
- **Root cause:** `redpash-api` (Axum, `:8080`) is not supervised; Postgres (`redpash_prerelease`@127.0.0.1:5433) stays up.
- **numu's case surface (the repoint target) — confirmed by reading the source:**
  - There is **no dedicated `/api/cases` route** in numu. Cases are the generic registry object:
    `/api/objects/case` and `/api/objects/comment`, served by the ONE handler set in
    `numu/crates/api/src/objects.rs` (router at `objects.rs:26-48`, mounted at `/api/objects` in
    `lib.rs:115`).
  - Writes are wrapped/unwrapped via an envelope: requests send field keys at the **top level of the JSON
    body** (the handler reads `payload` directly — `objects.rs:425-427`, `build_create_data` at
    `objects.rs:217`); responses are `{ "id", "type", "data", "version", "etag" }` (`entity_json`,
    `objects.rs:115-117`). **NOTE the shape correction vs. the brief:** numu's create/patch body is the
    **bare field object**, not `{data:{…}}`. The `{data:{…}}` envelope appears only on the *response* side.
    The adapter must send `{title, type, status, …}` at top level and read fields back out of `resp.data`.
  - Status enum: `["backlog","todo","in_progress","in_review","done"]` (matches RedPash) —
    `migrations/0007_cases_engine.sql:27`. Illegal transitions → `422 illegal_transition`
    (`objects.rs:122-150`, `workflow.rs`).
  - Concurrency: numu **requires `If-Match`** on PUT/PATCH/DELETE (`require_if_match`, `objects.rs:78-84`;
    a missing header → `428 precondition_required`, a stale one → `412 precondition_failed`). The etag is
    weak-form `W/"<version>"`.
  - Auth: the session cookie is **`numu_session`** (not `rp_session`) — `auth.rs:25`. `dev-login` is
    `POST /auth/dev-login` and is **compiled out of release** (`#[cfg(debug_assertions)]`, `auth.rs:103-138`);
    it mints a session for `USR_dev` by default. The cookie is `Set-Cookie: numu_session=<token>; …`.
  - Bind: `NUMU_BIND`, default `127.0.0.1:8080` (`config.rs:27`). So numu's API base is
    `http://127.0.0.1:8080/api`. **PORT COLLISION RISK:** both RedPash and numu default to `:8080` — see AC-1/AC-3 and Risk (a)/(f).

## Case `type_fields` (the exact contract the adapter must satisfy) — `migrations/0007_cases_engine.sql:24-34`
`case` (prefix `CAS`, `scope_parent = ["project_id"]`):
| field | kind | required | settable on create? | editable after? | notes |
|---|---|---|---|---|---|
| `title` | text | yes | yes | yes | |
| `description` | text | no | yes | yes | |
| `type` | enum | yes | yes | yes | `bug\|feature\|task\|epic\|chore`, default `task` |
| `status` | enum | yes | yes | yes | the 5-state enum; create must start at workflow `initial` (`backlog`) |
| `priority` | enum | yes | yes | yes | `low\|normal\|high\|urgent`, default `normal` — **N.B. RedPash used `medium\|critical`; numu uses `normal\|urgent`. Map on seed (see AC-4).** |
| `origin` | enum | no | yes | yes | default `ui`; the MCP should set `agent` |
| `visibility` | enum | no | yes | yes | default `internal` |
| `workflow_id` | ref | yes | **no (readonly)** | no | engine-defaulted to `"default"`; the adapter must NOT send it |
| `assignee_id` | ref | no | yes | yes | `ref: USR` |
| `reporter_id` | ref | no | **no (readonly)** | no | the adapter must NOT send it |
| `project_id` | ref | yes(!) | yes | no | `ref: PRJ`, the scope parent — **see Risk (b): cases need a project to create** |

`comment` (prefix `CMT`, `scope_parent = ["subject_id"]`) — `migrations/0009_case_family.sql:9-16`:
| field | kind | required | settable | editable | notes |
|---|---|---|---|---|---|
| `subject_id` | ref | yes | yes | **no (set-once)** | the case id the comment hangs off |
| `author_id` | ref | no | **no (readonly)** | no | engine-owned; do NOT send |
| `body` | text | yes | yes | yes | the comment text |
| `visibility` | enum | no | yes | yes | default `internal` |
| `reply_to_id` | ref | no | yes | no | optional thread parent |

## Acceptance criteria (numbered — tests map 1:1 to these)
- **AC-1 (resilience — start + health):** a checked-in start script (`numu/tools/cases-backend/start.sh` or
  equivalent) brings the chosen case backend up with the correct `DATABASE_URL`/`NUMU_BIND` and blocks until
  `GET /readyz` (numu, `lib.rs:128`) returns 200 within a bounded timeout, else exits non-zero. A companion
  `health.sh` returns 0 iff `GET /readyz` is 200. **Testable:** run `start.sh` against a scratch DB → exit 0
  and `health.sh` → 0; kill the process → `health.sh` → non-zero.
- **AC-2 (resilience — supervision):** the backend is registered under a supervisor that restarts it on crash
  AND on host reboot (systemd user unit `numu-cases.service` with `Restart=on-failure` + `WantedBy`, or a
  pm2 ecosystem entry with `--restart`). **Testable:** `kill -9` the PID → the supervisor brings it back and
  `health.sh` → 0 within the restart window; the unit is `enabled` (survives reboot). The unit file /
  ecosystem file is checked in under `numu/tools/cases-backend/`.
- **AC-3 (config — MCP repoint):** the `redpash-slack` block in `~/.claude.json` has `REDPASH_API_BASE` set
  to numu's base (`http://127.0.0.1:<numu-port>/api`), OR a parallel `numu-cases` MCP entry is added (Em's
  call — Risk (d)). The chosen numu port is explicit and does NOT collide with a still-running RedPash on
  `:8080` (Risk (f)). **Testable:** the `.claude.json` `redpash-slack`/`numu-cases` env shows the numu base;
  a documented note records that this is a `.claude/` self-mod (Em-approval) effective NEXT session.
- **AC-4 (seed — open cases present):** a `seed-cases` step issues one `case_create` per open case at its
  current status into the chosen backend, mapping RedPash priority values to numu's enum
  (`medium→normal`, `critical→urgent`), and setting `origin:"agent"`. The on-disk numu cases to consider are
  `docs/cases/0001–0017` with these statuses (read from each header):
  - `done`: 0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0011
  - `in_review`: 0012, 0013, 0014, 0016
  - `backlog`: 0015, 0017
  Plus the 22 cases in RedPash's DB (the four session cases `CAS_9E9069EF`, `CAS_A6AF92`, `CAS_428EE9C6`,
  `CAS_62572E8F` are `in_review`). The done-vs-skip decision for the 0001–0011 `done` ones is Risk (b);
  default recommendation: **skip the `done` numu docs-cases** (they are historical, already mirrored on disk)
  and seed only the in-flight ones (`in_review` + `backlog`), advancing each to its status via the legal
  transition chain (a numu case must be *created* at `backlog`, then PATCHed forward — see AC-5).
  **Testable:** after seeding, a `GET /api/objects/case` (via the MCP `case_list`/the adapter) returns the
  seeded cases, each at its expected status; re-running the seed is idempotent (no duplicates — keyed on a
  stable external id or title, see AC-6).
- **AC-5 (seed — status walked legally):** because numu rejects a create at a non-`initial` status
  (`objects.rs:430-439`) and rejects status skips (`422 illegal_transition`), the seed walks each case from
  `backlog` along the legal chain `backlog→todo→in_progress→in_review→done` to its target status, fetching
  the current `etag` before each PATCH and sending it as `If-Match` (numu requires it). A target of `done`
  additionally requires the workflow `close_checks` (`docs_reconciled`) to pass or the move is
  `422 close_preconditions_unmet` (`objects.rs:137-147`) — the seed must record the close-check
  (`POST /api/objects/case/:id/checks/docs_reconciled`, per CASE 0006 G4.2) before moving to `done`, or stop
  the seeded `done` cases at `in_review`. **Testable:** a case seeded to `in_review` shows `in_review`; a
  `done` seed either reaches `done` (with the check recorded) or stops at `in_review` with a logged reason —
  never a 422 left unhandled.
- **AC-6 (the repoint adapter):** `cases.js` (or a thin `cases-numu.js` adapter selected by an env flag) maps
  each MCP tool to numu's generic-object surface per the table in "API contracts" below:
  base-URL → numu; create/patch send the **bare field object** (no `{data}` wrapper on the request);
  responses are unwrapped from `{id,type,data,version,etag}` back into the MCP's expected `Case`/`CaseDetail`
  shape; `case_comment` → `POST /api/objects/comment {subject_id, body}`; `case_set_status` → fetch the
  case's current etag (`GET /api/objects/case/:id`), then `PATCH /api/objects/case/:id {status}` with
  `If-Match: W/"<version>"`; auth uses the `numu_session` cookie minted from `POST /auth/dev-login` and the
  Set-Cookie regex matches `numu_session=` (not `rp_session=`). **Testable:** a unit/shape test (numu's
  `web/tests/*.mjs` style, `ci.sh:31`) asserts each tool produces the documented numu request and parses the
  numu response into the MCP shape; the 401→re-mint retry path uses the numu dev-login URL.
- **AC-7 (verification — round-trip):** a `case_create` → `case_get` → `case_comment` → `case_set_status`
  round-trip *through the MCP* against the chosen backend returns the MCP-expected shapes at each step; the
  open cases appear with correct statuses; the on-disk `docs/cases/` mirror matches the seeded set; **no
  credentials (cookie/token values) appear in any log line** (the bridge logs URLs/statuses, never the
  cookie); and `tools/ci.sh` is green for any adapter code (clippy/test for Rust touched, `js shape tests`
  for the adapter — `ci.sh:23,27,31`).

## API contracts (exact — no guessing) — per-tool mapping table
All paths are relative to `REDPASH_API_BASE = http://127.0.0.1:<numu-port>/api`. Cookie header on every call:
`Cookie: numu_session=<token>`; `Content-Type: application/json` on bodies.

| MCP tool | numu request | numu response → MCP shape |
|---|---|---|
| `case_create(args)` | `POST /objects/case` body = **bare** `{title, description?, type?, priority?(mapped), assignee_id?, project_id, status:"backlog", origin:"agent"}` (omit `workflow_id`, `reporter_id`) | `201 {id, type:"case", data, version:1, etag}` → `{redpash_id:id, ...data, status, version}` |
| `case_get(rid)` | `GET /objects/case/:rid` | `200 {id, data, version, etag}` → `CaseDetail` row. **Comments thread:** numu has no nested feed; fetch `GET /objects/comment?subject=:rid` is NOT a real param — list `GET /objects/comment` then filter client-side by `data.subject_id == rid`, OR use the relations/search surface. (Open item — see Risk (g).) |
| `case_list(args)` | `GET /objects/case?limit&offset` (numu `ListParams` only supports `limit`/`offset`, `objects.rs:342-346`) — RedPash's `status/assignee/project/q/page/size` filters are NOT supported; filter client-side or via `search::router()` (`/api/search`, `lib.rs:118`). | `200 {items:[{id,data,version}], limit, offset}` → `Case[]` |
| `case_comment(args)` | `POST /objects/comment` body = **bare** `{subject_id: rid, body}` (omit `author_id`) | `201 {id, data, version, etag}` → comment row |
| `case_set_status(args)` | (1) `GET /objects/case/:rid` → read `version`; (2) `PATCH /objects/case/:rid` body = `{status}` header `If-Match: W/"<version>"` | `200 {id, data, version, etag}` → updated `Case`. `422 illegal_transition` on a skip; `412/428` on If-Match mismatch/missing — surface as the MCP error. |
| auth (internal) | `POST /auth/dev-login` (debug build only) → `Set-Cookie: numu_session=<token>` | cache `<token>`; regex `numu_session=([^;,\s]+)` |

Migrating to a non-debug numu requires a real session/token instead of dev-login — see Risk (c).

## Scope boundaries
- **In:** the resilience scripts + supervisor unit (AC-1/2); the `cases.js` repoint adapter + its shape test
  (AC-6); the `~/.claude.json` env change (AC-3, Em-gated); the seed step (AC-4/5); verification (AC-7).
- **Out:** the `slack_*` filesystem tools (untouched); any change to numu's Rust handlers (the engine is
  already built — CASE 0006); rewriting RedPash's `/api/cases` routes; the GCP-HA ops layer build-out
  (CASE 0016 covers that — this spec only *chooses where the supervisor lives*, Risk (e)).
- **Reuses:** numu's generic object handler (`objects.rs` — no new route), the existing `cases.js`
  fetch/retry/mint scaffolding (`cases.js:97-161` — only the base/paths/cookie-name/body-shape change), numu
  `/readyz` (`health.rs`), the workflow transition engine (`workflow.rs`), and the existing
  `web/tests/shapes.test.mjs` harness pattern for the adapter shape test.

## Risks / open questions for Em (Checkpoint 1)
- **(a) Backend choice.** Recommend **repoint-to-numu** (goal 2 — consolidate onto one engine; "we created
  the objects now"). Trade-off: numu's case API is the generic-object shape (bare-body request, `{data}`
  response envelope, `If-Match` required, `numu_session` cookie), so it needs the adapter in AC-6 — but it
  retires the second backend. Alternative **keep-RedPash-but-supervise** needs no adapter (AC-1/2 alone fix
  the outage) but leaves two case backends and two sources of truth. **both** = transitional only. Pick one.
- **(b) Seed scope + the project_id requirement.** numu `case.project_id` is **required** (`0007:34`), so
  every seeded case needs a `PRJ` parent — is there a canonical project to seed under, or do we create one
  (e.g. `PRJ_numu`)? And which cases: all 17 docs-cases + the 22 RedPash DB cases, or just the in-flight ones
  (recommended: skip the 11 `done` docs-cases, seed the 6 in-flight numu + the 4 `in_review` session cases)?
  Do the RedPash DB cases **migrate** into numu or stay in RedPash?
- **(c) numu auth for the MCP.** `dev-login` is `#[cfg(debug_assertions)]` (`auth.rs:115`) — it only exists in
  a debug build. Is the supervised numu run in debug? If prod, the MCP needs a real long-lived session/token
  (`mint_session` issues a 30-day cookie, `auth.rs:48-64`) provisioned out-of-band and pinned via
  `REDPASH_API_SESSION` — decide the credential story before flipping to a release build.
- **(d) The `.claude.json` change.** This is a `.claude/` self-modification (Em-approval) and takes effect
  only NEXT session (the MCP loads at Claude Code startup). Repoint the existing `redpash-slack` env, or add a
  parallel `numu-cases` MCP entry alongside (so RedPash's bus stays available during transition)?
- **(e) Where the supervisor lives.** Dev box (a systemd *user* unit on this WSL/Linux host) for now, or fold
  into the GCP-HA ops layer from CASE 0016? Recommend the dev-box user unit now; track the prod home under
  CASE 0016.
- **(f) Port collision.** Both RedPash and numu default to `:8080`. If both run during transition they
  conflict — set numu `NUMU_BIND` to a distinct port (e.g. `127.0.0.1:8090`) and reflect it in
  `REDPASH_API_BASE`.
- **(g) Comment-thread read.** RedPash's `case_get` returns a nested comments thread + activity feed; numu has
  no nested feed on the case object. The adapter must assemble the thread by listing `comment` objects and
  filtering by `subject_id` (or via `/api/search`), and map numu's `events` rows to the activity feed.
  Confirm the acceptable fidelity of `CaseDetail` (full thread vs. case-row only) for v1.
