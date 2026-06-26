//! G3 — registry-native omnisearch. ONE reach-filtered full-text search over EVERY type for free (every
//! object is a row in one store). `GET /api/search?q=<text>[&type=<type>][&limit=N]`: matches the
//! `entity_data.search_vector` (a GIN tsvector over the string values of `data`), ranks by `ts_rank`, and —
//! like every read — returns only entities the caller can reach. So search isn't bolted onto one screen;
//! it's a property of the registry the whole app inherits. (docs/OBJECTS.md G3, CASE 0008 B3.)

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use crate::caller::Caller;
use crate::error::{AppError, AppResult};
use crate::rbac;
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/search", get(search))
}

#[derive(Deserialize)]
struct SearchQ {
    q: Option<String>,
    #[serde(rename = "type")]
    type_id: Option<String>,
    limit: Option<i64>,
}

/// The select shared by both branches; `$1` = the query text, `$2` = the optional type filter. A `title`
/// is best-effort from the common naming fields so a result is human-recognizable without a second fetch.
const SELECT: &str = "select d.entity_id, d.type_id, ts_rank(d.search_vector, query) as rank, \
     coalesce(d.data->>'title', d.data->>'name', d.data->>'display_name', d.entity_id) as title \
     from entity_data d, websearch_to_tsquery('english', $1) query \
     where d.search_vector @@ query and ($2::text is null or d.type_id = $2)";

async fn search(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Query(qp): Query<SearchQ>,
) -> AppResult<Response> {
    let q = qp.q.unwrap_or_default();
    if q.trim().is_empty() {
        return Err(AppError::bad_request("the `q` query param is required")
            .with_request_id(ctx.request_id.clone()));
    }
    let limit = qp.limit.unwrap_or(20).clamp(1, 100);
    let type_filter = qp.type_id.as_deref();

    // Reach-filtered like every other read: a platform-admin sees all; everyone else is constrained to the
    // entities they can reach (any type), so search can never surface something they couldn't already see.
    let rows = if caller.is_platform_admin {
        sqlx::query(&format!("{SELECT} order by rank desc limit $3"))
            .bind(&q)
            .bind(type_filter)
            .bind(limit)
            .fetch_all(&st.pool)
            .await?
    } else {
        let reach = rbac::reachable_entity_ids_any(&st.pool, &caller.actor_id).await?;
        sqlx::query(&format!(
            "{SELECT} and d.entity_id = any($3) order by rank desc limit $4"
        ))
        .bind(&q)
        .bind(type_filter)
        .bind(&reach)
        .bind(limit)
        .fetch_all(&st.pool)
        .await?
    };

    let mut results = Vec::with_capacity(rows.len());
    for r in &rows {
        results.push(json!({
            "entity_id": r.try_get::<String, _>("entity_id")?,
            "type": r.try_get::<String, _>("type_id")?,
            "title": r.try_get::<String, _>("title")?,
            "rank": r.try_get::<f32, _>("rank")?,
        }));
    }
    Ok(Json(json!({ "query": q, "results": results })).into_response())
}
