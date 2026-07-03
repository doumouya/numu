//! Object sharing — the `/api/objects/:type/:id/members` surface (slice C). ONE reach-aware
//! membership-management surface for every object (the O(1) "one Membership = N SF objects" win), with the
//! SEV-0 guards: reach-aware manage authority (admin+), no privilege escalation (can't grant above your
//! own rank), the last-owner guard, self-leave, the team-nesting cycle guard, leak-free denials, and an
//! audit event on every grant/revoke/change. `context_role` is a cosmetic label, never read by a gate.
//! (docs/api/HTTP.md §4, CASE 0005.) Handlers receive the `Caller` from the session extractor (auth.rs
//! `FromRequestParts`); the caller-authority guards are enforced per function (require_rank), the data
//! invariants proven via HTTP tests.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Extension, Json, Router};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::caller::Caller;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::objects;
use crate::rbac;
use crate::request_id::RequestCtx;
use crate::state::AppState;

const MANAGE_RANK: i32 = 3; // admin+ may manage a roster

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/:type/:id/members", get(list_members).post(add_member))
        .route(
            "/:type/:id/members/:member_id",
            patch(set_member).delete(remove_member),
        )
        .route("/:type/:id/checks/:name", post(record_check))
}

/// POST /:type/:id/checks/:name {passed, note?} — record a case close-precondition (G4.2). Manage
/// authority (admin+); only cases have close-checks.
async fn record_check(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id, name)): Path<(String, String, String)>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> AppResult<Response> {
    if type_id != "case" {
        return Err(deny_404(&ctx)); // close-checks only apply to cases
    }
    ensure_object(&st.pool, &id, &type_id, &ctx).await?;
    require_rank(&st.pool, &caller, &id, MANAGE_RANK, &ctx).await?;
    let v = crate::objects::read_json(&headers, &body, false)?;
    let passed = v.get("passed").and_then(|x| x.as_bool()).unwrap_or(false);
    let note = v.get("note").and_then(|x| x.as_str());
    sqlx::query(
        "insert into case_close_checks (case_id, check_name, passed, note) values ($1, $2, $3, $4) \
         on conflict (case_id, check_name) do update set passed = excluded.passed, note = excluded.note, at = now()",
    )
    .bind(&id)
    .bind(&name)
    .bind(passed)
    .bind(note)
    .execute(&st.pool)
    .await?;
    crate::db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("case.check_{name}"),
        serde_json::json!({ "check": name, "passed": passed }),
    )
    .await;
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "check": name, "passed": passed })),
    )
        .into_response())
}

fn deny_404(ctx: &RequestCtx) -> AppError {
    AppError::not_found().with_request_id(ctx.request_id.clone())
}

/// The object must exist (404 if not — leak-free, same status as no-reach).
async fn ensure_object(pool: &PgPool, id: &str, type_id: &str, ctx: &RequestCtx) -> AppResult<()> {
    let hit: Option<i32> =
        sqlx::query_scalar("select 1 from entity_data where entity_id = $1 and type_id = $2")
            .bind(id)
            .bind(type_id)
            .fetch_optional(pool)
            .await?;
    if hit.is_none() {
        return Err(deny_404(ctx));
    }
    Ok(())
}

/// Reach gate returning the caller's effective rank: platform-admin bypasses; no reach → 404 (leak-free);
/// reach below `min_rank` → 403 (existence already admitted). The single authority check for the roster.
async fn require_rank(
    pool: &PgPool,
    caller: &Caller,
    object_id: &str,
    min_rank: i32,
    ctx: &RequestCtx,
) -> AppResult<i32> {
    if caller.is_platform_admin {
        return Ok(i32::MAX);
    }
    match rbac::effective_rank(pool, &caller.actor_id, object_id).await? {
        None => Err(deny_404(ctx)),
        Some(r) if r < min_rank => {
            Err(AppError::forbidden().with_request_id(ctx.request_id.clone()))
        }
        Some(r) => Ok(r),
    }
}

async fn current_role(
    pool: &PgPool,
    object_id: &str,
    member_id: &str,
) -> AppResult<Option<String>> {
    let role: Option<String> =
        sqlx::query_scalar("select role from memberships where object_id = $1 and member_id = $2")
            .bind(object_id)
            .bind(member_id)
            .fetch_optional(pool)
            .await?;
    Ok(role)
}

async fn owner_count(pool: &PgPool, object_id: &str) -> AppResult<i64> {
    let n: i64 = sqlx::query_scalar(
        "select count(*) from memberships where object_id = $1 and role = 'owner'",
    )
    .bind(object_id)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

fn str_field<'a>(v: &'a Value, key: &str, ctx: &RequestCtx) -> AppResult<&'a str> {
    v.get(key).and_then(|x| x.as_str()).ok_or_else(|| {
        AppError::bad_request(format!("{key} is required")).with_request_id(ctx.request_id.clone())
    })
}

/// GET — the roster (any caller with View reach on the object).
async fn list_members(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
) -> AppResult<Response> {
    ensure_object(&st.pool, &id, &type_id, &ctx).await?;
    require_rank(&st.pool, &caller, &id, 1, &ctx).await?;
    let rows = sqlx::query(
        "select member_id, role, context_role from memberships where object_id = $1 order by role desc, member_id",
    )
    .bind(&id)
    .fetch_all(&st.pool)
    .await?;
    let members: Vec<Value> = rows
        .iter()
        .map(|r| -> AppResult<Value> {
            Ok(json!({
                "member_id": r.try_get::<String, _>("member_id")?,
                "role": r.try_get::<String, _>("role")?,
                "context_role": r.try_get::<String, _>("context_role")?,
            }))
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(Json(json!({ "members": members })).into_response())
}

/// POST — grant a role (manage authority + no escalation + cycle guard).
async fn add_member(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    ensure_object(&st.pool, &id, &type_id, &ctx).await?;
    let caller_rank = require_rank(&st.pool, &caller, &id, MANAGE_RANK, &ctx).await?;

    let v = objects::read_json(&headers, &body, false)?;
    let member_id = str_field(&v, "member_id", &ctx)?;
    let role = str_field(&v, "role", &ctx)?;
    let context_role = v.get("context_role").and_then(|x| x.as_str()).unwrap_or("");

    // No privilege escalation: you cannot grant a role above your own (subsumes only-owner-grants-owner).
    let target_rank = rbac::rank_of(&st.pool, role).await?.ok_or_else(|| {
        AppError::unprocessable("unknown role").with_request_id(ctx.request_id.clone())
    })?;
    if target_rank > caller_rank {
        return Err(AppError::forbidden().with_request_id(ctx.request_id.clone()));
    }
    // Team-nesting cycle: granting member a role ON object closes a cycle iff member already contains the
    // object (object ∈ would-be descendants) — i.e. member ∈ principals(object).
    if rbac::principals_contain(&st.pool, &id, member_id).await? {
        return Err(AppError::conflict(
            "granting this member here would create a membership cycle",
        )
        .with_request_id(ctx.request_id.clone()));
    }

    sqlx::query(
        "insert into memberships (object_id, member_id, role, context_role) values ($1, $2, $3, $4) \
         on conflict (object_id, member_id) do update set role = excluded.role, context_role = excluded.context_role",
    )
    .bind(&id)
    .bind(member_id)
    .bind(role)
    .bind(context_role)
    .execute(&st.pool)
    .await?;

    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.member_granted"),
        json!({ "member_id": member_id, "role": role }),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "member_id": member_id, "role": role, "context_role": context_role })),
    )
        .into_response())
}

/// PATCH — change a member's role (manage authority + no escalation + last-owner guard).
async fn set_member(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id, member_id)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    ensure_object(&st.pool, &id, &type_id, &ctx).await?;
    let caller_rank = require_rank(&st.pool, &caller, &id, MANAGE_RANK, &ctx).await?;

    let v = objects::read_json(&headers, &body, false)?;
    let role = str_field(&v, "role", &ctx)?;
    let context_role = v.get("context_role").and_then(|x| x.as_str());

    let target_rank = rbac::rank_of(&st.pool, role).await?.ok_or_else(|| {
        AppError::unprocessable("unknown role").with_request_id(ctx.request_id.clone())
    })?;
    if target_rank > caller_rank {
        return Err(AppError::forbidden().with_request_id(ctx.request_id.clone()));
    }
    let current = current_role(&st.pool, &id, &member_id)
        .await?
        .ok_or_else(|| deny_404(&ctx))?;
    // Last-owner guard: demoting the sole owner would orphan the object.
    if current == "owner" && role != "owner" && owner_count(&st.pool, &id).await? <= 1 {
        return Err(AppError::conflict("cannot demote the last owner")
            .with_request_id(ctx.request_id.clone()));
    }

    sqlx::query(
        "update memberships set role = $3, context_role = coalesce($4, context_role) \
         where object_id = $1 and member_id = $2",
    )
    .bind(&id)
    .bind(&member_id)
    .bind(role)
    .bind(context_role)
    .execute(&st.pool)
    .await?;

    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.member_role_changed"),
        json!({ "member_id": member_id, "role": role }),
    )
    .await;
    Ok(Json(json!({ "member_id": member_id, "role": role })).into_response())
}

/// DELETE — revoke (manage authority, OR self-leave; never the last owner).
async fn remove_member(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path((type_id, id, member_id)): Path<(String, String, String)>,
) -> AppResult<Response> {
    ensure_object(&st.pool, &id, &type_id, &ctx).await?;
    let current = current_role(&st.pool, &id, &member_id)
        .await?
        .ok_or_else(|| deny_404(&ctx))?;
    // Self-leave: a member may remove their own edge without manage authority.
    if member_id != caller.actor_id {
        require_rank(&st.pool, &caller, &id, MANAGE_RANK, &ctx).await?;
    }
    // Last-owner guard: even self-leave can't orphan the object.
    if current == "owner" && owner_count(&st.pool, &id).await? <= 1 {
        return Err(AppError::conflict("cannot remove the last owner")
            .with_request_id(ctx.request_id.clone()));
    }

    sqlx::query("delete from memberships where object_id = $1 and member_id = $2")
        .bind(&id)
        .bind(&member_id)
        .execute(&st.pool)
        .await?;

    // When the deferred 60s Caller cache lands (AUTH.md §1), invalidate(member_id) here.
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        &format!("{type_id}.member_revoked"),
        json!({ "member_id": member_id }),
    )
    .await;
    Ok(StatusCode::NO_CONTENT.into_response())
}
