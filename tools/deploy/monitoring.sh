#!/usr/bin/env bash
# monitoring.sh — DEPLOY.md order-of-ops step 8 (docs/ops/MONITORING.md layers 2+3).
# OPERATOR-RUN. Creates: an email notification channel, three Ops-Agent-backed alert policies
# (CPU sustained, memory, disk fill — the e2-micro's real failure modes), and the billing
# budget tripwire. Idempotent-ish: each step no-ops when a same-named resource exists.
# The budget needs the billing account id: BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX (find it with
# `gcloud billing accounts list`).
set -euo pipefail

PROJECT="${PROJECT:-doumouya-portfolio}"
EMAIL="${EMAIL:-em@numu.im}"
BUDGET_USD="${BUDGET_USD:-10}"
VM="${VM:-numu-pg18}"

say() { printf '\n── %s\n' "$*"; }

say "notification channel (email ${EMAIL})"
CHANNEL=$(gcloud beta monitoring channels list --project "$PROJECT" \
  --filter="type=\"email\" AND labels.email_address=\"${EMAIL}\"" --format='value(name)' | head -1)
if [ -z "$CHANNEL" ]; then
  CHANNEL=$(gcloud beta monitoring channels create --project "$PROJECT" \
    --display-name="numu ops (${EMAIL})" --type=email \
    --channel-labels="email_address=${EMAIL}" --format='value(name)')
fi
echo "  channel: $CHANNEL"

policy() { # $1 display name, $2 filter, $3 threshold, $4 duration
  local name="$1" filter="$2" threshold="$3" duration="$4"
  gcloud alpha monitoring policies list --project "$PROJECT" \
    --filter="display_name=\"${name}\"" --format='value(name)' | grep -q . && { echo "  exists: $name"; return; }
  cat > /tmp/numu-policy.json <<JSON
{
  "displayName": "${name}",
  "combiner": "OR",
  "conditions": [{
    "displayName": "${name}",
    "conditionThreshold": {
      "filter": "${filter}",
      "comparison": "COMPARISON_GT",
      "thresholdValue": ${threshold},
      "duration": "${duration}",
      "aggregations": [{ "alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_MEAN" }]
    }
  }],
  "notificationChannels": ["${CHANNEL}"]
}
JSON
  gcloud alpha monitoring policies create --project "$PROJECT" --policy-from-file=/tmp/numu-policy.json >/dev/null
  echo "  created: $name"
}

say "alert policies (Ops Agent metrics from ${VM})"
policy "numu-pg CPU sustained >80%" \
  "resource.type=\\\"gce_instance\\\" AND metric.type=\\\"agent.googleapis.com/cpu/utilization\\\"" \
  80 "900s"
policy "numu-pg memory >90%" \
  "resource.type=\\\"gce_instance\\\" AND metric.type=\\\"agent.googleapis.com/memory/percent_used\\\" AND metric.labels.state=\\\"used\\\"" \
  90 "600s"
policy "numu-pg disk >85%" \
  "resource.type=\\\"gce_instance\\\" AND metric.type=\\\"agent.googleapis.com/disk/percent_used\\\" AND metric.labels.state=\\\"used\\\" AND metric.labels.device=\\\"sda1\\\"" \
  85 "600s"

say "billing budget (\$${BUDGET_USD}, 50/90/100%)"
if [ -z "${BILLING_ACCOUNT:-}" ]; then
  echo "  SKIPPED — set BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX (gcloud billing accounts list) and re-run"
else
  gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
    --filter="displayName='numu-prod'" --format='value(name)' | grep -q . \
    || gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
         --display-name="numu-prod" --budget-amount="${BUDGET_USD}USD" \
         --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  echo "  budget ready (email alerts to billing admins at 50/90/100%)"
fi

echo
echo "done — MONITORING.md layer 2 (host alerts) + layer 3 (budget) armed."
