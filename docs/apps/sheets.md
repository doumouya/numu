# sheets — the tabular workbench: profile, clean, edit

> Proposal (see [README.md](README.md)). Accent `var(--chart-5)` · icon `grid-3x3-gap-fill`.

## Purpose

One surface for everything tabular. A file lands and is profiled in seconds
(the shipped `data` block); pipeline words clean it (derive-don't-store — the
dossier.csv 101,234-row walk in [CONSOLE.md](../frontend/CONSOLE.md)); a
virtualized grid edits it cell by cell under field-level permissions. The
point: **the pipeline chips ARE nacl words** — chat and UI are the same engine.
Clicking `dedupe` in the column inspector appends the step exactly as typing it
in the composer would. The Data Cleaner agent works inside this app.

## Absorbs

| store id | tagline (verbatim) | becomes |
|---|---|---|
| `csvprofiler` | "Drop a CSV and get column types, null %, and a junk-row report in seconds." | the profile header + column inspector (type + semantic-type inference; null/duplicate/junk detection; one click to a clean file object) |
| `sheeteditor` | "Edit records in a spreadsheet grid with live, field-level validation." | the grid (inline edit with type checks; respects field-level permissions; writes back as object updates) |

## Objects

| type | PREFIX_ | role |
|---|---|---|
| file | `FIL_` | the sheet: blob + step chain, frames re-derived on demand (never stored); profile stats + `columns_meta` ride the entity |
| *(any registered type)* | *(existing)* | grid rows when a `read:` result opens as a sheet; a cell edit is an object `PATCH` with `If-Match` (412 on stale) |

**No new types.** Steps are rows on the file (`POST /api/files/:id/steps`), not
a type. Customization (icon/accent/label/density) is entity data.

## Views

The profile header is the SHIPPED `data` block (`web/src/console/feed.ts`):
the 4-stat grid — rows / cols / null rows / junk — plus cleanness. The grid is
virtualized, with a KindLabel dtype chip per column head. The column inspector
shows dtype · null% · distinct values (from the values cache
`window.__NUMU_VALUES`) · semantic type · the per-column pipeline chips:
`unwrap` · `repair` · `clean` · `dedupe` · `rename dots|snake` · `sort` ·
`group` · `drop nulls`.

### Phone (~360)

```
┌────────────────────────────┐
│ dossier.csv    clean 99.6% │
│ 101,234 rows · 17 cols     │
│ 0 null rows · 0 junk       │
├────────────────────────────┤
│ name ▸  │ city ▸ │ amount ▸│
│ Aya     │ Abidjan│  4 200  │
│ Marc    │ Dakar  │  1 150  │
│  … virtualized rows …      │
├────────────────────────────┤
│ [unwrap][repair][clean] …  │
│ › nacl composer            │
└────────────────────────────┘
```

Areas stack in source order below `--bp-md`: profile → grid → composer. The
column inspector opens as a bottom sheet on column-header long-press (▸ is the
visible non-gesture path). Cell tap opens the edit sheet.

### Context panel (half-open)

Container-first: half-open, the panel renders the phone view verbatim — same
profile header, same stacked grid, inspector as a sheet. Expanded, it renders
the desktop layout below. No forked code; the container band decides.

### Desktop (30×18)

```
┌──────────────────────────────────────────────┬───────────────┐
│ dossier.csv · 101,234 rows · 17 cols · 0 null│ (profile,30×3)│
├──────────────────────────────────────────────┼───────────────┤
│ name ▸    │ city ▸   │ opened ▸ │ amount ▸   │ COLUMN: city  │
│ Aya       │ Abidjan  │ 03-12    │  4 200     │ str · 0.2% ∅  │
│ Marc      │ Dakar    │ 03-14    │  1 150     │ semantic: geo │
│  … virtualized rows (grid, 22×15) …          │ distinct: 41  │
│           │          │          │            │ [sort][group] │
│           │          │          │            │ [dedupe][drop │
│           │          │          │            │  nulls] …     │
└──────────────────────────────────────────────┴───────────────┘
```

```json
{ "id": "sheets", "v": 1, "areas": [
  { "id": "profile",   "x": 0,  "y": 0, "w": 30, "h": 3  },
  { "id": "grid",      "x": 0,  "y": 3, "w": 22, "h": 15 },
  { "id": "inspector", "x": 22, "y": 3, "w": 8,  "h": 15 } ] }
```

## Sources model

sheets has no brand connectors of its own. Its sources are file objects,
wherever they came from: an upload, a mail attachment saved to chat, a Drive
pick (via `files`), a database query landed as a file. Database connectors
(`postgres`, `gluesql`) stay substrate on the Store's Connectors shelf. The
aggregation rule: **one grid regardless of origin** — the origin survives as
file meta, never as a second UI.

## Reuse

- `data` block + KindLabel dtype chips — `web/src/console/feed.ts` (amenan-ui `mountKindLabel`).
- Staged autocomplete — `web/src/console/nacl-suggest.ts` (verb→object→column→operator→value) already covers columns, operators, and values; the chips call the same staging.
- The csv pipeline + `ensureBlob` replay — `web/src/app.ts` (derive-don't-store: blob refetch + one retry).
- Values cache — `web/src/client.ts` (`window.__NUMU_VALUES`, prefetched per upload) feeds the inspector's distinct values.
- Field-perms posture — [docs/api/RBAC.md](../api/RBAC.md) Plane B: a write-denied field (`403 field_forbidden`) renders read-only; an unreadable field is absent from the read entirely (leak-free, omitted server-side).

## nacl surface

The whole pipeline exists today (`web/data/nacl-commands.js` doctrine). Every
chip click appends the same step the word would.

| input | result block / effect |
|---|---|
| `read:file` | `data` block — the 4-stat profile + column rows |
| `unwrap` | `step` block; wrapped single-column csv splits; grid re-derives |
| `repair [col]` | `step` block; mojibake fixed (windows-1252 → UTF-8) |
| `clean` | `step` block; cleanness recomputed in the profile header |
| `dedupe [full]` | `step` block; distinct rows · all-null rows dropped |
| `rename dots\|snake` · `rename a -> b` | `step` block; headers rewritten; KindLabel chips update |
| `sort by ‹col› [desc]` | `step` block; grid re-orders |
| `group ‹meas› by ‹col›` | `step` block; aggregated frame in the grid |
| `drop nulls ‹col›` | `step` block; null rows dropped |
| `new:chart.type=…` | a real `CHT_` entity + `openObjectId` — hands off to `insights` |

## Touch & appearance

- **hit**: `row` — the grid row is the target; inspector chips and edit-sheet controls pad to 44px (glyph unscaled).
- **hover**: `long-press` — column-header long-press opens the inspector; the ▸ header glyph is the visible non-gesture path (hover reveals it on pointer devices).
- **gestures**: `swipe-actions` on rows (row menu); the ⋮ row button is the non-gesture alternative.
- **density**: `comfortable` on touch; `compact` on desktop.
- Cell tap opens an **edit sheet** (type-checked input, Save/Cancel) — no inline caret juggling on touch; desktop double-click edits inline.
- Write-denied cells render read-only with a `lock` glyph in the column head.
- **icon** `grid-3x3-gap-fill` · **accent** `var(--chart-5)` — Customizable slots, stored as entity data; colors only ever token names.

## Phasing

- **Phase A (sim)** — profile, pipeline, and grid READ are real over
  `NumuClient.local()`: upload → `data` block, steps replay via `ensureBlob`,
  the virtualized grid over the derived frame, the inspector fed by the values
  cache. No write-back.
- **Phase B (Rust)** — write-back: cell edit = object `PATCH` with `If-Match`
  (412 on stale → refetch and re-offer the edit); field-perm-aware cell locking
  from the manifest; `POST /api/files/:id/steps` +
  `GET /api/files/:id/rows?offset=&limit=` per
  [docs/frontend/SEAM.md](../frontend/SEAM.md). Graduation opens its own Case.
