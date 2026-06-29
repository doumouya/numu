-- 0016_data_app_catalog.sql — register the DATA-APP types the numu frontend (numu Console) needs,
-- EXTEND `project` (PRJ) into the conversation container, and add the view-metadata layer the App's
-- generic renderer reads. Mostly REGISTRY ROWS + additive columns. Modeled on 0014_g7_catalog.sql.
--
-- WHY: the seeded catalog today is the engine/build/ops side (project · note · case · connector · skill …).
-- The frontend (project = conversation, the feed never routes away) also needs the redpash DATA objects —
-- file · chart · dashboard · message — hanging off a conversation, plus a small PRESENTATION layer
-- (context_view + field render-roles) so one renderer draws any type without per-type code.
--
-- D-CNV is settled: EXTEND `project` (PRJ); do NOT mint a `conversation`/CNV type. A conversation IS a PRJ
-- that has a feed (numu-rewrite §2 / app-update §0.5). Children scope to PRJ; PRJ gains `origin` + `case_id`.
--
-- This migration is the CATALOG half of README §3 Bucket 1. The `file` typed table + sealed
-- pipeline::upload_csv write-path land in 0017 (a migration + the `data` crate). The feed read
-- (GET /api/conversations/:id/feed) is Bucket 2 (a route, not SQL).
-- ============================================================================================

-- ── 0 · data_class — field-level privacy classification (none|personal|sensitive) ───────────
-- Ported from redpash (numu-legal-privacy-data-compliance.md §3.1): orthogonal to perm_class. The data
-- plane below carries third-party PII (message bodies, CSV sample cells), so classification lands WITH it,
-- not later — it is what export-scoping / log-redaction / the operator read-audit key off.
alter table type_fields
  add column if not exists data_class text not null default 'none'
    check (data_class in ('none', 'personal', 'sensitive'));

-- ── 1 · EXTEND project (PRJ) into the conversation ──────────────────────────────────────────
-- origin: null/'manual' = a plain build folder; 'email'/'case'/'connector' = a conversation.
-- case_id: a support case backs one conversation (optional 1:1). Both additive, non-breaking.
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('project', 'origin',  'Origin', 'enum', false, false, 7, 'standard', '{"enum":["manual","email","case","connector"],"default":"manual"}'),
  ('project', 'case_id', 'Case',   'ref',  false, false, 8, 'standard', '{"ref":"CAS"}')
on conflict do nothing;

-- ── 2 · PRESENTATION LAYER (numu-rewrite §2/§3) ─────────────────────────────────────────────
-- context_view: which Context-Panel ARCHETYPE renders a type. Closed set (the §2 census) — the CHECK keeps
-- it closed; adding an archetype is a deliberate migration. Field render-ROLE rides in the existing
-- type_fields.options json under "role" (no schema change): the renderer reads options->>'role' to fill an
-- archetype's slots (title · subtitle · cover · image · thumbnail · media_url · starts_at · ends_at ·
-- status · metric · lat · lng). Distinct from CSV semantic_dtype (the 6-value STORAGE set, 0017).
alter table type_definitions
  add column if not exists context_view text not null default 'record';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'type_definitions_context_view_chk') then
    alter table type_definitions add constraint type_definitions_context_view_chk
      check (context_view in (
        'record','table','media','collection','calendar','dashboard','board','preview','chart','map','thread'
      ));
  end if;
end $$;
update type_definitions set context_view = 'board'   where type_id = 'case';      -- kanban
update type_definitions set context_view = 'thread'  where type_id = 'project';   -- a PRJ-with-feed is a thread
update type_definitions set context_view = 'preview' where type_id = 'attachment';

-- ── 3 · file (FIL) — an uploaded CSV / data source, scoped to a PRJ ─────────────────────────
-- Original blob on disk; rows client-side (GlueSQL). This row is METADATA + the recipe pointer.
-- columns_meta = per-column dtype/semantic_dtype/null_pct/sample (numu-csv-flow-and-datatypes.md);
-- cleanness = value_quality × structural_integrity (0–100). 0017 adds the typed project_files projection.
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, context_view)
values ('file', 'FIL', 'File', 'Files', '["project_id"]', true, 32, 'table');
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options, data_class) values
  ('file', 'project_id',   'Conversation', 'ref',  true,  false, 1, 'standard', '{"ref":"PRJ"}',     'none'),
  ('file', 'filename',     'Filename',     'text', true,  false, 2, 'standard', '{"role":"title"}',  'none'),
  ('file', 'encoding',     'Encoding',     'text', false, false, 3, 'standard', '{}',                'none'),
  ('file', 'row_count',    'Rows',         'int',  false, false, 4, 'standard', '{}',                'none'),
  ('file', 'col_count',    'Columns',      'int',  false, false, 5, 'standard', '{}',                'none'),
  ('file', 'cleanness',    'Cleanness',    'int',  false, false, 6, 'standard', '{"role":"metric"}', 'none'),
  -- columns_meta carries one sample CELL per column (PII-bearing — the redpash F-J exception):
  ('file', 'columns_meta', 'Columns meta', 'json', false, false, 7, 'standard', '{"default":[]}',    'personal'),
  ('file', 'steps',        'Recipe',       'json', false, true,  8, 'standard', '{"default":[]}',    'none'),
  ('file', 'blob_ref',     'Blob',         'text', false, false, 9, 'readonly', '{}',                'none');

-- ── 4 · chart (CHT) — a chart spec over a file ──────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, context_view)
values ('chart', 'CHT', 'Chart', 'Charts', '["project_id"]', true, 34, 'chart');
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('chart', 'project_id', 'Conversation', 'ref',  true,  false, 1, 'standard', '{"ref":"PRJ"}'),
  ('chart', 'file_id',    'Source',       'ref',  false, false, 2, 'standard', '{"ref":"FIL"}'),
  ('chart', 'title',      'Title',        'text', true,  true,  3, 'standard', '{"role":"title"}'),
  ('chart', 'spec',       'Spec',         'json', true,  true,  4, 'standard', '{"default":{}}');
  -- spec (opaque, recipe-only — never customer data; redpash F-E): { type, fn, measure, group_by, bucket, … }

-- ── 5 · dashboard (DSH) — a grid of chart refs ──────────────────────────────────────────────
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, context_view)
values ('dashboard', 'DSH', 'Dashboard', 'Dashboards', '["project_id"]', true, 36, 'dashboard');
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('dashboard', 'project_id', 'Conversation', 'ref',  true,  false, 1, 'standard', '{"ref":"PRJ"}'),
  ('dashboard', 'title',      'Title',        'text', true,  true,  2, 'standard', '{"role":"title"}'),
  ('dashboard', 'spec',       'Layout',       'json', true,  true,  3, 'standard', '{"default":{"tiles":[]}}');
  -- spec.tiles: [{ chart_id, x, y, w, h }] on a 15×10 grid.

-- ── 6 · message (MSG) — a feed entry; variant by `channel`, lens by `visibility` ────────────
-- One type covers chat/sms/email/voice + the conversation OPERATOR-NOTE (channel='note',
-- visibility='internal'). NB this is DISTINCT from the standalone `note` (NOT) type, which is a pinned
-- PROJECT note ({title,body,pinned}) — they collided on the word "note"; both stay, by design.
-- visibility is the LENS plane: 'public' = customer-visible, 'internal' = operator-only. body is PII.
insert into type_definitions (type_id, id_prefix, display_name, display_name_plural, scope_parents, is_builtin, ordinal, context_view)
values ('message', 'MSG', 'Message', 'Messages', '["project_id"]', true, 38, 'thread');
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options, data_class) values
  ('message', 'project_id', 'Conversation', 'ref',  true,  false, 1, 'standard',    '{"ref":"PRJ"}',                                              'none'),
  ('message', 'author_id',  'Author',       'ref',  false, false, 2, 'standard',    '{"ref":"USR","role":"subtitle"}',                            'none'),
  ('message', 'channel',    'Channel',      'enum', true,  false, 3, 'standard',    '{"enum":["chat","sms","email","voice","note"],"default":"chat"}', 'none'),
  ('message', 'direction',  'Direction',    'enum', false, false, 4, 'standard',    '{"enum":["in","out"],"default":"out"}',                      'none'),
  ('message', 'visibility', 'Visibility',   'enum', true,  true,  5, 'owner_grade', '{"enum":["public","internal"],"default":"public","role":"status"}', 'none'),
  ('message', 'body',       'Body',         'text', false, true,  6, 'standard',    '{"role":"title"}',                                           'personal'),
  ('message', 'media_url',  'Media',        'text', false, false, 7, 'standard',    '{"role":"media_url"}',                                       'none');

-- ── 7 · report support — report = attachment + kind (README §3 Bucket 3 / numu-objects-schema §6) ──
-- The feed renders a `report` block (a pdf/deck artifact). Rather than a new type, classify the existing
-- `attachment` (ATT) by kind, so a report is an attachment with kind='report'.
insert into type_fields (type_id, field, label, kind, required, editable, ordinal, perm_class, options) values
  ('attachment', 'kind', 'Kind', 'enum', false, false, 7, 'standard', '{"enum":["file","report","deck","image"],"default":"file","role":"status"}')
on conflict do nothing;

-- ── 8 · data_class — tag the existing PII fields (the data plane now carries third-party PII) ──
update type_fields set data_class = 'personal'
  where (type_id, field) in (
    ('actor',   'email'),
    ('case',    'title'),
    ('case',    'description'),
    ('comment', 'body'),
    ('note',    'body')
  );

-- ── 9 · the feed read (Bucket 2 — a route, not SQL) ─────────────────────────────────────────
-- GET /api/conversations/:id/feed?lens=<all|customer|mine> → reach+visibility-filtered, time-ordered read
-- over a PRJ's child entities (file/chart/dashboard/message) UNION its `events`. The lens is a WHERE on
-- `visibility` (customer→public, mine→author=caller, all→reach-permitted). Leak-free by reuse. See 0017+.
