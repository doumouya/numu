# The 30×18 layout grid (the human guide)

You're about to lay out a screen in numu — a dashboard, a workbench, the console
shell, a new app's desktop view. This guide walks you through the grid you'll do
it on: **30 columns × 18 rows**, where a layout is *data* (a little list of
rectangles), not hand-written CSS. It's the friendly twin of the agent-facing
spec.

> **The authoritative contract** is the `amenan-typescript` skill's
> [`references/numu-layout.md`](../../.claude/skills/amenan-typescript/references/numu-layout.md)
> (reached through the [skill](../../.claude/skills/amenan-typescript/SKILL.md)).
> That file owns the exact rules — class names, validation bounds, the touch
> contract. This page teaches you how to *use* them. When the two disagree, the
> skill wins.

## Why 30×18 (and not "just CSS")

Every screen you'll target clusters around three aspect ratios: **16:9**
(most monitors and phones), **16:10** (many laptops), and **3:2** (Surface,
some tablets). A **15:9 logical canvas** sits comfortably inside all three with
minimal stretch, so *one* grid adapts everywhere. Double it and you get
**30 columns × 18 rows** — the canvas you place areas on.

The doubling isn't cosmetic. 30×18 reduces to 5:3, which is exactly 15:9 — so
the **chart/widget designer canvas is 15×9**, the same ratio at half scale.
That means:

- Every chart cell maps to a clean **2×2 block** of screen cells.
- A chart you built on the 15×9 designer drops onto a 30×18 dashboard with
  integer-perfect geometry — no half-pixels, no re-snapping.
- The drag/resize mental model you learn on charts is the same one you use on
  screens. (One engine really does drive both — see below.)

> The old chart canvas was 16×10 (8:5), which never mapped cleanly. It migrates
> once, via `migrateLayout(layout, {from: [16,10], to: [15,9]})` — a
> proportional snap + clamp — and the engine stays parameterized so legacy
> charts still render until they're swept.

## A layout is DATA, not CSS

This is the part that changes how you work. You don't write
`grid-column: 3 / 7`. You describe **areas** — named rectangles — as plain data:

```ts
interface Area {
  id: string;   // "header", "sidebar", "main" — maps to a mount
  x: number;    // left column,  0..30
  y: number;    // top row,      0..18
  w: number;    // width in columns
  h: number;    // height in rows
}
interface Layout { id: string; v: 1; areas: Area[] }
```

Here's a real console layout — a header strip, a sidebar, and a main panel:

```json
{ "id": "console", "v": 1, "areas": [
  { "id": "header",  "x": 0, "y": 0, "w": 30, "h": 2  },
  { "id": "sidebar", "x": 0, "y": 2, "w": 6,  "h": 16 },
  { "id": "main",    "x": 6, "y": 2, "w": 24, "h": 16 } ] }
```

Read it like a floor plan: the header runs the full 30 columns, 2 rows tall,
pinned to the top-left origin `(0,0)`. The sidebar starts on row 2, is 6 columns
wide and fills the remaining 16 rows. Main takes the rest — starts at column 6,
24 wide, 16 tall. Add them up: `6 + 24 = 30` across, `2 + 16 = 18` down. It fits
the canvas exactly.

**Why data and not CSS?** Because data is portable and checkable:

- **It validates.** Before anything renders, `validateLayout` clamps every area
  to `0 ≤ x, x+w ≤ 30` and `0 ≤ y, y+h ≤ 18`, requires `w,h ≥ 1`, rejects
  unknown schema versions (that's what `v: 1` is for), and rejects overlaps
  unless the overlapping areas explicitly declare a `z` layer. Geometry you
  didn't sanity-check never reaches the browser's `style`.
- **The backend can serve it.** birama-engine will eventually emit layouts as
  this same JSON — versioned, validated on arrival, per-viewer. And it's
  **leak-free the way the API's 404 posture is**: RBAC filters *areas
  server-side*, so an area you're not allowed to see is simply **absent** from
  the payload, never sent-and-hidden. An unknown `id` renders an empty-state
  component, never a crash.

You author layouts as `Layout` objects (numu keeps its presets in
`web/src/console/layouts.ts` when the component lands) — pure data you can
unit-test with no DOM.

## Who owns the grid CSS (`.amu-grid`, and only that)

The grid is **platform tier**: it lives in amenan-ui as a component, and it owns
exactly two class names — `.amu-grid` (the canvas) and `.amu-grid-area` (a
rectangle in it). numu ships only **layout data** (the presets above) and
**`.nu-*` content** *inside* the areas.

There is no third namespace. Do not invent `.numu-grid` or a `.numu-*` layout
class — two owners (amenan structure, numu content) *is* the whole discipline,
and the `css-drift` gate is there to keep it that way. If you catch yourself
writing grid CSS in numu, stop: the geometry is data, and the container styling
belongs to amenan-ui.

## Container-first: why your view gets the phone layout for free

Here's the payoff that makes the whole platform hang together. A view in numu
answers to **its container, not the viewport.**

The proof is the **Context panel**. An object dropped into a chat thread renders
in that panel — a music player, a document reader, a table, a dashboard, a
connected Gmail. When the panel is **half-open**, it's narrow, so the object
shows its **phone view**. Dragged **full-width**, the same object shows its
**desktop view**. Zero forked code — because the view was authored against
**container bands** (360 / 480 / 600 / 768 / 1024), not against `window.width`.

So when you build a view correctly:

- The viewport is just the *outermost* container. `device()` decides *input*
  (touch vs keyboard); the container decides *layout*.
- Your view is **"panel-ready" by construction** — the App Store contract is
  literally "renders correctly at any container width ≥ 320px", and it's
  testable mechanically.

You'll see this contract in action in
[USING-THE-CONSOLE.md](USING-THE-CONSOLE.md) — the Context panel is where a
person feels container-first working.

## The responsive bands (and where the grid switches off)

The 30×18 grid is a **medium-and-up behaviour**. Below the `--bp-md` breakpoint
(64rem) a single 30-column cell is only ~12px on a 368px phone — unusable — so
areas **stack in source order** instead:

| band | what happens |
|---|---|
| below `--bp-md` (64rem) | areas stack top-to-bottom in source order; the rail becomes a drawer; grid **editing is off** (view-only) |
| `--bp-md` → `--bp-lg` | grid active; side areas may overlay (`--z-side-panel`) |
| `--bp-lg`+ (80rem) | full 30×18, every area placed |

One nuance worth knowing: per-breakpoint layouts are **separate `Layout`
objects** selected in code (`breakpoint()` / `onViewportChange`), *not* media
queries that shuffle positions. CSS can't express layout *data*, and the same
selection mechanism is how birama-engine will serve per-device-class layouts.
Media queries only flip the stack ↔ grid mode.

> The full responsive ladder — the breakpoint tokens, the Galaxy Z Fold6
> inner/outer screens, the hinge-awareness — lives in
> [RESPONSIVE.md](RESPONSIVE.md). One tip that matters here: the Fold6 *inner*
> screen (~707×750, near-square) is where 30×18 actually shines on a phone.

## Drag & resize: one engine, two canvases

When you make a layout editable — dragging an area, resizing a tile — you are
**not** writing new drag code. The chart designer already ships grid
drag/resize; the grid component extracts it into pure, clamped functions
parameterized by `(cols, rows)`, identical for charts (15×9) and screens
(30×18):

```ts
moveArea(area, dx, dy, cols = 30, rows = 18)   // clamps so the area stays in bounds
resizeArea(area, dw, dh, cols = 30, rows = 18) // clamps so w,h ≥ 1 and no overflow
```

Move an area past the left edge and it clamps to column 0; resize it past the
right edge and it stops at the wall. Pointer handling uses Pointer Events with
`setPointerCapture`, there's **keyboard parity** (arrows move, shift+arrows
resize when an area has edit focus), and touch drag handles are **≥ 44px**. The
moment a second grid engine exists, that's drift — the gate era taught the team
exactly what happens next.

## Stages: ultrawide and dual-screen

A **stage** is one 30×18 canvas. A screen hosts one or more stages:

- **Standard desktop** — one stage; the Context panel docks or overlays inside
  it.
- **Ultrawide** (34" monitors, `--bp-uw`) — the primary stage *plus* the
  Context panel **promoted to its own full stage, open by default**. numu is
  built to be one of the first app UIs that actually rewards a 34" monitor
  instead of stretching to fill it.
- **Dual-screen / foldable-open** — the same stage model, driven by
  `viewport-segments` media queries. Each screen segment is a stage. The rule to
  remember: **never center critical UI across the seam.**

An app declares which stages it can fill (`main`, `context`, or `both`); the
shell owns handing them out.

## Icon-first (cheaper responsive, cheaper i18n)

Prefer **icons without text** for chrome and repeated actions. An icon doesn't
reflow and doesn't need translating, so both responsive layout and localization
get cheaper by subtraction. The guardrails that keep it honest:

- Textless only for **established metaphors** (gear, search, plus, grid,
  sidebar). A novel action keeps its label until the metaphor is earned.
- Every icon-only control needs a translated `aria-label` + tooltip (hover) /
  long-press hint (touch), and a **≥ 44px** hit area — pad the control, don't
  scale the glyph.
- All glyphs go through the **icon registry** (a logical name like `envelope` →
  a Bootstrap Icons class today, swappable to Material/Tabler/Phosphor later) —
  never a raw `bi-*` string in app code.

## Customization is declared, not bolted on

Every platform component **anticipates customization** and **declares a touch
story** up front, via one contract:

```ts
interface Customizable {
  slots: Partial<{
    icon: IconName;      // an icon-registry name
    accent: TokenName;   // a token like --chart-6, never a raw color
    label: string;       // display name, escaped at render
    density: "compact" | "default" | "comfortable";
  }>;
  touch: TouchSpec | "inherit";   // REQUIRED — no touch story, no ship
}
```

The `touch` field is *required* on purpose: a component with no touch plan
can't ship, so the review question stops being "did anyone think about touch?"
and becomes "is the declaration right?". The variant resolves automatically —
`isTouch()` (or a coarse-pointer container signal) picks it, no call-site
branching — and every gesture keeps a visible non-gesture path (gestures are
accelerators, never the only way).

Because a component's `icon` / `accent` / `label` / `density` are **entity
data** in the type-registry, customization inherits RBAC, audit, and the
close-gate for free, and birama-engine can serve it alongside the layout. This
is exactly the pin & icon-suggestion flow the apps use — see
[../apps/DATA-MODEL.md](../apps/DATA-MODEL.md) for how an app's declared `icon`
slot seeds the Object-Rail picker and how a personal override stays *your* data,
never the app's.

## Honest status: the component isn't built yet

Read this before you go looking for `grid.ts`. **The grid component does not
exist in the codebase today.** It lands in amenan-ui when the freeze lifts
(amenan-ui is frozen pull-only; Em unlocks it). What *does* exist right now is
**design**: the specification above, and the app proposals in
[../apps/README.md](../apps/README.md) already write their desktop views as
30×18 `Layout` JSON, so the presets are ready the day the renderer arrives.

So when you "lay out a screen" today, you are authoring **layout data** against
a validated contract — not calling a shipped renderer. That's deliberate: the
data is real and checkable now, and it renders unchanged the moment the
component ships.

## See also

- [RESPONSIVE.md](RESPONSIVE.md) — the breakpoint ladder, devices, the Fold6
  inner/outer screens.
- The [`amenan-typescript` skill](../../.claude/skills/amenan-typescript/SKILL.md)
  and its
  [`numu-layout` reference](../../.claude/skills/amenan-typescript/references/numu-layout.md)
  — the authoritative contract this guide teaches.
- [../apps/DATA-MODEL.md](../apps/DATA-MODEL.md) — pins & customization as
  entity data.
- [../apps/README.md](../apps/README.md) — the app proposals that already spec
  their 30×18 layouts.
- [USING-THE-CONSOLE.md](USING-THE-CONSOLE.md) — the container-first Context
  panel in the hands of a person.
