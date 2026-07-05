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
| `POST /ingest` | none (public) | telemetry batches + feedback from anonymous visitors — validated, rate-limited, body-capped; written AS the Plane-C-confined `SVC_collector` (create-only on `pt_event`/`feedback`) |
| `GET /insights` | platform admin (404 otherwise) | aggregates: visits/page, referrers, CV downloads, link clicks, settings distribution, dwell buckets, feedback list |
| `POST /publish` | platform admin (404 otherwise) | renders `content/site.json` + the genpdf CV PDF from published `article`/`site_copy`/`cv` entities and commits both to `doumouya/doumouya-portfolio` via the GitHub Contents API → the portfolio's CI deploys |

Portfolio types (`pt_event`, `feedback`, `article`, `site_copy`, `cv`) are **registry rows**
seeded by migration — a type is a row, and the app's data model needs no engine change.

## Status

CASE 0019 shipped the seam + skeleton (`AppMount`, `crates/server`, `/about`). Ingest, insights,
publish: planned, each its own Case.
