-- G3 — registry-native omnisearch (CASE 0008 B3). Because every object is a row in one store, ONE search
-- covers every type for free. The index is a GIN tsvector over the STRING values of each entity's `data`
-- (string values only — keys/numbers excluded), maintained automatically as a generated STORED column, so
-- it refreshes on every write with zero application code. `jsonb_to_tsvector` with an explicit config is
-- immutable, which a generated column requires. The reach filter lives in crates/api/src/search.rs (search
-- is leak-free like every other read). (docs/OBJECTS.md G3.)
alter table entity_data
  add column search_vector tsvector
  generated always as (jsonb_to_tsvector('english', data, '["string"]'::jsonb)) stored;

create index entity_data_search_idx on entity_data using gin (search_vector);
