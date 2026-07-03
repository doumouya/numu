# numu-sim — a faithful numu backend, twice

One engine (`numu-engine.js` + `numu-csv.js` + `numu-nacl.js` + `numu-seed.js`), two runtimes:

| Runtime | How | Persistence |
|---|---|---|
| **Browser (default)** | the console loads the sim as plain scripts; `NumuClient.local()` runs the engine in-process | registry/feeds → `localStorage` · CSV cells → memory, **re-derived** from the blob (`replay(blob, steps)`) on reload |
| **Node** | `node sim/server.node.js` → `http://localhost:8787` | `sim/data/state.json` + blobs in `sim/data/files/` |

## Run the Node backend

```sh
node sim/server.node.js            # zero dependencies, Node ≥ 16
# console served against it:
open http://localhost:8787/ui_kits/console/index.html
```

To make the console use HTTP instead of the in-browser engine, set before the sim scripts load
(e.g. in devtools: `localStorage` is not involved — add to index.html or run first):

```html
<script>window.NUMU_HTTP = true;</script>
```

API sanity checks:

```sh
curl -s localhost:8787/api/objects/case -H 'x-numu-actor: USR_jm'
curl -s -X OPTIONS localhost:8787/api/objects/case/CAS_m1 -H 'x-numu-actor: USR_jm'   # self-describe
curl -s localhost:8787/api/search?q=nova -H 'x-numu-actor: USR_marc'                  # reach-filtered
curl -s -X PATCH localhost:8787/api/objects/case/CAS_m1 \
     -H 'x-numu-actor: USR_jm' -H 'content-type: application/json' \
     -H 'if-match: W/"1"' -d '{"status":"master"}'                                    # workflow-guarded
```

## What is faithful (doc → code)

- **Two-plane RBAC** (`numu-rbac-membership-design.md` Part 1): roles-as-data rank ladder
  (viewer 1 → owner 4), reach = memberships over principals × scope ancestors (≤8, cycle-safe),
  denial = **leak-free 404**; field plane: `standard`/`owner_grade`/`readonly` floors → **403
  field_forbidden** on write, silent omission on read. Creator gets an owner edge ("no object
  without an owner"). Platform-admin bypass = `user.attributes.platform_role`.
- **Concurrency**: every item carries `ETag: W/"<version>"`; PUT/PATCH/DELETE without `If-Match`
  → **428**, stale → **412**.
- **Workflow-as-data**: `default`, `orvcle_production` (writing→…→termine), `orvcle_request`
  (nouvelle→…→convertie, rejects refusee/expiree) — illegal skip → **422 illegal_transition**,
  close-gate → **422 close_preconditions_unmet**.
- **OPTIONS self-describe**: allowed verbs + per-field read/write verdict + enum vocab + the
  workflow — the autocomplete manifest, per object.
- **CSV pipeline** (`numu-csv-flow-and-datatypes.md` / `numu-gluesql-postgres.md`): one write
  path (`uploadCsv`), immutable blob, wrapped-single-column sniff, 6-value dtype + FR-first
  semantic sniff (BOOL_WORDS, date shapes, numeric-ish with ID-name + leading-zero vetoes),
  sentinel list, `ColumnMeta`, cleanness = value_quality × structural gate, **derive-don't-store**
  (`project_steps` + `replay`). Try it on the real `uploads/dossier.csv` (101k rows, wrapped,
  mojibake, `???` sentinels): `save` the email attachment, then `unwrap` → `repair` → `clean` →
  `rename dots` → `new:chart` and watch cleanness climb.
- **nacl**: `read:` `new:` `set:` `del:` `on:` (the loop), projections, chained clauses, quoting;
  pipeline words `unwrap · repair · clean · dedupe · rename dots|snake · sort · group · drop nulls`.
  Registry verbs run through the SAME `handle()` the HTTP surface uses.

## Deliberately simulated (not the real engine)

Postgres/GlueSQL/Polars are stood in by plain JS; encoding detection is BOM + U+FFFD heuristics
(no chardetng); search is substring over `searchable` fields (no tsvector); `access_audit` /
operator grants (Part 2–4 of the RBAC doc) are not implemented; typed `bookings` exclusion
constraints are app-level here. The seam (`numu-client.js`) is the point: the console talks to
`request/nacl/uploadCsv/feed/manifest/values` only, so binding the real backend is a driver swap.

## Files

```
sim/numu-csv.js     ingest pipeline + steps + groupBy          (browser + node)
sim/numu-seed.js    registry seed: types · workflows · tenants (browser + node)
sim/numu-engine.js  the generic object service + dispatcher    (browser + node)
sim/numu-nacl.js    nacl → plan → execution → feed blocks      (browser + node)
sim/numu-client.js  the seam: local driver ⇄ http driver       (browser)
sim/server.node.js  zero-dep HTTP wrapper + static serving     (node)
```

Reset the browser demo: `window.numuClient.reset()` in devtools, then reload.
