# video — one video library and one player

> **Status: proposal** (see [README.md](README.md)). Accent `var(--chart-3)` · icon `film`.

## Purpose

One generic video surface for the whole workspace: a **library** (every reachable video, whatever
its origin) in front of the **player numu already ships** — the Context panel's video viewer with
its four expanded layouts. Session recordings and local uploads land in the same grid, play in the
same viewer, and remember position the same way. No brand gets its own video screen; a new
recording provider is a source row, zero new UI.

The player is **not respecced here** — it is shipped code
(`web/src/console/context-panel.ts`): real `<video>`, white-on-scrim custom controls, persisted
position, four expanded layouts (**cinema · review · strip · full**) with up-next tiles. This
proposal adds only the library view in front of it.

## Absorbs

| source | store id | role |
|---|---|---|
| local video files | — | `FIL_` (kind `video`) uploads — attached in the composer, tiled in the library |
| Google Meet recordings | `gmeet` *(cross-ref)* | **recordings source only** — "Recording lands as a video object" is gmeet's own catalog line. gmeet the *app* is absorbed by [`calendar`](calendar.md) (join = an event action, not an app) |

No store item becomes this app; video exists because two flows already produce video objects.

## Objects

| type | PREFIX_ | role |
|---|---|---|
| video | `FIL_` (kind `video`) | the library item — a local upload or an ingested Meet recording |

- **No new types this pass.** A video is a file object; the library is a kind-filtered projection.
- **Watch position** is localStorage today (how the shipped viewer persists it) → **phase-B entity
  data** on the `FIL_`, so position follows the user across devices under RBAC/audit for free.
- Meet recordings arrive **tagged with their session/case link** (link fields on the `FIL_`), so a
  recording's tile carries its session and `read:` can follow the edge back.

## Views

### Phone (~360)

Filter chips, then a single-column tile list. Each tile: duration badge, title, source/kind chip,
watch-progress bar. Tap a tile → the video viewer.

```
┌────────────────────────────┐
│ ◀ Video            ⌕   ⋮  │
├────────────────────────────┤
│ (all)(sessions)(uploads)   │
│                 sort: new ▾│
├────────────────────────────┤
│ ┌────────────────────────┐ │
│ │ ▶                12:40 │ │
│ │ Mix review — ACME      │ │
│ │ session · 2d    ▰▰▰▱   │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ ▶                03:12 │ │
│ │ rough-cut_v2.mp4       │ │
│ │ upload · 1w     ▰▱▱▱   │ │
│ └────────────────────────┘ │
│            …               │
├────────────────────────────┤
│ › nacl                   ➤ │
└────────────────────────────┘
```

### Context panel (half-open)

Container-first: half-open, the panel renders the phone view verbatim — same filter chips, same
tile list — because the library is authored against container bands, not the viewport. Expanded,
it renders the desktop grid. Playing a tile swaps the panel to the shipped video viewer; the
viewer's own cinema/review/strip/full switcher takes over from there.

### Desktop (30×18)

```
┌─────────────────────────────────────────────────────────┐
│ (all)(sessions)(uploads)        sort: newest ▾       ⌕  │ filter-bar
├─────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│ │▶  12:40 │ │▶  03:12 │ │▶  47:05 │ │▶  01:58 │         │
│ │Mix rev… │ │rough-c… │ │Standup… │ │teaser…  │         │
│ │session  │ │upload   │ │session  │ │upload   │         │ tile-grid
│ │▰▰▰▱     │ │▰▱▱▱     │ │▰▰▰▰     │ │▱▱▱▱     │         │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                        …                                │
└─────────────────────────────────────────────────────────┘
```

```json
{ "id": "video-library", "v": 1, "areas": [
  { "id": "filter-bar", "x": 0, "y": 0, "w": 30, "h": 2 },
  { "id": "tile-grid",  "x": 0, "y": 2, "w": 30, "h": 16 } ] }
```

Tiles inside `tile-grid` are content (the area scrolls, hidden-scrollbar default); below `--bp-md`
the two areas stack in source order. Tiles keep the 15×9 ratio family of the chart canvas.

## Sources model

- **Local** — a video attached in the composer becomes a `FIL_` (kind `video`) and tiles
  immediately. This is the shipped path; the on-device library needs no connector at all.
- **Meet recordings** — a connected source, not an app. **gmeet is absorbed by
  [`calendar`](calendar.md)** (join is an event action); *here* it appears only as a recordings
  source: when a linked session's recording lands, it arrives as a `FIL_` kind `video` tagged
  with the session/case, and tiles under the `sessions` filter. The connection row (account ·
  scopes · last-sync) uses the existing `connector` viewer.
- **Aggregation rule**: one grid across every source; the source survives as a chip on the tile
  and a filter value, never as a separate screen. A future recording provider = one connector row.

## Reuse

| piece | where | used for |
|---|---|---|
| video viewer (4 layouts, scrim controls, persisted position, up-next) | `web/src/console/context-panel.ts` | the player — referenced verbatim, zero respec |
| `objectTable` block | `web/src/console/feed.ts` | `read:videos` results in the feed |
| `KindLabel` (amenan-ui, mounted as in feed.ts) | `web/src/console/feed.ts` | duration + kind chips on tiles |
| `connector` viewer | `web/src/console/context-panel.ts` | the Meet source row |

## nacl surface

| input | result block / effect |
|---|---|
| `read:videos` | `objectTable` block — one clickable row per reachable video `FIL_` |
| `read:videos.kind=session` | same table, filtered — the filter bar is this query as chrome |
| `play:` on a video `FIL_` | the `play` effect (existing path) routed by kind → the **video viewer** opens in the Context panel |
| click an `objectTable` row | `objRef` → the same viewer — the library view is a projection of the same reach |

## Touch & appearance

- **hit**: `row` — the whole tile is the target; the ▶ glyph is decoration, never the only hit.
- **hover**: `always-visible` — transport and tile affordances never hover-revealed on touch; the
  viewer's white-on-scrim controls stay persistent on coarse pointers.
- **gestures**: `swipe-actions` along the **strip** layout's up-next rail; every strip tile stays
  tappable, the visible non-gesture path.
- **density**: `comfortable`.
- **icon**: `film` · **accent**: `var(--chart-3)` — active filter chip, progress bars, and kind
  chips ride the accent channel; every color is a token name.

## Phasing

- **Phase A (sim)** — local playback is **shipped** (the panel's video viewer, persisted
  position). The library lands against the sim: seeded tiles from the registry's video `FIL_`
  objects, client-side filter/sort, watch position in localStorage exactly as the viewer keeps it
  today.
- **Phase B** — Meet recording ingestion via the calendar/meet connection (recording → `FIL_`
  kind `video` + session/case link, tiled under `sessions`); watch position migrates to entity
  data on the `FIL_`; the source chip and last-sync resolve from the live connector.
