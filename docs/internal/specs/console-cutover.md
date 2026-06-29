# Spec: Console cutover — wire the Rethink Console live as the served `numu App.dc.html`
Case: CAS_ba8f690de09447fd939202ff11100bfa  ·  type: feature  ·  area: web/ (frontend — NO `crates/` change)

## Problem / intent

The canonical product UI already exists: `Datacore Design System Rethink/numu Console.dc.html` (2,421
lines) is the **Rethink Console** — component-decomposed (`WorkspaceRail`/`TopBar`/`SidePanel`/`Chart`/
`NotBuilt`) and already implementing the **UILogic context-switch model** (an invariant rail + a Header/
Thread/Composer that morph per channel + ONE typed-message renderer). What it is NOT is *live*: its inline
controller reads entity data from `window.NUMU_DATA` (`numu-data.js`) and persists the feed to
`localStorage` (`persistFeed`/`loadFeed`). This cutover **brings the Rethink Console + its 6 components into
`web/` as the served app and grafts it to the live `/api` seam** — repointing its inline controller off the
fixtures/localStorage and onto `makeClient("auto")`. The R0–R3 proofs in `web/` are the **seam/dispatch
reference** the graft reuses, not a scaffold to build on. Full Console parity in ONE milestone (Em);
surfaces whose backend isn't built ship as visible "coming soon" stubs (no dead controls).

## Decisions taken (Em — encode as FIXED, not open)

- **The App IS the Rethink Console wired live** — NOT a new file built on the R-spine harvesting the OLD
  Console. Bring `Datacore Design System Rethink/numu Console.dc.html` + its 6 components
  (`WorkspaceRail`/`TopBar`/`SidePanel`/`Chart`/`NotBuilt`/`PivotTable`) into `web/`; **graft the live seam
  by repointing the Console's INLINE controller** off `NUMU_DATA`/localStorage-feed onto the seam.
- **Served entrypoint = `web/numu App.dc.html`** (the wired Rethink Console under that name). Old Datacore
  Console + the R0–R3 proof pages move to `web/_archive/` at the END (orchestrator default for open (g)).
- **Reuse `web/numu-shell.js`, don't fork it.** The repo `web/numu-shell.js` is the shared theme/token/
  registry/nacl-lexicon runtime and is export-identical to the Rethink-folder copy; if the Console's inline
  controller needs a helper the repo copy lacks, ADD it to the repo copy (single source of truth — never
  ship a second shell.js). The hazard the brief flagged is real but the conflicting artifact is
  `numu-data.js` + the inline localStorage-feed, NOT `numu-shell.js` (orchestrator default for open (f)).
- **Reuse the live seam `web/numu-data-client.js`** (already present) — its 10 methods + `isLive` are the
  whole data plane. **CALL `window.NUMU_NACL` only; MUST NOT edit `web/numu-nacl-engine.js`** — Case 0019
  owns it; the file stays byte-identical through this Case.
- **Full parity in one cutover** (not a lean MVP). Gated surfaces → visible "coming soon" stubs.
- Served **same-origin** (`ServeDir`/`NUMU_WEB_DIR`) — the `SameSite=Lax` cookie just works (ADR 0002).
- **Gated → stub:** connector OAuth/sync, profile security (MFA/sessions/tokens), server-side prefs, the
  nacl step-PERSIST route (`project_steps` table EXISTS — migration 0017 — but there is NO append route,
  so the recipe stays session-local + disclosed). Each gated piece is its own future backend Case.

## Backend prereqs — CONFIRMED LIVE (port landed; the Rethink docs were stale/pessimistic)

The §5b compile-map writes hit routes that EXIST. No `crates/` change is required by any AC.

- Router (`crates/api/src/lib.rs:138–166`): objects+members, types, relations, search, orchestrator,
  connectors, files, conversations, auth, oauth, debug, health all merged; same-origin `ServeDir`/
  `NUMU_WEB_DIR` fallback.
- Migration **0016_data_app_catalog.sql** — registers `file`/`chart`/`dashboard`/`message` +
  `attachment.kind`; adds `context_view` to `type_definitions` (closed CHECK set incl. thread/board/table/
  chart/dashboard/media/collection/calendar/preview/record/map); extends `project` with `origin`+`case_id`;
  adds field render-`role`s + `data_class`. (project→thread, case→board, attachment→preview.)
- Migration **0017_project_files.sql** — typed `project_files` projection + the `project_steps` recipe
  table (ordinal · kind · params · cleanness). **The recipe table EXISTS; there is NO `POST /api/project_steps`
  append route** (only `files.rs` `POST /api/files` via sealed `pipeline::upload_csv`). → step-PERSIST GATED.
- `conversations.rs:19–20`: `GET /api/conversations/:id/feed?lens=` LIVE (reach+visibility filtered;
  `all|customer|mine`; 400 on bad lens).
- `files.rs:18–19`: `POST /api/files` LIVE (multipart → `UploadOutcome` via `pipeline::upload_csv`).
- `search.rs:21–22`: `GET /api/search` LIVE.
- `members.rs:30–35`: members + `POST /:type/:id/checks/:name` (case close-checks) LIVE.
- `connectors.rs:22–23`: `POST /api/connectors/:id/run` LIVE (the http_json `run` path).
- **Generic CRUD** (`objects::router` on `/api/objects/:type`) serves `POST/PATCH` for any registered type —
  so `POST /api/objects/chart|dashboard|message|attachment` and `PATCH /api/objects/case/:id` all EXIST
  (chart/dashboard/message/attachment registered in 0016). The §5b writes are generic POSTs/PATCHes; no
  per-type endpoint is needed.

**GATED (genuinely not built) → ship as "coming soon" stubs or disclosed session-local behavior:**
step-append/persist route (`project_steps` exists, no write route); connector OAuth/sync (only http_json
`run` is live); profile security backend (MFA/sessions/tokens); server-side preference/pin sync (pins +
channel grouping stay localStorage "this device"); the gmail send-run on `reply:email`.

## Verification-path tags (each AC names its tag)

> `[JS-UNIT]` = a Node assertion over the seam/client logic — extend `web/tests/shapes.test.mjs` (loads the
> client IIFE in Node, monkeypatches `_get`/`_send`); runs in `tools/ci.sh`'s node gate. Pure-JS contracts only.
> `[LIVE]` = the live e2e probe (`tools/e2e-0013.sh` against a running server) + curl; backend-observable.
> `[MANUAL-E2E]` = a documented manual browser flow for UI parity that can't be headless-asserted cheaply.
> `[REVIEW]` = code-inspection (no automated assertion).
>
> Most parity ACs are `[MANUAL-E2E]`/`[REVIEW]`; the automatable ones are seam-shape (`[JS-UNIT]`) + the
> existing e2e (`[LIVE]`). **Do NOT invent cargo tests.** NEVER `cargo test --features db-tests` (OOMs — Case 0012).

## Acceptance criteria (numbered — the tester maps one test/check 1:1 to each)

### Group A — The Rethink Console in `web/` + the live seam (GRAFT)

- **AC1 — the Rethink Console + its 6 components are in `web/`, served as `numu App.dc.html`, loading the
  EXISTING seam + runtime** `[REVIEW]`: `Datacore Design System Rethink/numu Console.dc.html` and its
  components (`WorkspaceRail`/`TopBar`/`SidePanel`/`Chart`/`NotBuilt`/`PivotTable`) are brought into `web/`;
  the served file is `web/numu App.dc.html`. It loads the EXISTING `web/numu-data-client.js` (seam), the
  EXISTING `web/numu-shell.js` (shared runtime — **reused, not forked**), and `web/numu-nacl-engine.js`
  (**call-only**, via `window.NUMU_NACL`), plus `Chart`. It instantiates the data client with
  `window.NUMU_CLIENT.makeClient("auto")`. The component decomposition (`dc-import`) is preserved.

- **AC2 — the Console's inline controller is repointed off the fixtures/localStorage onto the seam**
  `[REVIEW]`: every read/write goes through the seam methods `types · options · list · get · create ·
  update · feed · conversations · upload · run` (+ `isLive`). The inline controller no longer reads
  `window.NUMU_DATA`/`TENANTS` for entity data, and the feed no longer goes through `persistFeed`/`loadFeed`
  (the `localStorage.setItem("numu.feed.…")` path). No `fetch(`/`XMLHttpRequest` literal and no
  `numu-data.js` entity access. (Pins/channel-grouping localStorage is the one allowed "this device"
  client-state exception — see AC15/AC22.)

### Group B — The invariant rail + the morphing regions (the UILogic model)

- **AC3 — the rail is the INVARIANT context navigator; picking a channel morphs EXACTLY three regions**
  `[MANUAL-E2E]`: the `WorkspaceRail` lists live conversations from `client.conversations()` grouped by
  system/channel (channels grouped by their `channel` field, color-coded by type), each row showing the
  origin icon (`email→envelope`, `case→kanban`, `manual→chat-square-text`, `connector→plug`). Selecting a
  channel morphs EXACTLY three regions — Header (`TopBar`), Thread (the feed), Composer (`SidePanel`) — and
  NOTHING else (the rail stays put: that is the invariant). Empty/zero conversations renders an empty-state,
  not a throw.

- **AC4 — `conversations()` returns the flat projection shape the rail consumes** `[JS-UNIT]`: extend
  `shapes.test.mjs` to assert `HttpClient.conversations()` over a canned `GET /api/objects/project` envelope
  returns `[{id,title,origin,channel,status}]` — `title = data.title||data.name`, `channel =
  data.channel_group || "Clients"`, and a null `data` yields a sane row (not a throw).

### Group C — Feed (the ONE typed-message renderer) + lens

- **AC5 — the Thread is ONE typed-message renderer dispatching on message type** `[MANUAL-E2E]`: the Thread
  region renders `client.feed(convId,{lens})` items through a SINGLE renderer that dispatches on the
  message/block type into: `text`/`sms` (chat bubble, in/out align), `audio` (waveform), `file`/`csv`
  (attachment card + "Open in data workspace" → AC8), `youtube`, `call`, `email` (full card),
  `comment`/`checks`/`event` (case thread line), `datacmd`/`data` (qir command line + live datatable). Maps
  to the seam feed's `kind`+`data`. No type renders blank — an unknown type falls back to a plain text block.

- **AC6 — the lens toggle re-filters the feed leak-free** `[MANUAL-E2E]`: the `Everything / Customer / My
  work` toggle calls `client.feed(convId,{lens:"all"|"customer"|"mine"})` and re-renders; the lens is a
  server-side `WHERE` on `visibility` (the backend filters — the client passes `?lens=`), so an internal
  note disappears under `Customer`. (feed contract: `GET /api/conversations/:id/feed?lens=`,
  conversations.rs:20.)

### Group D — Context-panel archetypes (11, by `context_view`)

- **AC7 — the `SidePanel` context renderer dispatches on the entity type's `context_view`** `[MANUAL-E2E]`:
  opening any entity resolves `Promise.all([client.options(type), client.get(type,id)])` and renders the
  panel chosen by `options.contextView` — covering all 11 archetypes: `thread`+`record` → record list,
  `board`, `table` (file `columns_meta`), `chart` (`spec.cats`+`chart_type` via `Chart`), `dashboard` (tile
  `chart_id`s resolved to charts), `media`, `collection`, `calendar`, `preview`. No archetype renders blank
  — an unknown `context_view` falls back to `record`. (R2 dispatch :249–252 + R3 openArtifact :152–156 are
  the reference.)

- **AC8 — feed artifact cards open the correct archetype** `[MANUAL-E2E]`: clicking a `file`/`csv` card
  opens the `table` archetype (its `columns_meta`); clicking a `chart` card opens the `chart` archetype (its
  `spec`). The Header (`TopBar`) shows `context_view` as the archetype tag. (No new renderer — reuses AC7's
  dispatch.)

### Group E — Composer (the morphing region) + the §5b compile-map binding

- **AC9 — the Composer is the morphing region; nacl lines bind per the §5b compile map** `[MANUAL-E2E]`:
  the Composer lives in the morphing region (`SidePanel`); typing a nacl line and submitting routes it
  through the §5b composer data-binding contract (Group E2 below). The composer chrome is the Rethink
  Console's composer (try-chips + channel picker + input + send), wired to the seam paths.

- **AC10 — nacl ops CALL the existing engine, session-local + disclosed; zero engine edits** `[MANUAL-E2E]`
  `[REVIEW]`: nacl ops run via `window.NUMU_NACL.parseOp` on `activeData` (the call-only engine). A
  persistent **disclosure** affordance states nacl runs are **session-local / not persisted** (step-PERSIST
  is GATED — `project_steps` exists, no append route). `[REVIEW]`: the diff contains **zero edits to
  `web/numu-nacl-engine.js`** — it is byte-identical to the branch baseline (see the invariant in Contracts).

### Group E2 — §5b compile-map (the composer data-binding contract — NEW)

> Each AC binds one row of the §5b nacl→backend compile map (`numu-app-update-plan.md` §5b). The DSL stays
> frontend; each line compiles to generic CRUD / upload / run. See the contract section in API contracts.

- **AC9a — `open:csv <name>` → upload via the seam** `[MANUAL-E2E]`: typing `open:csv dossier` (Enter) calls
  `client.upload(file, project, tld)` (`POST /api/files`, multipart) and pushes a `file`/`csv` block built
  from the returned `UploadOutcome` (`filename`/`cleanness`/`columns`); on failure it pushes an
  internal-note error block (`.catch`), never a silent throw.

- **AC9b — `clean`/`cast`/`rename`/… → client step, session-local (persist GATED)** `[MANUAL-E2E]`
  `[REVIEW]`: a cleaning verb computes client-side via `window.NUMU_NACL.parseOp` on `activeData` and pushes
  a `step` block; the recipe is **session-local + disclosed** — it is NOT persisted (no `project_steps`
  append route; step-PERSIST GATED). `[REVIEW]`: confirms no persist call is made (no fabricated route).

- **AC9c — `chart`/`pivot`/`group`/`sort` → client compute; `chart` → POST chart** `[MANUAL-E2E]` `[LIVE]`:
  `group`/`sort`/`pivot` compute read-only client-side (via `PivotTable`/client compute); `chart` computes
  client-side AND calls `client.create("chart", spec)` (`POST /api/objects/chart`), then pushes a chartblock
  rendered via `Chart`. `[LIVE]` confirms a `chart` create round-trips against the seeded server.

- **AC9d — `new:dashboard` → POST dashboard; `new:pdf`/`new:deck` → render + POST attachment** `[MANUAL-E2E]`
  `[LIVE]`: `new:dashboard` calls `client.create("dashboard", {…})` (`POST /api/objects/dashboard`);
  `new:pdf`/`new:deck` render client-side and call `client.create("attachment", {kind:"report", …})`
  (`POST /api/objects/attachment`). `[LIVE]` confirms a dashboard create round-trips.

- **AC9e — `reply:email`/`note`/`close:case` → message/PATCH per §5b (sends + close-gate)** `[MANUAL-E2E]`
  `[LIVE]`: `reply:email … body:"…"` calls `client.create("message", {direction:"out", channel:"email", …})`
  (`POST /api/objects/message`) [the gmail SEND run is GATED until the connector is wired — disclose];
  `note "…"` calls `client.create("message", {channel:"note", visibility:"internal", …})`; `close:case`
  calls `client.update("case", id, {status:"done"}, version)` (`PATCH /api/objects/case/:id`) → the
  `cases_guard` close-gate returns `422` if the three checks are unmet (surfaced, not swallowed). `[LIVE]`
  confirms a `note` create + a `close:case` (gated when checks unmet) round-trip.

### Group F — Create / edit forms + If-Match (reuse R1 + BUILD conflict UX)

- **AC11 — create/edit forms render from field metadata (`field.kind` + `options.role`)** `[MANUAL-E2E]`: the
  form for any type is built from `client.options(type).fields` filtered to `editable`, mapping each
  `field.kind` to a DS input — `enum→Select` (from `options.enum`), `bool→Checkbox`, everything else (incl.
  `int→type="number"`) → `Input`; create pre-fills `options.default`s. No per-type code. (R1 :135, :165–180,
  :120–124 is the reference.)

- **AC12 — create POSTs and edit PATCHes with `If-Match`** `[MANUAL-E2E]` `[LIVE]`: Save in create mode
  calls `client.create(type, draft)` (`POST /api/objects/:type`); Save in edit mode calls
  `client.update(type, id, draft, selected._version)` which sends `If-Match: W/"<version>"`. `[LIVE]`
  confirms a create then an edit round-trips against the seeded server.

- **AC13 — a stale-version edit surfaces a conflict, not a silent throw (BUILD)** `[MANUAL-E2E]`: when
  `update()` rejects with a `412`/`428` (the seam's `_send` throws `Error("412 …")`/`"428 …"`), the form
  shows a non-dismissable conflict affordance ("This record changed since you opened it — reload to see the
  latest" with a Reload action that re-`get`s and re-opens the form). A 412 (If-Match mismatch) and a 428
  (If-Match required but absent) both map to this UX. NET-NEW. See the If-Match conflict-UX contract.

### Group G — Objects tree (the Rethink tree region)

- **AC14 — the objects tree renders projects, channels, and pinned items from live data** `[MANUAL-E2E]`:
  the Rethink Console's objects-tree region (overview items, channel groups, project rows with pin/menu,
  object-type rows with counts, hidden section) is fed by `client.conversations()` (projects) +
  `client.types()`/`client.list()` (object-type counts). No Console fixtures.

### Group H — Settings (the Rethink settings region, client-side)

- **AC15 — settings renders theme/density/i18n/nacl-dialect/notifications, labelled "this device"**
  `[MANUAL-E2E]`: the Rethink Console's settings region (appearance/theme/density/accent/tone, language
  grid, objects-panel toggles, nacl-dialect editor, palette specimen, notifications toggles) is wired to
  `numu-shell.js` registries (theme/token/dialect runtime) + localStorage. A clear "this device" /
  client-side label states prefs are NOT server-synced (server-side prefs GATED). Theme/dialect changes take
  effect live via the shell runtime.

### Group I — Profile (the Rethink profile region; security GATED)

- **AC16 — profile renders identity, memberships, and recent activity from live data** `[MANUAL-E2E]`:
  identity card + identity schema from the caller; memberships from `members.rs` (the caller's workspace
  memberships); recent activity from `events`. (The Rethink Console's profile region.)

- **AC17 — profile security is a "coming soon" stub** `[MANUAL-E2E]` `[REVIEW]`: the security section
  (MFA/sessions/tokens) renders a visible "coming soon" affordance (the `NotBuilt` component) — informative,
  no dead toggle/button. (Security backend is GATED → its own future Case.)

### Group J — Connectors (the Rethink connectors region; OAuth/sync GATED)

- **AC18 — the connectors catalog renders from live `connector` objects; `run` works for http_json**
  `[MANUAL-E2E]` `[LIVE]`: the Rethink connectors region lists `client.list("connector")`; the detail
  panel's Run/Sync action for an http_json connector calls `client.run(id, args)` (→ `POST
  /api/connectors/:id/run`). `[LIVE]` confirms a run against the seeded server.

- **AC19 — connector OAuth/sync flows are "coming soon" stubs** `[MANUAL-E2E]` `[REVIEW]`: Connect (OAuth)
  and scheduled-sync flows render the `NotBuilt` "coming soon" affordance with no dead control. Catalog read
  + http_json run remain live; OAuth/sync are GATED.

### Group K — Case-gate (the Rethink board archetype)

- **AC20 — the case three-check close-gate works against the live checks API** `[MANUAL-E2E]` `[LIVE]`: a
  `case` entity in the `board` archetype shows the status stepper and the three close-checks; recording a
  check calls `POST /api/objects/case/:id/checks/:name` (members.rs:35) and the close transition fires only
  when all checks pass. `[LIVE]` confirms a check record + close round-trips. (This is the `close:case` gate
  also exercised by AC9e.)

### Group L — Search (BUILD)

- **AC21 — global search queries the live search API and routes to results** `[MANUAL-E2E]` `[LIVE]`: the
  `TopBar` search calls `GET /api/search?q=<term>` and renders `results:[{entity_id,type,title,rank}]`
  (search.rs:78–85); clicking a result opens that entity in its archetype (AC7). An empty `q` is not sent
  (the backend 400s on blank — search.rs:47). `[LIVE]` confirms a search returns reach-filtered results.

### Group M — Notifications → "open as project" CTA (BUILD)

- **AC22 — a notification promotes to a project via create** `[MANUAL-E2E]`: the notification CTA "open as
  project" calls `client.create("project", {…})` and selects the new conversation in the rail. (Feed events
  are live; promotion = a project create — no new backend.)

### Group N — Error / offline layer (BUILD — the net-new core)

- **AC23 — every seam call has a `.catch` that surfaces a problem, not a console-only throw**
  `[MANUAL-E2E]` `[REVIEW]`: reads and writes that reject render a user-visible error affordance (inline or
  toast) carrying the failure; no unhandled promise rejection leaves the UI in a half-rendered state. (The
  Rethink Console's inline controller had no live error path — net-new.)

- **AC24 — the live/offline state is prominent; writes disable when offline (BUILD)** `[MANUAL-E2E]`: a
  prominent connection indicator reflects `client.isLive()` (green live / muted offline). When `isLive()`
  resolves false (FixtureClient fallback), all WRITE affordances (create/edit/save, upload, run,
  check-record, notification-promote, the §5b compile-map writes) are disabled or clearly marked read-only;
  reads still render off the fixture fallback. See the offline contract.

### Group O — Gated-stub uniformity (BUILD)

- **AC25 — all gated surfaces use ONE consistent "coming soon" affordance, with no dead controls**
  `[REVIEW]` `[MANUAL-E2E]`: connector OAuth/sync (AC19), profile security (AC17), server-side prefs (AC15
  label), nacl step-persist (AC9b/AC10 disclosure), the gmail send-run (AC9e) each render the SAME visible
  coming-soon component — never a button/toggle that silently no-ops. The Console's `NotBuilt` component is
  the model.

### Group P — Archive old Console + R0–R3 proofs (CLEANUP — at the END)

- **AC26 — the old Datacore Console + R0–R3 proofs move to `web/_archive/` once parity lands** `[REVIEW]`:
  at the end of the build, the prior `numu Console.dc.html` (the old fixtures build, if present in `web/`)
  and the R0–R3 proof pages (`R0 Seam.dc.html`, `R1 Fields.dc.html`, `R2 Archetypes.dc.html`,
  `R3 Shell.dc.html`) are relocated under `web/_archive/` (kept as reference, not deleted); the served app is
  `web/numu App.dc.html` (the wired Rethink Console).

## API contracts (exact — no guessing; cited to source)

### The seam — the 10 methods + `isLive` the App consumes (`web/numu-data-client.js`)
The App talks to `window.NUMU_CLIENT.makeClient("auto")` → `AutoClient` (probes `/api/health`; delegates to
`HttpClient` live, `FixtureClient` offline). Methods (HttpClient impls cited):
- `types() → [{type,idPrefix,displayName,displayNamePlural,contextView,scopeParents,fields}]` — `GET /api/types`,
  via `mapType()` (client.js:288–291, :272–282).
- `options(type) → <camel type descriptor incl. fields>` — `GET /api/types/:type`, `mapType()` (:292–295).
- `list(type, {query,limit,offset}) → {rows:[<flat entity>], total}` — `GET /api/objects/:type?q=&limit=&offset=`,
  `flatten()` per item (:297–304). `total` is the PAGE count.
- `get(type, id) → <flat entity>` — `GET /api/objects/:type/:id`, `flatten()` (:305).
- `create(type, data) → <flat entity>` — `POST /api/objects/:type`, `flatten()` (:306).
- `update(type, id, patch, version) → <flat entity>` — `PATCH /api/objects/:type/:id` with
  `If-Match: W/"<version>"` (:307, `_send` :308–312).
- `conversations() → [{id,title,origin,channel,status}]` — `GET /api/objects/project?origin=…` (:314–325).
- `feed(convId, {lens,limit,offset}) → {conversation,lens,items:[{id,kind,at,visibility,author,data}],…}` —
  `GET /api/conversations/:id/feed?lens=` (conversations.rs:20; client.js:326–330).
- `upload(file, project, tld) → UploadOutcome {rid,filename,encoding,cleanness,fully_null_rows,size_bytes,
  columns}` — multipart `POST /api/files` (files.rs:19; client.js:331–339).
- `run(id, args)` — `POST /api/connectors/:id/run` (connectors.rs:23). Live impl is the http_json path.
- `isLive() → Promise<boolean>` — resolves the `/api/health` probe (AutoClient :367).
`flatten()` (:261–269): `{id,type,data,version,etag} ⇒ {id,type,…data,_version:String(version)}` (`_version`
is a STRING). `mapType()` (:272–282): snake type descriptor ⇒ camel; `fields` (incl. `options.role`) pass through.

### §5b composer data-binding contract (nacl line → backend effect) — `numu-app-update-plan.md` §5b
The nacl DSL stays frontend; each composer line compiles to a generic CRUD / upload / run via the seam. The
backend never learns nacl — it just receives entities. (Source table: `numu-app-update-plan.md` §5b,
lines 265–281.)

| nacl line | seam call → backend effect | gate |
|---|---|---|
| `open:csv <name>` | `client.upload(file,project,tld)` → `POST /api/files` (multipart) → `UploadOutcome`; rows ingest into client GlueSQL | LIVE |
| `clean` / `cast` / `rename` / … | `window.NUMU_NACL.parseOp` client compute → `step` block; recipe **session-local + disclosed** | step-PERSIST GATED (`project_steps` exists, no append route) |
| `group` / `sort` / `pivot` | read-only client compute (`PivotTable`/client) | LIVE (no write) |
| `chart` | client compute → `client.create("chart", spec)` → `POST /api/objects/chart`; render via `Chart` | LIVE |
| `new:dashboard` | `client.create("dashboard", {…})` → `POST /api/objects/dashboard` (+ relations/layout to its charts) | LIVE |
| `new:pdf` / `new:deck` | render client-side → `client.create("attachment", {kind:"report", …})` → `POST /api/objects/attachment` | LIVE |
| `reply:email … body:"…"` | `client.create("message", {direction:"out", channel:"email", …})` → `POST /api/objects/message` (+ gmail send run) | message LIVE; **send-run GATED** |
| `note "…"` | `client.create("message", {channel:"note", visibility:"internal", …})` → `POST /api/objects/message` | LIVE |
| `close:case` | `client.update("case", id, {status:"done"}, version)` → `PATCH /api/objects/case/:id` → `cases_guard` close-gate (`422` if checks unmet) | LIVE (gate enforced) |

Every write above is the **generic handler** (`/api/objects/:type`), upload (`/api/files`), or connector run
(`/api/connectors/:id/run`) — all CONFIRMED LIVE. The only GATED pieces are the `project_steps` append route
(step-PERSIST) and the gmail send-run; both surface as the `NotBuilt` "coming soon" affordance / disclosure.

### `numu-shell.js` reuse-not-fork note
`web/numu-shell.js` is the shared theme/token/registry/nacl-lexicon runtime (`window.NUMU_SHELL`:
TONES/STATUS/CHART/buildVars/applyTheme/WORKSPACES/PAGES/NACL_LEX/…). It is export-identical to the
Rethink-folder copy. The App **reuses the repo copy as the single source**; if the Console's inline
controller references a shell helper the repo copy lacks, the missing helper is ADDED to
`web/numu-shell.js` — a second shell.js MUST NOT ship. The Rethink Console's App-controller logic (the
`setState` machine, the `render()` template, the §5b dispatch) lives INLINE in the `.dc.html` and is the
graft site, NOT shell.js.

### `project_steps` (migration 0017) — table exists, NO append route
The `project_steps` recipe table (ordinal · kind · params · cleanness) landed in 0017, but there is no
`POST /api/project_steps` (or equivalent) append/persist route wired in the router — only `files.rs`
`POST /api/files`. Therefore nacl cleaning steps (AC9b) compute client-side and stay **session-local +
disclosed**; the App MUST NOT fabricate a persist call. The step-PERSIST route is a future backend Case.

### Archetype dispatch contract (`context_view` → renderer) — R2/R3 reference
`options(type).contextView` selects the Context-Panel (`SidePanel`) renderer. The 11 context_views and their
renderers (R2 :249–252, R3 :269–272): `thread`→record · `record`→record · `board`→board(status lane) ·
`table`→table(`columns_meta`) · `chart`→chart(`Chart` over `spec.cats`+`chart_type`) · `dashboard`→grid of
`Chart` (resolve `spec.tiles[].chart_id` via `get("chart",…)`, R2 :188–192) · `media`→audio player ·
`collection`→cover+child list · `calendar`→date card · `preview`→post preview. Title is the field with
`options.role==="title"` (R2 titleOf :196). Unknown `context_view` → fall back to `record`.

### Create/edit form contract (`field.kind` + `options.role` → input) — R1 reference
Form fields = `options.fields.filter(editable)`. Per `field.kind`: `enum`→DS `Select` (options from
`field.options.enum`); `bool`→DS `Checkbox`; everything else→DS `Input`, `type="number"` when `kind==="int"`
(R1 :167–180). Create seeds defaults from `field.options.default` (R1 :120–124). View/list/title presentation
reads `options.role` (`title`/`subtitle`/`status`/`metric`) (R1 :150–151, :160–163).

### If-Match 412/428 conflict-UX contract (BUILD)
`update()` sends `If-Match: W/"<version>"` (seam `_send` :310). On the backend per HTTP.md: a version
mismatch → `412 Precondition Failed`; a required-but-missing If-Match → `428 Precondition Required`. The seam
surfaces these as a rejected promise `Error("412 …")` / `Error("428 …")` (`_send` :312 throws on `!r.ok`).
The App MUST: catch the rejection, detect `412`/`428` (the error message starts with the status), and render a
**conflict affordance** ("record changed since you opened it") with a **Reload** action that re-`get`s the
entity and re-opens the form on the fresh `_version`. Distinct from the generic error affordance (AC23): it
is recoverable and names the staleness.

### Gated-stub contract ("coming soon", no dead control) (BUILD)
Each gated surface (connector OAuth/sync, profile security, server-side prefs, nacl step-persist, gmail
send-run) renders ONE shared coming-soon affordance: visible, labelled "coming soon" (or equivalent), and
either informative-only or a disabled control with an explicit reason. NO affordance that looks interactive
but silently no-ops. The Rethink Console `NotBuilt` component is the model.

### Offline contract (disable writes when `!isLive()`) (BUILD)
The App resolves `client.isLive()` on mount. When false: (1) a prominent offline indicator; (2) ALL write
affordances disabled or read-only-marked — create/edit/save (AC12), upload + the §5b compile-map writes
(AC9a–AC9e), connector run (AC18), check-record (AC20), notification-promote (AC22). Reads still render off
the FixtureClient fallback so the UI is never blank. Open question (c): banner loudness.

### Invariant — NO `numu-nacl-engine.js` edits (CONCURRENCY)
`web/numu-nacl-engine.js` is owned by the nacl flow (Case 0019). The App only CALLS `window.NUMU_NACL`. The
file MUST remain byte-identical to the branch baseline through this Case. `[REVIEW]`: a reviewer confirms the
diff touches no line of `numu-nacl-engine.js`.

## Scope boundaries

- **In:** bringing the Rethink Console (`numu Console.dc.html`) + its 6 components into `web/` as the served
  `numu App.dc.html`; grafting the live seam by repointing the inline controller off `NUMU_DATA`/
  localStorage-feed onto the 10 seam methods; the invariant rail + three morphing regions (UILogic model);
  the ONE typed-message renderer; the 11-archetype `context_view` dispatch; feed/lens; R1-style forms; the
  §5b composer data-binding contract (AC9a–AC9e); the error/.catch + offline-disclosure layer, search, the
  notification "open as project" CTA, the 412/428 conflict UX, the uniform `NotBuilt` gated-stub; the
  `[JS-UNIT]` shape assertions in `web/tests/shapes.test.mjs`; archiving the old Console + R0–R3 to
  `web/_archive/` at the end.
- **Out (own Cases / later):** the `project_steps` append/persist route (nacl step-PERSIST); connector
  OAuth/sync; the gmail send-run; profile security backend; a server-side preference/pin type; ANY `crates/`
  change (this Case is frontend-only — flag any AC that would touch `crates/`); ANY edit to
  `web/numu-nacl-engine.js`; archetypes beyond the 11 (census: none).
- **Reuses (don't reinvent):** the Rethink Console `.dc.html` + its 6 components
  (`WorkspaceRail`/`TopBar`/`SidePanel`/`Chart`/`NotBuilt`/`PivotTable`); the seam's 10 methods +
  `flatten()`/`mapType()` (`numu-data-client.js`); `web/numu-shell.js` theme/token/dialect runtime (single
  source — reuse, don't fork); `window.NUMU_NACL` (call-only); the R0–R3 proofs as the seam/dispatch/forms
  REFERENCE (R3 feed map + rail grouping + openArtifact; R2 archetype dispatch + `titleOf`; R1 field→input +
  save-with-If-Match); the `NotBuilt` component for the gated stub; the `shapes.test.mjs` IIFE-in-Node
  harness for `[JS-UNIT]`.

## Risks / open questions for Em

- **(a) Multi-workspace switcher in v1, or single-workspace first?** The rail's top level is live `workspace`
  rows (seeded), and a workspace switch is a filter (not per-tenant code). Architect recommendation: ship
  single-workspace selection in v1 (filter the rail to the active workspace), defer a switcher chrome to
  polish — but confirm, since the Rethink Console chrome implies a switcher.
- **(c) How loud is the offline banner?** AC24 requires a prominent indicator + disabled writes. Architect
  recommendation: a persistent but non-modal top strip when offline (not a blocking overlay), so reads stay
  usable. Confirm the loudness.
- **(e) Search result → archetype open requires the result's `type` to be a registered archetype.** Search
  returns `{entity_id,type,title}`; AC21 opens it via AC7's dispatch. If a result's `type` lacks a
  `context_view` the dispatch falls back to `record` — acceptable? (Architect: yes, the record fallback is
  the safe default.) Confirm.

> Resolved by orchestrator defaults (no longer open): **(f)** REUSE `web/numu-shell.js` (single source — add
> any missing helper to it, don't fork); **(g)** served entrypoint = `web/numu App.dc.html` (the wired
> Rethink Console under that name), with the old Datacore Console + R0–R3 → `web/_archive/` at the END.
> Resolved earlier: **(b)** pins + channel grouping stay localStorage "this device" until a pref type lands;
> **(d)** the archive (AC26) happens in THIS Case as the final commit, after parity is verified.

## Process constraints (recorded for the build phase)

- **Frontend-only:** all changes live in `web/`. The case-first / docs-currency gates fire ONLY if `crates/`
  is touched — this Case should touch NO `crates/` file. **Flag any AC that would require a `crates/` change**
  (none are expected; the §5b writes all hit existing generic/feed/upload/run routes; AC4's `[JS-UNIT]`
  extends `web/tests/`; the `[LIVE]` ACs exercise existing endpoints).
- **No `numu-nacl-engine.js` edits** (the invariant above) — flag any AC that would require one (none).
- Branch `feat/numu-frontend-integration`. Commit **per-named-files** (never `git add -A`); messages end
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; **push ONLY on Em's explicit OK**.
- **NEVER run `cargo test --features db-tests`** (OOMs — Case 0012). Verification is `[JS-UNIT]` (the node
  gate in `tools/ci.sh`), `[LIVE]` (`tools/e2e-0013.sh` + the seeded server), `[MANUAL-E2E]`, `[REVIEW]`.
- Run via the `/feature` role chain (architect→tester→coder→reviewer→ops) with the two checkpoints; this spec
  is CHECKPOINT 1.
- Add a DOCMAP row for this spec when it lands (frontend doc-currency hygiene; not a crates gate).
