# CASE 0016 — land the Postgres-HA design docs (+ review open-items)

- **Status:** in_review
- **Type:** task
- **Opened:** 2026-06-29
- **Owner:** Torv (for Em)
- **MCP note:** Cases backend was down at open (`fetch failed`); this on-disk stub is the case-first
  fallback — promote via `case_create` when the backend is back.

## Goal

Em: "land in the docs first and ping me." Land the **reviewed** Postgres-HA deliverable's **design docs**
into numu (docs first; the configs/monitoring/scripts → `ops/postgres/` and the `postgres-ha` skill →
`.claude/skills/` are the follow-on phase). Source: the `numu-postgres-ha` output folder (a separate
design session), reviewed 2026-06-29.

## Delivered (this batch — docs only)

- `docs/ops/postgres-ha.md` ← `ARCHITECTURE.md` (verbatim) + a provenance/landing note.
- `docs/ops/postgres-ha-runbook.md` ← `RUNBOOK.md` (the operational procedures).
- `docs/DOCMAP.md` — new **Ops** section with both rows (every doc gets exactly one row).
- Docs-only commit on `feat/numu-frontend-integration`, **held — no push**; `git commit -o` named paths,
  so it doesn't touch the concurrent `crates/` security work.

## Review verdict

**Ship-worthy v1 design**, and genuinely *numu-aware* (not generic): monitoring views for the reach-resolver
CTE / `upload_csv` write path / `events` growth / `entity_data` bloat / per-`type_id` counts, plus the
`db-health → audit_runs/run_diff` integration, and a `postgres-ha` skill that mirrors the `http` skill's
"defer to the spec, carry house rules" pattern. Core HA is standard-proven: 1+2 Patroni + 3-node etcd quorum
+ HAProxy, quorum-sync (`ANY 1`, strict off), pgBackRest→GCS PITR, `data-checksums`, `max_slot_wal_keep_size`,
`pg_rewind`, watchdog; pg_hba is `hostssl`+scram+reject-default; logging is `log_statement=ddl` (no DML params).

## Open items (review findings, 2026-06-29) — 1–3 are must-fix before prod

1. **Proxy-tier SPOF** — one HAProxy + one PgBouncer in front of the HA cluster (HA's the DB, not the front
   door). Fix: GCP internal TCP LB → 2× HAProxy, or co-locate HAProxy+PgBouncer **per app node**. (#1 gap.)
   The design also never states *where* the proxies run — pin that down.
2. **Prod-hardening as commented TODOs** — Patroni REST auth + etcd TLS are `# enable in production`. The
   `:8008` REST API controls failover/switchover/restart — enable auth + restrict to the cluster subnet;
   update the HAProxy `httpchk` once auth is on.
3. **Alert ↔ exporter metric-name drift** — `40_alert_rules.yml` uses custom names
   (`pg_replication_slot_retained_retained_wal_bytes`, `pg_longest_xact_seconds_longest_xact_seconds`,
   `pg_wraparound_pct_to_forced_vacuum`) not diffed against `30_exporter_queries.yaml` → alerts may silently
   never fire. `BackupTooOld` needs a pgBackRest-timestamp exporter that isn't wired yet. **Verify each name.**
4. **Static `synchronous_standby_names` in `postgresql.conf`** while Patroni also manages it — drift footgun;
   let Patroni be the sole owner (drop it from the static file).
5. **Read-your-writes across the `:5000`/`:5001` pool split** under `synchronous_commit=on` (quorum *flushed*,
   not *applied*) — numu's return-the-entity-from-the-write-path mostly handles it; document the caveat in §6.
6. **`events` partitioning** flagged but not done — highest-write table; monthly declarative partition on
   `events.at` (a near-term migration), consistent with the monitoring's vacuum/wraparound emphasis.

Minor: `db-health.sh` only checks lag when pointed at a standby (run per-node or also hit `:5001`); make the
`retention-full=2` PITR-floor (~1–2 wks) explicit.

## Follow-on (phase 2, on Em's word)

`ops/postgres/` (configs + monitoring + scripts) · `.claude/skills/postgres-ha/` (the skill) · fixes for
findings 1–4. **Em directed "use /feature"** — the phase-2 implementation should run through the 5-role
orchestrator (architect spec → Checkpoint 1) rather than ad-hoc.

## Log

- **2026-06-29 — Torv:** Reviewed the `numu-postgres-ha` deliverable (ARCHITECTURE + 6 configs + 5 monitoring
  files + runbook + the `postgres-ha` skill). Landed the two design docs into `docs/ops/` + DOCMAP rows.
  Committed docs-only on `feat/numu-frontend-integration`, held for Em's push. MCP down → this on-disk stub.
