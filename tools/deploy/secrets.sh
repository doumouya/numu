#!/usr/bin/env bash
# secrets.sh — Secret Manager entries for numu prod (CASE 0026; docs/ops/DEPLOY.md).
# OPERATOR-RUN. Prompts for each value on stdin (never echoes, never lands in shell history);
# re-running adds a NEW VERSION (rotation = re-run). Grants the Cloud Run runtime SA accessor.
set -euo pipefail

PROJECT="${PROJECT:-doumouya-portfolio}"
RUN_SA="${RUN_SA:-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com}"

put_secret() {
  local name="$1" prompt="$2"
  gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1 \
    || gcloud secrets create "$name" --project "$PROJECT" --replication-policy=automatic
  printf '%s: ' "$prompt" >&2
  local value
  IFS= read -rs value
  echo >&2
  printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT" --data-file=-
  gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" \
    --member="serviceAccount:${RUN_SA}" --role="roles/secretmanager.secretAccessor" >/dev/null
}

put_secret numu-database-url   "DATABASE_URL (postgres://user:pass@VM_PRIVATE_IP:5432/numu)"
put_secret numu-secret         "NUMU_SECRET (strong random, e.g. openssl rand -hex 32)"
put_secret google-client-secret "GOOGLE_CLIENT_SECRET (the Internal OAuth client)"
put_secret github-token        "GITHUB_TOKEN (fine-grained PAT, contents:rw on doumouya-portfolio)"

echo "secrets ready; runtime SA ${RUN_SA} can access them (tools/deploy/run-deploy.sh wires them)"
