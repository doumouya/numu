# The numu console — frontend architecture

The console is numu's product surface: a **chat-driven, on-device data
workspace**. You talk to your org's objects in a conversation thread using
nacl; data (CSVs, records, media, dashboards) materializes as **blocks** in the
feed and opens in the right-hand **Context panel**. Multi-tenant, RBAC-scoped.

Built on **amenan-ui** (vanilla TS, zero runtime deps) — ported from the numu
Design System's console kit (`ui_kits/console/`), same layout, same behavior,
no React. The engine behind it is the **NumuClient seam** (see [SEAM.md](SEAM.md)):
phase A runs the design project's in-browser sim; phase B is the Rust api.

## Layout

```
┌──┬──────────────────────────────────────────────────────┐
│  │ topbar — tenant chip (mark · name · sub · driver)     │
│t ├──────────────┬───────────────────────────┬────────────┤
│e │ Objects      │ conversation feed         │ Context    │
│n │ panel        │  (blocks)                 │ panel      │
│a │  overview    │                           │  type-     │
│n │  objects     │                           │  specific  │
│t │  channels →  │                           │  viewer    │
│  │   projects   ├───────────────────────────┤ 27rem ⇄    │
│r │              │ composer: try-chips ·     │ full width │
│a │              │ › nacl prompt · send      │            │
│i │              │ (autocomplete popover ↑)  │            │
│l │              │                           │            │
└──┴──────────────┴───────────────────────────┴────────────┘
```

Expanding the Context panel hides the Objects panel + center (the viewer takes
the full width). The rail's plug button swaps the center for the **connectors
page**. There are exactly two tenants: **numu** (platform) and **ORVCLE** (a
recording studio) — per-tenant accent, projects, objects and feed.

## Modules (`web/src/`)

| module | owns |
|---|---|
| `app.ts` | state + layout + seam wiring (send / saveAttachment / applyEffects / feed bootstrap) + the theme reaction |
| `client.ts` | the typed `ncl` façade over `window.NumuClient` + `ORG_OF`/`PRJ_OF` + `prefetchValues` |
| `console/tenant-rail.ts` | workspace buttons (monogram + active bar) + chrome column + avatar |
| `console/projects-panel.ts` | overview · object list · channels→projects (accent-soft + inset-bar active state) |
| `console/feed.ts` | the block renderers (below) |
| `console/composer.ts` | try-chips · the auto-growing prompt (Enter sends, Shift+Enter newline) · the autocomplete popover DOM |
| `console/nacl-suggest.ts` | PURE staging logic (verb→object→column→operator→value) — unit-tested, no DOM |
| `console/context-panel.ts` | the panel shell + the viewer registry (below) |
| `console/connectors.ts` | the connectors catalog page |
| `console/chart-theme.ts` | token → ECharts option synthesis + `mountNuChart` (direct init on `.nu-` slots) |
| `numu-sim.d.ts` | ambient types over the sim globals — the typed face of the seam |

No framework: state lives in `app.ts`, each region is a mount exposing
`update()`, and a state change re-renders exactly the regions it touches.

## The block vocabulary (feed.ts)

| `type` | renders |
|---|---|
| `email` | sender/time head · subject · body · CSV attachment row with **Save to chat** (→ `saved · on device`) |
| `step` | `› <nacl>` head + kind tag · impact line (✓ ok / ⚠ warn) |
| `data` | the CSV profile: 4-stat grid (rows/cols/null rows/junk) + column rows (KindLabel dtype + null%) |
| `dashboard` | hairline chart grid, one live ECharts canvas per tile |
| `object` | a clickable card (type tag · title · meta) → opens the Context panel via `objRef` |
| `sent` / bubble | chat bubbles (sent = accent tint, right-aligned; reactions) |

## The viewer registry (context-panel.ts)

`object.type` → viewer: `audio` (art square + scrubber + transport) · `video`
(16:9 + transport) · `image` (hero + thumb strip) · `dashboard` (chart tiles) ·
`connector` (config: host/port/db/user + connection string + test/disconnect,
or account/scopes/last-sync for OAuth kinds) · `app` (iframe) · `case`/`record`
(code chip + status badge + **workflow stepper** + field rows + actions).
Media are on-brand placeholder surfaces until real assets land.

## nacl in the console

- **Send**: `app.ts#send` → `ncl.nacl(text, ctx)` with
  `ctx = { workspace, projectId, itFileId, channel }`; a `needBlob` effect
  triggers `ensureBlob` + one retry (derive-don't-store: the original bytes
  refetch by the `src` recorded at upload). Blocks append to the feed +
  persist; effects apply client-side.
- **Effects**: `theme` (mode dark|light · accent ink|blue — no settings page),
  `closePanel`, `play` (→ the audio viewer), `it` (the thread's focused file).
- **Autocomplete**: `nacl-suggest.ts` staging over three planes — the thread's
  materialized csvs (from the feed's `data` blocks), the lazy column-distinct
  values cache (`window.__NUMU_VALUES`, prefetched per upload), and the
  doctrine catalog (`window.NACL_COMMANDS.objects`). RBAC-scoped by
  construction: only reachable files/objects are in those planes. ↑↓ cycle,
  Tab/⏎ accept, Esc dismiss, click works.

## Theme

Two-axis amenan-ui platform: `data-theme` (`numu` ink | `numu-blue`) ×
`data-mode` (light | dark); default **numu + light** (the index.html prePaint
snippet — deliberately not the amenan default). `set:theme.mode=dark` and the
rail buttons are the same one-attribute write. Charts carry explicit
token-resolved colors, so the theme reaction re-renders the chart-bearing
regions (see [THEME.md](THEME.md)).

## Verified behavior (phase A, 2026-07-03)

Local driver: dossier.csv (14 MB · 101,234 rows · wrapped · windows-1252 ·
cleanness 35%) saved → `unwrap` (17 cols · 49.8%) → `repair` → `clean` (99.6%)
→ `rename dots` → `new:chart.type=donut` (a real CHT_ entity · 6 buckets, live
canvas); autocomplete staged; `set:theme.mode=dark` + accent swap; reload →
feed persists, the table **re-derives** from blob+steps on demand. HTTP driver
(`?http=1` against `web/sim/server.node.js`): same page, `· node` chip,
`read:case.status=master` sees state mutated via curl; 428/412/422/404 error
contract verified. Run it: `npm run dev` → http://localhost:8940.
