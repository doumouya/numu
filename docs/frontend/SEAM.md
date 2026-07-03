# SEAM.md — the NumuClient contract (the console ⇄ backend boundary)

The console talks ONLY to `window.NumuClient` (typed in `web/src/numu-sim.d.ts`,
faced by `web/src/client.ts`). Two drivers ship today, chosen before app code
runs (`?http=1` in the URL → the http driver):

- **`NumuClient.local()`** — the in-browser sim engine (`web/sim/*`, verbatim
  from the design project). Registry/feeds persist to localStorage; CSV frames
  are **re-derived** from the blob + steps on reload (blobs ≤250 KB persist,
  larger refetch by the `src` recorded at upload).
- **`NumuClient.http(base)`** — the same interface over fetch. Today that is
  `web/sim/server.node.js` (`node web/sim/server.node.js` → :8787, state in
  `web/sim/data/`); **in phase B it is the Rust api**. The console needs zero
  code change for that swap — this file is the contract the Rust routes must
  satisfy.

## The client interface

| method | http driver route | notes |
|---|---|---|
| `request(method, path, {query, body, headers})` | any `/api/*` | the generic escape hatch; carries `x-numu-actor` (phase B: the session cookie replaces it) |
| `nacl(text, ctx)` | `POST /api/nacl` `{text, ctx}` | ctx = `{workspace, projectId, itFileId, channel}` → `{blocks, effects}` |
| `uploadCsv(projectId, filename, csvText, srcUrl?)` | `POST /api/files` `{project_id, filename, csv}` | THE one write path for file bytes → 201 + the upload envelope |
| `feed(key)` | `GET /api/conversations/:key/feed` | key = the workspace (ORG) id |
| `appendFeed(key, blocks)` | `POST /api/conversations/:key/feed` `{blocks}` | |
| `setFeed(key, blocks)` | `POST …/feed` `{blocks, replace: true}` | optional (local driver has it) |
| `manifest(workspace)` | `GET /api/manifest?workspace=` | the per-user visible-objects manifest: types+fields+reachable files/columns, NO rows — the autocomplete-at-scale plane |
| `values(fileId, col)` | `GET /api/values?file=&col=` | column-distinct, lazy per field, sentinel-filtered, capped |
| `ensureBlob(fileId)` | no-op over http (the server owns blobs) | local: refetch the original bytes by `src` |

Plus the generic objects surface the sim serves and numu main already has:
`GET/POST /api/objects/:type`, `GET/HEAD/PUT/PATCH/DELETE/OPTIONS
/api/objects/:type/:id`, `GET /api/search?q=`, `GET /api/types`,
`POST /api/files/:id/steps` `{kind, params}`, `GET /api/files/:id/rows?offset=&limit=`.

## Wire shapes

- **Upload envelope** (`POST /api/files` 201): `{rid, filename, encoding,
  cleanness, fully_null_rows, row_count, col_count, columns: ColumnMeta[],
  wrapped}`.
- **nacl result**: `{blocks: Block[], effects: Effect[]}` — block `type`s:
  `email · step · data · dashboard · object · objectTable · sent/bubble`; effect `kind`s: `theme ·
  closePanel · play · it · needBlob · openObjectId` (see CONSOLE.md).
- **Entity**: `{id, type, data, scope_parent_id, version, created_at,
  updated_at}` + `ETag: W/"<version>"`.
- **OPTIONS self-describe** (the per-object autocomplete manifest): `{type, id,
  allow[], rank, etag, fields: [{field, kind, enum, required, can_read,
  can_write, data_class}], workflow: {states, rejects} | null}`.

## The error contract (verified against the sim server, 2026-07-03)

| condition | response |
|---|---|
| PUT/PATCH/DELETE without `If-Match` | `428 precondition_required` |
| stale `If-Match` | `412 precondition_failed` |
| illegal workflow skip (e.g. `recording → termine`) | `422 illegal_transition` |
| close-gate unmet on the terminal state | `422 close_preconditions_unmet` |
| out-of-reach object (Plane A) | **leak-free `404 not_found`** |
| field above the caller's rank (Plane B) | `403 field_forbidden` |

## Faithful vs simulated (carried from the sim README — the phase-B checklist)

**Faithful to the docs** (the Rust api must match): two-plane RBAC
(roles-as-data ranks, reach over principals × scope ancestors, leak-free 404,
field floors → 403), ETag/If-Match 428/412, workflow-as-data guards (default ·
orvcle_production · orvcle_request incl. rejects), OPTIONS self-describe,
events on every mutation, one-write-path CSV upload + derive-don't-store steps,
nacl grammar (`read: new: set: del: on:` + pipeline words + chaining + quoting).

**Deliberately simulated** (phase B replaces): plain-JS stand-ins for
Postgres/Polars, BOM/U+FFFD encoding heuristics (no chardetng), substring
search (no tsvector), `x-numu-actor` header auth (→ the `Caller` session
extractor), no `access_audit` plane.

## Phase-B route map (each is one Case)

1. Port `conversations.rs` + `pipeline.rs` + migrations 0016/0017 from
   `feat/numu-frontend-integration` (feed + `POST /api/files`).
2. `POST /api/files/:id/steps` + `GET /api/files/:id/rows` over the Polars
   data plane.
3. `GET /api/manifest` + `GET /api/values` (reach-filtered, no rows).
4. `POST /api/nacl` — parse→plan→execute in Rust; `web/sim/numu-nacl.js` is the
   executable spec, `web/data/nacl-commands.js` the doctrine.
5. OPTIONS enrichment (per-field verdict + enum vocab + workflow block).
6. Seal the file/message canonical fields against generic coll_create/patch
   (one write path, Rust gate + DB backstop).
7. Registry seed per the locked CATALOG.md (`web/sim/numu-seed.js` is the
   reference shape).
