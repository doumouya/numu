//! The conversation feed (README §3 Bucket 2). D-CNV: a conversation IS a project (PRJ) that has a feed.
//! `GET /api/conversations/:id/feed?lens=<all|customer|mine>` is a reach + visibility-filtered, time-ordered
//! read over the PRJ's child artifacts (file/chart/dashboard/message) UNION its `events`. The lens is a
//! WHERE on the existing `visibility` plane, so it's leak-free by reuse. The one genuinely new read.

use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::caller::{self, Action, Caller};
use crate::error::{AppError, AppResult};
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/conversations/:id/feed", get(feed))
}

#[derive(Deserialize, Default)]
struct FeedParams {
    lens: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn feed(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(id): Path<String>,
    Query(q): Query<FeedParams>,
) -> AppResult<Response> {
    // The conversation is a project; View-reach on it gates the whole feed (leak-free 404). A caller who
    // reaches the PRJ reaches its scope-children, so one gate covers the timeline.
    if !caller::reach_action(&st, &caller, &id, Action::View).await? {
        return Err(AppError::not_found().with_request_id(ctx.request_id.clone()));
    }
    let lens = match q.lens.as_deref().unwrap_or("all") {
        l @ ("all" | "customer" | "mine") => l,
        _ => {
            return Err(AppError::bad_request("lens must be all|customer|mine")
                .with_request_id(ctx.request_id.clone()))
        }
    };
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);

    // One read: child artifacts UNION events, lens-filtered, newest-first, paginated — all in SQL so no
    // timestamptz crosses into Rust (we select `at::text` for the wire and order by the raw column).
    let rows = sqlx::query(
        "select id, kind, at_str, visibility, author, payload from ( \
           select e.id as id, ed.type_id as kind, e.created_at as at, e.created_at::text as at_str, \
                  coalesce(ed.data->>'visibility', 'public') as visibility, \
                  coalesce(ed.data->>'author_id', e.created_by) as author, ed.data as payload \
             from entity_data ed join entities e on e.id = ed.entity_id \
            where ed.scope_parent_id = $1 and ed.type_id in ('file','chart','dashboard','message') \
           union all \
           select 'EVT_' || ev.id::text as id, 'event' as kind, ev.at as at, ev.at::text as at_str, \
                  'public' as visibility, ev.actor_id as author, \
                  jsonb_build_object('event', ev.kind, 'payload', ev.payload) as payload \
             from events ev \
            where ev.entity_id = $1 \
               or ev.entity_id in (select entity_id from entity_data where scope_parent_id = $1) \
         ) feed \
         where ($2 = 'all') \
            or ($2 = 'customer' and visibility <> 'internal') \
            or ($2 = 'mine' and author = $3) \
         order by at desc \
         limit $4 offset $5",
    )
    .bind(&id)
    .bind(lens)
    .bind(&caller.actor_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&st.pool)
    .await?;

    let items: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<String, _>("id"),
                "kind": r.get::<String, _>("kind"),
                "at": r.get::<String, _>("at_str"),
                "visibility": r.get::<String, _>("visibility"),
                "author": r.get::<Option<String>, _>("author"),
                "data": r.get::<Value, _>("payload"),
            })
        })
        .collect();

    Ok(Json(json!({
        "conversation": id,
        "lens": lens,
        "items": items,
        "limit": limit,
        "offset": offset,
    }))
    .into_response())
}
