# Datacore Design System

A design system for a pair of **local-first developer tools** that share one
conviction: *the engine is the truth, and the interface is a thin, honest
surface over it.* Both are small, dependency-light, and built so that "it runs
on your machine" is a fact of the architecture, not a marketing line.

The visual language is **calm, dense, and legible** — a tool, not a landing
page. Flat surfaces, hairline borders as the only structural device, a cool
neutral palette with exactly one blue accent, system fonts, tabular numbers,
and near-zero motion. It reads like a well-made terminal: quiet until you need
it, exact when you do.

---

## The products

**advanced-datatable** — a fully client-side CSV explorer. Open a CSV and sort,
filter, project (show/hide columns), page and export it; the file never leaves
the page. The data engine is Rust compiled to WebAssembly and runs entirely in
the browser — no server, no upload, no network call. *This product is the source
of the visual system:* its `web/style.css` and front-end brief define the look.

**build-engine** — a small, headless "build system that hosts its own build
process." A workflow is *data* (ordered states + permissive transitions in a
row), declaring a type is a *row* not a migration, and a case can only reach its
terminal state once its close-checks pass. Its own first feature was walked to
`done` through the engine and recorded as the first Case — the system recording
its own construction. *This product contributes a second domain* (a cases work
tracker) and the brand's terse, mechanism-first voice.

**rbac-explorer** — an interactive picture of **scoped-ownership access control**.
Pick an actor and watch the nodes they can reach light up across the org tree;
click a node to grant or revoke their membership and see reach recompute live.
The rule it makes tangible — *a membership grants the node and everything scoped
beneath it, never the parent* — is the **same reach resolver** the build-engine
enforces server-side (the *entity-rbac* case), here compiled to wasm and run in
the browser. *Contributes a tree/graph-visualization domain.*

**echarts-dashboard** — a fully client-side analytics dashboard. Open a CSV, add
chart cards that group + aggregate it (count/sum/avg/min/max), and chart it with
ECharts — all on-device, the file never leaving the page. *Contributes the one
new visual foundation: a **chart color palette** and a token-themed ECharts
integration.*

What unifies them: a pure **core** that compiles to `wasm32` and runs
client-side, a refusal to leak identity or ship baggage, and claims that are
**verifiable rather than asserted**.

---

## Sources

This system was reverse-engineered from four sibling repositories. They are the
ground truth; explore them to build more accurately against these products.

- **advanced-datatable** — <https://github.com/doumouya/advanced-datatable>
  Read `web/style.css`, `web/app.js`, `web/body.html` (the reference UI) and
  `docs/fe-brief.md` + `docs/spec.md` (the brief + the engine API). The entire
  color/type/spacing system here is lifted from that CSS.
- **build-engine** — <https://github.com/doumouya/build-engine-demo>
  Read `docs/DATA-MODEL.md`, `docs/specs/cases-backend.md` and the real build
  log `docs/build-log/entity-rbac.md` (reproduced in the work-tracker kit).
- **rbac-explorer** — <https://github.com/doumouya/rbac-explorer>
  Read `web/style.css`, `web/app.js`, `docs/spec.md` + `docs/fe-brief.md` (the
  reach model + the `WasmGraph` API). Same token system; adds the reached /
  member / dim node states.
- **echarts-dashboard** — <https://github.com/doumouya/echarts-dashboard>
  Read `web/style.css`, `web/app.js`, `docs/spec.md` + `docs/fe-brief.md` (the
  aggregation model + the `WasmData` API). The chart palette is derived to be
  harmonious with the brand accent.

> Access note: these were read via GitHub at the commits current in June 2026.
> The reader may not have access; nothing here assumes it, but the links are
> recorded so a maintainer who does can go deeper.

---

## CONTENT FUNDAMENTALS

How this brand writes. The voice is **engineer-to-engineer**: terse, precise,
quietly confident, and allergic to hype. Every claim is backed by a mechanism.

- **Person & address.** Speak to the user as **you / your** for guarantees
  ("your data never leaves this page", "it stays on your device"). Use **we**
  for the team's decisions ("we are greenfield", "we don't work with pull
  requests"). Never the royal/marketing "we".
- **Casing.** Product and crate names are **lowercase** (`advanced-datatable`,
  `build-engine`, `datatable-core`). UI labels are sentence case. Identifiers,
  states, ops, error kinds and IDs are **monospace** verbatim (`in_review`,
  `close_preconditions_unmet`, `CAS_277D2F5E…`). No Title Case Marketing.
- **Mechanism over adjective.** Don't say "secure" — say *"the file never leaves
  your machine."* Don't say "fast" — *"the DOM only ever holds the visible
  window."* The signature move: state the property, then the architecture that
  makes it true. *"Privacy here isn't a promise, it's the architecture."*
- **Punctuation.** The **middot ·** is the house separator
  (`1,240 rows · 3 filtered out · all processing happens in your browser`).
  Em-dashes for asides. Inline `backticks` for anything code-shaped. Arrows
  `→` for transitions.
- **Numbers.** Thousands separators, tabular figures, lowercase unit nouns
  (`1,240 rows`, `13 engine unit + 3 rbac integration tests`).
- **Emoji.** Effectively none. Status is a check `✓` or a colored dot, not 🚀/✅.
  (Repo docs use a bare ✅ in tables; in product UI it becomes a green check
  glyph.) If you reach for an emoji, you're off-brand.
- **Honesty markers.** "Verified end-to-end." "the case the engine produced."
  "a real record, not a writeup." The brand earns trust by showing its work and
  naming its own hazards, not by adjectives.

**Microcopy examples (use as templates):**
- Empty state: *"Open a CSV — it stays on your device."* /
  *"All processing happens in your browser. Nothing is uploaded."*
- Reject: *`422 invalid_transition: backlog → done`* /
  *`close_preconditions_unmet · missing: tests-green`*
- Count bar: *`48 rows · customers.sample.csv · 6 filtered out`*

---

## VISUAL FOUNDATIONS

- **Color.** A **cool neutral** (gray/slate) palette and **one** blue accent
  (`#2563eb` light, `#60a5fa` dark) for active sort/filter, focus and primary
  actions. Light and dark are both first-class (the source ships a hand-authored
  dark theme via `prefers-color-scheme`; we add a forced `[data-theme="dark"]`
  scope). Restrained status hues — green (passed / done), amber (in review /
  attention), red (reject / unmet / 4xx) — only ever as small accents, never as
  fills of large areas. **Charts** get their own categorical palette
  (`--chart-1..8`) anchored on the accent and remapped for dark mode (see the
  *Chart palette* card); the `Chart` component derives the live ECharts theme
  from these tokens. Imagery: there is **none**, and that's deliberate; data
  is the content.
- **Type.** **System fonts only** — `system-ui` sans + a system **monospace**
  for data, identifiers, code and JSON. Zero webfonts is an intentional,
  on-brand decision (the brief mandates no CDN fonts so the tool stays offline
  and traceless). Body is `0.875rem / 14px` on a `1.5` rhythm; data surfaces use
  `tabular-nums`. Weights 400/500/600/700.
- **Spacing & density.** Tight and rem-based (the table rhythm is `0.3rem`
  cell padding, controls `0.4rem 0.7rem`). Relative units only; `px` is reserved
  for hairlines and the focus ring. Calibrated to a 14-inch laptop.
- **Backgrounds.** **Flat solid surfaces.** No gradients, no images, no
  illustrations, no textures, no glass. Depth comes from a one-step surface
  change (`--surface` → `--surface-subtle`) plus hairlines. Tables get a faint
  zebra via `color-mix`. Sticky headers sit on a solid (un-blurred) background.
- **Borders.** A **1px hairline** (`--border`) is THE structural device —
  `border-collapse` tables, bordered controls, divided toolbars. Inputs use a
  slightly stronger border; everything else the default hairline.
- **Shadows / elevation.** Base surfaces and cards carry **no shadow**. Soft,
  low shadows exist only for things that genuinely float — filter popovers,
  dropdowns, dialogs. The brand's real elevation cue is the border + surface
  step, not a drop shadow.
- **Radii.** Small: inputs `0.3rem`, buttons/cards `0.4rem`, dialogs `0.5rem`,
  chips `0.2rem`. `full` only for status dots, avatars and true pills. Never
  sharp, never pill-by-default.
- **Cards.** Flat, hairline-bordered, small radius, **no shadow**; optional
  `--surface-subtle` header/footer bars. (Avoid the rounded-card-with-colored-
  left-border cliché — selection here is a subtle accent tint + a thin inset
  bar, used sparingly.)
- **Hover.** Controls **highlight their border to the accent** (or take a faint
  `--surface-subtle` fill for ghost/rows) — not a color flood. Quiet.
- **Press / active.** A small, decisive change: a half-step-darker surface, or
  the accent-tinted "selected/pressed" state on toggles. No bounce, no scale.
- **Focus.** A deliberate, always-visible **2px accent outline, inset
  (`offset: -1px`)**. Accessibility is a brand value, not an afterthought.
- **Motion.** Near-instant — the source has **no** transitions. We add only the
  smallest tasteful easing (`100–150ms`, `cubic-bezier(0.2,0,0,1)`) on hover
  borders and overlay fades, all disabled under `prefers-reduced-motion`. No
  decorative loops, no parallax, no entrance choreography.
- **Transparency / blur.** Used only functionally: `color-mix` for zebra and
  tints, the accent tint for selection. No backdrop blur, no frosted glass.
- **Layout.** Sticky header (`z-index: 2`), sticky `thead`, full-width data,
  a dense toolbar with a flexible spacer, master/detail for the work tracker.
  Content fills the viewport; the DOM only ever holds the visible window.

---

## ICONOGRAPHY

The icon language is **[Bootstrap Icons](https://icons.getbootstrap.com)** —
loaded from CDN and rendered at `currentColor` through the `Icon` component
(`<Icon name="funnel" />`, no `bi-` prefix). They are thin, single-weight and
geometric, so they sit naturally against the hairline borders and inherit the
text/accent color. This is the one deliberate external dependency in the system
(see Caveats) — chosen because crisp, consistent icons read far better in a
recruiter-facing demo than the Unicode glyphs the products ship today.

The vocabulary (use these names):
- **Sort & navigate:** `sort-up` / `sort-down` (active sort, accent-colored),
  `arrow-down-up` (sortable idle), `chevron-right` / `chevron-down` (disclosure),
  `three-dots` (overflow), `arrow-clockwise` (refresh), `list-ul`, `kanban`.
- **Data & filter:** `funnel` / `funnel-fill` (filter, fill = active), `search`,
  `table`, `layout-three-columns` (columns), `download` / `upload`,
  `filetype-csv`, `diagram-2`/`diagram-3`, `chevron-bar-left/right` (pager).
- **State & meta:** `check-circle-fill` (passed/done, success), `x-circle-fill`
  (failed), `exclamation-triangle-fill` (warning), `info-circle-fill`,
  `plus-lg` (new), `x-lg` (close), `lock-fill`, `shield-lock` / `shield-check`,
  `clock-history` (activity).
- **Emoji:** never used as iconography.

Rules: pass icons through the `Icon` component (it injects the font link once and
handles `aria-hidden`); give an `Icon` a `label` only when it carries meaning on
its own. Pair icons with text in buttons (`leadingIcon`). **Never hand-draw
SVGs.** If a needed glyph isn't in Bootstrap Icons, pick the nearest BI match
rather than inventing one.

**No logos or illustrations exist upstream** (both products are Rust/WASM
back-ends). The "logo" is typographic: the lowercase product name in the system
font, with a single accent square as the only graphic element (see the *Brand*
specimen cards). Don't invent illustrated marks.

---

## Using this system

Consumers link the one global stylesheet and read components off the namespace:

```html
<link rel="stylesheet" href="styles.css" />
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { Button, Badge, Card, KindLabel } = window.DatacoreDesignSystem_a460c7;
</script>
```

All styling flows through CSS custom properties (`var(--accent)`,
`var(--surface-subtle)`, `var(--space-3)`…). Reference tokens; don't hard-code
hexes or px.

---

## Index / manifest

**Root**
- `styles.css` — the global entry point (import manifest only).
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skills front-matter so this system works in Claude Code.

**`tokens/`** — CSS custom properties (`@import`ed by `styles.css`)
- `colors.css` · `typography.css` · `spacing.css` · `elevation.css` · `charts.css` · `base.css`

**`components/`** — 19 reusable primitives (`window.DatacoreDesignSystem_a460c7`)
- `forms/` — `Button`, `IconButton`, `Input`, `Select`, `Checkbox`
- `display/` — `Badge`, `KindLabel`, `Card`, `Toolbar`, `EmptyState`, `Code`,
  `Avatar`, `Icon`, `Stat`
- `navigation/` — `Tabs` (underline + segmented)
- `feedback/` — `Dialog`, `Toast`, `Tooltip`
- `charts/` — `Chart` (token-themed ECharts wrapper)
- Each ships a `.jsx`, a `.d.ts` (props contract), a `.prompt.md` (how & when),
  and a `@dsCard` showcase per group.

**`guidelines/`** — foundation specimen cards (the *Design System* tab)
- Colors (neutral · accent · semantic · status · chart palette), Type (families ·
  scale · weights/numerics), Spacing (scale · radii · borders/focus), Brand
  (wordmark · voice · iconography — a live Bootstrap Icons specimen).

**`ui_kits/`** — high-fidelity, interactive product recreations
- `datatable/` — the CSV explorer: drop/open → global search, per-column filter
  popovers, multi-column sort (shift-click), column projection, **pagination**,
  CSV export, and result toasts.
- `build-engine/` — the cases work tracker: a kanban **Board** and a master/
  detail **List**, the workflow stepper, the close-gate, the **new-case dialog**,
  the thread, and the append-only activity log, with engine-decision toasts.
  *Interprets the documented data model — the product has no upstream front-end.*
- `rbac-explorer/` — scoped-ownership reach: an org tree, an actor picker, live
  reach highlighting, click-to-grant/revoke, and a **reverse lookup** ("who can
  reach this node?").
- `echarts-dashboard/` — CSV analytics: a KPI strip + a grid of configurable
  **chart cards** (group / aggregate / type), token-themed ECharts, PNG export.

**`templates/`** — consumer starting folders (Design Components)
- `datatable-view/`, `case-view/`, `dashboard-view/` — one-file screen shells on
  the foundations.

---

## Caveats for the maintainer

- **Fonts are system fonts by deliberate choice** — there are no brand webfonts
  upstream, so none are shipped. If you want a distinct typeface, provide the
  files and we'll add `@font-face` rules and a `tokens/fonts.css`.
- **Icons are Bootstrap Icons via CDN** — the system's one external dependency.
  The underlying products favor inlineable assets; this design system trades that
  for crisp, consistent iconography (it's built for prototypes and recruiter
  demos). To go fully offline, self-host the `bootstrap-icons` font + CSS and
  point the `Icon` component's link at the local copy.
- **build-engine has no upstream UI**, and **rbac-explorer**'s polished graph
  layout is a future step — both kits faithfully interpret the documented model
  (and the reference UI where one exists), not invented screens.
- **ECharts** (echarts-dashboard kit + the `Chart` component) is loaded from CDN
  here; the product vendors it inline. Self-host it to go fully offline.
- Both engines are stubbed in JS for the kits (mirroring the real wasm/Rust API
  signatures); swap in the generated modules and the UIs are unchanged.
