//! conversations — the persistent per-workspace feed (SLICE 2a, CAS_00742b86). The console thread
//! was session-local in HTTP mode (the driver's `feed`/`appendFeed` calls 404'd). A conversation is
//! a `conversation` registry row (migration 0023) scoped to its workspace, so reach follows the
//! workspace: view-rank reads the feed, edit-rank appends; anything else is a leak-free 404. One row
//! per workspace, upserted on write. Blocks are stored verbatim — the same vocabulary the sim
//! persists (SEAM.md §nacl result).
//!
//! `GET  /api/conversations/:key/feed` → the stored blocks (or `[]`).
//! `POST /api/conversations/:key/feed` `{blocks[]}` (append) | `{blocks[], replace:true}` (replace).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::caller::Caller;
use crate::error::AppResult;
use crate::rbac;
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/conversations/:key/feed",
        get(get_feed).post(post_feed),
    )
}

/// The feed key is a workspace (ORG) id — the caller must reach it at `floor` (1 view · 2 edit),
/// else a leak-free 404. Platform admin bypasses (Plane A). Returns nothing; the caller proceeds.
async fn require_workspace_reach(
    st: &AppState,
    caller: &Caller,
    key: &str,
    floor: i32,
    ctx: &RequestCtx,
) -> AppResult<()> {
    if caller.is_platform_admin {
        return Ok(());
    }
    let rank = rbac::effective_rank(&st.pool, &caller.actor_id, key).await?;
    if rank.unwrap_or(0) >= floor {
        Ok(())
    } else {
        Err(crate::error::AppError::not_found().with_request_id(ctx.request_id.clone()))
    }
}

/// The conversation row's (entity_id, blocks) for a workspace, if one exists.
async fn find_conversation(st: &AppState, key: &str) -> AppResult<Option<(String, Value)>> {
    let row: Option<(String, Value)> = sqlx::query_as(
        "select entity_id, coalesce(data->'blocks', '[]'::jsonb) \
         from entity_data where type_id = 'conversation' and data->>'workspace_id' = $1 limit 1",
    )
    .bind(key)
    .fetch_optional(&st.pool)
    .await?;
    Ok(row)
}

async fn get_feed(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(key): Path<String>,
) -> AppResult<Response> {
    Ok(Json(get_feed_core(&st, &ctx, &caller, &key).await?).into_response())
}

/// The testable core of the GET: the stored blocks (or `[]`) once the caller's view-reach on the
/// workspace is proven (leak-free 404 otherwise).
pub async fn get_feed_core(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    key: &str,
) -> AppResult<Value> {
    require_workspace_reach(st, caller, key, 1, ctx).await?;
    Ok(find_conversation(st, key)
        .await?
        .map(|(_, b)| b)
        .unwrap_or_else(|| json!([])))
}

#[derive(Deserialize)]
struct FeedBody {
    #[serde(default)]
    blocks: Vec<Value>,
    #[serde(default)]
    replace: bool,
}

async fn post_feed(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(key): Path<String>,
    Json(body): Json<FeedBody>,
) -> AppResult<Response> {
    post_feed_core(&st, &ctx, &caller, &key, body.blocks, body.replace).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "ok": true }))).into_response())
}

/// The testable core of the POST: append (or replace) the workspace's feed once edit-reach is
/// proven. First write mints the `conversation` via the gated create path (scope→workspace, owner
/// grant, event); later writes patch `blocks` in place.
pub async fn post_feed_core(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    key: &str,
    blocks: Vec<Value>,
    replace: bool,
) -> AppResult<()> {
    require_workspace_reach(st, caller, key, 2, ctx).await?;

    let existing = find_conversation(st, key).await?;
    let next: Vec<Value> = match &existing {
        Some((_, prior)) if !replace => {
            let mut cur = prior.as_array().cloned().unwrap_or_default();
            cur.extend(blocks);
            cur
        }
        _ => blocks,
    };

    match existing {
        Some((id, _)) => {
            sqlx::query(
                "update entity_data set data = jsonb_set(data, '{blocks}', $2), updated_at = now() \
                 where entity_id = $1",
            )
            .bind(&id)
            .bind(Value::Array(next))
            .execute(&st.pool)
            .await?;
        }
        None => {
            let reg = st.registry.load_full();
            let td = reg.get("conversation").ok_or_else(|| {
                crate::error::AppError::not_found().with_request_id(ctx.request_id.clone())
            })?;
            let payload = json!({ "workspace_id": key, "blocks": next });
            crate::objects::create_object(st, ctx, caller, td, &payload).await?;
        }
    }
    Ok(())
}
