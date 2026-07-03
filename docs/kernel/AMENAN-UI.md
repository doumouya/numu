# Kernel · amenan-ui — the UI framework numu's console stands on

**Repo:** `github.com/doumouya/amenan-ui` (private; sibling checkout expected at `../../amenan-ui`).
**Its own docs:** `docs/DOCMAP.md → ARCHITECTURE / GETTING-STARTED / COMPONENTS / AUTHORING` +
`THEME.md` in that repo — this page documents the *boundary*: what the kernel provides, what numu
consumes, the rules where they meet, and how to maintain/extend across it. Don't duplicate the
kernel's own reference here.

## Purpose (what the kernel provides)

A **zero-runtime-dependency vanilla-TypeScript UI framework + theme platform**:

- **The `el()` kernel** — typed DOM construction (`el(tag, attrs, ...children)`); `class`→className,
  `on*`+fn→listener, nullish attrs/children skipped. No vdom, no framework.
- **The Mount contract** — components are authored 2-arg: `mountX(host, cfg) → { el, update?,
  destroy? }`; atoms (`button`, `chip`, `input`, `badge`, `icon`, …) return raw elements.
- **The theme platform** — a look is two document attributes, `html[data-theme] × html[data-mode]`,
  re-resolved by the CSS cascade: a switch is **one attribute write, O(1)**. The palette contract is
  **frozen at 40 tokens** per theme × mode (test-enforced); structure (spacing/type/motion) lives in
  `base.css`. Extras beyond the contract are legal — the contract is a floor.
- **Single-CSS-ownership** — every component is the sole owner of its `.amu-*` class family; sheets
  are co-located and `@import`ed by one manifest.
- **Component tiers** — LEAF (self-contained) → COMPOSED (compose leaves) → DATA (live behind an
  injected Service seam; never fetch on their own).

## Implementation (what numu consumes, exactly)

- **Imports** (the full set, from `web/src`): `el · icon · button · chip · badge · input ·
  mountCode · mountEmptyState · mountField · mountKindLabel · mountSelect · mountTabs · toast ·
  setTheme · getTheme · setMode · getMode · onThemeChange`. Everything else in the console is
  app-local `.nu-*` composition.
- **Build coupling** — no npm package: `tools/web-build.sh` aliases `amenan-ui →
  $AMU/src/index.ts` (esbuild) and **cats** the kernel CSS into `web/tokens.css`:
  `base.css → web/styles/numu-structure.css (the overlay) → themes/numu.css → themes/numu-blue.css →
  web/styles/numu-skins.css → the component sheets in use`. Using a new mount = adding its sheet to
  that cat list (the css-drift gate's C4 catches you if you forget).
- **numu's LOOK lives in the kernel** — `src/theme/themes/numu.css` (ink) + `numu-blue.css` are
  theme files IN amenan-ui, formalized from the numu Design System, including the **numu-family
  structural retune** (density/radii/control heights under
  `html[data-theme="numu"], html[data-theme="numu-blue"]`). numu's repo keeps only the app-side
  remainder in `web/styles/numu-structure.css` (font shorthands, tracking, transitions, chart
  aliases) and the console-local appearance tier `numu-skins.css` (skins on the `--brand` channel).
- **Vendored assets** — `web/vendor/echarts.min.js` + `web/vendor/bootstrap-icons/` are copied once
  from the kernel's `vendor/` by web-build.sh; charts init directly on `.nu-` slots with
  token-resolved options (`web/src/console/chart-theme.ts`).

## Maintenance (the boundary rules)

1. **`.amu-*` is the kernel's; `.nu-*` is numu's.** numu never defines or restyles an `.amu-*` class
   (css-drift C2 enforces; the one attempt was caught by the gate on day one).
2. **Contract is a floor.** numu's themes may declare extras (`--selection-bg`); the frozen-40 test
   in the kernel keeps the shared schema honest.
3. **Structural ownership:** numu-family structural retune (shared by numu + numu-blue) lives in
   the kernel's theme files; app-only structure stays in numu's overlay. One token, one home.
4. **Sibling checkout required** for web-build/web-test; ci.sh skips them without it
   (`NUMU_CI_STRICT=1` turns that skip into a failure).
5. After ANY kernel change: `npm run ci` in amenan-ui (its own 89-test suite incl. the
   theme-contract test), then numu's `bash tools/ci.sh` (the closure re-verifies).

## How to extend

- **A new numu-branded token/color** → the kernel's `themes/numu*.css` (both modes!), then the
  kernel's ci. A new *structural* value used only by the console → `web/styles/numu-structure.css`.
- **A new component** → decide the tier: reusable beyond numu? Author it in the kernel (AUTHORING.md
  there; own `.amu-x` family; add its sheet to numu's cat list). Console-shaped? App-local `.nu-*`
  module under `web/src/console/`.
- **Upstream-vs-overlay guide:** upstream when a second consumer plausibly wants it (the `icon`
  atom, toast tones came from this console); keep app-local when it's numu-shaped (feed blocks,
  viewers, the rails). Let one consumer prove an API before promoting it.
- **A new theme for a client** → the kernel's add-a-theme recipe (its THEME.md): copy `_template.css`,
  fill all 40 × 2, register in `THEMES`, import in `styles.css`, ci green.
