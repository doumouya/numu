//! DB helpers. `record_event` writes the G3 audit row for every mutation, carrying the request-id so a
//! wire error joins to its full server trace. Failure to record is logged (warn) — never fails the user's
//! request: observability must not become a new failure mode. (v0 awaits inline; a detached task is a
//! follow-on optimization.)

use sqlx::PgPool;

use crate::request_id::RequestCtx;

pub async fn record_event(
    pool: &PgPool,
    ctx: &RequestCtx,
    actor_id: &str,
    entity_id: Option<&str>,
    kind: &str,
    payload: serde_json::Value,
) {
    let res = sqlx::query(
        "insert into events (entity_id, actor_id, kind, payload, request_id, trace_id) \
         values ($1, $2, $3, $4, $5, $6)",
    )
    .bind(entity_id)
    .bind(actor_id)
    .bind(kind)
    .bind(payload)
    .bind(&ctx.request_id)
    .bind(&ctx.trace_id)
    .execute(pool)
    .await;

    if let Err(e) = res {
        tracing::warn!(error = %e, request_id = %ctx.request_id, kind, "event insert failed");
    }
}
