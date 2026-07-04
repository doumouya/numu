# docs/apps/ — the consolidated app catalog (UI proposals)

> **Status: proposal** — docs-authoritative until code lands (then code is truth and these
> reconcile). The spec to design against in the numu Design System project and to build against
> in phase B. Written under the `amenan-typescript` skill canon
> ([`.claude/skills/amenan-typescript/`](../../.claude/skills/amenan-typescript/SKILL.md)).

## The doctrine — one app per purpose, brands become sources

The Store must not grow one UI per brand. **A brand app or connector is a SOURCE inside one
generic app per purpose-type, never its own surface.** You don't install "Wave" and "PayPal" and
"Djamo" and learn three balance screens — you open **Wallet** and see the total solde across every
connected account. You don't install five music apps — you open **Player** and it plays your track
from the on-device mp3 *or* through your Spotify subscription, same UI. The brand survives as a
row in the app's Sources panel (logo, connection state, scopes — the existing `connector` viewer),
not as a tile competing for the rail.

What this buys, permanently:

- **No duplicate views.** One transactions list, one library, one inbox, one calendar — each
  written once, themed by tokens, reached by nacl.
- **Aggregation is the product.** Total balance across accounts, one play queue across providers,
  one inbox across mailboxes — the thing no single brand app can show you.
- **O(1) growth.** A new fintech/streamer/mail provider is a connector row + a source adapter,
  zero new UI.

## The map (every current Store item lands in exactly one app)

| app | absorbs (store ids) | accent | icon |
|---|---|---|---|
| [`wallet`](wallet.md) | `stripe` · `wave` · `djamo` · `wero` · `paypal` · `wise` (connectors; `billing` agent hooks) | `--chart-1` | `wallet2` |
| [`player`](player.md) | `spotify` · `apple` + local audio file objects | `--chart-4` | `music-note-beamed` |
| [`video`](video.md) | local video file objects · `gmeet` recordings | `--chart-3` | `film` |
| [`mail`](mail.md) | `gmail` (+ future providers) | `--chart-6` | `envelope` |
| [`files`](files.md) | `gdrive` + local file objects | `--chart-2` | `folder2-open` |
| [`calendar`](calendar.md) | `gcal` · sessions/bookings · `gmeet` (join = an event **action**, not an app) | `--chart-7` | `calendar-week` |
| [`sheets`](sheets.md) | `csvprofiler` · `sheeteditor` | `--chart-5` | `grid-3x3-gap-fill` |
| [`insights`](insights.md) | `chartbuilder` · `dashstudio` · `mapview` | `--chart-8` | `bar-chart-line` |
| [`releases`](releases.md) | `muso` · `distrokid` (the studio vertical) | `--accent` | `vinyl-fill` |

Database connectors (`postgres`, `gluesql`) are substrate, not apps — they stay in the Store's
Connectors shelf. Agents (Inbox Triage, Data Cleaner, Scheduler, Reach Auditor, Release Prep,
Billing Watch) are not apps either: each one *works inside* the app that owns its domain and is
noted there.

Two cross-cutting companions complete the catalog:
[**DATA-MODEL.md**](DATA-MODEL.md) — how the apps sit on the universal catalog
(`object-model/CATALOG.md`): the tier model, the per-app type adjudication, app-registered
prefixes, and the Object-Rail **pin & icon-suggestion contract**.
[**DISTRIBUTION.md**](DISTRIBUTION.md) — standalone ⇄ platform delivery: one origin,
**one runtime + N installable PWA faces**, the two shells, and the no-double-storage model.

## Shared conventions (every proposal follows these — the template enforces them)

1. **Objects first.** Each app's nouns are **registered types** in the type-registry
   (`docs/api/OBJECTS.md` style, `PREFIX_` ids) — never private app state. RBAC (leak-free 404),
   audit events, ETag/If-Match, and the workflow engine apply to app data *for free*.
   Customization (icon/accent/label/density + the touch variant) is **entity data**.
2. **Layouts are data.** Desktop views ship as a `Layout` JSON preset on the **30×18 grid**
   (`.amu-grid`, the skill's numu-layout DSL): areas `{id, x, y, w, h}` with
   `0 ≤ x, x+w ≤ 30 · 0 ≤ y, y+h ≤ 18`. Charts/tiles use **15×9** (same 5:3 family). Below
   `--bp-md` areas stack in source order.
3. **Container-first.** Every view is authored against container bands
   (360 / 480 / 600 / 768 / 1024) — the half-open Context panel gets the phone view for free;
   expanded gets desktop. "Renders correctly at any container width ≥ 320px" is the app contract.
4. **nacl-first.** Every app has a chat surface: its data answers `read:` in the feed (object
   card / objectTable block), its actions are verbs. The app view is a projection of the same
   reach the composer has — never a side door.
5. **Touch is declared, not bolted on.** Each proposal carries a TouchSpec (hit strategy · hover
   replacement · gestures, every gesture with a visible non-gesture path). ≥ 44px targets.
6. **Tokens only.** Colors are `var(--…)` (C1); accents come from the chart ramp; icons are
   registry names (Bootstrap Icons today); scrollable regions use the hidden-scrollbar default.
7. **Reuse the shipped viewers.** audio/video/artist/dashboard/connector/user viewers
   (`web/src/console/context-panel.ts`), the feed blocks (`feed.ts`), `chart-theme.ts`,
   `icon-picker.ts` — proposals compose them; they don't re-invent them.

## The proposal template

Each `<app>.md`: **Purpose** → **Absorbs** (id → source role) → **Objects** (type · prefix ·
role) → **Views** (phone wireframe · panel note · desktop wireframe + `Layout` JSON) →
**Sources model** (connected vs local; the aggregation rule) → **Reuse** → **nacl surface** →
**Touch & appearance** → **Phasing** (phase-A sim vs phase-B routes/connectors).

## What this pass is NOT

No code, no tokens, no Store-shelf regrouping (`web/data/console-data.js` is design-synced
verbatim — the regroup happens in the Design project, then re-syncs), no amenan-ui changes (the
kernel is frozen pull-only; the grid component lands there when Em unlocks). When a proposal
graduates to build, it opens its own Case.
