# The numu console — frontend architecture

The console is numu's product surface: a **chat-driven, on-device data
workspace**. You talk to your org's objects in a conversation thread using
nacl; data (CSVs, records, media, dashboards) materializes as **blocks** in the
feed and opens in the right-hand **Context panel**. Multi-tenant, RBAC-scoped.

Built on **amenan-ui** (vanilla TS, zero runtime deps) — ported from the numu
Design System's console kit (`ui_kits/console/`), same layout, same behavior,
no React. The engine behind it is the **NumuClient seam** (see [SEAM.md](SEAM.md)):
phase A runs the design project's in-browser sim; phase B is the Rust api.

## Layout

```
┌──┬──────────────────────────────────────────────────────┐
│I │ topbar — panel toggle · tenant chip · chrome (bell ·  │
│m │   accent · mode · Store · Settings · profile)         │
│p ├──────────────┬───────────────────────────┬────────────┤
│  │ OBJECT RAIL  │ conversation feed / Store │ Context    │
│R │  channels →  │  (blocks)                 │ panel      │
│a │   projects   │                           │  type-     │
│i │  objects     ├───────────────────────────┤  specific  │
│l │              │ composer (docked under    │  viewer    │
│  │              │  EVERY page): try-chips · │ 27rem ⇄    │
│  │              │  › nacl · action bar      │ full width │
└──┴──────────────┴───────────────────────────┴────────────┘
```

**The two rails — the tenancy rule (console v2, CAS_0cc48a29).** The far-left
strip is the **APPS RAIL** (`shell/rail.ts`): workspace marks at the top (the
tenancy section — sim canon today, real workspaces with the orgs slice; empty
in HTTP mode until then), then the **registered apps** (Workspace · Store ·
the portfolio manager…; flyout with name+desc on pointer-fine hover/focus,
taps navigate `#/<app>`), and **Impersonate as an app-like entry at its
foot** — operator + sim only ("view as user" scoped to the selected
workspace's members; enforced expiry + per-read audit stay the phase-B server
contract). A client member sees apps, never impersonation; while viewing-as
the rail disappears entirely — the operator sees exactly what the member
sees. The **Object Rail** (channels→projects/objects tree) remains the one
rail every member has.

## Modules (`web/src/`)

| module | owns |
|---|---|
| `main.ts` | the BOOT ENTRY (the esbuild entry since console v2): sim → straight into the console with the sim canon; http → the `.nu-boot` splash → `GET /auth/me` gate → console (lazy `import("./app.ts")` — a logged-out visitor's console DOM is never built) or the login page. Fail-closed: any non-200/401 answer lands on login with the unreachable note |
| `shell/auth.ts` | the identity store (`auth.identity`, null in sim) · `fetchMe` (the gate decision, pure over the seam's `request()`) · `identityRecord()` (synthesizes the `ConsoleUserRecordData` shape the existing renderers know — HTTP mode's `me`; sim's CCD wins untouched, Jean Mensah stays sim canon) · `doLogout` (204 → full reload back through the gate — mounts have no teardown contract). The chrome renders `avatar_url` as `.nu-me-img` (initials fallback); Settings gains additive `me?`/`onLogout?` cfg (the Sign out row exists only when a session does) |
| `shell/login.ts` | the front door: wordmark + ONE "Continue with Google" button (`/auth/google/start`, return-stash first) + the callback's `?error=denied\|auth_failed` slugs as human copy (URL scrubbed after reading) |
| `shell/apps.ts` | the **AppPage registry** (console v2, CAS_0cc48a29): `{id, label, icon, desc, order, available(), surface, objectRail}`; `showApp()` is the SINGLE visibility sink over kept-alive center surfaces; `onAppChange` feeds the chrome |
| `shell/router.ts` | hash routes `#/<app>[/sub]` over the registry (`parseHash`/`navigate`/`initRouter`) + the OAuth **return-stash** (sessionStorage — the hash does not survive the Google 302 chain) |
| `shell/layout.ts` | the four-region skeleton built ONCE: apps-rail host · topbar · Object-Rail host · center (kept-alive surfaces + the docked composer) · Context host; `addSurface()` mints an app's canvas |
| `app.ts` | state + seam wiring (send / saveAttachment / applyEffects / feed bootstrap) · **impersonation** (view-as: actor swap + logged engine events + banner) · **buildLive** (the Objects panel bound to the reach-filtered registry, artists grouped from real audio files) · channels as LOCAL user data (add/rename/delete/reorder/collapse/hide, `numu_chan_v2`) · projects as ENGINE objects (POST/PATCH/DELETE + If-Match) · appearance (accent × mode × **skin**, each persisted) · the theme reaction · (dissolving into `shell/` + `apps/` across the v2 slices) |
| `client.ts` | the typed `ncl` façade over `window.NumuClient` + `ORG_OF`/`PRJ_OF` + `prefetchValues` |
| `shell/rail.ts` | THE APPS RAIL — workspace marks · the registry's apps (borderless squares, flyout, `navigate()`) · impersonate as the foot entry (operator+sim only; absorbs the former `console/impersonation-rail.ts`) |
| `apps/portfolio.ts` | the PORTFOLIO MANAGER (CAS_357473a7) — the app that runs em.numu.im: Articles (list→md editor, slug create-only, PATCH w/ If-Match, 412 → reload prompt) · Overview (the 3 `site_copy` keys) · CV (validated JSON doc editor v1) · Insights (visits/referrers/clicks/dwell/… + feedback w/ stars) · the PUBLISH button (`POST /api/apps/portfolio/publish` → site.json + genpdf CV committed → the portfolio CI deploys). HTTP-only; admitted by the boot probe (about 200 + insights ≠ 404 = mounted AND admin); re-renders on every show |
| `console/object-rail.ts` | THE OBJECT RAIL — the one rail every member has: channels→projects tree with full CRUD (create-with-icon+color, inline rename, drag-reorder + drag-to-channel, collapse w/ count, hide/restore, pin) + the quick-access objects list |
| `console/icon-picker.ts` | the in-app icon picker: search over all ~2,050 Bootstrap Icons (synced name list) + a curated common grid |
| `console/feed.ts` | the block renderers (below) |
| `console/composer.ts` | the always-ready nacl terminal docked under EVERY page: one-line grow, try-chips, the autocomplete popover, and the ACTION BAR (➕ attach/insert/reach-out/schedule menu · mic · emoji · the Claude assistant · input settings · send) |
| `console/nacl-suggest.ts` | PURE staging logic (verb→object→column→operator→value, `read:users`) — unit-tested, no DOM |
| `console/context-panel.ts` | the panel shell + the viewer registry (below) |
| `console/store.ts` | the numu Store: Apps / Agents / Connectors shelves, search, install/enable state, brand logos. **The store's truth depends on the plane** (CAS_3bfcc22b): sim shows the full demo catalog; HTTP shows the REAL registry as installed and the catalog as an honest roadmap — `soon: true` items render "coming soon" with NO install/connect action and never a fake connected state (the apps doctrine: [`../apps/README.md`](../apps/README.md), one app per purpose, brands become sources) |
| `console/settings.ts` | the Settings surface (opens expanded in the panel): account (+ Sign out when a session exists) · **Directory** (HTTP mode, CAS_e6695638: create real workspaces/users through the generic pipeline) · appearance (skin cards + density) · workspace · members & roles · apps & permissions · AI-connect · plan · notifications · security & sessions · data · support · danger |
| `console/user-record.ts` | Profile == Record: identity · contact (inline-editable when self) · memberships · KYC · activity · owned · notes; Impersonate/Message for others |
| `console/chart-theme.ts` | token → ECharts option synthesis + `mountNuChart` (direct init on `.nu-` slots) |
| `numu-sim.d.ts` | ambient types over the sim globals — the typed face of the seam |

**The thread in HTTP mode (CAS_6b46bea7):** the composer never swallows input —
every send echoes a `sent` bubble, `read:<type>` (article/workspace/user/…) is
REAL over `GET /api/objects/<type>` → an `objectTable` (row-click fetches the
record into the Context panel), and every other line gets an honest `step`
("server-side nacl is the next backend slice — the full grammar runs in the
sim"). Feeds are session-local until `POST /api/nacl` + `/api/conversations`
land (SLICE 2, SEAM.md Phase C) — stated, not faked. Sim keeps its full nacl
engine unchanged.

**The plane rule (CAS_e6695638 · CAS_3bfcc22b): demo data never crosses into
HTTP mode.** In HTTP the tenancy is REAL (`shell/workspaces.ts` — the rail
marks + topbar chip come from the caller's reachable `workspace` rows; none →
the honest "no workspace yet" chip pointing at Settings → Directory), the
Object Rail is registry-fed (`loadLive`: reachable `project` rows scoped to
the selected workspace — empty until they exist), channels seed a neutral
`general`, the composer hints are neutral, no demo artist auto-opens, and
Settings shows only the real sections (Account · Directory · Appearance ·
Support). Sim keeps the full canon (orvcle tenants, Jean's members, demo
channels/projects/objects) — it IS the design reference.

**Scroll discipline**: invisible scrollbars are the house default (the
amenan-typescript canon) — every `.nu-*` scroll region rides the `.nu-scroll`
pattern block at the end of `app.css` (Firefox `scrollbar-width: none` +
webkit `display: none`); content scrolls, chrome doesn't, keyboard
scrollability and a partial-row affordance stay.

No framework: state lives in `app.ts`, each region is a mount exposing
`update()`, and a state change re-renders exactly the regions it touches.

## The block vocabulary (feed.ts)

| `type` | renders |
|---|---|
| `email` | sender/time head · subject · body · CSV attachment row with **Save to chat** (→ `saved · on device`) |
| `step` | `› <nacl>` head + kind tag · impact line (✓ ok / ⚠ warn) |
| `data` | the CSV profile: 4-stat grid (rows/cols/null rows/junk) + column rows (KindLabel dtype + null%) |
| `dashboard` | hairline chart grid, one live ECharts canvas per tile |
| `object` | a clickable card (type tag · title · meta) → opens the Context panel via `objRef` (a single-row read renders this) |
| `objectTable` | a multi-row read result: one clickable row per reachable entity (type tag · title · status badge · meta) — `read:case`, `read:users`, … |
| `sent` / bubble | chat bubbles (sent = accent tint, right-aligned; reactions) |

## The viewer registry (context-panel.ts)

`object.type` → viewer: `audio` (**real `<audio>` playback**, persisted position,
cover art, seek + transport) · `video` (**real `<video>`**, white-on-scrim custom
controls, persisted position, and 4 expanded layouts — cinema · review · strip ·
full — with up-next tiles) · `artist` (hero + plays/tracks stats + featured
track list → the player + discography grid) · `image` (hero + thumb strip) ·
`dashboard` (chart tiles) · `storeItem` (app/agent detail: logo, tagline,
what-it-does, Install/Configure/Open-app) · `connector` (config w/ brand logo:
host/port/db/user + connection string, or account/scopes/last-sync) · `user`
(the user-record viewer) · `settings` (the Settings surface, opens expanded) ·
`app` (iframe) · `case`/`record` (code chip + status/type/priority/
classification badges + **workflow stepper from the seed's workflow states** +
people & routing + field rows). Media fall back to placeholder surfaces when an
object carries no `src`.

## nacl in the console

- **Send**: `app.ts#send` → `ncl.nacl(text, ctx)` with
  `ctx = { workspace, projectId, itFileId, channel }`; a `needBlob` effect
  triggers `ensureBlob` + one retry (derive-don't-store: the original bytes
  refetch by the `src` recorded at upload). Blocks append to the feed +
  persist; effects apply client-side.
- **Effects**: `theme` (mode dark|light · accent ink|blue — no settings page),
  `closePanel`, `play` (→ the audio viewer), `it` (the thread's focused file),
  `openObjectId` (a `new:` create opens its object in the panel), `needBlob`
  (handled in Send — refetch + one retry).
- **Autocomplete**: `nacl-suggest.ts` staging over three planes — the thread's
  materialized csvs (from the feed's `data` blocks), the lazy column-distinct
  values cache (`window.__NUMU_VALUES`, prefetched per upload), and the
  doctrine catalog (`window.NACL_COMMANDS.objects`). RBAC-scoped by
  construction: only reachable files/objects are in those planes. ↑↓ cycle,
  Tab/⏎ accept, Esc dismiss, click works.

## Appearance (theme × mode × skin)

Two-axis amenan-ui platform: `data-theme` (`numu` ink | `numu-blue`) ×
`data-mode` (light | dark); default **numu + light** (the index.html prePaint
snippet — deliberately not the amenan default). A third console-local axis —
the **skin** (`data-skin` on the app root: midnight true-black + the aurora /
dusk / ember gradient trio) — rides a separate `--brand` channel so gradient
skins never break `color: var(--accent)` (`web/styles/numu-skins.css`, the
appearance tier). Settings → Appearance offers the six skin cards; each axis
persists independently, so a reload restores mode + accent + skin together.
`set:theme.mode=dark` and the topbar buttons are the same one-attribute write.
Charts carry explicit token-resolved colors, so the theme reaction re-renders
the chart-bearing regions (see [THEME.md](THEME.md)).

## Impersonation (the operator's view-as)

Explicit, purpose-tagged, time-bound, logged — never a silent bypass (RBAC
design §3.3): the Impersonation Rail's view-as popover (**targets = the
selected workspace's members**, resolved from the engine's memberships over the
workspace scope chain) or the eye in Settings → Members swaps `ncl.actor`,
writes `operator.impersonation_started` / `_ended` events on the engine, shows
the warn banner (who · purpose · until · granted by), and hides the
Impersonation Rail entirely — the impersonated user's reach drives everything
(`buildLive`, feeds, nacl).

## Clean-slate seeding

The registry seed carries ONLY the two workspaces + the operator: every flow is
testable from scratch — channels, projects (with icon + color), cases via
`new:case.title=…` — and everything you create persists (registry + feeds in
localStorage; frames re-derive from blob + steps).

## Verified behavior (phase A, 2026-07-03)

**Wave 1 (the Jul-2 canon), local driver:** dossier.csv (14 MB · 101,234 rows ·
wrapped · windows-1252 · cleanness 35%) saved → `unwrap` (17 cols · 49.8%) →
`repair` → `clean` (99.6%) → `rename dots` → `new:chart.type=donut` (a real
CHT_ entity · 6 buckets, live canvas); autocomplete staged; reload → feed
persists, the table **re-derives** from blob+steps on demand. HTTP driver
(`?http=1` against `web/sim/server.node.js`): same page, `· node` chip, state
shared with curl; 428/412/422/404 error contract verified.

**Wave 2 (the Jul-3 canon), clean slate:** channel created with the icon
picker → project created with color (a REAL `POST /api/objects/project`,
version-tracked) → `new:case.title="Mix — ACME jingle"` (INSERT · CAS_) →
`read:case` (single row → object card) → click → the enriched case detail
(default-workflow stepper, people & routing with the project name resolved) →
`read:users` → the objectTable block. Settings opened; the **ember** skin
applied (`numu × dark × ember`). Impersonated Marc from Members (banner, actor
swap, `operator.impersonation_started` logged, rail hidden) and exited. Store:
13 apps / 6 agents / connector groups, install → detail in the panel. Reload:
skin + channels + project + case all persist. Run it: `npm run dev` →
http://localhost:8940.
