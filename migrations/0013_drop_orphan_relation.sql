-- Drop the orphaned singular `relation` table from 0001 — superseded by the canonical plural `relations`
-- (0010 + crates/api/src/relations.rs). A tree-wide grep (per the drop-table discipline) found ZERO readers
-- of the singular table; it was a near-duplicate left from the early schema. (CASE 0008 review.)
drop index if exists relation_object_idx;
drop table if exists relation;
