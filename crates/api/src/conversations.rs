//! conversations — the persistent per-workspace feed (SLICE 2a, CAS_00742b86). The console thread
//! was session-local in HTTP mode (the driver's `feed`/`appendFeed` calls 404'd). A conversation is
//! a `conversation` registry row (migration 0023) scoped to its workspace. Authority runs BOTH planes,
//! like the object surface: Plane C (the acting surface's confinement — conversations are gated as the
//! `conversation` type; console default-allow, app/agent needs a capability grant) THEN the workspace
//! reach (View reads · Edit appends; platform-admin bypasses Plane A). Any refusal is the same leak-free
//! 404. One row per workspace (unique index, migration 0024); writes are atomic (append = jsonb concat,
//! replace = set) so concurrent appends can't lose blocks. Blocks are stored verbatim — the same
//! vocabulary the sim persists (SEAM.md §nacl result).
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

use crate::caller::{self, Action, Caller};
use crate::error::{AppError, AppResult};
use crate::rbac;

/// The accumulated per-workspace feed cap (DoS backstop, CAS_57309651). The per-request body limit
/// bounds one append; this bounds the total the feed can grow to across appends.
const MAX_FEED_BYTES: usize = 512 * 1024;
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/conversations/:key/feed",
        get(get_feed).post(post_feed),
    )
}

/// The feed key is a workspace (ORG) id. Authority runs BOTH planes exactly as the object surface does,
/// so a confined app/agent can't reach the feed just because it holds a workspace membership:
/// **Plane C** first (the acting surface's confinement, keyed on the `conversation` type — console is
/// default-allow, an app/agent is admitted only by a matching capability grant), THEN the workspace
/// **reach** (`Action::View` floor 1 reads · `Action::Edit` floor 2 appends; platform-admin bypasses
/// Plane A). Any refusal — Plane C or reach — is the SAME leak-free 404.
async fn require_workspace_reach(
    st: &AppState,
    caller: &Caller,
    key: &str,
    action: Action,
    ctx: &RequestCtx,
) -> AppResult<()> {
    let deny = || crate::error::AppError::not_found().with_request_id(ctx.request_id.clone());
    // Plane C precedes the admin bypass — surface confinement is orthogonal to the principal's power.
    if !caller::plane_c_admit_type(&st.pool, caller, "conversation", action).await? {
        return Err(deny());
    }
    if caller.is_platform_admin {
        return Ok(());
    }
    let floor = match action {
        Action::View => 1,
        _ => 2,
    };
    let rank = rbac::effective_rank(&st.pool, &caller.actor_id, key).await?;
    if rank.unwrap_or(0) >= floor {
        Ok(())
    } else {
        Err(deny())
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
    require_workspace_reach(st, caller, key, Action::View, ctx).await?;
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

/// The testable core of the POST: append (or replace) the workspace's feed once edit-reach is proven.
/// The write is ATOMIC — one UPDATE (append = jsonb concat, replace = set), no read-modify-write
/// window, so overlapping appends can't lose blocks. The first write for a workspace mints the
/// `conversation` via the gated create path (scope→workspace, owner grant, event); if a concurrent
/// first-write beat us (the one-per-workspace unique index → a 409 conflict), we retry as an atomic
/// apply against the row that now exists.
pub async fn post_feed_core(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    key: &str,
    blocks: Vec<Value>,
    replace: bool,
) -> AppResult<()> {
    require_workspace_reach(st, caller, key, Action::Edit, ctx).await?;
    let arr = Value::Array(blocks);

    // DoS backstop: the feed ACCUMULATES across appends, so cap the stored total (the per-request body
    // limit only bounds one append). The pre-read races benignly — landing slightly over the cap is
    // fine for a coarse resource guard.
    let incoming = serde_json::to_vec(&arr).map(|v| v.len()).unwrap_or(0);
    if incoming > MAX_FEED_BYTES {
        return Err(
            AppError::payload_too_large("feed blocks exceed the per-request limit")
                .with_request_id(ctx.request_id.clone()),
        );
    }
    if !replace {
        let current: Option<i64> = sqlx::query_scalar(
            "select octet_length(coalesce(data->>'blocks', ''))::bigint \
             from entity_data where type_id = 'conversation' and data->>'workspace_id' = $1",
        )
        .bind(key)
        .fetch_optional(&st.pool)
        .await?
        .flatten();
        if current.unwrap_or(0) as usize + incoming > MAX_FEED_BYTES {
            return Err(AppError::payload_too_large(
                "conversation feed is full — start a new thread",
            )
            .with_request_id(ctx.request_id.clone()));
        }
    }

    if apply_blocks(st, key, &arr, replace).await? > 0 {
        return Ok(());
    }
    match mint_conversation(st, ctx, caller, key, &arr).await {
        Ok(()) => Ok(()),
        // a concurrent first-write won the race (23505 on the unique index) → apply ours atomically.
        Err(e) if e.status == StatusCode::CONFLICT => {
            apply_blocks(st, key, &arr, replace).await?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Atomically set (replace) or append (jsonb concat) the workspace feed's blocks in ONE statement.
/// Returns the rows touched (0 when no conversation exists yet). The one-row-per-workspace invariant
/// is a partial unique index (migration 0024), so this touches at most one row.
async fn apply_blocks(st: &AppState, key: &str, arr: &Value, replace: bool) -> AppResult<u64> {
    let sql = if replace {
        "update entity_data set data = jsonb_set(data, '{blocks}', $2, true), updated_at = now() \
         where type_id = 'conversation' and data->>'workspace_id' = $1"
    } else {
        "update entity_data set data = jsonb_set(data, '{blocks}', \
         coalesce(data->'blocks', '[]'::jsonb) || $2, true), updated_at = now() \
         where type_id = 'conversation' and data->>'workspace_id' = $1"
    };
    Ok(sqlx::query(sql)
        .bind(key)
        .bind(arr)
        .execute(&st.pool)
        .await?
        .rows_affected())
}

/// Mint the workspace's conversation through the gated create path (validate → Plane C/A gate →
/// insert + owner edge + event), seeded with the initial `blocks`.
async fn mint_conversation(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    key: &str,
    arr: &Value,
) -> AppResult<()> {
    let reg = st.registry.load_full();
    let td = reg.get("conversation").ok_or_else(|| {
        crate::error::AppError::not_found().with_request_id(ctx.request_id.clone())
    })?;
    let payload = json!({ "workspace_id": key, "blocks": arr });
    crate::objects::create_object(st, ctx, caller, td, &payload).await?;
    Ok(())
}
