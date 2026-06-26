-- 0002_seed.sql — builtin registered types so the generic /api/objects surface is exercisable on a fresh
-- DB. Two types: `project` (a root container) and `note` (scoped to a project via project_id). Adding the
-- next builtin (case, spec, runbook, …) is more rows here — never a migration. This is "a type is a row".

-- ── project (PRJ) — a root container ──────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('project', 'PRJ', 'Project', 'Projects', '[]', true, 10);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('project', 'name',        'Name',        'text', true,  true,  1, 'standard', '{}'),
  ('project', 'slug',        'Slug',        'text', true,  false, 2, 'standard', '{"validate":"^[a-z0-9-]+$"}'),
  ('project', 'status',      'Status',      'enum', false, true,  3, 'standard', '{"enum":["planning","active","paused","archived"],"default":"planning"}'),
  ('project', 'description', 'Description', 'text', false, true,  4, 'standard', '{}'),
  ('project', 'repo_url',    'Repository',  'text', false, true,  5, 'standard', '{}');

-- ── note (NOT) — scoped to a project ──────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('note', 'NOT', 'Note', 'Notes', '["project_id"]', true, 20);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('note', 'project_id', 'Project', 'ref',  true,  false, 1, 'standard', '{"ref":"PRJ"}'),
  ('note', 'title',      'Title',   'text', true,  true,  2, 'standard', '{}'),
  ('note', 'body',       'Body',    'text', false, true,  3, 'standard', '{}'),
  ('note', 'pinned',     'Pinned',  'bool', false, true,  4, 'standard', '{"default":false}');
