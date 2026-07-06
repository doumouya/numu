-- 0025 — the `document` type: markdown documents as objects (the Docs app, CAS_25dbaded).
-- Succeeds the retired-by-decision `note` type (locked object-model call — note stays untouched
-- until its own removal Case). Project-scoped, so reach cascades project → document (leak-free
-- 404s ride the project edge) and documents sit in the Object Rail's project tree. `md` is not
-- required — a doc is legitimately created empty. `status` is draft|final, deliberately NOT
-- "published": nothing publishes a document, and UI state must never overclaim (CAS_b0d96f86).
-- Contract: docs/apps/DOCS.md.

insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('document', 'DOC', 'Document', 'Documents', '["project_id"]', true, 220);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('document', 'project_id', 'Project',  'ref',  true,  false, 1, 'standard', '{"ref":"PRJ"}'),
  ('document', 'title',      'Title',    'text', true,  true,  2, 'standard', '{}'),
  ('document', 'md',         'Markdown', 'text', false, true,  3, 'standard', '{"default":""}'),
  ('document', 'status',     'Status',   'enum', false, true,  4, 'standard', '{"enum":["draft","final"],"default":"draft"}');
