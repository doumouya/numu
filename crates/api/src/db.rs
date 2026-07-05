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

/// What a classified read disclosed — the `access_audit` row's read descriptor (field NAMES only,
/// never values).
pub struct AccessRead<'a> {
    pub type_id: &'a str,
    /// The item read; `None` for a collection read.
    pub entity_id: Option<&'a str>,
    /// `view` (item) | `list` (collection).
    pub action: &'a str,
    pub field_names: &'a [String],
    pub row_count: i32,
}

/// GOVERNANCE #2 — read accountability (0019): one INSERT-ONLY `access_audit` row per read request
/// that returned any `personal|sensitive` field. Field NAMES only, never values (OBSERVABILITY §6
/// rule 6). Same failure posture as `record_event`: warn, never fail the read.
pub async fn record_access(
    pool: &PgPool,
    ctx: &RequestCtx,
    caller: &crate::caller::Caller,
    read: AccessRead<'_>,
) {
    let res = sqlx::query(
        "insert into access_audit \
         (actor_id, surface_kind, surface_id, type_id, entity_id, action, field_names, row_count, purpose, request_id) \
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(&caller.actor_id)
    .bind(caller.surface.kind.as_str())
    .bind(&caller.surface.id)
    .bind(read.type_id)
    .bind(read.entity_id)
    .bind(read.action)
    .bind(read.field_names)
    .bind(read.row_count)
    .bind(caller.purpose.as_deref())
    .bind(&ctx.request_id)
    .execute(pool)
    .await;

    if let Err(e) = res {
        tracing::warn!(error = %e, request_id = %ctx.request_id, "access_audit insert failed");
    }
}

/// "No object without an owner" — stamp the creator as `owner` in the SAME txn as create. UPSERT on the
/// `(object_id, member_id)` key (narrowed in migration 0003) so a re-grant replaces rather than stacking a
/// second role row. Called by `coll_create` in the same txn as the entity insert.
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

/// Sync the typed `cases` projection from a case's `data` (the workflow engine + status index + the
/// cases_guard trigger operate on these typed columns; `entity_data` stays the canonical full record).
pub async fn upsert_case_mirror<'e, E: sqlx::PgExecutor<'e>>(
    exec: E,
    entity_id: &str,
    data: &serde_json::Value,
    version: i32,
) -> sqlx::Result<()> {
    let s = |k: &str| data.get(k).and_then(|v| v.as_str());
    sqlx::query(
        "insert into cases (entity_id, title, status, workflow_id, priority, assignee_id, project_id, version, updated_at) \
         values ($1, $2, $3, $4, $5, $6, $7, $8, now()) \
         on conflict (entity_id) do update set \
           title = excluded.title, status = excluded.status, workflow_id = excluded.workflow_id, \
           priority = excluded.priority, assignee_id = excluded.assignee_id, project_id = excluded.project_id, \
           version = excluded.version, updated_at = now()",
    )
    .bind(entity_id)
    .bind(s("title").unwrap_or(""))
    .bind(s("status").unwrap_or("backlog"))
    .bind(s("workflow_id").unwrap_or("default"))
    .bind(s("priority").unwrap_or("normal"))
    .bind(s("assignee_id"))
    .bind(s("project_id"))
    .bind(version)
    .execute(exec)
    .await?;
    Ok(())
}

/// The close-gate query: of a workflow's `close_checks`, the names that DON'T yet have a `passed=true`
/// `case_close_checks` row for this case. Empty ⇒ the terminal move is allowed.
pub async fn unmet_close_checks(
    pool: &PgPool,
    case_id: &str,
    close_checks: &[String],
) -> sqlx::Result<Vec<String>> {
    let mut unmet = Vec::new();
    for name in close_checks {
        let passed: Option<bool> = sqlx::query_scalar(
            "select passed from case_close_checks where case_id = $1 and check_name = $2",
        )
        .bind(case_id)
        .bind(name)
        .fetch_optional(pool)
        .await?;
        if passed != Some(true) {
            unmet.push(name.clone());
        }
    }
    Ok(unmet)
}
