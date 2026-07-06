# 0005 — first prod deploy: seven walls, one night

numu's first production deploy (the portfolio backend, [`../ops/DEPLOY.md`](../ops/DEPLOY.md))
failed seven times before going fully live — and **not one failure was a misconfiguration**.
Five walls were least-privilege defaults doing their jobs until the intended door was cut; the
sixth was an ignore-file inheriting where it shouldn't; the seventh was an escaping chain
quietly eating the backup job. This records the operator-side sequence so the next deploy (or
project) walks through in minutes.

Origin: CASE 0026 live ops session, 2026-07-05/06, project `doumouya-portfolio`
(org `443445851692`, numu.im). Operator commands ran as `em@numu.im`.

## The seven walls (symptom → root cause → fix)

| # | symptom | root cause | fix |
|---|---|---|---|
| 1 | Cloud Build `403 storage.objects.get` on source upload | fresh projects don't grant the default compute SA (which Cloud Build runs as) its working set | grant `${PROJECT_NUMBER}-compute@developer.gserviceaccount.com` → `roles/storage.objectViewer` + `roles/logging.logWriter` + `roles/artifactregistry.writer` |
| 2 | on-VM bootstrap hung: apt mirrors + pgdg unreachable | a `--no-address` VM has ZERO outbound egress | PGA + Cloud NAT, now created by `vm-postgres.sh` itself (fix `5881bfc`) |
| 3 | Cloud Build: ``feature `edition2024` is required`` | builder pinned `rust:1.83` < the lockfile's Cargo ≥1.85 floor (`time v0.3.51`); local nightly masked it | pin `rust:1.96-slim-bookworm` (fix `450761f`; symptom string comment lives in the Dockerfile) |
| 4 | `--allow-unauthenticated` silently no-ops; anonymous calls → GFE 403; deploy step printed `FAILED_PRECONDITION: One or more users named in the policy do not belong to a permitted customer` | org-wide **Domain Restricted Sharing** rejects `allUsers` | self-grant `roles/orgpolicy.policyAdmin` at org level (needs Organization Admin), project-scoped `allowAll: true` override on `iam.allowedPolicyMemberDomains`, then bind `allUsers` → `roles/run.invoker`; **allow 2–3 min propagation** between override and binding |
| 5 | hosting CI deploy: `403 Permission 'run.services.get' denied` at version-finalize | run-rewrites in `firebase.json` make the deploy VALIDATE the target service; the WIF deployer SA was minted with hosting-only roles | grant `github-deployer@…` → `roles/run.viewer` (read-only) |
| 6 | `/console/` blank white; browser: `Uncaught SyntaxError: Unexpected token '<' (at app.js?v=…)` — app.js and tokens.css served as `text/html` | with no `.gcloudignore`, `gcloud --source` GENERATES one from `.gitignore`, which excludes the console's two local build artifacts (`web/app.js`, `web/tokens.css`) that the committed `web/index.html` references — ServeDir's SPA fallback answered HTML for them | committed `.gcloudignore` (`#!include:.gitignore` + `!web/app.js` `!web/tokens.css`), and `run-deploy.sh` now runs `tools/web-build.sh` first so the image ships the console the operator just verified |
| 7 | **THE BACKUP THAT NEVER WAS** — `numu-pg-dump.service` failed on every run; the bucket was EMPTY when the pg18 restore drill needed it (the "restore" silently restored nothing: a fresh DB, a re-minted member actor, missing articles) | the dump command was an inline `ExecStart=/bin/bash -c '… \$\$(date +%%F) …'` written through FOUR escaping layers (local double-quotes → remote unquoted heredoc → systemd → bash); the remote heredoc expanded `$$` to its own PID, baking a bash syntax error into the unit | the command lives in a WRAPPER SCRIPT (`/usr/local/bin/numu-pg-dump.sh`) with a plain `ExecStart`; `vm-postgres.sh` now also RUNS the dump once at provision time and fails loud — a backup job that has never succeeded is not a backup job |

Exact commands for walls 1/4/5: [`../ops/GCP-SETUP.md`](../ops/GCP-SETUP.md) (the prep
checklist absorbed them); wall 2 is self-healing in the script; wall 3 is a pinned image;
wall 7 is why dump-freshness alerting ([`../ops/MONITORING.md`](../ops/MONITORING.md)) is a
page-level signal, not a nice-to-have.

## Verify

- `curl -s https://<run-url>/readyz` → `200 {"status":"ready"}` **anonymously** — one response
  proving container boot, the `DATABASE_URL` secret, the VPC-egress path to the VM's private
  IP, and embedded migrations. (`/healthz` on the bare `run.app` domain hits a GFE quirk —
  Google's own 404 page — `/readyz` is the canonical smoke.)
- `curl -si https://em.numu.im/api/objects/case | head -3` → a numu `problem+json`, **not**
  `text/html` index.html — proves the hosting rewrite reached Cloud Run.

## Related

- [`../ops/DEPLOY.md`](../ops/DEPLOY.md) — the runbook these walls interrupted (order-of-ops).
- [`../ops/GCP-SETUP.md`](../ops/GCP-SETUP.md) — prep checklist; walls 1/4/5 as checkboxes.
- [`../ops/MONITORING.md`](../ops/MONITORING.md) — the cost tripwires around the new NAT (~$1/mo).
- The meta-lesson: when a GCP deploy fails inside an org, ask *which two least-privilege
  systems just met for the first time* before assuming a bug.
