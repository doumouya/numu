-- G2 — the `relation` SYSTEM table: the one generic, typed entity↔entity edge (the M:N counterpart to
-- memberships' entity↔principal). One table so numu never grows SF-style per-pair junctions
-- (CaseArticle, blocks, duplicate-of…): the concept lives in `relation_type`, the shape is always two ids.
-- Surrogate `REL_` id for a clean DELETE; the (subject,object,type) triple is unique (no duplicate edges).
-- RBAC (enforced in crates/api/src/relations.rs): readable iff the caller reaches BOTH endpoints; writable
-- iff they can edit the subject. (docs/OBJECTS.md G2, CASE 0008.)
create table relations (
  id            text primary key,                                   -- REL_<hex>
  subject_id    text not null references entities(id) on delete cascade,
  object_id     text not null references entities(id) on delete cascade,
  relation_type text not null,
  created_by    text references entities(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (subject_id, object_id, relation_type)
);

create index relations_subject_idx on relations(subject_id);
create index relations_object_idx on relations(object_id);
