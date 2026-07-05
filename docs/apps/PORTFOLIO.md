# The portfolio app — numu's first production job (apps tier)

> The portfolio (em.numu.im) is numu's first real deployment AND its first app. This doc is the
> contract for `crates/apps/portfolio` and for the **apps tier** itself. Related:
> [`../api/RUNNING.md`](../api/RUNNING.md) (boot/env) ·
> [`../api/RBAC.md`](../api/RBAC.md) (the planes the app rides) ·
> [`../ops/DEPLOY.md`](../ops/DEPLOY.md) (the production runbook).

## The apps-tier doctrine

Two rules, both structural:

1. **Product-specific logic lives ONLY under `crates/apps/`.** The core (`crates/api`) stays
   generic — its only apps-shaped surface is the `AppMount` seam (`run_with`): a composition
   binary (`crates/server`, the production image) links core + apps and mounts each app under
   `/api/apps/<name>` iff its env flag (`NUMU_APP_PORTFOLIO=1`) is set at boot. The dependency
   arrow points app → core, never back; the dev binary (`numu-api`) never links an app.
2. **Apps consume the core through its public seams** — the `Caller` extractor, the registry,
   the gated object write path. An app never opens its own side door around a plane.

Consequence of (1): an app absent from the image or un-flagged at boot simply is not there —
its routes 404 like everything else numu doesn't admit.

> **Known audit under-claim.** The v0 audit gates (`rbac-audit`, `debuggability-audit`, …) scan
> `crates/api/src` only; app crates are not yet in their SRC set. The discipline still applies —
> this doc carries it, and widening the audits to `crates/apps/*` is a recorded follow-on Case.

## The app's surfaces (each lands as its own Case)

| Route (under `/api/apps/portfolio`) | Auth | What |
|---|---|---|
| `GET /about` | none | mount-seam liveness stub (CASE 0019) |
| `POST /ingest` | none (public) | **live (CASE 0022)** — telemetry batches + feedback from anonymous visitors; written AS the Plane-C-confined `SVC_collector` (create-only on `pt_event`/`feedback` — migration 0020) |
| `GET /insights` | platform admin (404 otherwise) | aggregates: visits/page, referrers, CV downloads, link clicks, settings distribution, dwell buckets, feedback list |
| `POST /publish` | platform admin (404 otherwise) | renders `content/site.json` + the genpdf CV PDF from published `article`/`site_copy`/`cv` entities and commits both to `doumouya/doumouya-portfolio` via the GitHub Contents API → the portfolio's CI deploys |

Portfolio types (`pt_event`, `feedback`, `article`, `site_copy`, `cv`) are **registry rows**
seeded by migration — a type is a row, and the app's data model needs no engine change.

## The ingest contract (CASE 0022)

`POST /api/apps/portfolio/ingest` — the app's only unauthenticated surface, hardened in layers:

- **Body** (strict serde — unknown fields/kinds are rejected; the schema IS the privacy
  contract, nothing identifying can even be expressed):
  `{ v: 2, events?: [ { kind, page, slug?, ref?, vp?, lang?, mode?, ts?, meta? } ], feedback?:
  { stars, text?, page, ts? } }` — kinds pinned to `route_view · feedback_ui · cv_download ·
  link_click · settings_change · install · writing_filter · dwell`; `vp` ∈ xs/sm/md/lg; `mode`
  ∈ light/dark; caps: page ≤128 · slug ≤64 · ref ≤256 · lang ≤8 · ts ≤32 · meta ≤512 (rendered)
  · text ≤1000 · **stars 1–5 enforced HERE** (the registry `int` kind has no range check) ·
  batch ≤50 · **body ≤64KB** (DefaultBodyLimit).
- **Rate limit**: its own per-client fixed window (`NUMU_INGEST_RATE_LIMIT`/`_WINDOW_SECS`,
  default 120/60). Keys are SHA-256 hashes held only in memory; under `NUMU_TRUST_PROXY=1` the
  key is the **last** `X-Forwarded-For` entry (edge-appended — the first is client-spoofable).
- **Write path**: every row goes through `objects::create_object` — the SAME gated pipeline as
  the HTTP surface — as `Caller::for_service("SVC_collector")` (agent surface, Plane-C
  default-deny). The collector's only grants are create on the two types: it cannot view, edit,
  or delete **even its own rows** (db-tested). No IP is ever read, stored, or logged.
- **Immutability**: `method_policy` masks PUT/PATCH on both types; delete stays open for the
  retention follow-on (GOVERNANCE #4).
- Success → `202 { accepted: n }`; violations → 422 problem+json; over-limit → 429.

## Status

CASE 0019 shipped the seam + skeleton (`AppMount`, `crates/server`, `/about`). CASE 0022 shipped
the public ingest (migration 0020, `SVC_collector`, the hardened route, db-tests). Insights and
publish: planned, each its own Case.
