#!/usr/bin/env bash
# vm-postgres.sh — one-time Postgres substrate for numu prod (CASE 0026; docs/ops/DEPLOY.md).
# OPERATOR-RUN (needs an authed gcloud with owner-ish rights on the project). Idempotent-ish:
# every step no-ops or warns when the resource already exists.
#
# Creates: the backup bucket (+30d lifecycle), a least-privilege VM service account
# (objectCreator on that bucket ONLY), IAP-SSH + in-VPC Postgres firewall rules, and the
# e2-micro VM (NO external IP). Then bootstraps ON the VM (via IAP ssh): Postgres 16 (pgdg),
# private listen + scram auth for the subnet, the numu role/db, the GCP Ops Agent
# (docs/ops/MONITORING.md layer 2), a nightly pg_dump→GCS timer, and the telemetry
# retention-prune timer (GOVERNANCE #4).
set -euo pipefail

PROJECT="${PROJECT:-doumouya-portfolio}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-numu-pg}"
BUCKET="${BUCKET:-gs://numu-pg-backups-${PROJECT}}"
DB_NAME="${DB_NAME:-numu}"
DB_USER="${DB_USER:-numu}"
SUBNET_RANGE="${SUBNET_RANGE:-10.128.0.0/20}"   # default-VPC us-central1 subnet
RETENTION_DAYS="${RETENTION_DAYS:-90}"           # pt_event pruning window

say() { printf '\n── %s\n' "$*"; }

say "backup bucket + 30d lifecycle"
gsutil ls -b "$BUCKET" >/dev/null 2>&1 || gsutil mb -p "$PROJECT" -l "$REGION" "$BUCKET"
cat > /tmp/numu-pg-lifecycle.json <<'EOF'
{ "rule": [ { "action": {"type": "Delete"}, "condition": {"age": 30} } ] }
EOF
gsutil lifecycle set /tmp/numu-pg-lifecycle.json "$BUCKET"

say "VM service account (objectCreator on the bucket only)"
VMSA="numu-pg-vm@${PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$VMSA" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create numu-pg-vm --project "$PROJECT" --display-name "numu-pg VM (backups only)"
gsutil iam ch "serviceAccount:${VMSA}:roles/storage.objectCreator" "$BUCKET"

say "firewall: IAP ssh + in-VPC Postgres"
gcloud compute firewall-rules describe allow-iap-ssh --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create allow-iap-ssh --project "$PROJECT" \
       --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20
gcloud compute firewall-rules describe allow-vpc-postgres --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create allow-vpc-postgres --project "$PROJECT" \
       --direction=INGRESS --action=ALLOW --rules=tcp:5432 --source-ranges="$SUBNET_RANGE" \
       --target-tags=numu-pg

say "the VM (e2-micro, no external IP)"
gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute instances create "$VM" --project "$PROJECT" --zone "$ZONE" \
       --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud \
       --no-address --tags=numu-pg \
       --service-account="$VMSA" --scopes=storage-rw,logging-write,monitoring-write

DB_PASS="${DB_PASS:-$(openssl rand -hex 24)}"

say "on-VM bootstrap (via IAP)"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --command "
set -euo pipefail
if ! command -v psql >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq curl ca-certificates gnupg lsb-release
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo \"deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt \$(lsb_release -cs)-pgdg main\" | sudo tee /etc/apt/sources.list.d/pgdg.list
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-16
fi
PGCONF=/etc/postgresql/16/main
sudo sed -i \"s/^#\\?listen_addresses.*/listen_addresses = '*'/\" \$PGCONF/postgresql.conf
sudo sed -i \"s/^#\\?max_connections.*/max_connections = 50/\" \$PGCONF/postgresql.conf
grep -q '$SUBNET_RANGE' \$PGCONF/pg_hba.conf || echo 'hostssl all all $SUBNET_RANGE scram-sha-256
host    all all $SUBNET_RANGE scram-sha-256' | sudo tee -a \$PGCONF/pg_hba.conf
sudo systemctl restart postgresql
sudo -u postgres psql -tAc \"select 1 from pg_roles where rolname='$DB_USER'\" | grep -q 1 \
  || sudo -u postgres psql -c \"create role $DB_USER login password '$DB_PASS'\"
sudo -u postgres psql -tAc \"select 1 from pg_database where datname='$DB_NAME'\" | grep -q 1 \
  || sudo -u postgres createdb -O $DB_USER $DB_NAME
# Ops Agent (MONITORING.md layer 2 — CPU burst credits, RAM/swap, disk days-to-full, egress)
if ! systemctl is-active --quiet google-cloud-ops-agent 2>/dev/null; then
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  sudo bash add-google-cloud-ops-agent-repo.sh --also-install
fi
# nightly dump → GCS (backup freshness is a page-level signal)
sudo tee /etc/systemd/system/numu-pg-dump.service >/dev/null <<UNIT
[Unit]
Description=numu nightly pg_dump to GCS
[Service]
Type=oneshot
User=postgres
ExecStart=/bin/bash -c 'pg_dump -Fc $DB_NAME | gzip | gsutil cp - $BUCKET/numu-\$\$(date +%%F).dump.gz'
UNIT
sudo tee /etc/systemd/system/numu-pg-dump.timer >/dev/null <<UNIT
[Unit]
Description=nightly numu pg_dump
[Timer]
OnCalendar=*-*-* 03:15:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
# telemetry retention prune (GOVERNANCE #4 — method_policy left DELETE open for exactly this)
sudo tee /etc/systemd/system/numu-pt-prune.service >/dev/null <<UNIT
[Unit]
Description=numu telemetry retention prune (${RETENTION_DAYS}d)
[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/psql -d $DB_NAME -c \"delete from entities where type = 'pt_event' and created_at < now() - interval '$RETENTION_DAYS days'; delete from events where kind like 'pt_event.%%' and at < now() - interval '$RETENTION_DAYS days';\"
UNIT
sudo tee /etc/systemd/system/numu-pt-prune.timer >/dev/null <<UNIT
[Unit]
Description=nightly numu telemetry prune
[Timer]
OnCalendar=*-*-* 04:05:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now numu-pg-dump.timer numu-pt-prune.timer
echo VM-BOOTSTRAP-OK
"

IP=$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" \
      --format='value(networkInterfaces[0].networkIP)')
say "done. DATABASE_URL for Secret Manager (tools/deploy/secrets.sh):"
echo "  postgres://${DB_USER}:${DB_PASS}@${IP}:5432/${DB_NAME}"
echo "  (record DB_PASS somewhere safe — it is shown ONCE here)"
