-- 0007_cases_engine.sql — G4.1: light up the work-tracking engine. Seed the `default` workflow (a row, not
-- code) and the `case` type. The generic handler routes case through entity_data as usual; the engine adds
-- a typed `cases` projection (maintained by the handler) + Rust transition validation. The cases_guard
-- trigger + the close-gate land in 0008. (docs/OBJECTS.md G4, CASE 0006.)

-- ── the default workflow ──────────────────────────────────────────────────────
-- Permissive (kanban): forward one step · one step back · reopen from done. An illegal skip (e.g.
-- backlog -> done) is rejected (422). Terminal = the last state; close_checks gate the terminal entry.
insert into workflows (workflow_id, states, transitions, initial, close_checks) values (
  'default',
  '["backlog","todo","in_progress","in_review","done"]',
  '{"backlog":["todo"],"todo":["backlog","in_progress"],"in_progress":["todo","in_review"],"in_review":["in_progress","done"],"done":["in_review"]}',
  'backlog',
  '["docs_reconciled"]'
);

-- ── case (CAS) — the unit of tracked work ─────────────────────────────────────
-- scope_parent = project_id (cases reach-scoped to their project). created_at/updated_at are engine-derived
-- (entities.created_at + the version/updated_at mirror), not user fields.
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('case', 'CAS', 'Case', 'Cases', '["project_id"]', true, 30);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('case', 'title',       'Title',       'text', true,  true,  1,  'standard', '{}'),
  ('case', 'description', 'Description', 'text', false, true,  2,  'standard', '{}'),
  ('case', 'type',        'Type',        'enum', true,  true,  3,  'standard', '{"enum":["bug","feature","task","epic","chore"],"default":"task"}'),
  ('case', 'status',      'Status',      'enum', true,  true,  4,  'standard', '{"enum":["backlog","todo","in_progress","in_review","done"],"default":"backlog"}'),
  ('case', 'priority',    'Priority',    'enum', true,  true,  5,  'standard', '{"enum":["low","normal","high","urgent"],"default":"normal"}'),
  ('case', 'origin',      'Origin',      'enum', false, true,  6,  'standard', '{"enum":["ui","agent","import","email","web","phone","chat"],"default":"ui"}'),
  ('case', 'visibility',  'Visibility',  'enum', false, true,  7,  'standard', '{"enum":["internal","public"],"default":"internal"}'),
  ('case', 'workflow_id', 'Workflow',    'ref',  true,  false, 8,  'readonly', '{"ref":"workflows","default":"default"}'),
  ('case', 'assignee_id', 'Assignee',    'ref',  false, true,  9,  'standard', '{"ref":"USR"}'),
  ('case', 'reporter_id', 'Reporter',    'ref',  false, false, 10, 'readonly', '{"ref":"USR"}'),
  ('case', 'project_id',  'Project',     'ref',  true,  false, 11, 'standard', '{"ref":"PRJ"}');
