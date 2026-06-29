# numu — PostgreSQL 18 High-Availability & Monitoring Architecture

> **Landed into numu 2026-06-29** from a review-approved design session (verbatim). This is the **design
> doc**; the configs/monitoring/scripts (→ `ops/postgres/`) and the `postgres-ha` skill (→
> `.claude/skills/postgres-ha/`) are the **follow-on phase**. The operational runbook is
> [`postgres-ha-runbook.md`](postgres-ha-runbook.md). Six review **open-items** (proxy-tier SPOF ·
> Patroni-REST-auth/etcd-TLS · alert↔exporter metric-name drift · static `synchronous_standby_names` ·
> read-your-writes across the pool split · `events` partitioning) are tracked in the landing Case.

**Target:** 1 writer + 2 read replicas with automatic failover, on Google Cloud Compute Engine (Linux VMs). Self-managed PostgreSQL 18, accessed by the numu Rust API via `sqlx`.
**Scope:** redundancy/failure design, backup & PITR, and a monitoring strategy (SQL/log-based core + optional Prometheus stack) for **numu's own production database** — the one storing `entities`, `entity_data`, `memberships`, `events`, and the registry. This is *not* about the Postgres *connector* feature (the conduit that pulls from external Postgres into `pipeline::upload_csv`); that is a separate concern noted in §11.
**Status:** v1 design. Values marked `<...>` must be set per environment before use.

---

## 1. Goals and non-goals

**Goals**

- Survive the loss of any single node (VM crash, zone disruption, disk failure) with automatic promotion of a replica and no manual step to keep writes flowing.
- Scale reads across replicas without touching numu's write path (`pipeline::upload_csv`, the single writer).
- Recover from data-loss events (bad migration, dropped table, corruption) to any point in time via PITR.
- See failures *before* they become outages, and feed DB health into numu's existing observability model rather than a separate silo.

**Non-goals (v1)**

- Multi-region active-active. Single primary; cross-region is a DR replica only (§7).
- Sharding / write scaling. numu has one logical write path; a single primary is sufficient. Revisit only if the primary VM saturates.

---

## 2. Target reliability (set real numbers with the team)

| Metric | Proposed target | Driven by |
|---|---|---|
| **RTO** (resume writes after primary loss) | < 60s automatic | Patroni failover + HAProxy reroute |
| **RPO** (max data loss) | 0 on planned switchover; near-0 on crash | Quorum sync replication (§4) |
| **Backup retention** | 14-day PITR window | pgBackRest on GCS |
| **Replica lag** | warn > 30s, page > 120s | monitoring (§8) |

RTO/RPO trade against write latency. The single biggest decision is **synchronous vs asynchronous replication** (§4.1).

---

## 3. Topology

```
                         +--------------------------+
        writes  -------->|  HAProxy :5000 (leader)  |
        reads   -------->|  HAProxy :5001 (replicas)|
                         +------------+-------------+
                                      | Patroni REST health checks
        +----------------+-----------+------------+----------------+
        v                v                        v                v
 +-------------+  +-------------+         +-------------+  +-------------+
 |  pg-node-1  |  |  pg-node-2  |  stream |  pg-node-3  |  | etcd quorum |
 |  PRIMARY    |  |  REPLICA    |<--------|  REPLICA    |  | 3 nodes     |
 |  Patroni    |<-|  Patroni    |         |  Patroni    |  | (DCS)       |
 +------+------+  +-------------+         +-------------+  +-------------+
        | WAL archive + base backups
        v
 +--------------------------+
 |  GCS bucket (pgBackRest) |  <-- PITR + DR source
 +--------------------------+
```

**Components & rationale**

- **PostgreSQL 18 x3** — one primary + two streaming replicas. Three data nodes (not two) so that after a failover you still have primary + one replica — never a single un-redundant node while a replacement spins up. This is exactly the "a replica takes over for writes while another spins up" model you described.
- **Patroni** — the HA controller: leader election, automatic failover, planned switchover, node rebuild/rejoin. De-facto standard for self-managed PG HA (GitLab, Zalando, et al.).
- **etcd (3-node)** — the Distributed Configuration Store. Patroni keeps cluster state and runs elections through it; it needs its own quorum (3 members survive losing 1). If etcd loses quorum, Patroni demotes PG to read-only rather than risk split-brain — correct, and why etcd reliability matters as much as PG.
- **HAProxy** — single entry point. Port `5000` -> current leader (writes); `5001` -> round-robin healthy replicas (reads). Routing decided by Patroni's REST `/primary` and `/replica` health endpoints, so a promotion is followed automatically within one health-check interval.
- **PgBouncer** (recommended) — transaction-mode pooler. A Rust app holding an `sqlx` pool *per process* x N instances can exhaust `max_connections`; PgBouncer multiplexes hundreds of client conns onto a few server conns. See §6.
- **pgBackRest -> GCS** — base backups + WAL archive for PITR and DR, off the VMs.

**GCP placement**

- Three DB VMs across **three zones** of one region (e.g. `europe-west1-b/c/d`) -> survives a single-zone disruption. etcd members also spread across zones.
- SSD persistent disks; pgBackRest (not disk snapshots) is the recovery source of truth.
- VPC firewall: only the app subnet reaches HAProxy; only cluster nodes reach 5432 / 8008 (Patroni) / 2379-2380 (etcd).

---

## 4. Replication & failover (the core decision)

### 4.1 Replication mode

- **Asynchronous (default):** lowest write latency; a primary *crash* can lose the last few unreplicated transactions -> RPO ~ seconds.
- **Synchronous quorum (recommended):** `synchronous_standby_names = 'ANY 1 (pg-node-2, pg-node-3)'` with `synchronous_commit = on`. The primary waits for *any one* replica to confirm WAL before commit -> RPO ~ 0, while tolerating the loss of one replica without stalling writes.

Let **Patroni manage** `synchronous_standby_names` so it stays correct across failovers. Set Patroni `synchronous_mode: true` and `synchronous_mode_strict: false` (strict off = if *all* sync standbys vanish, don't block writes forever). Choose strict `true` only if "stop writing" is preferable to "lose one transaction" — a business call.

> If quorum-sync write latency hurts numu UX (the `upload_csv` commit is one large txn), fall back to async + a tight lag alert and document the accepted RPO.

### 4.2 Failover sequence

1. Primary unreachable. 2. Patroni leader lock in etcd expires (TTL ~30s, tunable to ~15s). 3. Remaining agents elect the replica with the most WAL received (least data loss). 4. Winner promoted; `synchronous_standby_names` rewritten so the survivor becomes sync standby. 5. HAProxy's next health check reroutes :5000 writes; :5001 reads continue on healthy replicas. 6. You/automation provision a replacement VM; Patroni bootstraps it from pgBackRest + WAL and it rejoins -> 1+2 shape restored.

Net: writes resume on a surviving replica in well under a minute; a fresh node restores redundancy.

### 4.3 Guardrails

- **Split-brain:** prevented by Patroni + etcd quorum. Never run Patroni without a healthy DCS.
- **`maximum_lag_on_failover`** caps how far behind a candidate may be before Patroni refuses to promote (avoids promoting a badly-lagged node).
- **No cross-region auto-promote** — a DR replica is promoted manually only.

---

## 5. Failure scenarios & responses

| Failure | Detection | Automatic response | Manual follow-up |
|---|---|---|---|
| Primary VM crash | Patroni TTL expiry | Replica promoted, HAProxy reroutes | Spin up replacement |
| Replica VM crash | Patroni / lag metrics | Reads shift; sync quorum met by the other replica | Rebuild replica |
| Single zone down | health checks | Surviving-zone replica promoted | Restore capacity |
| Disk fills (WAL/data) | disk + `pg_database_size` alert | none -> **prevent** via alerts + `max_slot_wal_keep_size` | Extend disk / fix cause |
| Slot bloat (replica down too long) | slot retained-WAL metric | `max_slot_wal_keep_size` caps WAL; PG 18 can drop idle slots | Re-seed replica |
| Bad migration / dropped table | app + user reports | none | **PITR** to just before the event (§7) |
| etcd quorum loss | etcd + Patroni alerts | PG -> read-only (safe) | Restore etcd quorum |
| Corruption | checksum errors in logs | none | Restore from pgBackRest |

The two failures with **no automatic remedy** — backups/PITR and the slow-burn alerts (disk, slot bloat, lag, long transactions, wraparound, bloat) — are therefore the most important to get right (§7, §8).

---

## 6. Connection management (numu / sqlx specifics)

- Set PG `max_connections` conservatively (e.g. 200) and put **PgBouncer in `transaction` pooling** between the app and HAProxy. `sqlx` pools per process x instances can otherwise exhaust connections — an outage that *looks* like a DB failure.
- **Two app pools:** write pool -> HAProxy :5000, read pool -> :5001, kept separate so a replica blip never blocks writes. Route read-only numu queries (object GETs, the reach-resolution read path, list endpoints) to the read pool; route `upload_csv` and all mutations to the write pool.
- **Retry on failover:** short `sqlx` `acquire_timeout`, capped exponential backoff, idempotent writes where possible. Failover is fast but not instant; the app must reconnect, not crash. numu's `version`-based optimistic concurrency (`If-Match` -> `UPDATE ... WHERE version = $expected`) already makes write retries safe against lost updates.
- **Transaction-mode caveat:** PgBouncer transaction pooling disables session-level features (some `SET`, server-side prepared statements). With `sqlx`, set `statement_cache_capacity = 0` or use `PgBouncer`-compatible prepared-statement handling.

---

## 7. Backup, WAL archiving & PITR (pgBackRest -> GCS)

- **Repository:** dedicated GCS bucket with **object versioning + soft delete**, in a different failure domain than the VMs.
- **Auth:** on GCE prefer the VM's **attached service account + IAM** (`repo1-gcs-key-type=auto`) over a static JSON key — fewer secrets to leak (aligns with numu's never-log-creds / secret-handling discipline). Grant the SA `Storage Object Admin` on the bucket only.
- **WAL archiving:** `archive_mode = on`; `archive_command` hands each completed WAL segment to pgBackRest (the backbone of PITR). Patroni keeps this consistent across promotions.
- **Schedule:** weekly `full`, daily `differential`, continuous WAL. `repo1-retention-full=2` (weeks) — tune to your window.
- **Test restores:** a monthly PITR restore into a scratch VM, row-count/checksum verified. `pgbackrest check` daily via cron with alerting.
- **PITR (dropped-table style incident):** restore latest base backup, replay WAL to `--target-time`/`--target-lsn` just before the event. Procedure in `scripts/RUNBOOK.md`.
- **DR replica (optional):** a standby in a second region fed from the archive gives regional DR; promote manually only.

Config: `config/pgbackrest.conf`.

---

## 8. Monitoring strategy

Two layers. Layer 1 is the SQL/log-based core you asked for and runs with nothing but PostgreSQL + the GCP Ops Agent. Layer 2 is the stronger plan for history, trends, and paging.

### Layer 1 — SQL + log signals (always on)

- **`monitoring/00_monitoring_role.sql`** — least-privilege `numu_monitor` role granted the built-in **`pg_monitor`** role (reads all `pg_stat_*` without superuser).
- **`monitoring/10_monitoring_views.sql`** — a `monitoring` schema of views. Generic health (replication lag, long-running queries, blocked/blocking sessions, connection saturation, cache hit ratio, table/index bloat estimate, unused indexes, **xid wraparound headroom**, checkpoint pressure, **replication slot WAL retention**, temp-file usage) **plus numu-specific views** (§8.3).
- **`monitoring/20_health_checks.sql`** — copy-paste incident-response queries.
- **Logging** (`config/postgresql.conf`) tuned per the PostgreSQL error-reporting/logging docs: `jsonlog` destination (machine-parseable, ships cleanly to Cloud Logging via the Ops Agent), a rich `log_line_prefix`, and the high-signal switches — `log_min_duration_statement`, `log_checkpoints`, `log_lock_waits`, `log_temp_files`, `log_autovacuum_min_duration`, `log_connections`/`log_disconnections`, `log_replication_commands`. **Security:** keep `log_statement = 'ddl'` (not `all`) so routine DML parameters aren't written to logs — consistent with numu's never-log-secrets rule, since `entity_data` can contain sensitive field values.

### Layer 2 — Prometheus + Grafana + Alertmanager (recommended)

SQL views show *now*; they give no history, trend, or paging. Add **postgres_exporter** (CI-tested against PG 18, default :9187) scraped by Prometheus, dashboards in Grafana, paging via Alertmanager on `monitoring/40_alert_rules.yml`.

- `monitoring/30_exporter_queries.yaml` — custom exporter queries exposing the same signals (incl. numu-specific ones) as metrics.
- Run one exporter per DB node; also scrape **Patroni** `/metrics` and **etcd** so HA-layer health is visible, not just PG.
- **GCP-native alternative:** the same metrics can flow to **Cloud Monitoring** via the Ops Agent's PostgreSQL receiver if you'd rather not self-host Prometheus. Layer 1 is identical either way.

### 8.3 numu-aware monitoring (why this beats a generic setup)

Tailored to numu's schema and hot paths:

- **Reach-resolver CTE health** — the recursive RBAC CTE (`principals` + `scopes`, depth-capped 8) is on every authorized read. A view surfaces its `pg_stat_statements` line (mean/95p time, calls) so you catch it degrading as `memberships`/`entity_data` grow — before users feel it.
- **`upload_csv` write-path latency & locks** — the single write path is one large txn (blob + `entities` + `entity_data` + `project_files` + `project_steps` + owner edge). Monitor long transactions and lock waits specifically here; a stuck `upload_csv` blocks vacuum and inflates bloat.
- **`events` ingestion** — numu captures *every* mutation into `events` (audit-everything, request-correlated). Monitor its insert rate and table/index growth; it is the highest-write table and a prime partitioning candidate (partition by month on `at`).
- **`entity_data` JSONB bloat & GIN health** — the everything-as-data store. Track dead-tuple ratio and index bloat; ensure autovacuum keeps up given the mutation rate.
- **Per-type growth** — counts grouped by `type_id` give product-level visibility (which registered types dominate storage) straight from `entity_data`.

### 8.4 Feed DB health into numu's existing observability (don't build a silo)

numu already has a **render-ready observability model**: `audit_runs(tool, ran_at, git_sha, stats, payload)` + `audit_findings(run_id, tool, kind, severity, detail)` + a `run_diff` fn (new/fixed/regressed/improved/unchanged) feeding a planned Monitoring UI. Treat DB monitoring as **another audit tool**:

- A scheduled `db-health` job runs the `monitoring` views and writes a row to `audit_runs` (`tool='db-health'`, `stats`=JSON of the key signals) plus `audit_findings` for any threshold breach (e.g. `kind='replica_lag'`, `severity='warn'`). Then `run_diff` shows DB health *trending* in the same UI as the code audits — "regressed" lag, "fixed" bloat, etc.
- This also rides numu's request-id/`events` correlation: a `db-health` run can emit an `events` row, so a DB incident is queryable alongside application events by the same id.
- Prometheus/Grafana remain the real-time/paging layer; the `audit_runs` integration is the *product-visible*, historical, same-pane view. They are complementary, not redundant.

### What to watch (the short list catching most incidents)

1. **Replica lag** (bytes + seconds). 2. **Connection saturation** (`used / max_connections`). 3. **Long-running / idle-in-transaction** sessions (lock holders, vacuum blockers). 4. **Xid wraparound headroom** (silent killer). 5. **Replication slot retained WAL** (a dead replica can fill the primary's disk). 6. **Disk/WAL growth, checkpoint frequency, cache hit ratio, deadlocks, backup age**, plus the numu-specific signals in §8.3.

---

## 9. Verification & drills

- **Failover drill (quarterly):** `patronictl switchover` (planned) + kill-the-primary (unplanned). Measure real RTO; confirm HAProxy reroutes and `sqlx` reconnects.
- **Restore drill (monthly):** PITR into a scratch VM; verify counts/checksums.
- **Alert test:** trip each alert (e.g. open a long transaction) to confirm it pages.
- **Backup check:** `pgbackrest check` daily + alert on failure.

---

## 10. Rollout order

1. etcd quorum (3 nodes). 2. `pg-node-1` under Patroni (bootstraps primary) with logging + pgBackRest archiving. 3. First full backup + `pgbackrest check`. 4. Add `pg-node-2`, then `pg-node-3` (Patroni clones from backup/stream). 5. Enable quorum sync once both replicas are healthy. 6. HAProxy (+ PgBouncer) in front; switch numu's read/write pools to :5001 / :5000. 7. Deploy monitoring role, views, logging, exporter, Prometheus/Grafana, alerts, and the `db-health` -> `audit_runs` job. 8. Run failover + restore drills before declaring production-ready.

---

## 11. Note: numu's Postgres *connector* is a different surface

The pasted design covers a Postgres **connector** (a CSV-producing conduit: external source -> typed rows -> `upload_csv` -> a `file` entity). That is *consuming* an external database, and its reliability concerns are different from this document's (SSRF/host gate, statement timeouts, streaming vs buffering, secret resolution). This HA/monitoring design is about numu's **own** backing store. Two overlaps worth carrying across:

- **Statement timeout / row cap discipline** (the connector's P3/improvement #3) should also apply to numu's own long-running analytical reads — set `statement_timeout` per role/pool to avoid runaway queries pinning a connection.
- **Never log credentials / sensitive values** is a shared invariant — hence `log_statement = 'ddl'` and parameter-light logging here.

---

## File index

| Path | Purpose |
|---|---|
| `config/postgresql.conf` | Tuned PG 18 settings incl. replication, WAL/archiving, logging |
| `config/pg_hba.conf` | Host-based auth for app, replication, monitoring |
| `config/patroni-node.yml` | Patroni template (per-node values marked) |
| `config/haproxy.cfg` | Leader/replica routing via Patroni health checks |
| `config/pgbackrest.conf` | GCS repo, retention, archiving |
| `config/pgbouncer.ini` | Transaction-mode pooling |
| `monitoring/00_monitoring_role.sql` | Least-privilege monitoring role |
| `monitoring/10_monitoring_views.sql` | `monitoring` schema of health views (generic + numu-specific) |
| `monitoring/20_health_checks.sql` | Incident-response queries |
| `monitoring/30_exporter_queries.yaml` | postgres_exporter custom metrics |
| `monitoring/40_alert_rules.yml` | Prometheus/Alertmanager rules |
| `scripts/RUNBOOK.md` | Failover, replica rebuild, PITR procedures |

*Config values checked against the PostgreSQL 18 documentation (current stable 18.4). PostgreSQL 19 is in beta as of mid-2026; this design targets 18.*
