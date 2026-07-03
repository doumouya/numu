# SPA & PWA — the brand trademark, in Vanilla TS

We ship SPAs that install as PWAs. No framework: amenan-ui's kernel + contract
*is* the framework, and it stays small enough to read in an afternoon.

## The SPA contract (amenan-ui `src/contract/`)

Everything mounts through the same shapes — learn them once:

- `Mount` / `MountCtx` / `MountHandle` — a component is a function that mounts
  into a host element and returns a handle; `toMount` adapts plain components.
  `MountCtx` carries the `AbortSignal` — **every listener, interval, and
  `onViewportChange` subscription takes that signal** so teardown is free and
  leak-proof.
- `PageSpec` / `SectionSpec` / `SurfaceSpec` / `RailSpec` — declarative page
  assembly; the shell owns layout chrome, pages declare content.
- `RouteDef` / `RouteMap` / `Guard` / `Router` — hash-or-history routing with
  guards; a route change is a page-spec swap, not a reload.
- DOM building: `el`, `esc`, `qs` from the kernel. `el()` + template literals
  beat any VDOM for our sizes; `esc()` every interpolated string that isn't
  ours (the debuggability posture applies to XSS too).

State: module-level stores (`web/src/console/store.ts` is the model) —
plain objects + subscriber sets, no library. Async data flows through the
`Service`/`Source` contract so errors surface as `ServiceError`, never bare
throws into the DOM.

## SPA rules of thumb

- One esbuild IIFE bundle (`web/app.js`); the synced sim stays OUTSIDE the
  bundle as plain script globals (design-sync ships it verbatim).
- Cache-bust via the `?v=` stamp `web-build.sh` writes into `index.html` —
  never hand-edit those.
- Theme/mode/skin are document attributes; a switch re-resolves the cascade and
  re-renders only chart regions (explicit-color exception). No flash: set the
  attributes before first paint from storage (`THEME_KEY`/`MODE_KEY`).
- Keyboard parity for every pointer path (the console is keyboard-first on
  desktop, touch-first on mobile — same DOM, both inputs).

## PWA checklist (Vanilla TS, no workbox)

1. **Manifest** `web/manifest.webmanifest`: `name`, `short_name`, `start_url:
   "./"`, `display: "standalone"`, `theme_color`/`background_color` **from the
   active theme's tokens** (generate, don't hardcode — a hex here is C1-exempt
   but must be derived from the theme file), maskable icons 192/512.
2. **Meta viewport**: `width=device-width, initial-scale=1, viewport-fit=cover`
   — `viewport-fit=cover` is what makes `env(safe-area-inset-*)` real.
3. **Service worker** `web/sw.ts` → bundled to `sw.js`, registered after load.
   Strategy: precache the app shell (`index.html`, `app.js?v=…`,
   `tokens.css?v=…`, vendor) at install keyed by the build stamp;
   network-first for `/api/**` (never cache authed JSON); cache-first for
   vendor/static. On activate, delete caches with a different stamp.
4. **Offline shell**: the app boots to a usable frame offline (rails, theme,
   cached last state where safe) — offline is a state, not an error page.
5. **Install prompt**: listen for `beforeinstallprompt`, stash, surface as a
   quiet `.nu-*` affordance — never an interstitial.
6. iOS still needs `apple-touch-icon` and honest testing in standalone mode
   (no `beforeinstallprompt` there).

A PWA change touches `web-build.sh` (the sw needs bundling + the stamp) — keep
the sw in the same typecheck net as the app (`tsc --noEmit` covers `web/src`
and `web/sw.ts`).

## Tooling to build when needed (Vanilla TS, dependency-free)

The team improves by turning repeated hand-work into tools with gates:

- a `manifest-from-theme` generator (reads theme css, writes manifest colors) +
  a sync gate;
- a `sw-precache-list` generator reading `web-build.sh`'s outputs;
- a device-viewport smoke: puppeteer-less — a static HTML harness that iframes
  the app at each `assets/devices.json` size for eyeball + screenshot passes.
