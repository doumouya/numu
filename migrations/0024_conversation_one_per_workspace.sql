-- 0024 — one conversation per workspace (SLICE 2 pre-push review, CAS_00742b86). post_feed_core applies
-- feed writes atomically by workspace_id and assumes at most one `conversation` row per workspace. This
-- partial unique index enforces that invariant at the DB: two racing first-writes now collide on 23505
-- (the handler retries the loser as an atomic append) instead of minting a duplicate row that would
-- orphan half the feed. Forward-only; conversations carry no rows in prod yet (SLICE 2 not deployed).

create unique index if not exists entity_data_conversation_workspace_uidx
  on entity_data ((data->>'workspace_id'))
  where type_id = 'conversation';
