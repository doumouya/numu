//! A2 — sessions + the `Caller` extractor. Every object/member handler takes `caller: Caller`; this
//! extractor resolves it from the `numu_session` cookie (an opaque token; only its sha256 is stored), or
//! returns `401` (never a dev fallback). v0 resolves per request (no cache → no staleness, so a revoked
//! membership takes effect immediately); the 60s cache is a documented perf follow-on that must invalidate
//! on revoke when added. dev-login (debug only) + the atomic claim-admin are the bootstrap escape hatches.
//! (plan slice A2.)

use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::caller::Caller;
use crate::error::{AppError, AppResult};
use crate::ids;
use crate::state::AppState;

const SESSION_COOKIE: &str = "numu_session";
/// `Secure` only in release — dev (http://localhost) must keep the cookie. cfg-flip, not an env var.
const SECURE: &str = if cfg!(debug_assertions) {
    ""
} else {
    "; Secure"
};

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn cookie_token(header_value: &str) -> Option<String> {
    header_value
        .split(';')
        .map(str::trim)
        .find_map(|kv| kv.strip_prefix(&format!("{SESSION_COOKIE}=")))
        .map(str::to_string)
}

/// Mint a 256-bit opaque token, store its hash, return the `Set-Cookie` value.
async fn mint_session(pool: &PgPool, actor_id: &str) -> AppResult<String> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = sha256_hex(&token);
    let sid = ids::mint("SES");
    sqlx::query(
        "insert into sessions (id, actor_id, token_hash, expires_at) \
         values ($1, $2, $3, now() + interval '30 days')",
    )
    .bind(&sid)
    .bind(actor_id)
    .bind(&hash)
    .execute(pool)
    .await?;
    Ok(format!(
        "{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000{SECURE}"
    ))
}

#[axum::async_trait]
impl FromRequestParts<AppState> for Caller {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(cookie_token)
            .ok_or_else(AppError::unauthorized)?;
        let hash = sha256_hex(&token);
        let row = sqlx::query(
            "select s.actor_id, d.data->>'platform_role' as prole \
             from sessions s join entity_data d on d.entity_id = s.actor_id and d.type_id = 'actor' \
             where s.token_hash = $1 and s.expires_at > now()",
        )
        .bind(&hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(AppError::unauthorized)?;
        let actor_id: String = row.try_get("actor_id")?;
        let prole: Option<String> = row.try_get("prole")?;
        Ok(Caller {
            actor_id,
            is_platform_admin: prole.as_deref() == Some("admin"),
        })
    }
}

pub fn router() -> Router<AppState> {
    let r = Router::new()
        .route("/auth/claim-admin", post(claim_admin))
        .route("/auth/logout", post(logout));
    #[cfg(debug_assertions)]
    let r = r.route("/auth/dev-login", post(dev_login));
    r
}

#[derive(Deserialize)]
struct DevLogin {
    actor_id: Option<String>,
}

/// Debug-only escape hatch: mint a session for an existing actor (default the seeded `USR_dev` admin).
/// Compiled OUT of release builds — there is no dev-login in production.
#[cfg(debug_assertions)]
async fn dev_login(
    State(st): State<AppState>,
    body: Option<Json<DevLogin>>,
) -> AppResult<Response> {
    let actor_id = body
        .and_then(|b| b.0.actor_id)
        .unwrap_or_else(|| "USR_dev".to_string());
    let exists: Option<i32> =
        sqlx::query_scalar("select 1 from entity_data where entity_id = $1 and type_id = 'actor'")
            .bind(&actor_id)
            .fetch_optional(&st.pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::not_found());
    }
    let cookie = mint_session(&st.pool, &actor_id).await?;
    Ok((
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "actor_id": actor_id })),
    )
        .into_response())
}

/// Atomic first-admin claim: promote the caller's actor to platform-admin IFF no real admin exists yet
/// (the seeded `USR_dev` bootstrap is excluded). A single race-free UPDATE; a second claim → 409.
async fn claim_admin(State(st): State<AppState>, caller: Caller) -> AppResult<Response> {
    let res = sqlx::query(
        "update entity_data set data = jsonb_set(data, '{platform_role}', '\"admin\"'::jsonb) \
         where entity_id = $1 and type_id = 'actor' \
           and not exists ( \
             select 1 from entity_data \
             where type_id = 'actor' and entity_id <> 'USR_dev' and data->>'platform_role' = 'admin')",
    )
    .bind(&caller.actor_id)
    .execute(&st.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::conflict("an admin already exists"));
    }
    Ok((
        StatusCode::OK,
        Json(json!({ "actor_id": caller.actor_id, "platform_role": "admin" })),
    )
        .into_response())
}

/// Drop the caller's sessions and clear the cookie.
async fn logout(State(st): State<AppState>, caller: Caller) -> AppResult<Response> {
    sqlx::query("delete from sessions where actor_id = $1")
        .bind(&caller.actor_id)
        .execute(&st.pool)
        .await?;
    let cleared = format!("{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{SECURE}");
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, cleared)]).into_response())
}
