# numu — the database substrate (Postgres HA, backups, DB-level observability)

> **Current prod posture (CASE 0026):** a single-node Postgres 16 on a private GCE
> e2-micro with nightly `pg_dump → GCS` + the Ops Agent ([`DEPLOY.md`](DEPLOY.md) ·
> [`MONITORING.md`](MONITORING.md)). The HA topology below (1+2, Patroni, pgBackRest/PITR)
> remains the designed forward posture — not yet deployed.

> **Status: design contract (forward-looking) · current: single-node Postgres on `localhost` (dev).**
> Layer: **OPS** — the substrate the [`api/`](../api/HTTP.md) layer runs on. Pairs with
> [`OBSERVABILITY.md`](../api/OBSERVABILITY.md) (application-level P-DEBUG), [`OBJECTS.md`](../api/OBJECTS.md)
> (the schema this substrate stores), and [`RUNNING.md`](../api/RUNNING.md) (booting the binary).
> Changing the HA/RPO/RTO targets is an Em-level decision.

## Why this doc exists

numu is "database-as-a-framework": the registry spine, the RBAC edge, the `events` audit spine, and
**every registered type** live in **one Postgres**. That database is the substrate everything else
assumes. This is its production contract — how it survives failure, how it is recovered, and how its
health is watched. It is the **database-level counterpart** to `OBSERVABILITY.md`, which covers only the
application layer.

## Purpose (what "good" means)

- Survive the loss of any single node with **automatic failover** — no manual step to keep writes flowing.
- Scale reads off the primary **without touching numu's single write path** (the generic object handlers
  today; the CSV-ingest `pipeline::upload_csv` when that slice lands — not yet in `crates/`).
- Recover to **any point in time** (a bad migration, a dropped table) via PITR.
- Surface DB health into numu's **own `audit_runs` / `audit_findings` substrate** — not a separate silo.

## Current state vs. target

| | Current (design phase) | Target (self-host, ~months out) |
|---|---|---|
| Topology | one Postgres (`numu_dev`) on `localhost` | 1 primary + 2 read replicas |
| Failover | none | automatic (Patroni + etcd + HAProxy) |
| Backups | none | pgBackRest → GCS, continuous WAL, PITR |
| Host | dev box | GCP Compute Engine, 3 zones |
| RPO / RTO | n/a | ≈0 (quorum sync) / <60s |

The jump is **rehearsable locally today** (see *How to test* below), so self-hosting is a drill, not a
first attempt.

## Implementation (the target topology)

- **Writes → HAProxy `:5000`** (always the current leader); **reads → `:5001`** (replicas, round-robin).
  Patroni promotes the least-lagged replica on primary loss; HAProxy follows via the `/primary` and
  `/replica` REST health checks. **Three** data nodes so a failover still leaves primary + one replica
  while a replacement spins up.
- **etcd quorum (3 nodes)** is the split-brain guard: if etcd loses quorum, Postgres goes **read-only**
  (safe) rather than risk two primaries. Never force-promote while etcd is unhealthy.
- **Replication:** quorum synchronous — `synchronous_standby_names = 'ANY 1 (r2, r3)'` — gives **RPO ≈ 0**
  while tolerating one replica down. **Patroni owns** `synchronous_standby_names`; never hand-edit it.
- **Connections:** PgBouncer (transaction mode) in front; numu keeps **two `sqlx` pools** — writes → `:5000`,
  reads → `:5001` — with retry/backoff on failover. numu's `version` / `If-Match` optimistic concurrency
  makes write retries lost-update-safe.
- **Backups:** pgBackRest → a GCS bucket (object versioning + soft delete), authenticated by the VM's
  **IAM service account** (no static key). `archive_command` ships each WAL segment; weekly full + daily
  differential + continuous WAL → a ~14-day PITR window.

## DB-level observability (the tie to OBSERVABILITY.md)

`OBSERVABILITY.md` makes the *application* debuggable (request-id → `events` → problem+json). This is its
**database-level counterpart, on the same substrate**:

- A **`monitoring` schema** of least-privilege views (read via the built-in **`pg_monitor`** role — no
  superuser): replication lag, replication-slot WAL retention, connection saturation, **xid-wraparound
  headroom**, long / idle-in-transaction sessions, blocking chains, cache-hit ratio, table bloat,
  checkpoint pressure, top queries — **plus numu-specific** signals: reach-resolver CTE timing (the RBAC
  hot path), write-path lock waits (the generic object-handler txn today; the CSV-ingest path when it
  lands), `events` ingestion growth, and per-`type_id` counts.
- A **`db-health` collector** (a Postgres function today; a Rust collector when the slice lands) reads
  those views and writes **one `audit_runs` row** (`tool='db-health'`, `stats` = JSON of the key signals)
  plus **`audit_findings`** rows (`severity ∈ info|warn|error`, per `migrations/0001_init.sql`) per breach, with a `run_diff`
  (new | fixed | unchanged). DB health thus becomes a **6th signal on the exact `audit_runs`/`audit_findings`
  ratchet** the five gates already use (`OBSERVABILITY.md` §6) — rendered in the same Monitoring surface as
  the code audits, and request-id-correlated via an `events` row.
- **Logging obeys the same never-log-secrets rule** (`OBSERVABILITY.md` §6 rule 6): `jsonlog` + a rich
  `log_line_prefix` + the high-signal switches, but **`log_statement = 'ddl'` only** — never `all`/`mod` —
  because `entity_data` holds sensitive field values.

## Maintenance

- **Backups:** `pgbackrest check` daily (alert on non-zero exit); a **monthly PITR restore drill** into a
  scratch node — a backup you haven't restored is only a hypothesis.
- **Failover:** a **quarterly** planned switchover + a kill-the-primary drill; measure the real RTO
  (target < 60s) and confirm the app's `sqlx` pools reconnect.
- **Watch-list** (catches most incidents): replica lag, connection saturation, idle-in-transaction,
  wraparound headroom, slot retained-WAL, disk/WAL growth, backup age.
- **Never** start a demoted ex-primary as a second primary — let Patroni `pg_rewind` it back as a replica.

## How to extend

- **Add a monitoring signal** → add a `monitoring.*` view + a threshold branch in the `db-health`
  collector (+ optional alert); it flows into `audit_findings` automatically.
- **Add a replica** → Patroni clones it from a backup/stream; adjust `synchronous_standby_names` **via
  Patroni**, not by hand.
- **Move to a managed database later** → the `monitoring` views and the collector are portable; only the
  HA/backup layer changes.
- **Bound long reads** → the connector's discipline (`statement_timeout`, row caps) applies to numu's own
  analytical reads too; set `statement_timeout` per role/pool so a runaway query can't pin a connection.

## How to test locally (rehearse before self-hosting)

A Docker Compose harness mirrors the topology on one machine — 3 Patroni / PG 18 nodes + etcd + HAProxy —
seeds a numu-like schema (`entities`/`entity_data`/`events`/`memberships` + the audit tables), and drives
failover and the `db-health` collector. Kill the leader and watch a replica get promoted; generate write
load and watch lag; run the collector and see `audit_runs` + `run_diff` populate. Fold this in as
`ops/local-test/` when the ops slice lands (see the handoff note in `~/.claude/plans/`).

## Cross-references

- Application-level debuggability → [`OBSERVABILITY.md`](../api/OBSERVABILITY.md).
- The schema this substrate stores → [`OBJECTS.md`](../api/OBJECTS.md).
- Boot the binary + connect a frontend → [`RUNNING.md`](../api/RUNNING.md).
- The data plane (GlueSQL in the browser vs. Postgres for the registry) →
  [`numu-gluesql-postgres.md`](../foundation/numu-gluesql-postgres.md).
