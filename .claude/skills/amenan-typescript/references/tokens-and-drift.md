# Tokens & drift — the theme platform contract

numu's look is a **theme ON amenan-ui's platform, not a fork of it**. Keep that
sentence in mind: almost every drift incident is someone forking what they
should have themed, or overlaying what they should have contributed upstream.

## The tiers (one token, one home)

| tier | file | owner |
|---|---|---|
| structure (shared scales: spacing, radius, type, density, motion, z-index, breakpoints) | amenan-ui `src/theme/base.css` | amenan-ui |
| palette (real color/font/shadow values, per theme) | amenan-ui `src/theme/themes/<name>.css` under `html[data-theme="<name>"] × html[data-mode]` | amenan-ui |
| numu-family structural retune (density steps, radii, control heights, tap/focus geometry) | amenan-ui `themes/numu.css` mode-independent block (shared numu + numu-blue) | amenan-ui |
| app structure overlay (font shorthands, weights/leadings, motion composites, chart aliases, residual drift) | numu `web/styles/numu-structure.css` — token-only, no classes | numu |
| skins (`data-skin`, the `--brand` channel) + media conventions | numu `web/styles/numu-skins.css` — appearance tier, exempt from C1 | numu |
| app classes | numu `web/styles/app.css` — `.nu-*` ONLY | numu |

`base.css` carries NO color/`--font`-family/`--shadow` values — those are
palette, per-theme. The 40-token palette contract is a **floor, not a ceiling**:
a theme may declare extras (e.g. numu's `--selection-bg`), but every consumer of
an extra must know it's numu-specific.

## The built closure (`web/tokens.css`)

`tools/web-build.sh` concatenates, in cascade order:

```
amenan base.css → numu-structure.css (overlay wins) → themes/numu.css →
themes/numu-blue.css → numu-skins.css → component sheets actually composed
(atoms · code · kindLabel · field · toast · tabs · select · empty-state · …)
```

When a new amenan component lands in console TS, **add its sheet to that list**
— C4 exists because forgetting renders unstyled DOM silently. The build also
typechecks (`tsc --noEmit`) and bundles `web/src/app.ts` with esbuild, aliasing
`amenan-ui` to the sibling checkout's `src/index.ts`. There is no npm package;
the sibling checkout (`AMU=../../amenan-ui`, i.e. `/home/mansa/amenan-ui`) is
the dependency.

## The four drift queries (numu `tools/css-drift-audit/audit.sh`)

- **C1 — no raw colors.** `#hex` / `rgb()` / `hsl()` in `web/src/**/*.ts` or
  `app.css` is a finding; use `var(--…)` or move the value into the theme tier.
  Charts are the sanctioned exception path: ECharts options carry explicit
  colors *resolved from live tokens at render time* via
  `web/src/console/chart-theme.ts`, and theme/mode switches re-render chart
  regions.
- **C2 — namespace.** `app.css` defines `.nu-*` only. `.is-*` state classes are
  legal only compound with a `.nu-*` owner (`.nu-x.is-active`). Any `.amu-*`
  redefinition in app CSS is how single-CSS-ownership dies.
- **C3 — closure resolution.** Every `var(--x)` referenced anywhere in app TS,
  `app.css`, or `index.html` must be defined in built `tokens.css` + `app.css`.
  An unresolved var renders as a silent fallback — the quietest drift.
- **C4 — sheet registration.** Every `.amu-*` class composed in TS must exist in
  built `tokens.css` (i.e. its sheet is in `web-build.sh`).

C3/C4 read the *built* `tokens.css` — run `tools/web-build.sh` first (ci.sh
does).

## amenan-ui's own rules (`npm run audit`, ratcheted against baseline.json)

- **R3** — no `!important` anywhere in `src/**` CSS.
- **R4** — one owner per `.amu-<name>*` class: styled in exactly one sheet.
  Want the look elsewhere? Compose the component, don't restyle the class.
- **R5** — no `#id` selectors (root/showcase sheets excepted).
- **R6** — `styles.css` is the ONLY `@import` manifest; every component sheet
  imported exactly once; token/theme sheets precede component sheets.

`npm run ci` chains typecheck → audit → build → test.

## Creating a theme

1. New file `amenan-ui/src/theme/themes/<name>.css`; declare the palette under
   `html[data-theme="<name>"]` (light) and `html[data-theme="<name>"][data-mode="dark"]`.
2. Cover the full 40-token palette contract (copy an existing theme as the
   checklist); extras beyond the floor are fine but documented.
3. No structural values in a theme unless it's a deliberate family retune block
   (see numu.css) — structure lives in base.css.
4. Register the theme name in the theme registry (`listThemes`), rebuild, and
   verify a switch is one attribute write with zero layout shift.
5. If numu should ship it: add the file to `web-build.sh`'s concat list.

Skins are console-local: a `data-skin` attribute on the app root retuning the
`--brand` channel in `numu-skins.css` — never a new theme file.

## Upstream vs overlay (the contribution decision)

Ask: *would another amenan-ui consumer want this?*

- Yes → contribute to amenan-ui (new token in base.css, component fix, theme
  block). This is the default posture — the framework improves by absorbing
  proven needs.
- No, numu-app-specific → overlay (`numu-structure.css` for tokens,
  `app.css` for `.nu-*` classes).
- Never: copying an amenan sheet into numu and editing it (that's a fork —
  sim-verbatim and css-drift both exist to catch flavors of this).
