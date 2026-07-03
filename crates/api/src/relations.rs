//! G2 — the `relation` surface: the one generic, typed entity↔entity edge. `POST /api/relations` (create),
//! `GET /api/relations?entity=<id>` (list edges touching an entity), `DELETE /api/relations/:id`. RBAC
//! mirrors the doc: an edge is **readable iff the caller reaches BOTH endpoints** (so it never leaks an
//! entity they couldn't already see), and **writable iff they can edit the subject**. The `relation_type`
//! is a registered vocab (unknown → 422); the DB's unique triple backstops duplicates (→ 409, via the
//! 23505 mapping). (docs/api/OBJECTS.md G2, docs/cases/0008-backend-completion.md.)

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::caller::{self, Action, Caller};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::ids;
use crate::rbac;
use crate::request_id::RequestCtx;
use crate::state::AppState;

/// The registered relation vocabulary — one typed edge family instead of a junction per pair.
const RELATION_TYPES: &[&str] = &[
    "relates-to",
    "duplicates",
    "blocks",
    "references",
    "article-of",
    "parent-of",
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/relations", post(create_relation).get(list_relations))
        .route("/api/relations/:id", delete(delete_relation))
}

#[derive(Deserialize)]
struct RelInput {
    subject_id: String,
    object_id: String,
    relation_type: String,
}

#[derive(Deserialize)]
struct ListQ {
    entity: Option<String>,
    #[serde(rename = "type")]
    relation_type: Option<String>,
}

fn deny_404(ctx: &RequestCtx) -> AppError {
    AppError::not_found().with_request_id(ctx.request_id.clone())
}

fn relation_json(r: &sqlx::postgres::PgRow) -> AppResult<Value> {
    Ok(json!({
        "id": r.try_get::<String, _>("id")?,
        "subject_id": r.try_get::<String, _>("subject_id")?,
        "object_id": r.try_get::<String, _>("object_id")?,
        "relation_type": r.try_get::<String, _>("relation_type")?,
        "created_by": r.try_get::<Option<String>, _>("created_by")?,
        "created_at": r.try_get::<Option<String>, _>("created_at")?,
    }))
}

const SELECT_COLS: &str =
    "id, subject_id, object_id, relation_type, created_by, created_at::text as created_at";

async fn create_relation(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    body: Bytes,
) -> AppResult<Response> {
    let input: RelInput = serde_json::from_slice(&body).map_err(|e| {
        AppError::bad_request(format!("invalid relation: {e}"))
            .with_request_id(ctx.request_id.clone())
    })?;
    if !RELATION_TYPES.contains(&input.relation_type.as_str()) {
        return Err(AppError::unprocessable(format!(
            "unknown relation_type '{}' (one of: {})",
            input.relation_type,
            RELATION_TYPES.join(", ")
        ))
        .with_request_id(ctx.request_id.clone()));
    }
    if input.subject_id == input.object_id {
        return Err(
            AppError::unprocessable("a relation cannot link an entity to itself")
                .with_request_id(ctx.request_id.clone()),
        );
    }
    // write = edit the subject AND at least VIEW the object. The object gate is load-bearing: without it the
    // create's status codes (201/409 on a real id vs the FK's 422 on a missing one) would be an existence
    // oracle over entities the caller can't reach. Both denials collapse to the same leak-free 404.
    if !caller::reach_action(&st, &caller, &input.subject_id, Action::Edit).await?
        || !caller::reach_action(&st, &caller, &input.object_id, Action::View).await?
    {
        return Err(deny_404(&ctx));
    }

    let id = ids::mint("REL");
    // a bad object_id → FK 23503 → 422; a duplicate edge → unique 23505 → 409 (both mapped in error.rs).
    sqlx::query(
        "insert into relations (id, subject_id, object_id, relation_type, created_by) \
         values ($1, $2, $3, $4, $5)",
    )
    .bind(id.as_str())
    .bind(input.subject_id.as_str())
    .bind(input.object_id.as_str())
    .bind(input.relation_type.as_str())
    .bind(caller.actor_id.as_str())
    .execute(&st.pool)
    .await?;

    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&input.subject_id),
        "relation.created",
        json!({ "id": id, "object_id": input.object_id, "relation_type": input.relation_type }),
    )
    .await;

    let row = sqlx::query(&format!(
        "select {SELECT_COLS} from relations where id = $1"
    ))
    .bind(id.as_str())
    .fetch_one(&st.pool)
    .await?;
    Ok((StatusCode::CREATED, Json(relation_json(&row)?)).into_response())
}

async fn list_relations(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Query(q): Query<ListQ>,
) -> AppResult<Response> {
    let entity = q.entity.ok_or_else(|| {
        AppError::bad_request("the `entity` query param is required")
            .with_request_id(ctx.request_id.clone())
    })?;
    // you must be able to view the anchor entity to enumerate its edges.
    if !caller::reach_action(&st, &caller, &entity, Action::View).await? {
        return Err(deny_404(&ctx));
    }
    let rows = sqlx::query(&format!(
        "select {SELECT_COLS} from relations \
         where (subject_id = $1 or object_id = $1) and ($2::text is null or relation_type = $2) \
         order by created_at desc",
    ))
    .bind(entity.as_str())
    .bind(q.relation_type.as_deref())
    .fetch_all(&st.pool)
    .await?;

    // leak guard: only return an edge whose OTHER endpoint the caller can also reach. Resolve the caller's
    // cross-type reach set ONCE (a single recursive CTE) rather than one per row, then test each opposite
    // endpoint with a set lookup — `reachable_entity_ids_any` is the down-cascade dual of the per-object
    // `effective_rank` up-climb, so membership is equivalent to View reach.
    let reachable: Option<std::collections::HashSet<String>> = if caller.is_platform_admin {
        None
    } else {
        Some(
            rbac::reachable_entity_ids_any(&st.pool, &caller.actor_id)
                .await?
                .into_iter()
                .collect(),
        )
    };
    let mut out = Vec::new();
    for r in &rows {
        let subject: String = r.try_get("subject_id")?;
        let object: String = r.try_get("object_id")?;
        let other = if subject == entity { &object } else { &subject };
        let visible = match &reachable {
            None => true,
            Some(set) => set.contains(other),
        };
        if visible {
            out.push(relation_json(r)?);
        }
    }
    Ok(Json(json!({ "relations": out })).into_response())
}

async fn delete_relation(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let subject: Option<String> =
        sqlx::query_scalar("select subject_id from relations where id = $1")
            .bind(id.as_str())
            .fetch_optional(&st.pool)
            .await?;
    let Some(subject) = subject else {
        return Err(deny_404(&ctx));
    };
    // delete = edit the subject (same authority that created it).
    if !caller::reach_action(&st, &caller, &subject, Action::Edit).await? {
        return Err(deny_404(&ctx));
    }
    sqlx::query("delete from relations where id = $1")
        .bind(id.as_str())
        .execute(&st.pool)
        .await?;
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&subject),
        "relation.deleted",
        json!({ "id": id }),
    )
    .await;
    Ok(StatusCode::NO_CONTENT.into_response())
}
