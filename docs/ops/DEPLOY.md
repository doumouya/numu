# Deploying numu — production runbook (Cloud Run + self-managed Postgres)

> The production posture for numu's first deployment (the portfolio backend —
> [`../apps/PORTFOLIO.md`](../apps/PORTFOLIO.md)): the **`numu-server`** container on **Cloud Run**
> behind Firebase Hosting rewrites (same-origin `/api/**`, `/auth/**`, `/console/**` on
> em.numu.im), and **Postgres 16 self-managed on a GCE VM** (private IP only, direct VPC egress,
> nightly dumps → GCS). Dev/boot basics live in [`../api/RUNNING.md`](../api/RUNNING.md); the DB
> substrate contract in [`DATABASE.md`](DATABASE.md). Skeleton landed with CASE 0020; the deploy
> kit (`tools/deploy/`) completes it in its own Case.

## The image (CASE 0020)

- `Dockerfile` (repo root): multi-stage — pinned `rust:1.83-slim-bookworm` builds
  `numu-server --release --locked`; runtime `debian:bookworm-slim`, non-root user, plus the
  committed `web/` console for the flag-gated `/console` ServeDir (its own Case).
- Migrations are **embedded at compile time** (`sqlx::migrate!`) and applied on every boot under
  sqlx's advisory lock — idempotent; concurrent cold starts are safe; the image ships no `.sql`.
- **Bind contract**: Cloud Run injects `PORT` → numu binds `0.0.0.0:$PORT` when `NUMU_BIND` is
  unset (`config::resolve_bind`). `NUMU_BIND` remains the explicit override.
- No local Docker required: `gcloud run deploy --source .` builds via Cloud Build, or the deploy
  kit pushes to Artifact Registry.

## Production environment matrix

| var | prod value | why |
|---|---|---|
| `DATABASE_URL` | secret (Secret Manager) | the VM's private IP DSN |
| `PORT` | injected by Cloud Run | bind contract above |
| `NUMU_SECRET` | secret — strong random | release build refuses to boot without it |
| `NUMU_TRUST_PROXY` | `1` | rate-limit keys come from `X-Forwarded-For` behind the Cloud Run LB |
| `NUMU_CORS_ORIGINS` | `https://em.numu.im` | the only browsing origin (rewrites make API calls same-origin, so CORS is belt-and-braces) |
| `NUMU_APP_PORTFOLIO` | `1` | mounts the portfolio app |
| `NUMU_SESSION_COOKIE` | `__session` | Firebase Hosting forwards ONLY a cookie named `__session` to Cloud Run — any other cookie name silently breaks auth through the rewrite (its own Case) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | id + secret (Secret Manager) · `https://em.numu.im/auth/google/callback` | Google login; the OAuth client is **Internal** to the numu.im Workspace |
| `GITHUB_TOKEN` | secret | the publish route's fine-grained PAT (contents:rw on doumouya-portfolio only) |
| `RUST_LOG` | `info,numu_api=info` | calmer prod logs; hot-swappable via the debug surface |

## Topology

```
visitor ── em.numu.im (Firebase Hosting/CDN)
              ├── static site (portfolio/dist)
              └── rewrites /api/** /auth/** /console/** ──► Cloud Run: numu-server
                                                               │ direct VPC egress (private ranges)
                                                               ▼
                                                    GCE VM (no external IP, IAP SSH)
                                                    Postgres 16 ── nightly pg_dump → GCS
```

Sizing: Cloud Run `--max-instances 5` × pool 5 = ≤25 connections against the VM's
`max_connections=50`. Scale-to-zero is on; cold start ≈ sub-second (migrate no-ops under the
advisory lock).

## To be completed by the deploy-kit Case

- `tools/deploy/vm-postgres.sh` — VM + Postgres bootstrap + backup timer.
- `tools/deploy/secrets.sh` — Secret Manager entries + accessor grants.
- `tools/deploy/run-deploy.sh` — build/push/deploy with the full env.
- `tools/deploy/firebase-rewrites.json` — the snippet the portfolio repo adopts.
- First-boot checklist (Google login → `POST /auth/claim-admin`), rollback
  (`gcloud run services update-traffic`), and the restore drill (pg_restore from a GCS dump —
  a backup unverified is a hypothesis).

> **CI note:** numu's repo cannot deploy through the existing WIF provider (its attribute
> condition admits only `doumouya/doumouya-portfolio`). Deploys are operator-run `gcloud` for
> now; widening WIF is a portfolio-project decision, recorded here.
