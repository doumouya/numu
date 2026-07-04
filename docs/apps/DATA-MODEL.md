# Data model — the apps on the universal catalog (reconciliation)

> **Status: proposal** (see [README.md](README.md)). How the 9 consolidated apps integrate with
> the Em-approved universal catalog (`../../../object-model/CATALOG.md`) and the prefix registry
> (`../../../object-model/numu_id.md`) — evaluated claim by claim. Where a proposal minted a noun
> the model already owns, **the catalog wins**; the corrections are applied to the proposal docs
> in the same change. Companion: [DISTRIBUTION.md](DISTRIBUTION.md) (the delivery side of install
> state and faces).

## The tier model — an app never mints a noun a lower tier already has

1. **SYSTEM tables** — engine machinery (`events` audit, `memberships`, `relations`, sessions).
   Never re-modeled: history is an events query, participation is a membership edge.
2. **Universal catalog types** — the 9 + enrichments in CATALOG.md (`TXN` transaction, `BKG`
   booking, `MSG` message, `ADR` address, …). The domain floor every vertical shares.
3. **App-registered types** — nouns only one app needs, registered via `POST /api/types`
   (a row, never a migration). This is the registry's whole point: the catalog is a floor,
   not a ceiling.
4. **Entity data** — `attributes` / customization json on an instance. Axes, snapshots,
   preferences — anything that is data about an object, not a queryable noun.

## The reconciliation — every app object, adjudicated

| app | proposed | verdict | rationale |
|---|---|---|---|
| calendar | ~~`EVT_ event`~~ | **catalog `booking` BKG** | CATALOG **locked decision 4**: the scheduled-occurrence type is `booking`, never `event` (the `events` audit-table collision is the reason the name was chosen). BKG's `kind` enum already carries `meeting` (Meet) and `session` (ORVCLE studio time); participants are memberships with `context_role`, availability stays derived |
| releases | ~~`REL_ release`~~ | **`RLS_ release`** (app-registered) | `REL` is the LIVE system prefix for relation edges (`relations.rs:107`) — reusing it violates the day-one rule (one prefix, one type, forever). The Design-project seed's `REL_44` is an upstream nit to fix at the next re-sync |
| wallet | ~~`ACC_ account`~~ + own `TXN_` shape | **catalog `transaction` TXN verbatim; accounts = `connector` CON rows** | The catalog deliberately CUT the wallet object — *"a balance is `SUM(amount signed by kind)` per party"* — and its TXN is stronger than the proposal's (kind enum with sign semantics, set-once ledger fields, polymorphic `party_id`, `method` json for PSP/mobile-money detail). A connected money account is a **connector instance**; its provider-side balance is a synced snapshot in the connector row's attributes. **Total solde = Σ latest snapshots** (display-level, recomputed each sync) + the internal ledger = `SUM(TXN)` — two views, zero stored wallets |
| mail | ~~`MAC_ mailAccount`~~, ~~`MSG_/CNV_` guesses~~ | **catalog `message` MSG** + the existing conversation model; the account = a **`connector` CON row** | MSG was built for exactly this: `channel` enum (email/sms/chat/dm/push/letter), `direction`, delivery lifecycle (`draft→queued→sent→delivered/failed/received`), `external_ref` for the provider id, polymorphic `subject_id` anchor |
| files | ~~`DRV_ driveAccount`~~ | **`connector` CON row** | Same pattern — the proposals already render every Sources panel with the connector viewer; the data model now says the same thing |
| player | provider connections | **`connector` CON rows**; `PLS_ playlist` stays, **app-registered** | Playlist fails the catalog's ≥2-verticals bar (music-only) — correctly an app-tier type, not a catalog enrichment |
| insights | `CHT_ chart` · `DSH_ dashboard` | **app-registered** (CHT_ already minted by the sim's `new:chart`) | Never share a prefix: the RedPash lineage lesson (`FIL_` once served file AND dashboard) is why DSH_ exists at all |
| releases | `CRD_ credit` · `SPL_ split` | **app-registered** | Per-payee rows so RBAC and the KYC gate reach each split independently. CATALOG's lean alternative — `project.attributes.royalty_splits` — is recorded in releases.md as the phase-A shortcut; rows graduate when gates need them |
| sheets · video · files | `FIL_` + steps | **already core** — no change | derive-don't-store is shipped canon |

**Aligned for free:** wallet/releases KYC gates ride the `user` enrichment's `owner_grade`
`kyc_status` (owner-grade privacy is exactly right for payout gating). Insights' map archetype
geocodes the catalog's `address` ADR (`geo` json). Money everywhere = int minor units + ISO-4217
`currency` filled from `workspace.default_currency` — the wallet renders XOF because the
workspace says so, not because wallet hardcodes it.

**One dependency named:** the releases app's 422 close-gate spine (credits complete · splits =
100% · payee KYC verified) requires **workflows on registered types** — CATALOG open question 1
(the engine is case-only today). The releases app is that roadmap item's motivating use case.

## App-registered prefixes (the new lane for `numu_id.md`)

Collision-checked against the live registry (17 prefixes), the planned catalog (9), and the
system lanes (`SES REL FRN st req`):

| Prefix | Type | scope_parents | app |
|---|---|---|---|
| `APP` | app | `["workspace_id"]` | platform (the Store's noun — below) |
| `PLS` | playlist | `["workspace_id"]` | player |
| `CHT` | chart | `["workspace_id"]` | insights *(already minted by the sim)* |
| `DSH` | dashboard | `["workspace_id"]` | insights |
| `RLS` | release | `["workspace_id"]` | releases |
| `CRD` | credit | `["release_id"]` | releases |
| `SPL` | split | `["release_id"]` | releases |

`CRD`/`SPL` scope to their release the way `order_item` scopes to its order — reach flows from
the parent. The same table is appended to `numu_id.md` as **"App-registered types — planned"**.

## `app` APP_ — the Store's noun, and where icons live

Today a Store item is seed data. Registering **`app`** as a type makes install state, scopes, and
identity gatable entities:

| field | kind | notes |
|---|---|---|
| workspace_id | ref | scope parent |
| key | text | `wallet` · `player` · … (the face path key — DISTRIBUTION) |
| name · tagline | text | the Store card |
| **icon** | text | **the declared Customizable slot** — an icon-registry name (`envelope`) |
| **accent** | text | a token name (`--chart-6`), never a raw color |
| status | enum | `available · installed · disabled` — workspace-install IS this field (synced everywhere; DISTRIBUTION D4's entity half) |
| scopes | json | the granted `appScopes` set |

**Declare once, render everywhere:** the same `icon`/`accent` slots feed the Store tile, the
Object-Rail pin default, the standalone shell's topbar, AND the PWA face manifest
(`manifest-from-theme` reads them). Device-install state stays in the browser — never an entity.

## Pins & icon suggestion (the Object Rail contract)

Pinning an app to the Object Rail is a **user-scoped preference**, and the icon flow is the same
one channels and projects already use (`web/src/console/icon-picker.ts`):

1. **Suggestion priority.** The pin flow opens the icon picker **pre-seeded with the app's
   declared `icon` slot as the suggested, pre-selected first choice** — pin Mail and `envelope`
   leads; the curated grid and the full ~2,050-icon search stay one scroll away. The rule
   generalizes: any pin/create flow seeds the picker from the **nearest declared slot** — app
   icon for app pins, type icon for object pins, none for channels (curated grid first — exactly
   today's behavior).
2. **An override is user data, not app data.** `user.attributes.pins[] = { app_id,
   icon_override?, accent_override?, order }` — your rail can show Mail as a carrier pigeon while
   the Store tile, other members' rails, and the installed PWA face keep the envelope. The app's
   canonical identity is never mutated by a pin.
3. **Phasing.** Phase A: pins ride local storage next to `numu_chan_v2` (the channels pattern);
   phase B: `user.attributes.pins` — synced across devices, and RBAC-invisible apps simply
   drop off the rail because the pin's target stops resolving (leak-free by construction).

## Derived, never stored

The catalog's discipline, restated for the apps: **balances** (Σ TXN, Σ connector snapshots) ·
**availability** (query over BKG) · **stream/audience stats** (source projections; snapshot in
`user.attributes` at most) · **tracking/activity histories** (the `events` audit trail) ·
**watch/play positions** (device-local until proven sync-worthy). If an app wants to store one of
these, the answer is the tier model, top of this doc.

## Changes outside numu (recorded)

- `object-model/numu_id.md`: the app-registered table above appended as a planned lane
  (this pass — Em-approved).
- CATALOG open question 1 gains its motivating case (releases) — noted there when the catalog
  next opens for edit; no catalog change in this pass.
- Design-project upstream nit: the seed's `REL_44` label collides with the relation system
  prefix — rename to `RLS_…` in the numu Design System project at the next re-sync.
