-- 0009_case_family.sql — G4.3: seed the `comment` + `attachment` types. Both hang off ANY object via
-- `subject_id` (the scope_parent), so the activity thread + file metadata are uniform across the engine and
-- inherit RBAC for free (project -> case -> comment cascade). They auto-wire through the generic handler —
-- zero per-type code. Set-once fields use editable=false + perm_class=standard (settable on create,
-- immutable after); `system`/`readonly` would block them at create. (docs/OBJECTS.md G4, CASE 0006.)

-- ── comment (CMT) ─────────────────────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('comment', 'CMT', 'Comment', 'Comments', '["subject_id"]', true, 40);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('comment', 'subject_id',  'On',        'ref',  true,  false, 1, 'standard', '{}'),
  ('comment', 'author_id',   'Author',    'ref',  false, false, 2, 'standard', '{"ref":"USR"}'),
  ('comment', 'body',        'Body',      'text', true,  true,  3, 'standard', '{}'),
  ('comment', 'visibility',  'Visibility','enum', false, true,  4, 'standard', '{"enum":["internal","public"],"default":"internal"}'),
  ('comment', 'reply_to_id', 'Reply to',  'ref',  false, false, 5, 'standard', '{"ref":"CMT"}');

-- ── attachment (ATT) — metadata only; the blob lives in a storage mirror ───────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal)
values ('attachment', 'ATT', 'Attachment', 'Attachments', '["subject_id"]', true, 50);

insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('attachment', 'subject_id',  'On',          'ref',  true,  false, 1, 'standard', '{}'),
  ('attachment', 'name',        'Filename',    'text', true,  false, 2, 'standard', '{}'),
  ('attachment', 'blob_ref',    'Blob ref',    'text', true,  false, 3, 'standard', '{}'),
  ('attachment', 'mime',        'Type',        'text', false, false, 4, 'standard', '{}'),
  ('attachment', 'size_bytes',  'Size',        'int',  false, false, 5, 'standard', '{}'),
  ('attachment', 'uploaded_by', 'Uploaded by', 'ref',  false, false, 6, 'standard', '{"ref":"USR"}');
