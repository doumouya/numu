# Distribution — standalone ⇄ platform: one runtime, N faces

> **Status: proposal** (see [README.md](README.md)). The delivery layer for the 9 consolidated
> apps: how each ships as a standalone installable PWA *and* lives inside the numu console with
> zero migration cost and zero duplicated bytes. Companion:
> [DATA-MODEL.md](DATA-MODEL.md) (the entity side of install state, pins, and icons).

## The decision spine

| # | decision | why it's load-bearing |
|---|---|---|
| **D1** | **One origin, path scopes.** Platform at `/`, each app at `/apps/<key>/`. Branded subdomains later (wallet.numu.im) are ALIASES that redirect into the path scope — never separate origins. | Browser storage (localStorage, IndexedDB/OPFS, Cache Storage) and the session cookie are per-ORIGIN. Sharing is by construction, not by a sync protocol — both scenarios below collapse to "nothing to do". |
| **D2** | **One service worker, N manifests.** The root SW at `/` controls every path; there are NO per-app SWs. Each installable app is a **face**: a manifest (`/apps/<key>/manifest.webmanifest` — own name/icons/theme_color/start_url/scope) + a thin HTML entry. | Installability needs a manifest + a SW controlling start_url — the root SW satisfies every face. One SW = one cache set = one update stamp: every face updates atomically together. A face costs kilobytes; the **headless runtime** exists once. |
| **D3** | **Two shells, one set of mounts.** Console shell (rails · feed · panel · composer) and standalone shell (app-identity topbar · the app's 30×18 Layout · the Context panel · the docked composer). | Apps are container-first mounts that never know their shell — the same code fills the half-open panel, the expanded panel, a phone, and a standalone window. Forking the shell per app is where drift would start; there are exactly two. |
| **D4** | **Install is two orthogonal states; an install owns NO data.** Workspace-install (the Store's existing action → entity state, synced across devices — see DATA-MODEL) vs device-install (a face on this device's home screen). Data lives in the workspace (server entities) + the origin (on-device plane) — never "in the app". | Uninstalling a face deletes nothing. Installing a face downloads (almost) nothing. The Store can reason about both states independently. |

## URL & scope map

| path | manifest | SW controller | shell | notes |
|---|---|---|---|---|
| `/` | numu platform | root SW | console | rails + everything |
| `/apps/wallet/` | wallet face | root SW | standalone | scope `/apps/wallet/` |
| `/apps/player/` … `/apps/releases/` | one face each | root SW | standalone | same pattern ×9 |

Rules: **no `scope_extensions`** (using it blocks installing any other face from those scopes —
w3c/manifest #1209); every page links exactly ONE manifest (its own face's); cross-app links
navigate out of scope deliberately (below). The nacl composer ships in every face — a standalone
app is still chat-driven.

## The cache model — the no-double-storage proof

Cache Storage buckets, keyed by the build stamp `web-build.sh` already mints:

| bucket | contents | copies |
|---|---|---|
| `shell-<stamp>` | kernel bundle (amenan runtime + shared mounts), `tokens.css`, vendored echarts / bootstrap-icons / fonts | **one, shared by every face** |
| `face-<key>-<stamp>` | the app's entry chunk + its manifest + icon set | one small bucket per installed face |
| *(none)* | `/api/**` | **never cached** — network-first; authed JSON does not enter Cache Storage |

Worked math: the runtime (kernel + vendor + tokens) is cached once on first visit to ANY face or
the platform. Installing Wallet after visiting numu.im downloads its entry chunk + icons —
kilobytes. Installing all 9 faces + the platform ≈ one runtime + 10 icon sets + 9 entry chunks.
esbuild multi-entry with shared-chunk splitting keeps the entry chunks thin (phase-B build work,
§Build deltas). On-device DATA is even simpler: `numu_sim_v5` (phase A) / the GlueSQL-IndexedDB
plane + blob store (phase B) are origin-level — every face reads the same workspace, so there is
nothing to copy in the first place.

## The shells & chrome contract

The standalone shell is the console minus operator surface: **app topbar** (declared icon +
name — the same Customizable slot the Store tile and the manifest use, see DATA-MODEL —
account chip, panel toggle) · the app's **Layout** · the **Context panel** (objects still open in
viewers) · the **composer** (nacl travels; try-chips scoped to the app's verbs). The
**Impersonation Rail is console-only** — a face never carries operator chrome; an operator who
needs to troubleshoot inside a client's wallet does it from the console, where impersonation is
logged and bannered.

Cross-app links: a payee card in Wallet opens the user viewer in the panel (viewers are shared —
in scope). "Open in Mail" navigates to `/apps/mail/…` — out of scope, so the browser shows the
URL chip or opens the Mail face if installed; the platform face at `/` is always a valid target.
This is the honest same-origin trade-off: the faces are siblings, not strangers, and the browser
says so. Acceptable — the alternative (separate origins) breaks D1's entire storage story.

## Install state & the Store

The Store gains a second, orthogonal action per app (D4):

- **Add to workspace** — the existing install: entity state, synced everywhere (DATA-MODEL).
- **Install on this device** — a quiet affordance (never an interstitial — spa-pwa canon).
  `beforeinstallprompt` fires for the CURRENT page's manifest, so the affordance lives on the
  app's own path: the Store's button opens `/apps/<key>/?install=1`, which stashes the event and
  surfaces the prompt. Pages `preventDefault()` the event outside their own install surfaces.
- `related_applications` in every manifest + `navigator.getInstalledRelatedApps()` tune the
  prompts — don't push the platform install on someone happily running five faces; suggest
  consolidation gently. **Chromium-only, progressive enhancement** — absence of the signal just
  means default prompting; verify support at build time.
- iOS: no `beforeinstallprompt` — manual add-to-home-screen with `apple-touch-icon` per path;
  test standalone mode honestly.

## The scenarios, end to end

**A · apps-first → platform.** Day 1: a share link lands on `/apps/wallet/`; sign-in sets the
origin session; the runtime caches once; the user installs the Wallet face and works — the
on-device plane fills under the origin. Day 30: they open numu.im. End state: **already signed
in** (same cookie), workspace data already visible (server entities), on-device plane already
present (same origin), Store shows Wallet "on this device ✓". Installing the platform face
downloads the platform entry chunk only — the runtime is already cached. The old home-screen
icon keeps working. Migration performed: **none**.

**B · both, without doubling — the headless answer.** The user wants Wallet on the home screen
AND the full console, without two apps' worth of storage. They have it by construction: two
faces = two manifests + two icon sets over ONE headless runtime (one SW, one cache set, one
on-device plane). Every byte of code and data exists once per origin. "Headless" is literal —
the runtime has no face of its own; installs are just named doors into it.

**C · platform-first → pin an app.** From the Store, "Install on this device" on Player → its
face opens the standalone shell at `/apps/player/`, same session, same library, zero re-download
beyond the entry chunk. (Pinning to the Object Rail is the in-console analog — DATA-MODEL §pins.)

**D · uninstall & eviction.** Uninstalling a face removes an icon and its manifest registration —
no data lives there (D4). Browser storage EVICTION is the real risk (Safari ITP can clear
script-writable storage on unused origins): mitigate with `navigator.storage.persist()` on
first meaningful use, and server truth means eviction costs a re-sync, never data loss. The
offline plane is a cache of the workspace, not the workspace.

## Offline & sync tiers (matches each proposal's Phasing)

| tier | apps | offline behavior |
|---|---|---|
| **full** | sheets · player · video | local blobs + derive-don't-store: profile/pipeline/playback work offline entirely |
| **last-synced + queue** | wallet · mail · calendar · files | read last-synced state; writes queue as PATCH + If-Match — a stale version on reconnect is a **412 → re-derive**, the conflict protocol is the concurrency contract we already ship |
| **recompute** | insights | recipes re-evaluate on reconnect (recipe-only means nothing stale to show as if fresh) |
| **read-only** | releases | board renders last state; workflow transitions need the server (the 422 close-gates are server truth) |

## Build & tooling deltas (phase B — each its own Case, none in this pass)

1. `tools/web-build.sh` multi-entry + shared-chunk splitting; per-face HTML stubs; the stamp
   discipline extends to face chunks.
2. `manifest-from-theme` generator (theme tokens + the app's declared accent → manifest colors +
   maskable icons) + a sync gate — a hand-edited manifest color is drift.
3. `web/sw.ts` + a `sw-precache-list` generator reading web-build's outputs + a sync gate.
4. A **`pwa-audit` gate**: every `/apps/<key>/` has a manifest, icons, and a precache entry; no
   scope collisions; no `scope_extensions`; no bare `100vh` in shell CSS. Auto-discovered by
   ci.sh like every gate.
5. Browser-behavior items to verify at build time: root-scope-SW installability across engines ·
   per-page `beforeinstallprompt` handling · `getInstalledRelatedApps` support surface.
