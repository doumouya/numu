# Deploying numu — production runbook (Cloud Run + self-managed Postgres)

> The production posture for numu's first deployment (the portfolio backend —
> [`../apps/PORTFOLIO.md`](../apps/PORTFOLIO.md)): the **`numu-server`** container on **Cloud Run**
> behind Firebase Hosting rewrites (same-origin `/api/**`, `/auth/**`, `/console/**` on
> em.numu.im), and **Postgres 18 self-managed on a GCE VM** (private IP only, direct VPC egress,
> nightly dumps → GCS). Dev/boot basics live in [`../api/RUNNING.md`](../api/RUNNING.md); the DB
> substrate contract in [`DATABASE.md`](DATABASE.md). Skeleton landed with CASE 0020; the deploy
> kit (`tools/deploy/`) completes it in its own Case.

## The image (CASE 0020)

- `Dockerfile` (repo root): multi-stage — pinned `rust:1.96-slim-bookworm` (≥1.85: the locked deps use edition2024) builds
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
                                                    Postgres 18 ── nightly pg_dump → GCS
```

Sizing: Cloud Run `--max-instances 5` × pool 5 = ≤25 connections against the VM's
`max_connections=50`. Scale-to-zero is on; cold start ≈ sub-second (migrate no-ops under the
advisory lock).

## The deploy kit (CASE 0026 — `tools/deploy/`)

| script | does |
|---|---|
| `vm-postgres.sh` | backup bucket (+30d lifecycle) · least-privilege VM SA (objectCreator on that bucket only) · IAP-SSH + in-VPC pg firewall · **egress for the no-external-IP VM**: Private Google Access on the subnet (free — GCS backups + Ops Agent) + Cloud NAT `numu-nat` (~$1/mo — apt/pgdg and lifelong security updates; a `--no-address` VM otherwise has ZERO outbound) · the e2-micro (no external IP) · ON-VM: Postgres ${PG_MAJOR:-18} (pgdg, `listen '*'`, scram for the subnet, `max_connections=50`), the **Ops Agent** ([`MONITORING.md`](MONITORING.md) layer 2), the nightly `pg_dump→GCS` timer, the 90-day telemetry-prune timer. Prints the `DATABASE_URL` once. |
| `secrets.sh` | Secret Manager: `numu-database-url` · `numu-secret` · `google-client-secret` · `github-token` (values prompted, never in history; re-run = rotate) + accessor grants for the Cloud Run runtime SA. |
| `run-deploy.sh` | `gcloud run deploy --source .` (Cloud Build builds the Dockerfile — no local Docker), direct VPC egress (`private-ranges-only`, no connector fee), min 0 / max 5, the full env matrix above. Needs `GOOGLE_CLIENT_ID` exported. |
| `firebase-rewrites.json` | the `/api` + `/auth` + `/console` run-rewrites the PORTFOLIO repo adopts before its SPA catch-all. |
| `monitoring.sh` | step 8 as a script: email notification channel · three Ops-Agent alert policies (CPU sustained >80%/15m, memory >90%, disk >85%) · the Billing budget (`BILLING_ACCOUNT=… BUDGET_USD=10`) — [`MONITORING.md`](MONITORING.md) layers 2+3. |

## Order of operations (first deploy, WITH Em)

1. **Google OAuth client** (GCP console → Credentials): type Web, audience **Internal**
   (numu.im Workspace — consent-level lock), redirect
   `https://em.numu.im/auth/google/callback`. Note client id + secret.
2. **GitHub PAT**: fine-grained, `doumouya/doumouya-portfolio` only, contents:read/write.
3. `bash tools/deploy/vm-postgres.sh` → record the printed `DATABASE_URL`.
4. `bash tools/deploy/secrets.sh` (paste the four values).
5. `GOOGLE_CLIENT_ID=… bash tools/deploy/run-deploy.sh` → smoke `curl $URL/readyz` (a 200 proves
   secrets + the VPC path to the VM; `/healthz` on the bare `run.app` domain hits a GFE quirk —
   Google's own 404 page — so `/readyz` is the canonical smoke). If anonymous calls get a GFE
   403, the org's Domain Restricted Sharing stripped the `allUsers` invoker binding — see the
   project-scoped override in [`GCP-SETUP.md`](GCP-SETUP.md) §1 (found live on first deploy).
6. Portfolio repo: adopt `firebase-rewrites.json` into `firebase.json` → deploy → smoke
   `curl -i https://em.numu.im/api/healthz` (a Cloud Run answer, not index.html).
7. **First boot**: Em opens `https://em.numu.im/console/` → Google login (Internal client +
   `NUMU_AUTH_ALLOWED_DOMAINS=numu.im` both gate it) → `POST /auth/claim-admin` (one atomic
   claim; a second → 409).
8. **Monitoring**: `BILLING_ACCOUNT=… bash tools/deploy/monitoring.sh` — the email channel,
   the three host alert policies, and the Billing budget in one pass
   ([`MONITORING.md`](MONITORING.md) layers 2+3; dump-freshness alerting stays a follow-on with
   the db-health collector).
9. Author content in the console (`article` · `site_copy` · `cv` rows) →
   `POST /api/apps/portfolio/publish` → watch the portfolio CI deploy the commit (~60–90s).

## Rollback · restore · drills

- **Rollback**: `gcloud run services update-traffic numu-api --region us-central1
  --to-revisions <prev>=100` — migrations are additive; an old revision runs on a newer schema.
- **Restore drill** (run ONCE after first deploy, then quarterly — an unverified backup is a
  hypothesis). The first drill doubled as the **pg 16 → 18 move** (CAS_612250dc): restore the
  nightly dump into a fresh next-major VM, repoint, retire the old VM. The recipe:

  ```sh
  # 1. fresh VM on the target major (vm-postgres.sh defaults to PG_MAJOR=18, VM=numu-pg18)
  bash tools/deploy/vm-postgres.sh                       # record the printed DATABASE_URL
  # 2. newest dump → restore ON the VM (it has no external IP; gsutil rides the VM SA + PGA)
  DUMP=$(gsutil ls gs://numu-pg-backups-doumouya-portfolio | tail -1)
  gcloud compute ssh numu-pg18 --zone us-central1-a --tunnel-through-iap --command \
    "gsutil cp $DUMP /tmp/numu.dump.gz && gunzip -f /tmp/numu.dump.gz && \
     sudo -u postgres pg_restore --clean --if-exists --no-owner --role=numu -d numu /tmp/numu.dump && \
     sudo -u postgres psql -d numu -tAc 'select count(*) from entities'"
  # 3. repoint + redeploy + verify
  bash tools/deploy/secrets.sh        # paste the NEW DATABASE_URL (new version = rotation)
  GOOGLE_CLIENT_ID=… bash tools/deploy/run-deploy.sh
  curl -s https://em.numu.im/api/../readyz               # and: console login + insights shows
                                                          # PRE-drill telemetry (restore proof)
  # 4. after a 24h soak: gcloud compute instances delete numu-pg --zone us-central1-a
  ```
- **Disk-fill runbook**: prune WAL + telemetry (`numu-pt-prune.service` manually), off-peak
  `VACUUM (FULL)` on the big relations, or snapshot-and-resize the PD (resize is online:
  `gcloud compute disks resize` + `resize2fs`).

> **CI note:** numu's repo cannot deploy through the existing WIF provider (its attribute
> condition admits only `doumouya/doumouya-portfolio`). Deploys are operator-run `gcloud` for
> now; widening WIF is a portfolio-project decision, recorded here.
