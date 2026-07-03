# insights — visualize records: charts, dashboards, maps

> Status: proposal (see [README.md](README.md) — one app per purpose). Accent `var(--chart-8)`,
> icon `bar-chart-line`. Recipes, never data copies.

## Purpose

One visualization surface for the whole workspace. A chart is a **recipe** — a measure, a
group-by, a bucket over a source — never a snapshot of rows. A dashboard is a recipe of chart
refs placed on a layout. A map is a chart **kind**, not an app. Because nothing copies data,
every render re-evaluates under the viewer's reach: publishing a dashboard shares the recipe,
and RBAC decides per viewer what each tile shows.

## Absorbs

| store id | tagline (verbatim) | lands as |
|---|---|---|
| `chartbuilder` | "Build a chart from any file with a measure, a group-by, and a bucket." | the chart designer: bar · line · donut · area; spec is a recipe, not a snapshot; opens in the Context chart viewer |
| `dashstudio` | "Compose charts onto a 15×10 tile grid; publish as a shareable dashboard." | the dashboard composer: recipe-only — never copies data; publish with per-viewer reach |
| `mapview` | "Plot any address-bearing records on a map, clustered by region." | a chart **kind** (`map`): geocodes address fields, clusters + heat by measure — the map context archetype |

> Canon note: the `dashstudio` tagline says a "15×10 tile grid" — the layout doctrine
> standardizes chart tiles on **15×9** (the 5:3 family, half of 30×18); the Design-project
> tagline reconciles at the next re-sync (`web/data/console-data.js` stays sim-verbatim until then).

## Objects

| type | prefix | role |
|---|---|---|
| chart | `CHT_` | the recipe: source ref · measure · group-by · bucket · kind (`bar` \| `line` \| `donut` \| `area` \| `map`). **Ships today** — `new:chart` creates a real `CHT_` entity with a live canvas |
| dashboard | `DSH_` | a recipe of chart refs + a `Layout` (the 30×18 DSL) — layouts are data, `validateLayout`-checked before render; publish + reach ride RBAC for free |

No third type for maps: a map is `CHT_` with `kind=map`.

## Views

### Phone (~360)

```
┌────────────────────────────┐
│ insights            ⌕   +  │
│ [ charts ] [ dashboards ]  │
├────────────────────────────┤
│ ▮ Streams by month    CHT_ │
│ ◔ Revenue mix         CHT_ │
│ ◉ Listeners map       CHT_ │
│ ▦ Label overview      DSH_ │
├─ tap → designer (stacked) ─┤
│ ┌────────────────────────┐ │
│ │   live preview (5:3)   │ │
│ └────────────────────────┘ │
│ measure ▾  group-by ▾      │
│ bucket ▾   kind ▾  (sheets)│
├────────────────────────────┤
│ › nacl                  ⏎  │
└────────────────────────────┘
```

Below `--bp-md` the areas stack in source order: gallery, then canvas. Grid editing is
disabled (view-only); pickers open as bottom sheets.

### Context panel (half-open)

A `read:` on a chart or dashboard opens the shipped viewers — the chart canvas and the
`dashboard` viewer in `web/src/console/context-panel.ts`. Half-open, the panel gets the phone
view above (container-first, zero forked code); expanded, it gets the desktop view below.

### Desktop (30×18)

```
┌──────────────┬───────────────────────────────────────────────┐
│ GALLERY      │ CANVAS — the designer OR the composer         │
│ ⌕ search     │                                               │
│ charts       │ designer: one 15×9 canvas                     │
│  ▮ Streams   │ ┌─────────────────────────┐  measure   ▾      │
│  ◔ Revenue   │ │                         │  group-by  ▾      │
│  ◉ Map       │ │      live preview       │  bucket    ▾      │
│ dashboards   │ │                         │  kind      ▾      │
│  ▦ Label     │ └─────────────────────────┘                   │
│              │ composer: a nested 30×18 grid of 15×9 tiles   │
│ + chart      │ ┌─────────┐ ┌─────────┐   drag/resize via     │
│ + dashboard  │ │  tile   │ │  tile   │   the ONE shared      │
│              │ └─────────┘ └─────────┘   grid engine         │
└──────────────┴───────────────────────────────────────────────┘
     8 cols                    22 cols
```

```json
{ "id": "insights", "v": 1, "areas": [
  { "id": "gallery", "x": 0, "y": 0, "w": 8,  "h": 18 },
  { "id": "canvas",  "x": 8, "y": 0, "w": 22, "h": 18 } ] }
```

The canvas hosts either the chart designer (measure/group-by/bucket/kind pickers + live
preview on one 15×9 canvas) or the dashboard composer (15×9 tiles on a nested 30×18 grid —
every chart cell maps to a clean 2×2 block of screen cells). One drag/resize engine, forward
the amenan-ui grid component; never a second implementation.

## Sources model

A recipe points at a **source**, it never contains rows: a saved file object (the thread's
CSVs), a registered-type read (`case`, `users`, any type), or a connector-backed table (the
Store's Databases shelf — substrate, not an app). The gallery aggregates every reachable
recipe in one place; a new source kind is an adapter, zero new UI. Map charts geocode the
source's address fields and cluster + heat by the measure.

**Reach headline:** a published dashboard re-evaluates **reach per viewer** at render — a
viewer without reach to a tile's source rows sees the leak-free empty state, never cached
numbers. Recipe-only is what makes this possible.

## Reuse

- `web/src/console/chart-theme.ts` — token → ECharts option synthesis + `mountNuChart`; the theme reaction re-renders every mounted canvas.
- `web/src/console/context-panel.ts` — the `dashboard` viewer + the chart canvas; viewers stay the only render path.
- `web/src/console/feed.ts` — the `dashboard` block (chart-tile grids render there already) and the `object` / `objectTable` cards for `read:` results.
- `web/vendor/echarts.min.js` — vendored; no CDN at runtime.
- Forward: the amenan-ui grid component (`.amu-grid`, `moveArea`/`resizeArea`) — one engine parameterized `(cols, rows)`, shared between the designer (15×9) and the composer (30×18).

## nacl surface

| input | result |
|---|---|
| `new:chart.type=donut` | **exists today** — creates `CHT_`; object card in the feed; `openObjectId` opens the Context chart viewer with a live canvas |
| `new:chart.kind=map` | `CHT_` with the map kind — geocode + cluster over the source's address fields |
| `new:dashboard.title=…` | creates `DSH_`; object card; opens the dashboard composer in the panel |
| `read:chart` | `objectTable` block — one row per reachable `CHT_` |
| `read:dashboard` | the `dashboard` block (`feed.ts` renders chart-tile grids already); a single row → object card → the viewer |

## Touch & appearance

TouchSpec (declared, not bolted on):

- `hit: "handle"` — designer/composer drag + resize get dedicated ≥ 44px handles; glyphs unscaled.
- `hover: "always-visible"` — tile actions (edit · duplicate · remove) stay visible on coarse pointers.
- `gestures: ["drag-handle"]` — keyboard parity per the DSL doctrine: arrows move, shift+arrows resize a focused area.
- `density: "default"` — pickers (measure / group-by / bucket / kind) become bottom sheets on touch.

Appearance slots: `icon: bar-chart-line` · `accent: var(--chart-8)`. Per-object icon / accent /
label are entity data (the `Customizable` contract), picked with
`web/src/console/icon-picker.ts`; chart colors come from the chart ramp tokens only.

## Phasing

**Phase A (sim)** — charts are **shipped**: `new:chart.type=donut` creates a real `CHT_` with a
live canvas (verified 2026-07-03). This pass adds `DSH_` dashboards rendering with **static
placement**: preset `Layout` data through `validateLayout`, no drag/resize yet; publish is a
field, reach evaluated by the sim.

**Phase B (Rust api)** —

- the amenan-ui grid component — **needs the frozen kernel unlocked** (amenan-ui is pull-only until Em unlocks); the composer's drag/resize waits on it, and the chart designer refactors onto the same engine at 15×9;
- `/api/values` + manifest routes to populate the measure/group-by/bucket pickers;
- per-viewer reach evaluation **server-side**: a dashboard read re-runs each tile's recipe under the caller's reach; a denied source is the empty state, leak-free.
