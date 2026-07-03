# player — play music from an on-device file or a connected subscription

> **Status: proposal** (see [README.md](README.md)). Accent `var(--chart-4)` · icon
> `music-note-beamed`.

## Purpose

One app to play music. The streaming-brand tiles collapse into **sources** inside a single
library: an on-device audio file and a Spotify-subscription track sit in the same list, join the
same queue, and open the same viewer. The artist side (for-Artists stats) rides the same surface
as a tab, not a second app. Aggregation is the product: **one queue across sources** is the thing
no brand app can show.

## Absorbs

| store id | source role |
|---|---|
| `spotify` | Spotify for Artists — "Pull streams, listeners, and playlist adds for every artist." Daily streams + listeners series, playlist adds → the Stats tab. |
| `apple` | Apple Music — "Streams and Shazams from Apple Music for Artists." Plays + Shazam counts, editorial adds, city-level listener map → the Stats tab. |
| — (local) | Audio `FIL_` objects — the on-device source; not a store id, already first-class in the registry. |

Each absorbed brand survives as a row in the Sources panel (the existing `connector` viewer:
logo, connection state, scopes) — never its own surface.

## Objects

| type | `PREFIX_` | role |
|---|---|---|
| playlist | `PLS_` | name · owner · ordered track refs · icon/accent (Customizable slots) |
| audio file | `FIL_` | the local track — the existing file object with an audio blob; **no new type** |

A **track** is either a `FIL_` ref or an inline provider ref `{uri, provider, duration}` carried
in the playlist's track refs and the queue — there is deliberately **no duplicate track type**.
**Artist** stays a viewer concept (the sim groups artists from real audio files — `buildLive`),
not a registered type. **Stream stats are source projections**: derived from the connected
for-Artists sources on read, never stored as entities.

## Views

Nav (Library / Artists / Playlists / Stats), a content list/grid, and a **persistent
now-playing bar**. Library = an objectTable of audio rows with a source column; Artists = cards
opening the shipped artist viewer; Playlists = `PLS_` cards; Stats = per-artist streams/listeners
chart tiles (specs authored on the 15×9 chart canvas, rendered via `mountNuChart`).

### Phone (~360)

```
┌──────────────────────────┐
│ ♪ player            ⌕  ⋯ │
├──────────────────────────┤
│ Library·Artists·Playl·St │
├──────────────────────────┤
│ ▸ Midnight Run      3:42 │
│ ▸ Cold Water   ◈    4:05 │
│ ▸ Ivory             2:58 │
│ ▸ Slow Sun     ◈    3:21 │
│   …                      │
├──────────────────────────┤
│ ▶ Midnight Run   ◁ ▶ ▷   │
└──────────────────────────┘
```

Areas stack in source order below `--bp-md`; the nav rail becomes the tab strip, the now-playing
bar pins to the container bottom. `◈` = subscription badge (streams via a provider).

### Context panel (half-open)

Container-first: half-open (27rem) the panel renders the phone view verbatim — no forked code.
A track played from the feed opens the shipped audio viewer; an artist card opens the shipped
artist viewer; expanding the panel to full width yields the desktop grid.

### Desktop (30×18)

```
┌────────────┬─────────────────────────────────────────────┐
│ ♪ player   │ Library                          ⌕  sources │
│            ├─────────────────────────────────────────────┤
│ ▸ Library  │ ▸ Midnight Run    NOVA   local        3:42  │
│   Artists  │ ▸ Cold Water      NOVA   spotify  ◈   4:05  │
│   Playlists│ ▸ Ivory           AKAN   local        2:58  │
│   Stats    │ ▸ Slow Sun        AKAN   apple    ◈   3:21  │
│            │                                             │
│ Sources    │                                             │
│  spotify ● │                                             │
│  apple   ○ │                                             │
├────────────┴─────────────────────────────────────────────┤
│ ▶ Midnight Run — NOVA   ◁ ▶ ▷   ════●────    2:10 / 3:42 │
└──────────────────────────────────────────────────────────┘
```

```json
{ "id": "player", "v": 1, "areas": [
  { "id": "nav",         "x": 0, "y": 0,  "w": 6,  "h": 16 },
  { "id": "content",     "x": 6, "y": 0,  "w": 24, "h": 16 },
  { "id": "now-playing", "x": 0, "y": 16, "w": 30, "h": 2 } ] }
```

The Artist view is the **shipped artist viewer** unchanged: hero, plays/tracks stats, featured
track list → the player, discography grid (`web/src/console/context-panel.ts`). The Stats tab
lays streams/listeners tiles per artist inside `content`, fed by the for-Artists sources.

## Sources model

Three sources, one queue. **Play resolves the local blob first**: an on-device `FIL_` audio
plays in the shipped real-`<audio>` viewer (persisted position, cover art, seek + transport).
No local blob → the track streams through its connected provider and the row carries the
subscription badge. The queue is one ordered list across sources — advancing from a local track
into a Spotify track is seamless; that is the whole point. Disconnecting a provider greys its
tracks in place (visible, unplayable) rather than deleting library rows.

## Reuse

- **audio viewer** — real `<audio>` playback, persisted position, cover art
  (`web/src/console/context-panel.ts`).
- **artist viewer** — hero + stats + featured list + discography, as shipped
  (`web/src/console/context-panel.ts`).
- **chart-theme** — token → ECharts synthesis + `mountNuChart` for the Stats tiles
  (`web/src/console/chart-theme.ts`).
- **objectTable block** — track lists and `read:` results (`web/src/console/feed.ts`).
- **icon picker** — playlist icon/accent via the Customizable slots
  (`web/src/console/icon-picker.ts`).
- **connector viewer** — the Sources panel rows (`web/src/console/context-panel.ts`).

## nacl surface

| input | result block / effect |
|---|---|
| `play:<file>` | the `play` effect — **exists today**: opens the audio viewer in the Context panel (`web/src/app.ts` applyEffects) |
| `read:artist` | artist object card → the artist viewer |
| `read:streams.artist=NOVA` | chart block — streams/listeners series from the connected sources |
| `new:playlist.name=…` | `PLS_` create → object card, opens in the panel (`openObjectId`) |
| `read:playlist` | objectTable of reachable `PLS_` rows |

## Touch & appearance

- **hit**: `row` — track rows, playlist cards, and nav items are whole-row targets; now-playing
  transport controls pad to ≥ 44px (glyph unscaled).
- **hover**: `long-press` — icon-only transport gets the long-press hint on touch, tooltip on
  pointer.
- **gestures**: `swipe-dismiss` on queue items — a visible remove button remains the
  non-gesture path.
- **density**: `comfortable`.
- **icon**: `music-note-beamed` · **accent**: `var(--chart-4)`; playlist icon/accent are entity
  data through the Customizable slots (registry glyphs + chart-ramp tokens only).

## Phasing

- **Phase A (sim)** — local playback is **shipped** (the audio viewer + the `play` effect);
  playlists land as `PLS_` registered entities; Stats renders projections faked from the seed.
- **Phase B** — provider OAuth for the two for-Artists sources, stream resolution for
  provider-ref tracks, and scheduled stats sync via the numu-sync service-account pattern
  already in the seed. New provider = connector row + source adapter, zero new UI.
