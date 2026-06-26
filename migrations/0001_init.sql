-- 0001_init.sql — numu SYSTEM schema (Postgres-first).
--
-- Realizes the SYSTEM tables of docs/OBJECTS.md. "A type is a row, not a migration": declaring an object
-- type inserts into type_definitions + type_fields; instances live in entity_data (the one typed-table
-- exception, `cases`, is created here but the v0 generic handler routes every type — including case —
-- through entity_data; the workflow engine wiring + cases_guard trigger + the omnisearch tsvector index
-- are follow-on slices, noted inline).

-- ── G1 · registry spine ───────────────────────────────────────────────────────
create table type_definitions (
  type_id             text primary key,
  id_prefix           text not null unique,           -- CAS, PRJ, … → makes kind(id) a lookup
  display_name        text not null,
  display_name_plural text not null default '',
  scope_parents       jsonb not null default '[]',    -- ordered parent fields the reach resolver climbs
  icon                text,
  is_builtin          boolean not null default false,
  ordinal             integer not null default 0,
  method_policy       jsonb not null default '{}'     -- {"mask":[verbs],"delete_min_role":"owner"}; '{}' = full surface
);

create table entities (
  id          text primary key,                       -- <PREFIX>_<hex>
  type        text not null references type_definitions(type_id),
  created_at  timestamptz not null default now(),
  created_by  text
);
create index entities_type_idx on entities(type);

create table type_fields (
  type_id    text not null references type_definitions(type_id) on delete cascade,
  field      text not null,
  label      text not null default '',
  kind       text not null,                            -- text|int|bool|date|json|ref|enum
  required   boolean not null default false,
  editable   boolean not null default true,
  ordinal    integer not null default 0,
  perm_class text not null default 'standard',         -- system|readonly|standard|owner_grade
  options    jsonb not null default '{}',              -- enum vocab / {"ref":"PRJ"} / default / validate
  searchable boolean not null default false,           -- feed omnisearch (index is a follow-on slice)
  primary key (type_id, field)
);

-- all-JSONB store; version/updated_at power the ETag/If-Match concurrency contract (docs/HTTP.md §3).
create table entity_data (
  entity_id       text primary key references entities(id) on delete cascade,
  type_id         text not null references type_definitions(type_id),
  data            jsonb not null default '{}',
  scope_parent_id text references entities(id) on delete set null,   -- real reach edge (IDOR backstop)
  version         integer not null default 1,
  updated_at      timestamptz not null default now()
);
create index entity_data_type_idx on entity_data(type_id);
create index entity_data_scope_parent_idx on entity_data(scope_parent_id);

-- ── G2 · access & org ─────────────────────────────────────────────────────────
create table memberships (
  object_id    text not null references entities(id) on delete cascade,
  member_id    text not null references entities(id) on delete cascade,
  role         text not null check (role in ('viewer','member','admin','owner')),
  context_role text not null default '',
  created_at   timestamptz not null default now(),
  primary key (object_id, member_id, role, context_role)
);
create index memberships_member_idx on memberships(member_id);

create table relation (
  subject_id    text not null references entities(id) on delete cascade,
  object_id     text not null references entities(id) on delete cascade,
  relation_type text not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  primary key (subject_id, object_id, relation_type)
);
create index relation_object_idx on relation(object_id);

-- ── G3 · audit & observability ────────────────────────────────────────────────
create table events (
  id         bigserial primary key,
  entity_id  text references entities(id) on delete set null,
  actor_id   text,
  kind       text not null,
  at         timestamptz not null default now(),
  payload    jsonb not null default '{}',
  request_id text,                                     -- correlation id (X-Request-Id) — P-DEBUG spine
  trace_id   text
);
create index events_entity_idx on events(entity_id);
create index events_request_idx on events(request_id);

create table audit_runs (
  id         text primary key,
  tool       text not null,
  ran_at     timestamptz not null default now(),
  git_sha    text,
  git_branch text,
  stats      jsonb not null default '{}',
  payload    jsonb not null default '{}'
);

create table audit_findings (
  id          bigserial primary key,
  run_id      text not null references audit_runs(id) on delete cascade,
  tool        text not null,
  kind        text not null,
  finding_key text not null,
  severity    text not null default 'info',            -- info|warn|error
  detail      jsonb not null default '{}'
);
create index audit_findings_run_idx on audit_findings(run_id);

-- ── G4 · work tracking (workflow-as-data) ─────────────────────────────────────
create table workflows (
  workflow_id  text primary key,
  states       jsonb not null,                         -- ordered; last = terminal
  transitions  jsonb not null,                         -- { "<from>": ["<to>", …] } (permissive)
  initial      text not null,
  close_checks jsonb not null default '[]'
);

-- the one typed-table opt-in (workflow engine needs typed status/index/guard). v0 handler still routes
-- case through entity_data; this table + the cases_guard trigger are wired in the workflow-engine slice.
create table cases (
  entity_id   text primary key references entities(id) on delete cascade,
  title       text not null,
  status      text not null,
  workflow_id text not null references workflows(workflow_id),
  priority    text not null default 'normal',
  assignee_id text references entities(id) on delete set null,
  project_id  text references entities(id) on delete set null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);
create index cases_status_idx on cases(status);

create table case_close_checks (
  case_id    text not null references cases(entity_id) on delete cascade,
  check_name text not null,
  passed     boolean not null default false,
  note       text,
  at         timestamptz not null default now(),
  primary key (case_id, check_name)
);

-- ── G5 · orchestrator / feature pipeline ──────────────────────────────────────
create table feature_runs (
  id         text primary key,
  case_id    text references cases(entity_id) on delete set null,
  title      text not null,
  phase      text not null default 'spec',
  status     text not null default 'active',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table role_handoffs (
  id             bigserial primary key,
  feature_run_id text not null references feature_runs(id) on delete cascade,
  role           text not null check (role in ('architect','tester','coder','reviewer','ops')),
  attempt        integer not null default 1,
  gate           text,
  outcome        text,
  kind           text not null default 'gate',
  retries        integer not null default 0,
  hops           integer not null default 0,
  note           text,
  at             timestamptz not null default now()
);
create index role_handoffs_run_idx on role_handoffs(feature_run_id);

-- ── G6 · build knowledge: the docs-currency gate's data ───────────────────────
create table changeset (
  commit_sha   text primary key,
  case_id      text references cases(entity_id) on delete set null,
  touched_docs boolean not null default false,
  docs_ack     text,
  at           timestamptz not null default now()
);
