# wallet — every money account in one place

> **Status: proposal** (see [README.md](README.md)). Accent `var(--chart-1)` · icon `wallet2`.

## Purpose

One surface for money. The six payments brands stop being tiles and become **sources**: rows in
wallet's Sources panel (the existing `connector` viewer), each feeding accounts and transactions
into one shared model. The headline is the aggregation no single brand app can show — the **total
solde**: the sum of every account balance converted to the workspace currency (XOF, from
`settings.workspace.currency` in `web/data/console-data.js`) with per-currency subtotals. FX rates
come through the `wise` source (a stub rate table in phase A).

The **Billing Watch** agent works *inside* wallet — it is not an absorbed app. It reconciles
payouts against invoices, flags shortfalls and late fees, and opens a case on mismatch; its
findings surface as `object` blocks in the wallet conversation.

## Absorbs

| store id | brand | seed kind | role as a source |
|---|---|---|---|
| `stripe` | Stripe | Payments (connected) | card charges + payouts → connector row / `TXN_` |
| `wave` | Wave | Mobile money (connected) | mobile-money balance + transfers |
| `djamo` | Djamo | Neobank | card account + spend |
| `wero` | Wero | Payments | P2P payments |
| `paypal` | PayPal | Payments | merchant balance + payouts |
| `wise` | Wise | FX / transfers | multi-currency accounts + **the FX rate source** |

## Objects

| type | prefix | role |
|---|---|---|
| connected account | `CON_` | a **`connector` instance — the existing type, nothing new registered** ([DATA-MODEL.md](DATA-MODEL.md)): provider · kind · currency + the **balance snapshot** and last-sync in its attributes. Customization (icon/accent) is entity data. |
| transaction | `TXN_` | **the universal catalog ledger type, adopted verbatim** (CATALOG.md): `kind` enum `payment · refund · deposit · withdrawal · payout · fee · adjustment` (sign derives from kind) · **positive** minor units + ISO-4217 currency · polymorphic `party_id` (wallet = SUM per party) · `subject_id` · `method` json for PSP/mobile-money detail · set-once ledger fields |

The catalog **deliberately cut the wallet object** — a balance is derived, never stored. Wallet
shows two derived views: the internal ledger (`SUM(TXN)` per party) and the external picture
(Σ latest provider snapshots per connected account).

A **transfer** is not a special verb: it is a new `TXN_` going through the default workflow.
Payouts are **KYC-gated** — a payee whose KYC is pending is a `422 close_preconditions_unmet`
(the seed already encodes this: NOVA, "KYC pending — payouts blocked", in the user-record KYC
section).

## Views

### Phone (~360)

```
┌────────────────────────────┐
│ wallet              ⟳  ⋯   │
│ ┌────────────────────────┐ │
│ │ TOTAL SOLDE            │ │
│ │ 4 812 300 XOF          │ │
│ │ EUR 1 240 · USD 310    │ │
│ └────────────────────────┘ │
│ ◂ [Wave✓][Stripe✓][Wise] ▸ │  ← account cards, h-scroll
│ ─ all · wave · in · out ─  │  ← filter chips
│ • Awa K.      −25 000 XOF  │
│ • Stripe pay  +310 USD     │
│ • …             (scrolls)  │
│ [ ⇄ Transfer ]             │  ← thumb reach
│ › nacl composer            │
└────────────────────────────┘
```

Balance card first, horizontal account-card scroll, unified transaction list. The Transfer
action sits in thumb reach above the docked composer.

### Context panel (half-open)

Container-first: half-open, the panel renders the phone view verbatim — balance card, account
scroll, list. A `read:wallet` card in any thread opens here; expanding the panel promotes it to
the desktop layout. No forked code — the view answers to its container, not the viewport.

### Desktop (30×18)

```
┌────────────────────────────────────────────────────────────┐
│ hero — TOTAL SOLDE 4 812 300 XOF · per-currency subtotals  │
├────────────────────────────────────────────────────────────┤
│ accounts — [Wave ✓][Stripe ✓][Djamo][Wero][PayPal][Wise]   │
│   one card per source: brand logo · balance · sync state   │
├─────────────────────────────────────┬──────────────────────┤
│ transactions — chips: all·wave·out  │ insight — one 15×9   │
│ • Awa K.        −25 000 XOF  done   │ chart: in/out over   │
│ • Stripe payout +310 USD     done   │ time, or spend by    │
│ • …                     (scrolls)   │ kind                 │
└─────────────────────────────────────┴──────────────────────┘
```

```json
{ "id": "wallet", "v": 1, "areas": [
  { "id": "hero",         "x": 0,  "y": 0, "w": 30, "h": 3 },
  { "id": "accounts",     "x": 0,  "y": 3, "w": 30, "h": 4 },
  { "id": "transactions", "x": 0,  "y": 7, "w": 18, "h": 11 },
  { "id": "insight",      "x": 18, "y": 7, "w": 12, "h": 11 } ] }
```

Below `--bp-md` the areas stack in source order: hero → accounts → transactions → insight —
which is the phone view. The insight tile hosts one 15×9 chart spec (the chart-designer canvas).

## Sources model

All six sources are **connected** connector rows; a manual cash account is a local `CON_` row
(no provider) — its balance is pure `TXN_` arithmetic. Aggregation rule: `total = Σ accounts
(snapshot × rate→XOF)`, subtotaled per currency; rates resolve through the `wise` source (stub
table in phase A, live in phase B). A new fintech is a connector row + a source adapter — zero
new UI, zero new types.

## Reuse

- `web/src/console/context-panel.ts` — the `connector` viewer for source config (brand logo,
  account/scopes/last-sync); the `user` viewer's KYC section pattern for payee gating.
- `web/src/console/feed.ts` — `object` card (the solde, a single `TXN_`), `objectTable`
  (transaction/account lists), the KindLabel chip for currency tags on rows.
- `web/src/console/chart-theme.ts` — `mountNuChart` for the insight tile (token-resolved
  colors; re-renders on the theme reaction).
- `web/src/console/icon-picker.ts` — icon slot for account customization.

## nacl surface

| input | result block / effect |
|---|---|
| `read:wallet` | the aggregate balance `object` card (total solde + subtotals) → panel |
| `read:account` | `objectTable` — one row per connected `CON_` source: provider · balance snapshot · last-sync |
| `read:transactions.account=wave` | `objectTable` — Wave `TXN_` rows, status badges |
| `new:transaction.kind=payout.amount=25000.currency=XOF.party_id=USR_…` | INSERT `TXN_` (catalog fields) → `object` card + `openObjectId`; payee KYC pending → `422 close_preconditions_unmet` |

## Touch & appearance

- **hit**: `row` — transaction rows and account cards are whole-row targets (≥ 44px).
- **hover**: `overflow-menu` — every swipe action has a visible `⋯` path.
- **gestures**: `swipe-actions` on transaction rows (categorize · attach receipt) ·
  `pull-refresh` = source sync.
- **density**: `comfortable` on coarse pointer.

Icon `wallet2` · accent `var(--chart-1)`. Account cards expose the Customizable slots
(icon · accent · label · density) as entity data; source rows keep their brand logos.

## Phasing

- **Phase A (sim seam)** — `CON_` sources + `TXN_` as seeded registry entities with fake last-sync
  timestamps; aggregation client-side; the stub FX rate table under the `wise` source id;
  Billing Watch matches seeded payouts to seeded invoices; the KYC 422 replays from the seed.
- **Phase B (Rust api)** — real connector OAuth + provider APIs (webhooks land as `TXN_`),
  live wise FX rates, the transfer write path (`POST` + If-Match on the account, default
  workflow), the KYC gate enforced server-side; Billing Watch on real payouts.
