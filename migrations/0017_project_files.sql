-- 0017_project_files.sql — the typed projection for `file` + the cleaning recipe (README §3 Bucket 1c).
--
-- `file` is the second typed-table opt-in (the `cases` precedent, 0001/db.rs::upsert_case_mirror):
-- entity_data stays the CANONICAL record (the generic CRUD/OPTIONS surface reads it); `project_files` is
-- the typed, indexable PROJECTION the feed + grid read, and `project_steps` is the cleaning recipe.
-- Derive-don't-store: the original blob (on disk, `blob_ref`) + the ordered `project_steps` = the frame
-- (replay() — client-side today). One sealed write-path: pipeline::upload_csv (no public inserter).

create table project_files (
  entity_id    text primary key references entities(id) on delete cascade,
  project_id   text not null references entities(id) on delete cascade,
  filename     text not null,
  encoding     text,
  row_count    bigint,
  col_count    integer,
  cleanness    real,                       -- value_quality x structural_integrity (0-100)
  columns_meta jsonb not null default '[]', -- ColumnMeta[] (per-column dtype/semantic_dtype/null_pct/sample)
  blob_ref     text not null default '',    -- files/<FIL>.bin on disk (the immutable original)
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index project_files_project_idx on project_files (project_id);

create table project_steps (
  id         text primary key,             -- STP_<hex>
  file_id    text not null references project_files(entity_id) on delete cascade,
  ordinal    integer not null,             -- 0 = the genesis 'original' step
  kind       text not null,                -- the cleaning step kind (opaque to the backend v1)
  params     jsonb not null default '{}',
  applied    boolean not null default true,
  cleanness  real,                          -- the score AFTER this step (trajectory)
  created_at timestamptz not null default now(),
  unique (file_id, ordinal)
);
