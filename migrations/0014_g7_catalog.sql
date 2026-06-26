-- G7 — the last of the catalog (CASE 0011): connector, secret, skill, milestone. Registry rows that
-- auto-wire the full /api/objects/:type surface (CRUD, OPTIONS, search, relations) — no per-type code.
-- secret is deliberately METADATA-ONLY (an `external_ref`, never the plaintext) so the generic handler is
-- inherently leak-safe. connector gains one behavior beyond CRUD: POST /api/connectors/:id/run
-- (crates/api/src/connectors.rs), which fetches its target through the existing SSRF gate. (docs/OBJECTS.md G7.)

-- ── connector (CON) — an external-source conduit ──────────────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('connector', 'CON', 'Connector', 'Connectors', '["project_id"]', true, 70);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('connector', 'project_id',    'Project',       'ref',  false, false, 1, 'standard', '{"ref":"PRJ"}'),
  ('connector', 'name',          'Name',          'text', true,  true,  2, 'standard', '{}'),
  ('connector', 'kind',          'Kind',          'enum', true,  true,  3, 'standard', '{"enum":["http_json","webhook","sql","file"],"default":"http_json"}'),
  ('connector', 'target',        'Target',        'text', true,  true,  4, 'standard', '{}'),
  ('connector', 'status',        'Status',        'enum', true,  true,  5, 'standard', '{"enum":["draft","active","disabled","error"],"default":"draft"}'),
  ('connector', 'data_contract', 'Data contract', 'json', false, true,  6, 'standard', '{"default":{}}'),
  ('connector', 'last_run_at',   'Last run',      'date', false, false, 7, 'readonly', '{}'),
  ('connector', 'description',   'Description',   'text', false, true,  8, 'standard', '{}');

-- ── secret (SEC) — a REFERENCE to a credential (never the plaintext) ──────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('secret', 'SEC', 'Secret', 'Secrets', '["project_id"]', true, 72);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('secret', 'project_id',   'Project',       'ref',  false, false, 1, 'standard',    '{"ref":"PRJ"}'),
  ('secret', 'name',         'Name',          'text', true,  true,  2, 'standard',    '{}'),
  ('secret', 'provider',     'Provider',      'enum', true,  true,  3, 'standard',    '{"enum":["env","vault","aws_kms","gcp_sm"],"default":"env"}'),
  ('secret', 'external_ref', 'External ref',  'text', true,  true,  4, 'owner_grade', '{}'),
  ('secret', 'status',       'Status',        'enum', true,  true,  5, 'standard',    '{"enum":["active","rotating","revoked"],"default":"active"}'),
  ('secret', 'rotation_at',  'Rotates',       'date', false, true,  6, 'standard',    '{}'),
  ('secret', 'description',  'Description',   'text', false, true,  7, 'standard',    '{}');

-- ── skill (SKL) — a reusable, agent-invokable procedure ───────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('skill', 'SKL', 'Skill', 'Skills', '["project_id"]', true, 74);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('skill', 'project_id',  'Project',     'ref',  false, false, 1, 'standard', '{"ref":"PRJ"}'),
  ('skill', 'name',        'Name',        'text', true,  true,  2, 'standard', '{}'),
  ('skill', 'description', 'Description', 'text', true,  true,  3, 'standard', '{}'),
  ('skill', 'kind',        'Kind',        'enum', true,  true,  4, 'standard', '{"enum":["procedure","playbook"],"default":"procedure"}'),
  ('skill', 'definition',  'Definition',  'json', false, true,  5, 'standard', '{"default":{}}'),
  ('skill', 'status',      'Status',      'enum', true,  true,  6, 'standard', '{"enum":["draft","active","deprecated"],"default":"draft"}');

-- ── milestone (MIL) — a generic time-bound obligation off any subject ─────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('milestone', 'MIL', 'Milestone', 'Milestones', '["subject_id"]', true, 76);
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('milestone', 'subject_id',   'On',        'ref',  true,  false, 1, 'standard', '{}'),
  ('milestone', 'name',         'Name',      'text', true,  true,  2, 'standard', '{}'),
  ('milestone', 'kind',         'Kind',      'enum', true,  true,  3, 'standard', '{"enum":["sla","deadline","checkpoint"],"default":"deadline"}'),
  ('milestone', 'target_at',    'Target',    'date', true,  true,  4, 'standard', '{}'),
  ('milestone', 'completed_at', 'Completed', 'date', false, true,  5, 'standard', '{}');
-- NOTE: `breached` is intentionally NOT a stored field — it's derived at read
-- (now > target_at AND completed_at IS NULL) from the two fields above, so it can't go stale.
