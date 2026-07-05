# Monitoring & cost control — three layers, one substrate

> Adopted from Em's monitoring-and-cost-control plan (2026-07-05) with the deploy Case
> (CASE 0026). Target: Postgres 16 on a GCE **e2-micro** (1 GB RAM, private IP, ~30 GB disk),
> Cloud Run api (`--max-instances 5`, pool 5×5 ≤ 25 of `max_connections=50`), nightly
> `pg_dump → GCS`, us-central1 free tier. Cost-conscious by design. Companions:
> [`DEPLOY.md`](DEPLOY.md) · [`DATABASE.md`](DATABASE.md).

**Principle:** DB-internal health, host resources, and cloud/cost all funnel breaches into
numu's `audit_runs`/`audit_findings` (the substrate exists — 0001_init) so "cost regressed" and
"disk filling in 6 days" read like any other finding, in one pane. And **no Prometheus/Grafana
on a 1 GB box** — it would eat the RAM it watches. GCP's free Ops Agent + Cloud Monitoring
carry infra; numu-native collectors carry the ledger.

## Layer 1 — DB-internal health (`db-health` collector) — **follow-on Case**

The collector from [`DATABASE.md`](DATABASE.md), run ~5-minutely by a confined read-only
monitoring role. Signals: connections vs cap (warn > 35/50, page > 45), long/idle-in-transaction,
bloat + autovacuum lag (watch `entity_data` and the append-heavy `pt_event` rows), XID
wraparound headroom, `pg_stat_statements` top-by-total-time (watch the insights aggregates +
the reach CTE), telemetry growth (row count + partial-index size), cache-hit ratio/temp files,
**backup freshness** (age of the last dump — stale = page). Each run: one `audit_runs` row
(`tool='db-health'`) + a finding per breach. *(PG16: `pg_stat_bgwriter` for checkpoints;
replication views N/A single-node.)*

## Layer 2 — Host resources (GCP Ops Agent → Cloud Monitoring) — **shipped with the VM**

`tools/deploy/vm-postgres.sh` installs the **Ops Agent** (free, ~50 MB — acceptable on 1 GB).
What matters on a tiny burstable box:

- **CPU burst credits / steal** — the e2-specific trap: sustained load above baseline drains
  credits → throttling. Alert on **credit depletion**, not just utilization.
- **RAM + swap** — 1 GB is tight (shared_buffers + the nightly dump + OS). Swap-in is the first
  sign; page on low available memory.
- **Disk % + growth rate** — "full in N days" is THE alert for a fixed disk (data + WAL + dump
  staging). Also IOPS/latency (small PDs have low ceilings) and **network egress bytes** (the
  classic GCP cost surprise — layer 3).

Alert policies + a Billing budget are operator steps ([`DEPLOY.md`](DEPLOY.md) §first-boot).

## Layer 3 — Cloud platform + the real cost drivers — **tripwires**

FREE: e2-micro in-region, ≤30 GB disk, VPC-internal traffic (Cloud Run → VM), Cloud
Monitoring/Logging within limits, Cloud Run free tier (2M req/mo). PAID: internet egress, GCS
storage + egress, instance-hours beyond free tier, extra disk/VMs. Watch: egress (Cloud Run +
VM), the backup bucket size (lifecycle 30d is the cap; monitor as backstop), Cloud Run
instance-hours (min-instances stays 0), and a **Cloud Billing budget** ($5–10/mo, 50/90/100%
thresholds → Pub/Sub as the automation hook).

## Cost is a metric too — **follow-on Case**

A second collector — `resource-health` — pulls the layer-2/3 numbers (Cloud Monitoring API /
on-VM `/proc` + `gsutil du` + the billing export) into the SAME ledger: disk > 80%, RAM-avail
< 15%, egress spike vs 7-day baseline, bucket over cap, projected monthly cost > budget. Then
`run_diff` shows *"monthly-cost regressed"* next to *"replica lag regressed"* — spend gets the
same visibility as code drift. Measure, don't assert — pointed at the bill.

## Cost-control automation (what ships now)

1. **Telemetry retention prune** — nightly systemd timer on the VM deletes `pt_event` entities
   (+ their `pt_event.*` events) older than 90 days (GOVERNANCE #4; `method_policy` left DELETE
   open for exactly this). Shipped in `vm-postgres.sh`.
2. **Backup lifecycle** — the GCS rule auto-deletes dumps past 30 days. Shipped.
3. **Budget guardrail** — Billing budget → Pub/Sub → page (operator step). Escalation (capping
   `max-instances`, disabling billing) stays opt-in and documented, never automatic.
4. **Cloud Run ceiling** — `--max-instances 5` hard cap; `min-instances 0` (accept cold starts).
5. **Egress hygiene** — DB traffic stays VPC-internal (free); static assets come from
   Firebase/CDN, never Cloud Run.
6. **Disk-fill response** — runbooked, mostly-manual at this scale: prune WAL/telemetry,
   off-peak `VACUUM (FULL)`, or snapshot-and-resize ([`DEPLOY.md`](DEPLOY.md) §runbooks).

## Starter thresholds (tune after a week of baseline)

CPU credits < 20% → warn; util > 85% for 15 min → warn. RAM avail < 15% → warn, < 7% or
sustained swap-in → **page**. Disk > 75% → warn, > 88% or < 10 days-to-full → **page**.
Connections > 35/50 → warn, > 45 → **page**. `pg_dump` age > 30 h → **page**; restore drill
overdue > 30 d → warn. Cost projection > 80% of budget → warn, > 100% → **page**. `pt_event`
size doubling week-over-week → warn (prune).

## Honest scale note

At ~5k events/day and < 2 GB/yr this deployment lives inside GCP's free tier — real cost is a
few dollars/month at most, dominated by egress and GCS. These are mostly **tripwires**: catch a
telemetry flood, an egress spike, a runaway instance, or a filling disk *before* it costs
money — and the same discipline scales cleanly when the load does.
