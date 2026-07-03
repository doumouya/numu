---
name: amenan-typescript
description: >-
  Front-end expert skill for the numu team's Vanilla TypeScript stack: numu
  console (web/), amenan-ui (the component/theme platform), and the birama-engine
  seam. Use this skill for ANY front-end work on numu or amenan-ui — building or
  reviewing console features, creating/adjusting themes or skins, adding tokens,
  writing new amenan-ui components, laying out screens on the numu-layout 30×18
  grid (dashboards, workbenches, drag/resize areas, server-driven layouts),
  responsive/mobile-first layout (including Galaxy Z Fold6 inner+outer screens),
  SPA routing, PWA setup, hiding scrollbars, touch-target sizing, icon/font
  choices, or authoring/extending ci.sh audit gates (css-drift and friends).
  Trigger it whenever the user mentions numu web, console-web, amenan-ui,
  tokens.css, .nu-/.amu- classes, drift, themes, grids or page layout,
  mobile-first, responsive breakpoints, fold devices, SPA/PWA tooling, or
  Vanilla TS UI work — even if they don't name the skill.
---

# amenan-typescript — the numu front-end discipline

You are the front-end expert of the numu team. The stack is **Vanilla TypeScript,
no framework** — the ambition is a token-driven TS framework solid enough to open
source. Everything below exists to prevent drift while moving fast.

## The three repos (WSL paths)

| repo | path | role |
|---|---|---|
| numu | `/home/mansa/rust-project/numu` (branch `feat/console-web`) | the app: `web/` console + `tools/` gates |
| amenan-ui | `/home/mansa/amenan-ui` (sibling checkout, aliased at build — no npm package) | the platform: kernel, contract, components, themes |
| birama-engine | sibling Rust kernel | backend seam only; its test feature is `pg-tests`, numu's is `db-tests` — never cross the names |

Docs are authoritative until code lands, then **code is truth**: read
`docs/frontend/THEME.md`, `CONSOLE.md`, `SEAM.md` and amenan-ui's
`DISCIPLINE.md` before non-trivial work. Non-trivial changes open a Case first
(see CLAUDE.md working rules). Never push without Em's OK.

## Non-negotiables (what the gates enforce)

1. **Tokens only, no raw colors** in `web/src/**/*.ts` + `web/styles/app.css`.
   Every color is `var(--…)`; literals live in the theme tier (C1).
2. **Namespace ownership**: app CSS defines `.nu-*` only; `.amu-*` belongs to
   amenan-ui; one component owns its `.amu-<name>*` sheet; state classes ride an
   owner (`.nu-x.is-active`, never bare `.is-active`) (C2, R4).
3. **The token closure resolves**: every `var(--x)` referenced must be defined in
   built `web/tokens.css` + `app.css` (C3); every `.amu-*` composed in TS must
   have its sheet concatenated in `tools/web-build.sh` (C4).
4. **No `!important`, no `#id` selectors** in amenan-ui CSS (R3, R5).
5. **Green before commit**: `bash tools/ci.sh` (bash, never `sh`) in numu;
   `npm run ci` in amenan-ui. Both must pass before any hand-off.

Ownership rule for new values — *one token, one home*: shared structure →
amenan `base.css`; numu-family retune → amenan `themes/numu.css`
(mode-independent block); app-only residuals → `web/styles/numu-structure.css`;
appearance/skins → `web/styles/numu-skins.css`. When in doubt, contribute
upstream to amenan-ui rather than overlaying in numu.

## Mobile-first (the first way customers land on our apps)

Design at 360 px first, enhance upward. The breakpoint ladder is
`kernel/responsive.ts` `BREAKPOINTS` (JS truth) ⇄ `--bp-sm/md/lg` rem tokens in
`base.css` (CSS truth) — keep them in sync if you ever touch either.

- Prefer fluid CSS (`clamp()`, `@container`, `@media`); reach for the JS signals
  (`device()`, `breakpoint()`, `isTouch()`, `isShort()`, `isFolded()`,
  `onViewportChange`) only when *behaviour* must change.
- **Viewport units**: use `dvh`/`svh`, never bare `100vh` — mobile browser chrome
  makes `vh` lie. Full-height shells: `min-height: 100dvh`.
- **Touch targets**: ≥ 44×44 CSS px with ≥ 8 px spacing; primary actions in
  thumb reach; no hover-only affordances (`isTouch()` exists for this).
- **Fold devices are targets**, including Galaxy Z Fold6 **outer** (~368×905)
  and **inner** (~707×823) screens; hinge-aware layout via `isFolded()` /
  `viewport-segments` media queries. Full device matrix + DevTools import file:
  `references/responsive-devices.md` and `assets/devices.json`.
- **Invisible scrollbars are the default** for scrollable regions — the standard
  pattern (all three engines) lives in `references/responsive-devices.md`; make
  it a `.nu-scroll` (app) or an amenan utility, don't restate it inline.

## Workflows

**Assess / review front-end work** → run `bash tools/ci.sh`, then read
`references/tokens-and-drift.md` and check the five non-negotiables above
against the diff. Findings are cited as `FINDING [rule] file:line`.

**Build a console feature** → compose existing `.amu-*` components from the
amenan barrel (`amenan-ui` import), app chrome in `.nu-*` classes, colors from
tokens, mobile-first CSS. New amenan component used? Add its sheet to
`web-build.sh` (C4 will catch you). Then `bash tools/ci.sh`.

**Create or adjust a theme/skin** → read `references/tokens-and-drift.md`
(theme axes, the 40-token palette contract, skin tier). A look is
`html[data-theme] × html[data-mode]` + console `data-skin`; a switch is one
attribute write.

**New amenan-ui component** → `src/components/<name>/{<name>.ts,<name>.css}`,
`.amu-<name>*` classes only, import once in `styles.css`, export from the
barrel, `npm run ci`.

**Build or improve a tool / CI gate** → read `references/gates-and-tooling.md`.
Gates are `tools/<name>-audit/audit.sh`, auto-discovered by `ci.sh` — read-only,
exit 0/1 with `FINDING [rule] message` lines. Team tooling is Vanilla TS or
bash; keep it dependency-free.

**Lay out a screen / dashboard / workbench / context panel** → read
`references/numu-layout.md`. The canonical canvas is the **30×18 grid**
(`.amu-grid`, platform tier — never a third namespace); charts use **15×9**
(same 5:3 ratio, half scale, ONE shared engine). Layouts are `Layout` data
validated before render; areas stack below `--bp-md`. Components are
**container-first** (the half-open context panel gets the mobile view for
free); ultrawide (34") and dual-screen use the **stage** model. Fonts ship as
theme `--font` tokens (system-first; Google Fonts self-hosted only); icons are
**icon-first via the registry** (Bootstrap Icons default, translated
aria-labels); components declare `Customizable` slots (icon/accent/label/
density) **and a required `touch` variant** (hit strategy, hover replacement,
gestures) stored as entity data and resolved automatically via `isTouch()`.

**SPA routing / PWA setup** → read `references/spa-pwa.md` (Mount/PageSpec/
Router contract, manifest + service-worker patterns in Vanilla TS).

## References

- `references/tokens-and-drift.md` — token tiers, build closure, C1–C4 + R3–R6,
  theme/skin creation, upstream-vs-overlay decisions.
- `references/responsive-devices.md` — device matrix (incl. Fold6), viewport
  units, touch targets, invisible scrollbar, fold/hinge handling.
- `references/gates-and-tooling.md` — authoring audit gates, ci.sh contract,
  tool-building conventions.
- `references/numu-layout.md` — the 30×18 grid system: DSL, renderer,
  drag/resize engine, server-driven layouts, fonts & icons.
- `references/spa-pwa.md` — SPA contract types, router, PWA checklist.
- `assets/devices.json` — Chrome DevTools device list (vibranium format) with
  Fold6 inner + outer added: `npx @pittankopta/vibranium add -r assets/devices.json`.
