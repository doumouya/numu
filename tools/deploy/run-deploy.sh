#!/usr/bin/env bash
# run-deploy.sh — build + deploy numu-server to Cloud Run (CASE 0026; docs/ops/DEPLOY.md).
# OPERATOR-RUN from the repo root (numu's own CI can't deploy — the WIF provider is scoped to
# the portfolio repo; recorded in DEPLOY.md). Uses `gcloud run deploy --source .` → Cloud Build
# builds the Dockerfile remotely, so no local Docker is required. Direct VPC egress reaches the
# Postgres VM's private IP with no serverless connector (and no connector fee).
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT="${PROJECT:-doumouya-portfolio}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-numu-api}"

# The console's app.js/tokens.css are LOCAL build artifacts (gitignored; re-included by
# .gcloudignore). Build them fresh so the image ships the console the operator just verified.
bash tools/web-build.sh

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 --max-instances 5 \
  --memory 512Mi --cpu 1 \
  --network default --subnet default --vpc-egress private-ranges-only \
  --set-secrets "DATABASE_URL=numu-database-url:latest,NUMU_SECRET=numu-secret:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,GITHUB_TOKEN=github-token:latest" \
  --set-env-vars "NUMU_TRUST_PROXY=1,NUMU_APP_PORTFOLIO=1,NUMU_SERVE_CONSOLE=1,NUMU_SESSION_COOKIE=__session,NUMU_CORS_ORIGINS=https://em.numu.im,NUMU_AUTH_ALLOWED_DOMAINS=numu.im,GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID},GOOGLE_REDIRECT_URI=https://em.numu.im/auth/google/callback,RUST_LOG=info\,numu_api=info"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')
echo "deployed: $URL"
echo "smoke: curl -s $URL/healthz && curl -s $URL/readyz"
echo "next: adopt tools/deploy/firebase-rewrites.json into the portfolio repo's firebase.json"
