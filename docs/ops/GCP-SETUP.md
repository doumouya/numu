# GCP setup — what Em prepares before the first deploy

> The operator-prep companion to [`DEPLOY.md`](DEPLOY.md) (which owns the order of operations,
> env matrix, and drills — this file never duplicates them). Everything here is **console
> clicking and value gathering** you can do ahead of the deploy session; the `tools/deploy/`
> scripts then consume what you prepared. Scripts default to `PROJECT=doumouya-portfolio`,
> `REGION=us-central1` — override via env if you decide otherwise (see the region call below).

## 0 · The one hard constraint first

**The Cloud Run service MUST live in the same GCP project as the Firebase Hosting site**
(`doumouya-portfolio`, the one serving em.numu.im). Firebase Hosting run-rewrites cannot cross
projects — deploying numu-api anywhere else means no same-origin `/api/**` and the whole
no-CORS design collapses. Don't create a fresh "numu" project for this; numu's first home is
the portfolio's project, recorded here on purpose.

## 1 · Project + billing (5 min)

- [ ] Confirm the project: `gcloud config set project doumouya-portfolio`
      (`gcloud projects describe doumouya-portfolio` should answer).
- [ ] Billing is linked (Console → Billing). The stack targets the always-free tier but GCE
      and Cloud Build refuse to run without a billing account attached.
- [ ] Your `gcloud` is current + authed: `gcloud auth login` · `gcloud auth list`.
- [ ] Region decision — **us-central1** (default): the e2-micro + 30 GB standard PD ride the
      always-free tier, ~110 ms console latency from EU. **europe-west1**: snappier console
      editing, ~€7/mo for the VM. Scripts take `REGION=`/`ZONE=` overrides; pick once, the
      Postgres VM does not move cheaply afterwards.

## 2 · Enable the APIs (2 min, one command)

```sh
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  compute.googleapis.com secretmanager.googleapis.com iap.googleapis.com \
  storage.googleapis.com monitoring.googleapis.com logging.googleapis.com \
  billingbudgets.googleapis.com pubsub.googleapis.com
```

| API | consumed by |
|---|---|
| `run` · `cloudbuild` · `artifactregistry` | `run-deploy.sh` (`--source` deploys build remotely — no local Docker) |
| `compute` | the Postgres VM, firewalls, direct VPC egress (`vm-postgres.sh`) |
| `secretmanager` | `secrets.sh` (the four runtime secrets) |
| `iap` | tunnel-through-IAP SSH to the no-external-IP VM |
| `storage` | the nightly `pg_dump` backup bucket |
| `monitoring` · `logging` | Ops Agent metrics/logs ([`MONITORING.md`](MONITORING.md) layer 2) |
| `billingbudgets` · `pubsub` | the cost tripwire (budget → Pub/Sub, layer 3) |

## 3 · OAuth consent + client (10 min — the one part only you can do)

Console → **APIs & Services → OAuth consent screen**:

- [ ] User type **Internal** — this is the consent-level lock to the numu.im Workspace.
      **Gotcha to check first**: *Internal* is only offered when the project belongs to the
      numu.im Google Workspace **organization**. If `doumouya-portfolio` is an org-less
      personal project, Internal is greyed out → either migrate the project into the org
      (Console → IAM → Settings → Migrate) or fall back to **External** + test users; the
      server-side `NUMU_AUTH_ALLOWED_DOMAINS=numu.im` allowlist (already wired in
      `run-deploy.sh`) enforces the same boundary either way — defense stays in depth.
- [ ] App name `numu`, support email `em@numu.im`. Scopes: none beyond the defaults —
      the server requests only `openid email profile` (non-sensitive, no verification queue).

Then **Credentials → Create credentials → OAuth client ID**:

- [ ] Type **Web application**, name `numu-api`.
- [ ] Authorized redirect URI — exactly one: `https://em.numu.im/auth/google/callback`.
      No JavaScript origins (the flow is fully server-side).
- [ ] Record the **client ID** (exported as `GOOGLE_CLIENT_ID` for `run-deploy.sh`) and the
      **client secret** (pasted into `secrets.sh` — never into a file or shell history).

## 4 · GitHub PAT for the publish route (5 min)

github.com → Settings → Developer settings → **Fine-grained tokens**:

- [ ] Resource owner `doumouya`, repository access: **only** `doumouya/doumouya-portfolio`.
- [ ] Permissions: **Contents: Read and write** (Metadata: read comes attached). Nothing else.
- [ ] Expiry 90 days — rotation is just re-running `secrets.sh` (each run adds a new version).

## 5 · What the scripts will create (so nothing surprises you)

Nothing below is prepared by hand — this is the inventory `tools/deploy/` produces, for
reviewing the project afterwards:

| resource | created by | notes |
|---|---|---|
| `gs://numu-pg-backups-doumouya-portfolio` (+30d lifecycle) | `vm-postgres.sh` | dump target |
| SA `numu-pg-vm@…` | `vm-postgres.sh` | objectCreator on that bucket ONLY |
| firewalls `allow-iap-ssh` (35.235.240.0/20 → :22) · `allow-vpc-postgres` (10.128.0.0/20 → :5432, tag `numu-pg`) | `vm-postgres.sh` | the VM has no external IP at all |
| Private Google Access on the default subnet + Cloud Router `numu-nat-router` + NAT `numu-nat` | `vm-postgres.sh` | the no-external-IP VM's ONLY egress: PGA (free) for GCS backups + Ops Agent, NAT (~$1/mo + $0.045/GB) for apt/pgdg + security updates |
| VM `numu-pg` (e2-micro, debian-12) + Postgres 16 + Ops Agent + dump/prune timers | `vm-postgres.sh` | prints the `DATABASE_URL` **once** |
| secrets `numu-database-url` · `numu-secret` · `google-client-secret` · `github-token` | `secrets.sh` | run-SA gets accessor per-secret |
| Cloud Run service `numu-api` (min 0 / max 5, direct VPC egress) | `run-deploy.sh` | Cloud Build builds the Dockerfile remotely |

## 6 · Values to bring to the deploy session

| value | where it comes from |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | §3 |
| GitHub PAT | §4 |
| `NUMU_SECRET` | generate now: `openssl rand -hex 32` (keep it out of history) |
| `DATABASE_URL` | printed by `vm-postgres.sh` during the session — nothing to prepare |
| region decision | §1 |

Then the session itself is [`DEPLOY.md`](DEPLOY.md) **Order of operations** steps 3–9
(VM → secrets → deploy → rewrites → claim-admin → monitoring/budget → author + publish),
followed once by the restore drill.
