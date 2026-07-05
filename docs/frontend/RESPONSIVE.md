# Mobile-first & responsive — the human guide

Your customers land on numu from a phone. Not a phone *eventually* — a phone
*first*. A screen that only looks right at 1280 px isn't "not yet responsive," it's
broken for most of the people who'll ever open it.

This is the friendly walkthrough. The authoritative, agent-facing version — the one
the CI gates were written against — lives in the **amenan-typescript skill**:
[`SKILL.md`](../../.claude/skills/amenan-typescript/SKILL.md) and its
[`references/responsive-devices.md`](../../.claude/skills/amenan-typescript/references/responsive-devices.md)
(the full device matrix + the DevTools import file). When this guide and the skill
ever disagree, the skill wins. Here's how you actually use it.

## Why you design at 360 first

Pick the smallest *real* phone you'll support and build there, then enhance upward.
That floor is a common Android (S23-class) at **360×780**. Below that you have the
iPhone SE at 320 — treat it as the hard floor, not your canvas.

The reason this works and "desktop-first, shrink later" doesn't: adding space is
easy, taking it away is a rewrite. If it reads and taps cleanly at 360, every wider
screen is a bonus. If you start at 1280, 360 is a bug report.

So: single column first. One primary action visible. Panels and rails *earn* their
place as the viewport grows.

## The breakpoint ladder (two sources of truth, on purpose)

numu keeps the ladder in **two** places — and that's deliberate, because JS and CSS
can't share a variable at the point where each one needs it.

- **JS truth** — `BREAKPOINTS` in amenan-ui `src/kernel/responsive.ts`:
  `xs 360 · sm 480 · md 600 (Fold-inner edge) · lg 768 (Fold unfolded / iPad
  portrait) · xl 1024 (floor for full chrome) · 2xl 1280`.
- **CSS truth** — `--bp-sm 48rem` / `--bp-md 64rem` / `--bp-lg 80rem` in amenan-ui
  `base.css`.

Here's the catch you *will* trip on: **CSS can't use `var()` inside `@media`.** A
media query needs a literal. So the convention is — write the rem literal, then tag
it with the token name in a comment so a grep keeps the two truths in sync:

```css
/* the two-truths convention: literal + token-name comment */
@media (min-width: 64rem) { /* --bp-md */
  .nu-shell { grid-template-columns: 16rem 1fr; }
}
```

If you touch a breakpoint value, change it in **both** homes and keep the comment.
That comment is what lets the next person (or the next audit) confirm they still
agree.

What the ladder *does* in the console, top to bottom:

- below `--bp-lg` (80rem) → side panels stop being columns and **overlay**.
- below `--bp-md` (64rem) → the rail drawers too; areas stack.
- `--bp-sm` (48rem) → the portrait safety net. Usable, not a design target.

## Viewport units — because `100vh` lies

On mobile, `100vh` is measured against the viewport *without* the URL bar, so a
`height: 100vh` shell is taller than the screen and the bottom gets clipped behind
the browser chrome. Don't use bare `vh` for anything full-height. Use the dynamic
and small variants instead:

- **Full-height shells** → `min-height: 100dvh`. Put a `100vh` line *above* it as a
  fallback for old engines:

  ```css
  .nu-shell {
    min-height: 100vh;   /* fallback for engines without dvh */
    min-height: 100dvh;  /* the real one */
  }
  ```

- **Must never be covered while the browser chrome is showing** (a sticky composer,
  a top bar) → `svh` (the *small* viewport height — the pessimistic measurement).
- **Fixed overlays** → never size them with `vh`. Pair `dvh` with
  `env(safe-area-inset-*)` padding on notched devices, and set
  `viewport-fit=cover` in the meta viewport so the insets are non-zero.

Rule of thumb: `dvh` for "fill the space that's currently there," `svh` for "stay
clear no matter what the browser does."

## Touch — thumbs, not cursors

- **44×44 CSS px minimum** per target (Apple's floor; 48 is nicer on Android), with
  **≥ 8 px** between adjacent targets. A dense table row at `--row-h: 2.25rem` is
  fine — the *row* is the target, not a 16 px glyph inside it.
- **Icon-only controls**: give them an `aria-label` and *pad* the hit area to 44 px.
  Pad the box, don't scale the glyph — a 16 px icon in a 44 px button is correct.
- **Thumb zone**: primary actions live in the bottom half on phones; any menu is
  reachable in ≤ 2 taps; prefer a sticky top bar / composer over nav you have to
  hunt for.
- **No hover-only affordances.** Anything that appears on `:hover` needs a
  touch-visible path — gate it on `@media (hover: none)` in CSS, or `isTouch()` in
  JS. If a phone user can't discover it, it doesn't exist.
- **Inputs ≥ 16 px font-size.** iOS auto-zooms a focused input under 16 px, which
  yanks the whole layout. Set input font-size explicitly.

## The Fold6 is a first-class device (both screens)

Galaxy Z Fold6 is two devices in one hinge, and both are targets:

- **Outer (cover)** ≈ **368×905** — tall and narrow, one-handed. It lives *below*
  `--bp-sm`, so it must stay genuinely usable: single column, rail drawered,
  composer full-width. Not "degraded" — usable.
- **Inner (unfolded)** ≈ **707×823** — near-square, and the hinge may run through it.

Two things about those numbers. First, they're a **band**, not a wall — logical px
shift with the user's screen-zoom, so outer ≈ 360–390 wide and inner ≈ 690–740 wide.
That's exactly why the ladder uses width bands instead of sniffing "is this a Fold."
Second, **landscape phones are short, not narrow** — iPhone 15 landscape is 743×310
inner, and a bar that assumes 500 px of height dies there. `isShort()` is what
catches that case; don't reach for width alone.

For the hinge itself, don't center critical UI across the fold. In CSS you can react
to the segments directly:

```css
@media (horizontal-viewport-segments: 2) {
  /* place content within one segment; the gap is env(viewport-segment-width 0 0) */
}
```

In JS, `isFolded()` tells you the same thing (segments === 2) when *behaviour*, not
just layout, has to change.

## The invisible scrollbar (the `.nu-scroll` pattern)

The house default the skill prescribes: scrollable regions scroll their content but
**hide the scrollbar** — the chrome doesn't move, the content does. One utility, one
home. **Not yet shipped** — today `app.css` has per-region `overflow-y: auto`
classes (`.nu-orail-scroll`, `.nu-feed-scroll`) but no scrollbar-hiding rule; the
canonical utility to add (or upstream as an amenan atom if other consumers want it)
is a single `.nu-scroll`:

```css
.nu-scroll {
  overflow: auto;
  -ms-overflow-style: none;   /* IE / legacy Edge */
  scrollbar-width: none;      /* Firefox */
}
.nu-scroll::-webkit-scrollbar { display: none; } /* Chrome / Safari / Opera */
```

Once it lands, don't restate those five lines inline every time — reuse the one
utility. And mind the caveats:

- Keep a **visible hint** that there's more — a fade edge, a partial next row.
- **Don't** hide it on huge desktop documents where the bar *is* the position
  indicator.
- Keep it **keyboard-scrollable** — add `tabindex="0"` if the region isn't already
  focusable content.

## The JS signals — reach for them only when *behaviour* changes

Default to fluid CSS: `clamp()`, `@container`, `@media`. It's cheaper, it can't get
out of sync with a resize event, and it works before your JS loads. Only when the
*behaviour* (not the style) has to change do you import the responsive kernel:

```ts
import { device, breakpoint, isTouch, isShort, isFolded, onViewportChange } from "amenan-ui";
```

- **`device()`** → `"phone" | "tablet" | "desktop"`. It combines pointer/hover with
  the *short* side of the viewport, so a wide-but-short landscape phone reads as a
  phone and a narrow desktop window doesn't.
- **`breakpoint()`** → the current rung of the ladder (`xs`…`2xl`).
- **`isTouch()`** → the touch/hover path (the JS twin of `@media (hover: none)`).
- **`isShort()`** → the landscape-phone / short-viewport catch.
- **`isFolded()`** → the hinge is visible (viewport-segments === 2).
- **`onViewportChange(cb, signal?)`** → an rAF-debounced resize/orientation hook.
  **Always** pass an `AbortSignal` from your component's mount so it tears down —
  a leaked resize listener is a real bug.

If you find yourself reading a signal to change a *color* or a *margin*, stop —
that's a CSS job. Signals are for "on a phone this button opens a sheet, on desktop
it opens a popover" — genuine behaviour forks.

## Don't duplicate the token table

Breakpoints, spacing scales, `--row-h`, `--text-*`, `--font` — those tokens and
their homes live in one place. Read the table in
[`THEME.md`](./THEME.md); don't restate it here.

## See also

- [`LAYOUT.md`](./LAYOUT.md) — the 30×18 layout grid this ladder drawers and overlays.
- [`CONSOLE.md`](./CONSOLE.md) — the console shell and its layout (the 30×18 grid,
  the panels and rails that this ladder drawers and overlays).
- [`THEME.md`](./THEME.md) — tokens, the overlay, and the drift gates.
- [`../apps/DISTRIBUTION.md`](../apps/DISTRIBUTION.md) — installing numu as a PWA
  (the manifest, service worker, and the `viewport-fit=cover` / safe-area story that
  makes `dvh` land correctly on notched devices).
- The **amenan-typescript skill** —
  [`SKILL.md`](../../.claude/skills/amenan-typescript/SKILL.md) and
  [`references/responsive-devices.md`](../../.claude/skills/amenan-typescript/references/responsive-devices.md)
  (device matrix + `assets/devices.json` for a DevTools import). The authoritative
  spec; this doc is its human twin.
