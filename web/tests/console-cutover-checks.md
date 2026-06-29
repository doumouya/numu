# Console cutover — `[MANUAL-E2E]` + `[REVIEW]` verification checklist

Case **CAS_ba8f690de09447fd939202ff11100bfa** · spec `docs/internal/specs/console-cutover.md`
(31 ACs). This doc covers the ACs that **cannot be headless-asserted cheaply** —
the `[MANUAL-E2E]` browser flows and the `[REVIEW]` code-inspection checks.

The automatable halves live elsewhere and are NOT repeated here:

- `[JS-UNIT]` → `web/tests/shapes.test.mjs` (AC4 conversations projection, AC11
  create-flat, AC12 If-Match forwarding, AC21 search-shape **[RED — coder gap, see
  report]**). Run: `node web/tests/shapes.test.mjs`.
- `[LIVE]` → `tools/e2e-0019-console.sh` (AC9c/AC9d/AC9e/AC12/AC18/AC20/AC21 against
  a running seeded server). Run by **ops**, not in the build phase.

## How to run the manual flows

1. Migrate + seed + start a **debug** `numu-api` bound to `:8099`
   (`tools/seed-demo.sh`; `NUMU_WEB_DIR=web`; dev-login is debug-only).
   Optionally `REDPASH_DEV_LOGIN=1` if your harness keys off it.
2. Open `http://localhost:8099/numu%20App.dc.html` same-origin. Confirm the
   `SameSite=Lax; HttpOnly` `numu_session` cookie is set and `/api/*` calls carry it.
3. For the **offline** rows (AC24): stop the server (or block `/api/health`) and
   reload — the App must fall back to `FixtureClient` and disable writes.

Tick each row: **what to do** → **expected**. A row fails if the expected behavior
is absent, throws to the console, or leaves the UI half-rendered.

---

## Group A — Console in `web/` + the live seam (graft)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC1 | `[REVIEW]` | Inspect `web/`: the Rethink Console + its 6 components (`WorkspaceRail`/`TopBar`/`SidePanel`/`Chart`/`NotBuilt`/`PivotTable`) are present; the served file is `web/numu App.dc.html`. Grep its `<head>`/`dc-import`. | Loads the EXISTING `web/numu-data-client.js`, the EXISTING `web/numu-shell.js` (reused, not forked — no second shell.js in `web/`), and `web/numu-nacl-engine.js`. Instantiates `window.NUMU_CLIENT.makeClient("auto")`. The `dc-import` decomposition is preserved (6 components imported, not inlined). |
| AC2 | `[REVIEW]` | Grep `web/numu App.dc.html` for `NUMU_DATA`, `TENANTS`, `persistFeed`, `loadFeed`, `localStorage.setItem("numu.feed`, `fetch(`, `XMLHttpRequest`, `numu-data.js`. | NO entity reads via `NUMU_DATA`/`TENANTS`; NO feed persistence via `persistFeed`/`loadFeed`/`localStorage.*feed`; NO raw `fetch(`/`XMLHttpRequest` literal; NO `numu-data.js` entity access. Every read/write goes through the seam (`types·options·list·get·create·update·feed·conversations·upload·run·isLive`). The ONLY allowed `localStorage` is pins + channel-grouping (AC15/AC22 "this device"). |

## Group B — Invariant rail + morphing regions

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC3 | `[MANUAL-E2E]` | Load the App against the seeded server. Observe the `WorkspaceRail`. Click several channels. | The rail lists live conversations from `client.conversations()`, grouped by system/channel and color-coded by type; each row shows its origin icon (`email→envelope`, `case→kanban`, `manual→chat-square-text`, `connector→plug`). Selecting a channel morphs EXACTLY three regions — Header (`TopBar`), Thread (feed), Composer (`SidePanel`) — and the rail itself stays put (the invariant). With zero conversations the rail shows an empty-state, not a throw. |

## Group C — Feed (one typed-message renderer) + lens

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC5 | `[MANUAL-E2E]` | Open a seeded conversation with a mixed feed. Inspect each item type. | One renderer dispatches on `kind`+`data` into: `text`/`sms` (chat bubble, in/out aligned), `audio` (waveform), `file`/`csv` (attachment card + "Open in data workspace"), `youtube`, `call`, `email` (full card), `comment`/`checks`/`event` (case-thread line), `datacmd`/`data` (qir line + live datatable). NO type renders blank; an unknown type falls back to a plain text block. |
| AC6 | `[MANUAL-E2E]` | Toggle the lens: `Everything / Customer / My work`. Have at least one `visibility:internal` note in the feed. | Each toggle calls `client.feed(convId,{lens:"all"|"customer"|"mine"})` and re-renders. Under `Customer` the internal note DISAPPEARS (server-side `WHERE` on `visibility`, not a client hide). Bad lens would 400 server-side — the toggle only sends the three valid values. |

## Group D — Context-panel archetypes (11)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC7 | `[MANUAL-E2E]` | Open one entity of EACH archetype (project/message → thread/record; case → board; file → table; chart → chart; dashboard → dashboard; track → media; release → collection; session → calendar; post → preview). | Opening resolves `Promise.all([client.options(type), client.get(type,id)])` and `SidePanel` renders the panel chosen by `options.contextView`. All 11 archetypes render: `thread`/`record`→record list, `board`→status lanes, `table`→`columns_meta`, `chart`→`Chart` over `spec.cats`+`chart_type`, `dashboard`→grid of `Chart` (tile `chart_id`s resolved), `media`→audio, `collection`→cover+children, `calendar`→date card, `preview`→post preview. An unknown `context_view` falls back to `record` (none renders blank). |
| AC8 | `[MANUAL-E2E]` | In a feed, click a `file`/`csv` card, then a `chart` card. | The `file`/`csv` card opens the `table` archetype (its `columns_meta`); the `chart` card opens the `chart` archetype (its `spec`). The `TopBar` shows the `context_view` as the archetype tag. Reuses AC7's dispatch (no new renderer). |

## Group E — Composer + the §5b compile-map binding

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC9 | `[MANUAL-E2E]` | Open a conversation; locate the Composer in the `SidePanel`. Type a nacl line and submit. | The Composer chrome is the Rethink Console's (try-chips + channel picker + input + send), wired to seam paths. Submitting a nacl line routes it through the §5b data-binding contract (AC9a–AC9e). |
| AC9a | `[MANUAL-E2E]` | Type `open:csv dossier` and press Enter (pick the seeded `dossier.csv`). | Calls `client.upload(file, project, tld)` (`POST /api/files`, multipart) and pushes a `file`/`csv` block built from the returned `UploadOutcome` (`filename`/`cleanness`/`columns`). On failure it pushes an internal-note error block (`.catch`), never a silent throw. |
| AC9b | `[MANUAL-E2E]` `[REVIEW]` | Type a cleaning verb (`clean` / `cast` / `rename`) on an active dataset. | Computes client-side via `window.NUMU_NACL.parseOp` on `activeData` and pushes a `step` block. A **disclosure** states the recipe is session-local / not persisted. `[REVIEW]`: confirm NO persist/`project_steps` write call is made (the route does not exist — no fabricated route). |
| AC9c | `[MANUAL-E2E]` (`[LIVE]` half in e2e-0019) | Type `group` / `sort` / `pivot`, then `chart`. | `group`/`sort`/`pivot` compute read-only client-side (`PivotTable`/client). `chart` computes client-side AND calls `client.create("chart", spec)` (`POST /api/objects/chart`), then pushes a chartblock rendered via `Chart`. (LIVE round-trip asserted by `e2e-0019-console.sh` AC9c.) |
| AC9d | `[MANUAL-E2E]` (`[LIVE]` half in e2e-0019) | Type `new:dashboard`, then `new:pdf` / `new:deck`. | `new:dashboard` → `client.create("dashboard", {…})` (`POST /api/objects/dashboard`). `new:pdf`/`new:deck` render client-side then `client.create("attachment", {kind:"report", …})` (`POST /api/objects/attachment`). (Dashboard LIVE round-trip asserted by `e2e-0019-console.sh` AC9d.) |
| AC9e | `[MANUAL-E2E]` (`[LIVE]` half in e2e-0019) | Type `reply:email … body:"…"`, then `note "…"`, then `close:case`. | `reply:email` → `client.create("message", {direction:"out", channel:"email", …})` (the gmail SEND run is GATED — disclosed as coming-soon). `note` → `client.create("message", {channel:"note", visibility:"internal", …})`. `close:case` → `client.update("case", id, {status:"done"}, version)` → the close-gate returns `422` if the three checks are unmet, **surfaced** not swallowed. (note create + the gated close asserted by `e2e-0019-console.sh` AC9e/AC20.) |
| AC10 | `[MANUAL-E2E]` `[REVIEW]` | Run any nacl op; look for the persistence disclosure. Then inspect the diff. | nacl ops run via `window.NUMU_NACL.parseOp` on `activeData` (call-only engine). A persistent disclosure states runs are session-local / not persisted (step-PERSIST GATED). `[REVIEW]`: the diff contains **ZERO edits to `web/numu-nacl-engine.js`** (see the hard invariant below). |

## Group F — Create/edit forms + If-Match conflict UX

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC11 | `[MANUAL-E2E]` (`[JS-UNIT]` flat-return in shapes.test) | Open a create form for several types (case, chart, message). | The form is built from `client.options(type).fields` filtered to `editable`: `enum→Select` (from `options.enum`), `bool→Checkbox`, everything else→`Input` (`int→type="number"`). Create pre-fills `options.default`s. No per-type code. |
| AC12 | `[MANUAL-E2E]` (`[LIVE]` round-trip in e2e-0019) | Create an entity (Save in create mode); then open it and Save an edit. | Create calls `client.create(type, draft)` (`POST /api/objects/:type`). Edit calls `client.update(type, id, draft, selected._version)` which sends `If-Match: W/"<version>"`. (Header forwarding asserted by shapes.test AC12; the live round-trip + 412 by `e2e-0019-console.sh` AC12.) |
| AC13 | `[MANUAL-E2E]` | Open the same record in two tabs. Save an edit in tab A. In tab B, edit and Save (its `_version` is now stale). | tab B's `update()` rejects with `412` (or `428` if If-Match absent). The form shows a **non-dismissable conflict affordance** ("This record changed since you opened it — reload to see the latest") with a **Reload** action that re-`get`s the entity and re-opens the form on the fresh `_version`. Both 412 and 428 map to this UX, distinct from the generic error toast (AC23). |

## Group G — Objects tree

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC14 | `[MANUAL-E2E]` | Open the objects-tree region. | Overview items, channel groups, project rows (with pin/menu), object-type rows with counts, and a hidden section — all fed by `client.conversations()` (projects) + `client.types()`/`client.list()` (object-type counts). NO Console fixtures (cross-check against AC2's grep). |

## Group H — Settings (client-side)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC15 | `[MANUAL-E2E]` | Open Settings. Change theme, density, accent, language, nacl-dialect; toggle a notification. | Appearance (theme/density/accent/tone), language grid, objects-panel toggles, nacl-dialect editor, palette specimen, notification toggles are wired to `numu-shell.js` registries + localStorage. Theme/dialect changes take effect LIVE via the shell runtime. A clear **"this device" / client-side** label states prefs are NOT server-synced (server-side prefs GATED — uses the shared coming-soon affordance, AC25). |

## Group I — Profile (security gated)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC16 | `[MANUAL-E2E]` | Open Profile. | Identity card + identity schema from the caller; memberships from `members.rs` (the caller's workspace memberships); recent activity from `events`. All live, no fixtures. |
| AC17 | `[MANUAL-E2E]` `[REVIEW]` | In Profile, find the security section (MFA/sessions/tokens). | Renders a visible "coming soon" affordance (the `NotBuilt` component) — informative, NO dead toggle/button. `[REVIEW]`: it is the SAME shared coming-soon component used elsewhere (AC25). |

## Group J — Connectors (OAuth/sync gated)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC18 | `[MANUAL-E2E]` (`[LIVE]` run in e2e-0019) | Open Connectors. Click an http_json connector's Run/Sync. | The catalog lists `client.list("connector")`; the detail Run/Sync for an http_json connector calls `client.run(id, args)` (`POST /api/connectors/:id/run`). (Live run asserted by `e2e-0019-console.sh` AC18 with `CONNECTOR_ID` seeded.) NOTE: the backend run takes NO body — `args` is unused server-side (a benign seam-vs-backend mismatch, see report). |
| AC19 | `[MANUAL-E2E]` `[REVIEW]` | In a connector detail, find Connect (OAuth) and scheduled-sync. | Both render the `NotBuilt` "coming soon" affordance with NO dead control. Catalog read + http_json run stay live; OAuth/sync are GATED. `[REVIEW]`: same shared coming-soon component (AC25). |

## Group K — Case-gate (board archetype)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC20 | `[MANUAL-E2E]` (`[LIVE]` round-trip in e2e-0019) | Open a `case` in the `board` archetype. Record the three close-checks; try to close before/after. | The status stepper + three close-checks show. Recording a check calls `POST /api/objects/case/:id/checks/:name` (members.rs). The close transition fires ONLY when all checks pass; before that, `close:case` 422s (surfaced). (Check-record + gated close asserted by `e2e-0019-console.sh` AC20.) |

## Group L — Search

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC21 | `[MANUAL-E2E]` (`[LIVE]` + `[JS-UNIT]`) | Type a term in the `TopBar` search; click a result. Then clear the box. | Search calls `GET /api/search?q=<term>` and renders `results:[{entity_id,type,title,rank}]`; clicking a result opens that entity in its archetype (AC7; a result whose `type` lacks a `context_view` falls back to `record`). An empty `q` is NOT sent (backend 400s on blank). **CODER GAP:** the seam has no `search()` method today — shapes.test AC21 is RED until it lands (see report). LIVE half: `e2e-0019-console.sh` AC21. |

## Group M — Notifications → "open as project" CTA

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC22 | `[MANUAL-E2E]` | Trigger a notification; click "open as project". | Calls `client.create("project", {…})` and selects the new conversation in the rail. (Promotion = a project create; no new backend.) |

## Group N — Error / offline layer

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC23 | `[MANUAL-E2E]` `[REVIEW]` | Force a seam call to reject (e.g. open a bogus id → 404; submit an invalid create → 422). | Reads and writes that reject render a user-visible error affordance (inline or toast) carrying the failure. NO unhandled promise rejection; the UI never sits half-rendered. `[REVIEW]`: every seam call site has a `.catch` (grep the App for `.catch`/`try` around `client.` calls — count ≈ call sites). |
| AC24 | `[MANUAL-E2E]` | Stop the server (or block `/api/health`); reload the App. | A prominent connection indicator reflects `client.isLive()` (green live / muted offline). When offline, ALL write affordances (create/edit/save, upload, run, check-record, notification-promote, the §5b writes) are disabled or clearly marked read-only; reads still render off the `FixtureClient` fallback (UI never blank). Recommended loudness: a persistent non-modal top strip, not a blocking overlay. |

## Group O — Gated-stub uniformity

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC25 | `[REVIEW]` `[MANUAL-E2E]` | Visit each gated surface: connector OAuth/sync (AC19), profile security (AC17), server-side prefs (AC15 label), nacl step-persist (AC9b/AC10 disclosure), gmail send-run (AC9e). | Each renders the SAME visible coming-soon component (the Console's `NotBuilt` model) — labelled "coming soon" (or equivalent), informative-only or a disabled control with an explicit reason. NEVER a button/toggle that looks interactive but silently no-ops. `[REVIEW]`: grep confirms a single shared component, not five bespoke stubs. |

## Group P — Archive (cleanup, at the END)

| AC | tag | what to do | expected |
|----|-----|-----------|----------|
| AC26 | `[REVIEW]` | After parity lands, inspect `web/`. | The prior `numu Console.dc.html` (old fixtures build, if present in `web/`) and the R0–R3 proofs (`R0 Seam.dc.html`, `R1 Fields.dc.html`, `R2 Archetypes.dc.html`, `R3 Shell.dc.html`) are relocated under `web/_archive/` (kept as reference, NOT deleted). The served app is `web/numu App.dc.html`. |

---

## Hard `[REVIEW]` invariants (must hold across the whole diff)

These are the two non-negotiable boundary checks. A violation of either FAILS the
review regardless of feature completeness.

| # | invariant | how to verify | expected |
|---|-----------|---------------|----------|
| INV-1 | **ZERO edits to `web/numu-nacl-engine.js`** (Case 0019/nacl owns it; AC10 + spec §"Invariant — NO `numu-nacl-engine.js` edits"). | `git diff --stat <baseline>..HEAD -- web/numu-nacl-engine.js` (must be empty). Stronger: `git diff <baseline>..HEAD -- web/numu-nacl-engine.js` produces no hunks; the file is byte-identical to the branch baseline. | No diff. The file is untouched. The App only CALLS `window.NUMU_NACL`. |
| INV-2 | **NO `crates/` change** (this Case is frontend-only; the §5b writes hit existing generic/feed/upload/run routes — spec §"Process constraints"). | `git diff --stat <baseline>..HEAD -- crates/` (must be empty). | No `crates/` file changed. If any AC appears to need a `crates/` change, it is flagged to Em as a spec defect, not silently coded. |

> Replace `<baseline>` with the merge-base of `feat/numu-frontend-integration`
> against its fork point (the commit before the cutover work began).

## Coverage note

Every one of the 31 ACs has a verification artifact:
- `[JS-UNIT]` (4): AC4, AC11, AC12, AC21 → `web/tests/shapes.test.mjs`.
- `[LIVE]` (7 ACs, some shared): AC9c, AC9d, AC9e, AC12, AC18, AC20, AC21 →
  `tools/e2e-0019-console.sh`.
- `[MANUAL-E2E]`/`[REVIEW]` (the rest) → this doc, one row per AC, plus INV-1/INV-2.
