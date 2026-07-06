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
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::caller::{Caller, Surface, SurfaceKind};
use crate::error::{AppError, AppResult};
use crate::ids;
use crate::state::AppState;

/// `Secure` only in release — dev (http://localhost) must keep the cookie. cfg-flip, not an env var.
const SECURE: &str = if cfg!(debug_assertions) {
    ""
} else {
    "; Secure"
};

/// The session cookie NAME, configurable via `NUMU_SESSION_COOKIE` (default `numu_session`).
/// Why configurable: Firebase Hosting rewrites forward exactly ONE cookie to Cloud Run — one
/// literally named `__session` — so production behind the rewrite sets
/// `NUMU_SESSION_COOKIE=__session` or auth silently breaks (CASE 0021; docs/ops/DEPLOY.md).
/// The OAuth state cookie MULTIPLEXES onto this same name (`st.<signed>` values — oauth.rs)
/// for the same reason.
pub(crate) fn session_cookie_name() -> &'static str {
    use std::sync::OnceLock;
    static NAME: OnceLock<String> = OnceLock::new();
    NAME.get_or_init(|| {
        std::env::var("NUMU_SESSION_COOKIE").unwrap_or_else(|_| "numu_session".to_string())
    })
}

/// Marks an in-flight OAuth state value riding the session cookie (oauth.rs). Session tokens are
/// hex-only, so the prefix can never collide with a real token.
pub(crate) const OAUTH_STATE_PREFIX: &str = "st.";

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn cookie_token(header_value: &str) -> Option<String> {
    header_value
        .split(';')
        .map(str::trim)
        .find_map(|kv| kv.strip_prefix(&format!("{}=", session_cookie_name())))
        // an in-flight OAuth state value is not a session — treat it as absent (401), never query it.
        .filter(|v| !v.starts_with(OAUTH_STATE_PREFIX))
        .map(str::to_string)
}

/// Mint a 256-bit opaque token, store its hash, return the `Set-Cookie` value. Reused by the OAuth flow.
pub(crate) async fn mint_session(pool: &PgPool, actor_id: &str) -> AppResult<String> {
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
        "{}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000{SECURE}",
        session_cookie_name()
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
            "select s.actor_id, d.data->>'platform_role' as prole, d.data->>'kind' as akind \
             from sessions s join entity_data d on d.entity_id = s.actor_id and d.type_id = 'actor' \
             where s.token_hash = $1 and s.expires_at > now()",
        )
        .bind(&hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(AppError::unauthorized)?;
        let actor_id: String = row.try_get("actor_id")?;
        let prole: Option<String> = row.try_get("prole")?;
        let akind: Option<String> = row.try_get("akind")?;

        // The acting surface (Plane C): a human session is the console; an agent/service principal
        // IS its own confined surface (default-deny — only capability grants admit it). App faces
        // tag their surface via the app token when the faces land; a session never claims `app`.
        let surface = match akind.as_deref() {
            Some("agent") | Some("service") => Surface {
                kind: SurfaceKind::Agent,
                id: actor_id.clone(),
            },
            _ => Surface::console(),
        };

        // Declared purpose (X-Numu-Purpose) — binds purpose_limited grants and is recorded by the
        // access audit. Self-declared: it binds, it doesn't prove. Shape-checked only.
        let purpose = parts
            .headers
            .get("x-numu-purpose")
            .and_then(|v| v.to_str().ok())
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 64
                    && s.chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            })
            .map(str::to_string);

        // The strictest max_data_class ceiling across this surface's grant conditions (0018 ∘ 0016)
        // — severity-ordered; shared with Caller::for_service (caller::surface_ceiling).
        let data_class_ceiling = crate::caller::surface_ceiling(&state.pool, &surface).await?;

        Ok(Caller {
            actor_id,
            is_platform_admin: prole.as_deref() == Some("admin"),
            surface,
            purpose,
            data_class_ceiling,
        })
    }
}

pub fn router() -> Router<AppState> {
    let r = Router::new()
        .route("/auth/me", get(me))
        .route("/auth/claim-admin", post(claim_admin))
        .route("/auth/logout", post(logout));
    #[cfg(debug_assertions)]
    let r = r.route("/auth/dev-login", post(dev_login));
    r
}

/// `GET /auth/me` — the session's own identity: what the console chrome renders (name, avatar,
/// role). A self-read of `personal`-classified fields, so it leaves the same access-audit
/// evidence as any classified read (GOVERNANCE #2). Logged out → the extractor's plain 401.
async fn me(
    State(st): State<AppState>,
    Extension(ctx): Extension<crate::request_id::RequestCtx>,
    caller: Caller,
) -> AppResult<Response> {
    let body = me_core(&st.pool, &ctx, &caller).await?;
    Ok(Json(body).into_response())
}

/// The testable core of `/auth/me` (the `*_core` convention — handlers stay thin).
pub async fn me_core(
    pool: &PgPool,
    ctx: &crate::request_id::RequestCtx,
    caller: &Caller,
) -> AppResult<serde_json::Value> {
    let data: Option<serde_json::Value> = sqlx::query_scalar(
        "select data from entity_data where entity_id = $1 and type_id = 'actor'",
    )
    .bind(&caller.actor_id)
    .fetch_optional(pool)
    .await?;
    let data = data.ok_or_else(AppError::unauthorized)?;
    let field_names: Vec<String> = [
        "display_name",
        "handle",
        "email",
        "avatar_url",
        "first_name",
        "last_name",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    crate::db::record_access(
        pool,
        ctx,
        caller,
        crate::db::AccessRead {
            type_id: "actor",
            entity_id: Some(&caller.actor_id),
            action: "view",
            field_names: &field_names,
            row_count: 1,
        },
    )
    .await;
    Ok(json!({
        "actor_id": caller.actor_id,
        "display_name": data.get("display_name").cloned().unwrap_or(serde_json::Value::Null),
        "handle": data.get("handle").cloned().unwrap_or(serde_json::Value::Null),
        "email": data.get("email").cloned().unwrap_or(serde_json::Value::Null),
        "avatar_url": data.get("avatar_url").cloned().unwrap_or(serde_json::Value::Null),
        "first_name": data.get("first_name").cloned().unwrap_or(serde_json::Value::Null),
        "last_name": data.get("last_name").cloned().unwrap_or(serde_json::Value::Null),
        "platform_role": if caller.is_platform_admin { "admin" } else { "member" },
    }))
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
    let cleared = format!(
        "{}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{SECURE}",
        session_cookie_name()
    );
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, cleared)]).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_token_should_skip_inflight_oauth_state() {
        let name = session_cookie_name();
        assert_eq!(
            cookie_token(&format!("{name}=abc123; other=x")).as_deref(),
            Some("abc123")
        );
        // an st.-prefixed value is an OAuth state in flight, not a session
        assert!(cookie_token(&format!("{name}=st.payload.sig")).is_none());
        assert!(cookie_token("unrelated=1").is_none());
    }
}
