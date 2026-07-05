-- 0019_access_audit.sql — GOVERNANCE #2: read accountability for classified data. CASE 0017.
-- The events spine already logs every MUTATION; this table logs READS that returned any
-- `personal|sensitive` field (per type_fields.data_class, 0016), appended by the ONE generic
-- handler (item GET / collection GET) — every type inherits operator-read evidence.
--
-- INSERT-ONLY by convention and by code: no handler updates or deletes rows here (the
-- access-audit gate greps for exactly that). Field NAMES only, never values (OBSERVABILITY §6
-- rule 6 — never log the data). One row per REQUEST, not per entity: a list read carries the
-- returned row_count; the field set is the union of classified fields the response exposed.

create table access_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor_id     text not null,
  surface_kind text not null,                  -- console | app | agent (the acting surface, Plane C tag)
  surface_id   text not null,                  -- '*' for console; the app/agent id otherwise
  type_id      text not null,
  entity_id    text,                           -- the item read; null for a collection read
  action       text not null check (action in ('view','list')),
  field_names  text[] not null,                -- the personal|sensitive fields returned (names only)
  row_count    int not null default 1,
  purpose      text,                           -- the request's declared purpose (X-Numu-Purpose), if any
  request_id   text not null                   -- joins to the events spine + the log stream
);

create index access_audit_actor_idx on access_audit(actor_id, at);
create index access_audit_entity_idx on access_audit(entity_id) where entity_id is not null;
