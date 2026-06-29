# numu PostgreSQL — Operational Runbook

Procedures for the common incidents. Assumes Patroni + etcd + HAProxy + pgBackRest(GCS).
Run cluster commands from any DB node unless stated. `--stanza=numu` throughout.

---

## 0. Quick status

```bash
patronictl -c /etc/patroni/patroni.yml list        # cluster: who is Leader / Replica / lag
patronictl -c /etc/patroni/patroni.yml history     # past failovers/switchovers
pgbackrest --stanza=numu info                       # backup inventory + WAL archive status
```
In SQL: `SELECT pg_is_in_recovery();` (true = standby). Health views in `monitoring.*`.

---

## 1. Planned switchover (zero data loss — for maintenance)

```bash
patronictl -c /etc/patroni/patroni.yml switchover \
  --master <current-leader> --candidate <target-replica>
```
HAProxy follows the new leader within a health-check interval. Confirm with `patronictl list`
and that numu writes succeed against HAProxy :5000.

## 2. Unplanned failover (primary crashed)

Patroni does this automatically: leader lock expires -> election -> promote least-lagged
replica -> rewrite `synchronous_standby_names` -> HAProxy reroutes :5000.

**Your job afterward — restore the 1+2 shape:**
1. Confirm the new leader: `patronictl list`.
2. Provision a replacement GCE VM (same image/Patroni config, new `name`/`connect_address`).
3. Start Patroni on it; it bootstraps from pgBackRest + streams WAL and joins as a replica.
4. Verify it reaches `state=streaming` in `monitoring.replication_lag` and `wal_status=reserved` in `monitoring.replication_slots`.
5. If the old primary returns, Patroni `pg_rewind`s it back as a replica automatically (don't start it as a second primary).

## 3. Rebuild / re-seed a replica (lagged, broken, or slot bloat)

```bash
# On the bad replica:
systemctl stop patroni
patronictl -c /etc/patroni/patroni.yml reinit numu-cluster <node-name>
# Patroni re-clones from the leader (or pgBackRest) and rejoins.
```
If a slot is retaining too much WAL and the replica is gone for good, drop the orphan slot
ON THE PRIMARY: `SELECT pg_drop_replication_slot('<slot_name>');`

## 4. Point-in-time recovery (bad migration / dropped table)

**Decide the target time/LSN first** (just before the bad event). This restores the WHOLE
cluster's data to that point — do it on a SCRATCH node first to extract data if you only need
a few rows, to avoid rolling back good writes.

```bash
# On a fresh/scratch node (Patroni stopped, empty data dir):
pgbackrest --stanza=numu --type=time \
  --target="2026-06-29 14:30:00+00" \
  --target-action=promote restore

# Then start PostgreSQL; it replays WAL to the target and promotes.
pg_ctlcluster 18 main start
# Verify the data, extract what you need, or repoint the app if doing a full rollback.
```
Targets: `--type=time` (timestamp), `--type=lsn` (`--target=0/XXXXXXX`), `--type=xid`, `--type=name`
(a named restore point you created with `pg_create_restore_point`).

## 5. Take / verify backups

```bash
pgbackrest --stanza=numu --type=full backup           # weekly (cron)
pgbackrest --stanza=numu --type=diff backup           # daily  (cron)
pgbackrest --stanza=numu check                         # daily  (cron) -> ALERT on nonzero exit
```
Recommended cron (on the leader, or a standby with backup-standby=y):
```
0 1 * * 0  postgres  pgbackrest --stanza=numu --type=full backup
0 1 * * 1-6 postgres pgbackrest --stanza=numu --type=diff backup
*/30 * * * * postgres pgbackrest --stanza=numu check || /usr/local/bin/notify "pgbackrest check FAILED"
```

## 6. Disk filling on the primary

1. Check causes: `monitoring.replication_slots` (orphan slot retaining WAL),
   `monitoring.table_bloat` (vacuum lag), failed `archive_command` (WAL piling in pg_wal).
2. If archiving is failing: fix GCS/IAM, then WAL drains. `max_slot_wal_keep_size`
   (50GB) caps slot retention so a dead replica can't fill the disk indefinitely.
3. Extend the GCE persistent disk (online resize) + `resize2fs`/`growpart` if needed.

## 7. etcd quorum lost (PG went read-only)

PG demoting to read-only is the SAFE response (no split-brain). Restore etcd quorum
(bring members back / replace a failed member). Patroni resumes normal operation and the
leader becomes writable again. Do NOT force-promote PG manually while etcd is unhealthy.

## 8. Drills (schedule these — reliability isn't real until tested)

- Quarterly: §1 switchover + a kill-the-primary §2 test; record actual RTO.
- Monthly: §4 PITR into a scratch VM; verify row counts/checksums.
- Continuously: §5 `pgbackrest check` + the alert rules in `monitoring/40_alert_rules.yml`.
