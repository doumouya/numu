# files — one browser for every file, local or connected

> Status: proposal (see [README.md](README.md)). Accent `var(--chart-2)` · icon `folder2-open`.

## Purpose

One browser for every file the user can reach — on-device `FIL_` objects and connected
providers — in a single list with one preview path and one insert action. The brand
(Drive today, others later) survives as a source row, never its own surface. The csv
flow already ships on the `file` type; **files** is the browsing surface that type has
been missing. The Data Cleaner agent hooks the same upload path (runs the moment a
file lands); it is noted here, not a separate app.

## Absorbs

| store id | tagline (verbatim) | becomes |
|---|---|---|
| `gdrive` | Browse and attach Drive files; edits sync back as file objects. | a source row (`DRV_`): pick files without leaving numu · two-way sync · respects Drive sharing |

Local `FIL_` objects are the on-device source — not an absorbed store item, the substrate.

## Objects

| type | PREFIX_ | role |
|---|---|---|
| `file` | `FIL_` | **EXISTS** — the core type; every browsable item, local or synced. The csv flow (blob_ref, cleanness, columns_meta) ships on it. |
| `driveAccount` | `DRV_` | source row: account · scopes · last-sync. One per connected Drive account; rendered by the existing `connector` viewer. |

Folders are **not** entities: the provider's tree is browsed live through the source
adapter. Mirroring a folder hierarchy into the registry is drift by construction.

## Views

### Phone (~360)

Areas stack in source order below `--bp-md`; the source rail collapses to a chip row.

```
┌────────────────────────────┐
│ files      ⌕   ☰/▦   ⬆    │  search · list/grid · upload
├────────────────────────────┤
│ Local ▾  Drive  Recent  Sh…│  source chips (scroll)
├────────────────────────────┤
│ ▤ dossier.csv    14 MB   ⋮ │
│ ♪ mix-final.wav  48 MB   ⋮ │
│ ▣ cover.png      1.2 MB  ⋮ │
│ ▶ rough-cut.mp4  210 MB  ⋮ │
│         …                  │
├────────────────────────────┤
│ [ Insert into conversation]│
└────────────────────────────┘
```

### Context panel (half-open)

Container-first: half-open, the panel renders the phone view verbatim — same chips,
same rows, same Insert button. Tapping a row swaps the panel to the file's **type
viewer** (image / audio / video / the `data` profile block for CSVs), so the browser
never carries a preview pane of its own; back returns to the list.

### Desktop (30×18)

```
┌────────┬──────────────────────────────────────────────────┐
│SOURCES │ ⌕ search          ☰ list  ▦ grid        ⬆ upload │
│        ├──────────────────────────────────────────────────┤
│ Local  │ name              kind     size      modified    │
│ Drive  │ ▤ dossier.csv     table    14 MB     Jul 2     ⋮ │
│ Recent │ ♪ mix-final.wav   audio    48 MB     Jun 30    ⋮ │
│ Shared │ ▣ cover.png       image    1.2 MB    Jun 28    ⋮ │
│        │ ▶ rough-cut.mp4   video    210 MB    Jun 27    ⋮ │
│ ● gdrive                    …                             │
└────────┴──────────────────────────────────────────────────┘
```

```json
{ "id": "files", "v": 1, "areas": [
  { "id": "sources", "x": 0, "y": 0, "w": 6,  "h": 18 },
  { "id": "toolbar", "x": 6, "y": 0, "w": 24, "h": 2  },
  { "id": "browser", "x": 6, "y": 2, "w": 24, "h": 16 } ] }
```

`sources` lists Local · Drive · Recent · Shared plus one row per connected account
(brand logo, connection dot). `toolbar` spans the content: search, list/grid toggle,
upload. `browser` is the file table (grid mode swaps rows for thumbnail tiles).
Preview opens in the Context panel — the shipped viewer registry, never a third pane.

## Sources model

- **Local** — `FIL_` objects from the registry, reach-filtered like everything else.
  This is the default source and the only one that exists without a connector.
- **Connected** — one `DRV_` row per account; the adapter lists the provider's tree
  live and materializes a `FIL_` object only when a file is saved or inserted
  (derive-don't-store: bytes refetch by recorded `src`).
- **Recent · Shared** are queries *across* all sources, not sources — the aggregation
  rule: one list, provider shown as a chip on the row, never a per-brand screen.
- Drive sharing is respected by the adapter; numu RBAC then filters what the *numu*
  user can reach — the stricter of the two wins.

## Reuse

- `object` / `objectTable` blocks (`web/src/console/feed.ts`) — read results and the row list share renderers.
- The viewer registry (`web/src/console/context-panel.ts`) — image · audio · video · `data` profile; files adds zero viewers.
- `saveAttachment` + `ensureBlob` derive-don't-store path (`web/src/app.ts`) — upload and Drive ingestion ride the same seam.
- KindLabel dtype chips (`mountKindLabel`, used in `web/src/console/feed.ts`) — the `kind` column.
- The `connector` viewer for `DRV_` rows (account · scopes · last-sync).

## nacl surface

| input | result |
|---|---|
| `read:files` | `objectTable` block — every reachable `FIL_`, all sources |
| `read:files.source=drive` | `objectTable` block filtered to the Drive source |
| `save` (EXISTS — the save verb) | attachment → `FIL_` object, `saved · on device` |
| Insert into conversation | `object` block in the feed + the `it` effect |
| open a file in chat | **`it` focus** — the file becomes the thread's focused object (doctrine); `unwrap`/`clean`/`chart` verbs target it |

Insert is the inverse of the email block's **Save to chat** (`web/src/app.ts#saveAttachment`):
Save pulls a file *into* numu; Insert pushes a reachable file *into* the thread.

## Touch & appearance

- **hit**: `row` — the whole file row is the target (≥ 44px).
- **hover**: `overflow-menu` — long-press opens it; the kebab (`three-dots-vertical`) stays visible, never hover-revealed.
- **gestures**: none required. Drag-to-chat is desktop-only (fine pointer); the explicit **Insert** button exists everywhere.
- **density**: `default` (touch retunes comfortable automatically).
- **icon**: `folder2-open` · **accent**: `var(--chart-2)` — both Customizable slots; overrides are entity data.

## Phasing

- **Phase A (sim)** — local `FIL_` browsing is real: the registry's reach-filtered
  files, list/grid, upload through the existing seam, preview via the shipped viewers,
  Insert into conversation. Drive rows are **seeded** `DRV_` objects (connector viewer
  shows account/scopes/last-sync); the Drive tree is sim data.
- **Phase B (routes/connectors)** — Drive OAuth + two-way sync through the source
  adapter. Ingestion of provider bytes goes **only** through the sealed pipeline
  (`pipeline::upload_csv` is the one write path — the docs/api data-plane note);
  `POST /api/objects/file` is not an ingestion door. blob_ref stays
  `perm_class=readonly`, engine-written.
