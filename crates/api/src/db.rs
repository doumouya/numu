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

/// "No object without an owner" — stamp the creator as `owner` in the SAME txn as create. UPSERT on the
/// `(object_id, member_id)` key (narrowed in migration 0003) so a re-grant replaces rather than stacking a
/// second role row. Wired into `coll_create` in slice B1; staged here so the owner write is FK- and
/// stack-safe before any handler calls it.
#[allow(dead_code)]
pub async fn grant_owner(
    tx: &mut sqlx::PgConnection,
    object_id: &str,
    member_id: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "insert into memberships (object_id, member_id, role) values ($1, $2, 'owner') \
         on conflict (object_id, member_id) do update set role = excluded.role",
    )
    .bind(object_id)
    .bind(member_id)
    .execute(tx)
    .await?;
    Ok(())
}
