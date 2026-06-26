-- B2 — the rest of the catalog (CASE 0008). G2 org types (workspace, team) + the G6 build-knowledge types
-- (spec, acceptance_criterion, runbook, decision, capability). Each is a registry row pair — no engine
-- code; the generic handler auto-wires the full /api/objects/:type surface. (docs/OBJECTS.md G2 + G6.)
-- created_at is a system column on `entities`, not a data field, so it's never a type_field (matches 0002).

-- ── workspace (ORG) — the top-level tenant/org container (root of the scope tree) ─────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('workspace', 'ORG', 'Workspace', 'Workspaces', '[]', true, 6);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('workspace', 'name',   'Name',   'text', true,  true,  1, 'standard',    '{}'),
  ('workspace', 'slug',   'Slug',   'text', true,  false, 2, 'standard',    '{"validate":"^[a-z0-9-]+$"}'),
  ('workspace', 'status', 'Status', 'enum', true,  true,  3, 'owner_grade', '{"enum":["active","suspended"],"default":"active"}');

-- ── team (TEM) — a group principal scoped to a workspace ──────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('team', 'TEM', 'Team', 'Teams', '["workspace_id"]', true, 8);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('team', 'workspace_id', 'Workspace',   'ref',  true,  false, 1, 'standard', '{"ref":"ORG"}'),
  ('team', 'name',         'Name',        'text', true,  true,  2, 'standard', '{}'),
  ('team', 'kind',         'Kind',        'enum', true,  false, 3, 'standard', '{"enum":["team","department"],"default":"team"}'),
  ('team', 'description',  'Description', 'text', false, true,  4, 'standard', '{}');

-- ── spec (SPC) — the approved design for a Case ───────────────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('spec', 'SPC', 'Spec', 'Specs', '["case_id"]', true, 60);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('spec', 'case_id',     'Case',        'ref',  true,  false, 1, 'standard',    '{"ref":"CAS"}'),
  ('spec', 'title',       'Title',       'text', true,  true,  2, 'standard',    '{}'),
  ('spec', 'body',        'Body',        'text', true,  true,  3, 'standard',    '{}'),
  ('spec', 'status',      'Status',      'enum', true,  true,  4, 'standard',    '{"enum":["draft","approved","superseded"],"default":"draft"}'),
  ('spec', 'approved_by', 'Approved by', 'ref',  false, true,  5, 'owner_grade', '{"ref":"USR"}');

-- ── acceptance_criterion (ACR) — one testable criterion of a spec ─────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('acceptance_criterion', 'ACR', 'Acceptance criterion', 'Acceptance criteria', '["spec_id"]', true, 62);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('acceptance_criterion', 'spec_id',  'Spec',      'ref',  true,  false, 1, 'standard', '{"ref":"SPC"}'),
  ('acceptance_criterion', 'ordinal',  '#',         'int',  true,  true,  2, 'standard', '{}'),
  ('acceptance_criterion', 'text',     'Criterion', 'text', true,  true,  3, 'standard', '{}'),
  ('acceptance_criterion', 'verified', 'Verified',  'bool', false, true,  4, 'standard', '{"default":false}'),
  ('acceptance_criterion', 'test_ref', 'Test',      'text', false, true,  5, 'standard', '{}');

-- ── runbook (RBK) — a durable record of a non-trivial bug + fix (case_id is an OPTIONAL scope_parent) ──
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('runbook', 'RBK', 'Runbook', 'Runbooks', '["case_id"]', true, 64);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('runbook', 'case_id',    'Case',       'ref',  false, false, 1, 'standard', '{"ref":"CAS"}'),
  ('runbook', 'title',      'Title',      'text', true,  true,  2, 'standard', '{}'),
  ('runbook', 'problem',    'Problem',    'text', true,  true,  3, 'standard', '{}'),
  ('runbook', 'root_cause', 'Root cause', 'text', true,  true,  4, 'standard', '{}'),
  ('runbook', 'fix',        'Fix',        'text', true,  true,  5, 'standard', '{}'),
  ('runbook', 'status',     'Status',     'enum', true,  true,  6, 'standard', '{"enum":["open","fixed","wontfix"],"default":"open"}'),
  ('runbook', 'date',       'Date',       'date', true,  true,  7, 'standard', '{}');

-- ── decision (DEC) — an architectural decision record (ADR); root-level (no scope_parent) ─────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('decision', 'DEC', 'Decision', 'Decisions', '[]', true, 66);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('decision', 'title',         'Title',        'text', true,  true,  1, 'standard',    '{}'),
  ('decision', 'context',       'Context',      'text', true,  true,  2, 'standard',    '{}'),
  ('decision', 'decision',      'Decision',     'text', true,  true,  3, 'standard',    '{}'),
  ('decision', 'consequences',  'Consequences', 'text', true,  true,  4, 'standard',    '{}'),
  ('decision', 'status',        'Status',       'enum', true,  true,  5, 'owner_grade', '{"enum":["proposed","accepted","superseded"],"default":"proposed"}'),
  ('decision', 'supersedes_id', 'Supersedes',   'ref',  false, true,  6, 'standard',    '{"ref":"DEC"}'),
  ('decision', 'date',          'Date',         'date', true,  true,  7, 'standard',    '{}');

-- ── capability (CAP) — the anti-amnesia ledger as data (project_id is an OPTIONAL scope_parent) ───────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('capability', 'CAP', 'Capability', 'Capabilities', '["project_id"]', true, 68);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('capability', 'project_id',  'Project',     'ref',  false, false, 1, 'standard', '{"ref":"PRJ"}'),
  ('capability', 'key',         'Key',         'text', true,  false, 2, 'standard', '{}'),
  ('capability', 'status',      'Status',      'enum', true,  true,  3, 'standard', '{"enum":["live","gap","deferred"],"default":"live"}'),
  ('capability', 'description', 'Description', 'text', true,  true,  4, 'standard', '{}'),
  ('capability', 'evidence',    'Evidence',    'text', false, true,  5, 'standard', '{}');
