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

> **Audit coverage (CAS_57309651).** The UNIVERSAL P-DEBUG rules now scan the app tier too:
> `debuggability-audit` (no bare panic on a request path, no secret in a log) and `stale-staging-audit`
> both include `crates/apps/*/src`, and `outbound-audit` gates every outbound HTTP client (this app's
> GitHub publish client stays host-pinned + hardened, or CI fails). The api-SPECIFIC wiring gates
> (`rbac-audit`'s objects/members handler shape, the one-responder/request-id/mutation-event checks)
> remain scoped to `crates/api/src` by design — the app tier reaches data ONLY through the core's gated
> seams (`create_object`/`list_core`), never a raw mutation, so those invariants are inherited, not
> re-checked. A pen-test hand-audit (2026-07) confirmed the ingest/insights/publish routes reproduce
> every discipline (leak-free 404, airlocked 5xx, Plane-C confinement, no secret logging).

## The app's surfaces (each lands as its own Case)

| Route (under `/api/apps/portfolio`) | Auth | What |
|---|---|---|
| `GET /about` | none | mount-seam liveness stub (CASE 0019) |
| `POST /ingest` | none (public) | **live (CASE 0022)** — telemetry batches + feedback from anonymous visitors; written AS the Plane-C-confined `SVC_collector` (create-only on `pt_event`/`feedback` — migration 0020) |
| `GET /insights` | platform admin (404 otherwise) | **live (CASE 0023)** — aggregates: visits/page (7d/30d), referrer origins, CV downloads, link clicks by target, settings distribution, viewport bands, dwell buckets, install funnel, writing filters, feedback list + average stars |
| `POST /publish` | platform admin (404 otherwise) | **live (CASE 0024)** — renders `content/site.json` + the genpdf CV PDF from published `article`/`site_copy`/`cv` entities (migration 0021) and commits both to the portfolio repo via the GitHub Contents API → the portfolio's CI deploys |

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

## The insights response (CASE 0023)

`GET /api/apps/portfolio/insights` (admin) returns one JSON object — every aggregate keyed on
the SERVER-side insert time, never the client `ts`:

```json
{ "visits": { "last_7d": [ {"key": "<page>", "count": n} ], "last_30d": [...] },
  "referrers": [...], "cv_downloads": n, "link_clicks": [...], "settings": [...],
  "viewport_bands": [...], "dwell_buckets": [...], "installs": [...],
  "writing_filters": [...],
  "feedback": { "average_stars": x, "latest": [ {"stars", "text", "page", "at"} ] } }
```

Lists are `{key, count}` pairs, count-descending, capped at 25; feedback latest is capped at 50.
A console Insights PANEL over this endpoint is a recorded follow-on; v1 reads it raw (or via
the generic console object lists for feedback).

## The publish pipeline (CASE 0024)

`POST /api/apps/portfolio/publish` (admin; leak-free 404 otherwise):

1. **Assemble** from the content entities (migration 0021 — Em edits them in the console, so
   every edit already carries numu's RBAC/audit/events): `article` rows where `published`
   (ordered by `ordinal` asc), the three `site_copy` keys (`overview.lead/.body/.muted`), and
   the newest `cv` row's `doc` (the cv-data JSON contract). Missing pieces → a loud 422 — a
   publish never ships a half-empty site.
2. **Version = content hash** (sha256 prefix of the assembled content). If the repo's
   `site.json` already carries it, the publish is a NO-OP (`skipped`) — idempotent by
   construction.
3. **Render**: `portfolio/content/site.json` (version + generated_at stamped) and the CV PDF via
   **genpdf** (`pdf.rs`: embedded Montserrat, OFL.txt shipped; DARK/BLUE/MUTED house style; the
   mini-markdown tokenizer mirrors the web `inline()` — links render as blue labels, PDF
   annotations aren't exposed by genpdf).
4. **Commit** both via the GitHub Contents API (`github.rs`: pinned `api.github.com`,
   https-only, no redirects, 10s timeout, capped reads — the SsrfFetcher recipe; token =
   `GITHUB_TOKEN`, a fine-grained PAT with contents:rw on the ONE repo, never logged). The
   portfolio's WIF CI deploys the commit (~60–90s).

Env: `GITHUB_TOKEN` (required) · `NUMU_PUBLISH_REPO` (default `doumouya/doumouya-portfolio`) ·
`NUMU_PUBLISH_BRANCH` (default `main`).

## Status

CASE 0019 shipped the seam + skeleton (`AppMount`, `crates/server`, `/about`). CASE 0022 shipped
the public ingest (migration 0020, `SVC_collector`, the hardened route, db-tests). CASE 0023
shipped the admin insights endpoint. CASE 0024 shipped the publish pipeline (migration 0021,
genpdf CV writer, GitHub Contents client, mock-hosted db-tests). The app surface is complete;
what remains is deployment (the ops Case) and the console serving flag.

## The console surface (CAS_357473a7 — console v2)

The app's OPERATOR face lives in the console: `web/src/apps/portfolio.ts`, registered in the
Apps Rail when the boot probe admits (`GET /about` 200 = mounted on this node, `GET /insights`
≠ 404 = the caller is platform admin — everyone else never sees the app). Four tabs over the
GENERIC object surface (the apps-tier doctrine holds: no portfolio route was added for the UI):
**Articles** (ordinal-sorted list → markdown editor; `slug` is create-only — the registry's
`editable:false` is the public identity contract; saves are `PATCH` + `If-Match`, a 412 tells
the operator to reopen), **Overview** (the three `site_copy` keys), **CV** (a STRUCTURED editor
over the genpdf contract — header · links · sections · entries · bullets, each add/remove; the
mini-md fields carry a **Bold/Italic/Link toolbar** (select-and-click, no markers typed) and a
**live preview in the Context panel** rendered by the SAME inline tokenizer as `pdf.rs` — what
you see is what Publish renders; an "Import live CV" button pulls the published `content/site.json`
so nothing is retyped; a Raw JSON escape hatch remains; `pdf.rs` carries a test that renders the
real CV verbatim), **Insights** (the
`/insights` aggregates + the feedback list). The header **Publish** button drives
`POST /publish` and shows `{version, committed, skipped}` with a link to the live site; a 422
(missing keys / no published articles) is surfaced verbatim.
