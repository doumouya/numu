# numu-layout — the 30×18 screen grid (canonical layout system)

A Bootstrap-like layout discipline for Vanilla TS + CSS, powered by amenan-ui
tokens, PWA-first, and ready for server-driven layouts from birama-engine. It
replaces ad-hoc page CSS with one canonical grid — console, RBAC explorer,
dashboards, workbenches all speak it.

## The 30×18 canvas model

Modern screens cluster around 16:9, 16:10, and 3:2. A **15:9 logical canvas
(30 columns × 18 rows)** sits comfortably inside all three, so one grid adapts
everywhere with minimal stretch — and it's a direct 2× extension of the chart
designer's 16×10 canvas, so the drag/resize mental model carries over.

- Columns 30 · rows 18 · cell size computed from the viewport.
- **One ratio family**: 30×18 reduces to 5:3 = 15:9, so the chart/widget
  designer canvas is **15×9** — the same ratio at half scale. Every chart cell
  maps to a clean 2×2 block of screen cells, so a chart drops onto a dashboard
  with integer-perfect geometry. The legacy 16×10 chart canvas (8:5, never maps
  cleanly) migrates via `migrateLayout(layout, {from: [16,10], to: [15,9]})` —
  proportional snap + clamp — in a one-off sweep; the engine stays
  parameterized so legacy renders until migrated.
- Full-screen by default: the shell occupies the viewport; *content* scrolls
  inside areas (with the hidden-scrollbar default), the grid itself doesn't.
- The grid is a **md-and-up behaviour**: below `--bp-md` areas stack in source
  order (a 30-col cell on a 368px Fold6 outer screen is 12px — unusable).
  The Fold6 *inner* screen (~707×750, near-square) is where 30×18 shines on
  mobile — keep hinge awareness (`isFolded()`) when placing critical areas.

## Where it lives (ownership — decided, not optional)

This is **platform tier**: it goes in amenan-ui as a component
(`src/components/grid/{grid.ts,grid.css}`, classes `.amu-grid` /
`.amu-grid-area`), exported from the barrel, sheet added to `web-build.sh`
(C4). numu ships only *layout data* (presets) and `.nu-*` content inside areas.
Don't create a `.numu-*` third namespace — two owners is the whole discipline.

Grid tokens are shared structure → amenan `base.css`:

```css
:root {
  --grid-cols: 30;
  --grid-rows: 18;
}
```

## CSS foundation

```css
/* amenan-ui src/components/grid/grid.css — single owner of .amu-grid* */
.amu-grid {
  inline-size: 100%;
  block-size: 100dvh;            /* NEVER 100vh/100vw: mobile chrome + scrollbar overflow */
  display: grid;
  grid-template-columns: repeat(var(--grid-cols), 1fr);
  grid-template-rows: repeat(var(--grid-rows), 1fr);
  gap: var(--gap);
}
.amu-grid-area {
  grid-area: var(--area);        /* set per-element by the renderer */
  min-inline-size: 0;            /* grid items must be allowed to shrink */
  min-block-size: 0;
  padding: var(--sp-2);          /* amenan token names: --sp-*, not --amenan-space-* */
}
@media (max-width: 64rem) { /* --bp-md */
  .amu-grid { display: flex; flex-direction: column; block-size: auto; min-block-size: 100dvh; }
  .amu-grid-area { grid-area: auto; }
}
```

**Why `--area` and not `attr()`:** `grid-column: attr(data-col-start)` does not
work — CSS `attr()` outside `content` is not usable in stable engines. Geometry
is *data*, so the renderer writes one custom property per area
(`el.style.setProperty("--area", "3 / 1 / 19 / 7")`). Inline geometry is fine;
inline *colors* are still C1 drift.

## TypeScript DSL (in amenan-ui, Mount-contract shaped)

```ts
type Col = number; // 0..30
type Row = number; // 0..18

export interface Area {
  id: string;
  x: Col; y: Row; w: Col; h: Row;
  z?: keyof typeof Z;          // named layers, not raw numbers
  className?: string;          // a .nu-* content class, composed not restyled
}
export interface Layout { id: string; v: 1; areas: Area[] }

const Z = { base: "var(--z-base)", rail: "var(--z-rail)", panel: "var(--z-side-panel)" } as const;

export function renderLayout(layout: Layout, host: HTMLElement, ctx: MountCtx): MountHandle {
  const root = el("div", { class: "amu-grid", role: "presentation" });
  for (const a of validateLayout(layout).areas) {
    const cell = el("div", { class: cx("amu-grid-area", a.className) });
    cell.style.setProperty("--area", `${a.y + 1} / ${a.x + 1} / ${a.y + a.h + 1} / ${a.x + a.w + 1}`);
    if (a.z) cell.style.zIndex = Z[a.z];
    cell.dataset.areaId = a.id;   // ids are data — esc() anything rendered from them
    root.append(cell);
  }
  host.append(root);
  return { destroy: () => root.remove() }; // listeners ride ctx.signal
}
```

`validateLayout` is load-bearing (layouts will arrive as JSON from
birama-engine): clamp `0 ≤ x, x+w ≤ 30`, `0 ≤ y, y+h ≤ 18`, `w,h ≥ 1`, reject
unknown schema versions, and (by default) reject overlaps unless both areas
declare `z`. Never trust server geometry into `style` without it.

## Drag & resize — ONE engine

The chart designer already ships grid drag/resize. Do **not** write a second
implementation: extract it into the grid component parameterized by
`(cols, rows)` — pure functions, clamped, identical between charts (15×9) and
screens (30×18):

```ts
export const moveArea = (a: Area, dx: number, dy: number, cols = 30, rows = 18): Area => ({
  ...a,
  x: Math.max(0, Math.min(cols - a.w, a.x + dx)),
  y: Math.max(0, Math.min(rows - a.h, a.y + dy)),
});
export const resizeArea = (a: Area, dw: number, dh: number, cols = 30, rows = 18): Area => ({
  ...a,
  w: Math.max(1, Math.min(cols - a.x, a.w + dw)),
  h: Math.max(1, Math.min(rows - a.y, a.h + dh)),
});
```

Pointer handling: Pointer Events (`setPointerCapture`), keyboard parity
(arrows move, shift+arrows resize when an area has edit focus), touch drag
handles ≥ 44px.

## Responsive behaviour (aligned to the house ladder)

| band | behaviour |
|---|---|
| below `--bp-md` (64rem) | areas stack in source order; rail is a drawer; grid editing disabled (view-only) |
| `--bp-md`–`--bp-lg` | grid active; side areas may overlay (`--z-side-panel`) |
| `--bp-lg`+ (80rem) | full 30×18, all areas placed |

Per-breakpoint layouts are **multiple `Layout` objects** selected via
`breakpoint()`/`onViewportChange` — not media-query position remaps (CSS can't
express layout *data*, and birama-engine will eventually serve per-device-class
layouts using the same mechanism). Media queries handle only the stack/grid
mode switch, tagged with the token-name comment convention.

## Container-first: the context panel is the proof

The platform pattern: an object recorded in the chat/thread view **renders in
the Context panel** — music player, video player, document reader, table,
dashboard, connected Gmail/Calendar. Half-open, the panel shows the *mobile*
view; expanded to full width, the *desktop* view. That works with zero forked
code only if components respond to their **container, not the viewport**:

- Every app view is authored against **container bands** (same ladder as the
  breakpoints: 360/480/600/768/1024, via `@container` queries or a
  ResizeObserver signal the grid component exposes on each area).
- The viewport is just the outermost container; `device()` decides *input*
  behaviour (touch/keyboard), the container decides *layout*.
- Consequence: a view is "panel-ready" by construction — the App Store contract
  is "renders correctly at any container width ≥ 320px", testable mechanically.

## Stages — ultrawide (34") and dual-screen

A **stage** is one 30×18 canvas. Screens host one or more stages:

- Standard desktop: one stage; the context panel overlays/docks inside it.
- **Ultrawide** (`@media (min-width: 120rem) and (min-aspect-ratio: 2/1)`
  `/* --bp-uw */`): primary stage + the context panel **promoted to its own
  full stage, open by default** — numu is the first app UI optimized for 34"
  monitors, and this is the convention that makes it so.
- **Dual-screen / foldable-open**: same stage model driven by
  `viewport-segments` media queries (and the Window Management API when
  windows span monitors) — each segment/screen is a stage; never center
  critical UI across the seam.

Stages keep the App Store convention survivable: an app declares which stages
it can fill (`main`, `context`, `both`); the shell owns stage allocation.

## Icon-first (responsiveness + i18n by subtraction)

Prefer icons **without text** for chrome and repeated actions — icons don't
reflow and don't translate, so both responsive layout and localization get
cheaper. Guardrails that keep it honest:

- Textless only for **established metaphors** (gear, search, plus, grid,
  sidebar…); a novel action keeps its label until the metaphor is earned.
- Every icon-only control: translated `aria-label` + tooltip (hover) /
  long-press hint (touch) + ≥ 44px hit area (pad, don't scale the glyph).
- All glyphs go through the **icon registry** (logical name → Bootstrap Icons
  class today; Material/Tabler/Phosphor swappable later) — never a raw `bi-*`
  string in app code, so an icon-pack swap is a registry change.

## The Customizable contract (the O(1) mantra, one more layer)

The channel-creation icon picker was the prototype: **every platform component
anticipates customization by default**. Formalize it:

```ts
interface Customizable {
  /** Declared slots this component exposes. */
  slots: Partial<{
    icon: IconName;          // from the icon registry
    accent: TokenName;       // a --brand-channel token, never a raw color
    label: string;           // display name (escaped at render)
    density: "compact" | "default" | "comfortable";
  }>;
  /** The declared touch-optimized variant — how this component adapts on a
      coarse pointer. Declared, not bolted on. */
  touch: TouchSpec | "inherit"; // "inherit" = composed children carry it
}

interface TouchSpec {
  /** How the ≥44px floor is met: the whole row is the target, the control
      pads to 44 (glyph unscaled), or a dedicated drag handle appears. */
  hit: "row" | "pad-44" | "handle";
  /** What replaces hover-revealed affordances on touch. */
  hover?: "always-visible" | "overflow-menu" | "long-press";
  /** Gestures the touch variant adds (each with a visible non-gesture path). */
  gestures?: Array<"swipe-actions" | "swipe-dismiss" | "pull-refresh" | "drag-handle">;
  /** Touch retunes density upward by default. */
  density?: "comfortable";
}
```

The variant resolves automatically — `isTouch()` (or a coarse-pointer container
signal) picks the declared `TouchSpec`; no call-site branching. The field is
**required**: a component with no touch story can't ship, which is the point —
the review question stops being "did anyone think about touch?" and becomes
"is the declaration right?". A **touch-contract gate** enforces it mechanically
once the contract lands (every interactive `.amu-*` component exports
`Customizable` with a `touch` field). Every gesture keeps a visible non-gesture
alternative — gestures are accelerators, never the only path.

- Values are **entity data** in the type-registry (a `customization` field on
  the object) — so RBAC, audit, and the close-gate apply to customization for
  free, and birama-engine can serve it with the layout.
- Rendering goes through the registry/tokens only — a customization can never
  introduce a raw color or an unregistered glyph (drift-safe by construction).
- One picker set (icon picker exists: `web/src/console/icon-picker.ts`; add
  accent + density pickers) reused across every app — customizing a *new*
  component is O(1): declare the slots, done.

## Typography & icons (theme tier, not component tier)

- **System fonts first.** The stack ships as the theme's `--font` palette token
  — components never declare `font-family` literals:
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif`.
- **Google Fonts are opt-in per theme and self-hosted** (vendored woff2 under
  `vendor/fonts/`, preloaded, `font-display: swap`) — a PWA must not depend on
  fonts.googleapis.com at runtime (offline-first + no third-party beacon).
  Candidates: Inter, Roboto, Source Sans 3; JetBrains Mono may retune
  `--font-mono` for console/workbench themes.
- **Bootstrap Icons is the default icon set** — already vendored
  (`web/vendor/bootstrap-icons/`). Compose `<i class="bi bi-gear"></i>` (or the
  `amu-icon` wrapper); icon-only controls get `aria-label` + a ≥ 44px hit area.
  Future packs (Material Symbols, Tabler, Phosphor) arrive through an amenan-ui
  icon registry mapping logical names → glyphs, so swapping packs is a registry
  change, not a codebase grep.

## birama-engine integration (future, design now)

The backend emits layouts as data:

```json
{ "id": "console", "v": 1, "areas": [
  { "id": "header",  "x": 0, "y": 0,  "w": 30, "h": 2 },
  { "id": "sidebar", "x": 0, "y": 2,  "w": 6,  "h": 16 },
  { "id": "main",    "x": 6, "y": 2,  "w": 24, "h": 16 } ] }
```

Rules: schema is versioned (`v`); the frontend `validateLayout`s and clamps
before render; area `id`s map to registered mounts (unknown id → empty-state
component, never a crash); RBAC filters *areas server-side* (an area the user
can't see is absent, not hidden — leak-free like the 404 posture).

## Deliverables & gates

- `amenan-ui grid` component: types, `validateLayout`, renderer, move/resize
  engine (shared with chart designer), `grid.css`. Barrel-exported.
- numu presets (`web/src/console/layouts.ts`): console, RBAC explorer,
  dashboard, workbench — pure `Layout` data, unit-testable.
- **layout-audit gate** (`tools/layout-audit/audit.sh`): every preset in
  bounds, no undeclared overlaps, every area id resolves to a registered mount.
- Chart designer refactored onto the shared engine at **15×9** (one-off 16×10
  migration sweep) — the moment there are two grid engines, that's drift; the
  gate era taught us what happens next.
- Icon registry + `Customizable` slots in amenan-ui; an **icon-registry gate**
  (no raw `bi-*` strings in app TS) once the registry lands.
