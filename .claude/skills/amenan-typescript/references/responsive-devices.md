# Responsive & devices — mobile-first is the brand

Customers land on our web apps from a phone first. A layout that only works at
1280 px is a bug, not a starting point.

## Target device matrix

Logical CSS px, **inner** viewport (what `window.innerWidth/Height` actually
reports with browser chrome on — from the mfehrenbach DevTools gist, June 2025),
plus our Fold6 targets. Import all of them into Chrome DevTools with
`npx @pittankopta/vibranium add -r assets/devices.json`.

| Device | W×H (logical) | W×H (inner) | DPR | Note |
|---|---|---|---|---|
| iPhone SE | 320×568 | 320×449 | 2 | the floor for phone width |
| Common Android (S23-class) | 360×780 | 360×649 | 3 | design here first |
| **Galaxy Z Fold6 — outer (cover)** | ~368×905 | ~368×832 | 2.625 | tall + narrow; one-handed |
| iPhone 15 | 390×844 | 393×659 | 3 | |
| iPhone 15 Plus | 428×926 | 430×739 | 3 | |
| **Galaxy Z Fold6 — inner (unfolded)** | ~707×823 | ~707×750 | 2.625 | near-square; hinge possible |
| iPad Mini (6th) | 744×1133 | 744×1026 | 2 | |
| iPad (10th) | 820×1180 | 820×1073 | 2 | |
| iPad Pro 12.9" | 1024×1366 | 1024×1259 | 2 | the `--bp-md` floor, landscape |
| MacBook Air 13" | 1280×832 | 1280×715 | 2 | `--bp-lg` |
| Studio Display, half | — | 1278×1336 | 2 | tiled desktop windows are real |

Landscape phone variants matter (`isShort()` catches them): iPhone 15 landscape
inner is 743×310 — a bar that assumes 500 px of height dies here.

Fold6 numbers are logical px at default scaling and vary slightly with the
user's screen-zoom setting — treat them as a *band* (outer ≈ 360–390 wide,
inner ≈ 690–740 wide), not exact walls. That's one more reason the ladder uses
bands, not device sniffing.

## The breakpoint ladder (two sources of truth, deliberately)

- **JS**: `BREAKPOINTS` in amenan-ui `src/kernel/responsive.ts` —
  xs 360 · sm 480 · md 600 (Fold-inner edge) · lg 768 (Fold unfolded / iPad
  portrait) · xl 1024 (floor for full chrome) · 2xl 1280.
- **CSS**: `--bp-sm 48rem` / `--bp-md 64rem` / `--bp-lg 80rem` in `base.css`.
  CSS can't `var()` inside `@media`, so each media rule repeats the rem literal
  **and tags it with the token name in a comment** to stay grep-synced. Follow
  that convention in every new media query.

Behaviour ladder in the console: below `--bp-lg` side panels overlay; below
`--bp-md` the rail drawers too; `--bp-sm` is a portrait safety net (usable, not
a target). The Fold6 outer screen lives below `--bp-sm` — it must stay *usable*:
single column, rail drawered, composer full-width.

## JS signals (use sparingly)

Prefer fluid CSS. Reach for `amenan-ui`'s responsive kernel only when
*behaviour* (not style) changes:

```ts
import { device, breakpoint, isTouch, isShort, isFolded, onViewportChange } from "amenan-ui";
```

- `device()` — "phone" | "tablet" | "desktop"; combines pointer/hover with the
  SHORT viewport side (a landscape phone is wide-but-short; a narrow desktop
  window is not a phone).
- `isFolded()` — `(horizontal|vertical)-viewport-segments: 2` — the hinge is
  visible; avoid centering critical UI across the fold. CSS equivalent:
  `@media (horizontal-viewport-segments: 2) { … env(viewport-segment-width 0 0) … }`.
- `onViewportChange(cb, signal?)` — rAF-debounced resize/orientation; always
  pass an `AbortSignal` from your mount for teardown.

## Viewport units

`100vh` lies on mobile (URL bar). Rules:

- Full-height shells: `min-height: 100dvh` (fallback line `min-height: 100vh`
  above it for old engines).
- Anything that must never be covered while chrome is visible: `svh`.
- Never size fixed overlays with `vh`; pair `dvh` with `env(safe-area-inset-*)`
  padding on notched devices (`viewport-fit=cover` in the meta viewport).

## Touch (from the team's touch-friendly canon)

- Targets ≥ **44×44 CSS px** (Apple HIG floor; 48 preferred on Android), with
  ≥ 8 px between adjacent targets — a dense `--row-h: 2.25rem` table row is fine
  because the *row* is the target.
- Primary actions reachable in the thumb zone (bottom half on phones); menus
  reachable within 2 taps; sticky topbar/composer over buried nav.
- Labels concise and visible — icon-only controls get `aria-label` and a
  ≥ 44 px hit area even when the glyph is 16 px (pad, don't scale the glyph).
- No hover-only affordances: anything revealed on `:hover` needs a
  touch-visible path (`isTouch()` or `@media (hover: none)`).
- Font sizes legible without zoom: body ≥ `--text-md`, never below 16 px
  *for inputs* (iOS zooms focused inputs under 16 px — set input font-size
  explicitly).

## Invisible scrollbar — the house default

Scrollable regions hide the scrollbar by default (content scrolls, chrome
doesn't). One utility, one home — app-side it's a `.nu-*` utility in `app.css`
(or upstream it as an amenan atom if other consumers want it):

```css
.nu-scroll {
  overflow: auto;
  -ms-overflow-style: none;   /* IE/legacy Edge */
  scrollbar-width: none;      /* Firefox */
}
.nu-scroll::-webkit-scrollbar { display: none; } /* Chrome/Safari/Opera */
```

Caveats: keep a visible affordance that content scrolls (fade edge, partial
row); never hide scrollbars on huge desktop documents where the bar is the
position indicator; the region must stay keyboard-scrollable (`tabindex="0"` if
it isn't focusable content).
