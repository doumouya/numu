# CASE 0017 — the read-audit hook (GOVERNANCE #2)

**Origin:** [`../kernel/GOVERNANCE.md`](../kernel/GOVERNANCE.md) #2 — the events spine logs every
mutation; the gap was READ accountability of classified data. Co-designed with CASE 0016: the
access row carries the same acting-surface tag + declared purpose Plane C consumes.

## Landed

- **`migrations/0019_access_audit.sql`** — `access_audit`: actor · surface_kind/surface_id ·
  type/entity · action `view|list` · `field_names text[]` (NAMES only, never values —
  OBSERVABILITY §6 rule 6) · row_count · purpose · request_id. Insert-only; indexed by actor and
  entity.
- **`db::record_access`** — same failure posture as `record_event`: warn, never fail the read.
- **`objects.rs`** — the chokepoint hook in BOTH generic read paths: `item_get` (one row, the
  entity id) and `coll_get` (one row per request, the union of classified field names + the row
  count). Fields are collected AFTER Plane B/C filtering — the audit records what was actually
  returned, not what exists.
- **`tools/access-audit/`** — R1 substrate exists + nothing UPDATEs/DELETEs the table ·
  R2 both read paths flow through the hook · R3 the row carries field names + request-id.
  Self-arming; auto-discovered. (Red-tested: the grep fires on an unhooked read fn.)
- **Test** (`tests/plane_c.rs::access_audit_row_shape`) — the full row round-trip; the handler
  WIRING is the gate's job (the numu pattern: function-level proof + static wiring query).

## Decisions

- **One row per request, not per entity** — a 200-row list is one evidence row with
  `row_count=200` and the field-name union; per-entity rows would turn the audit into the
  workload. The request_id joins it to the events spine and the log stream.
- **Post-filter collection** — evidence of actual disclosure; a field the caller couldn't read
  never appears in the audit.
- Purpose is recorded as declared (binds, doesn't prove) — the same posture as Plane C's
  `purpose_limited`.

**Landed 2026-07-05:** 0019 applies after 0001–0018; `access_audit_row_shape` proves the full row
round-trip; the access-audit gate red-tested (fires on an unhooked read fn) and green on HEAD;
full ci green — 16 gates.

## Follow-on (recorded)

Retention windows on `data_class` (GOVERNANCE #4) sweep this table too; the RoPA/register
generator reads `access_audit` + the `data_class` rows as its evidence base; `operator_access`
(#3) joins its TTL'd reads to these rows via request_id.
