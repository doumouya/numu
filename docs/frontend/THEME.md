# THEME.md — numu ⇄ amenan-ui: tokens, the overlay, and the drift gates

numu's look is a theme ON amenan-ui's platform, not a fork of it. A look is two
document attributes — `html[data-theme="numu"|"numu-blue"]` ×
`html[data-mode="light"|"dark"]` — and a switch is ONE attribute write
re-resolved by the CSS cascade (`set:theme.mode=dark` and the rail buttons are
the same write).

## Where each tier lives

| tier | file | owner |
|---|---|---|
| palette (numu ink) | `amenan-ui src/theme/themes/numu.css` | amenan-ui — real brand values (formalized from the design system, value-preserved) |
| palette (blue alternate) | `amenan-ui src/theme/themes/numu-blue.css` | amenan-ui |
| structure (shared scales) | `amenan-ui src/theme/base.css` | amenan-ui |
| **numu structure overlay** | `web/styles/numu-structure.css` | numu — concatenated AFTER base.css in `web/tokens.css`, so it wins here without touching other amenan consumers |
| app classes | `web/styles/app.css` | numu — `.nu-*` ONLY |

The overlay does two things: **adds** the structural tokens the design system
defines and amenan-ui's base doesn't yet (font shorthands `--font-body/-title/
-code` + weights/leadings/tracking/numerics, focus geometry, `--ease-out` +
transition composites, chart structural aliases `--chart-axis/grid/track/
tooltip-*`, `--text-2xs/-3xl`, `--ctl-h-sm/-lg`, `--tap-min`) and **settles the
value drift** in numu's favor (numu is tighter/denser: `--sp-5/6/8`,
`--radius-sm`, `--text-md`, `--ctl-h`, `--pad-x`, `--fast/--slow`).

`--selection-bg` is a numu EXTRA declared per-theme (beyond amenan's frozen
40-token palette contract — the contract is a floor, not a ceiling); app.css
consumes it via `::selection`.

## tokens.css (the built closure)

`tools/web-build.sh` concatenates: amenan `base.css` → the overlay → `numu.css`
→ `numu-blue.css` → the component sheets the console actually composes (atoms ·
code · kindLabel · field · toast). Add a sheet to that list when a new amenan
component lands in TS — the gate below catches you if you forget.

## Charts

ECharts options carry EXPLICIT colors resolved from the live tokens at render
time (`web/src/console/chart-theme.ts`); on a theme/mode switch `app.ts`
re-renders the chart-bearing regions, so charts always match the look. Charts
init directly on `.nu-` slots — amenan's `mountChart` card was the wrong chrome
here, and restyling `.amu-chart-*` internals from app.css is exactly the drift
the gate forbids.

## The css-drift-audit gate (`tools/css-drift-audit/audit.sh`)

Four queries, run by ci.sh after web-build:

- **C1 · no raw colors** in `web/src/**/*.ts` + `web/styles/app.css` — every
  color is a `var(--…)`; literals belong in the theme tier.
- **C2 · namespace** — app.css defines only `.nu-*`; `.is-*` state classes are
  legal ONLY compound with a `.nu-*` owner; `.amu-*` is amenan-ui's.
- **C3 · closure resolution** — every `var(--x)` the app references resolves in
  the built tokens.css + app.css. An unresolvable var renders as a silent
  fallback — the quietest drift there is.
- **C4 · sheet presence** — every `.amu-*` class composed in TS exists in
  tokens.css (a component used without its sheet in web-build.sh's cat list).

## Adding a theme / changing tokens

Palette work happens in amenan-ui (the add-a-theme recipe in its THEME.md; the
theme-contract test enforces completeness). Structure work that is
numu-specific goes in the overlay; structure that is generic belongs upstream
in amenan's base.css — prefer upstream when a second consumer would want it.
