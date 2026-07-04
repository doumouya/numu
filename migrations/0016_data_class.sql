-- 0016_data_class.sql — docs/kernel/GOVERNANCE.md §Implementation #1: field-level data classification.
--
-- Adds `type_fields.data_class` — the registry property the `data-class-audit` gate and the privacy
-- register key off. NOT NULL + DEFAULT 'internal' backfills every already-seeded field to a safe floor; the
-- CHECK pins the vocabulary so the DB itself rejects an unclassified / invalid class (the backstop behind
-- the gate and the type-registration validator). Personal/sensitive fields are then RAISED explicitly below
-- (the classification manifest). This column drives access-audit, retention, and at-rest encryption; it is
-- INDEPENDENT of `perm_class` (which governs read/write RANK) — classifying a field does not change who may
-- read it, only how the engine treats it for privacy.

alter table type_fields
  add column data_class text not null default 'internal'
  check (data_class in ('public', 'internal', 'personal', 'sensitive'));

-- ── the classification manifest — raise above the 'internal' floor ─────────────────────────────
-- `personal`: data that identifies a natural person, or free-text that routinely carries third-party PII
-- (per docs/foundation/numu-legal-privacy-data-compliance.md §2 data inventory: user identity; case
-- title/description; comment bodies; uploaded-file names).
update type_fields set data_class = 'personal' where (type_id, field) in (
  ('actor',      'display_name'),
  ('actor',      'handle'),
  ('actor',      'email'),
  ('actor',      'avatar_url'),
  ('case',       'title'),
  ('case',       'description'),
  ('comment',    'body'),
  ('attachment', 'name')
);

-- `sensitive`: credential material or a pointer to it. `secret` is metadata-only by design — it stores the
-- `external_ref`, never the secret value (docs/api/OBJECTS.md) — so the ref is the field that carries risk.
update type_fields set data_class = 'sensitive' where (type_id, field) in (
  ('secret', 'external_ref')
);
