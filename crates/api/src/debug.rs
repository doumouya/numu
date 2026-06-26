//! The re-homed debug surface (OBSERVABILITY.md): `POST /api/_debug/echo` reflects the request — the safe
//! replacement for HTTP TRACE (sensitive headers redacted) — and `PATCH /api/_debug/log-level` hot-swaps
//! the tracing filter. Both admin-only; echo additionally requires `NUMU_DEBUG=1` and 404s when off, so the
//! surface is invisible unless explicitly enabled. (docs/cases/0008-backend-completion.md B4.)

use std::sync::OnceLock;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{patch, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::caller::Caller;
use crate::config;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::request_id::RequestCtx;
use crate::state::AppState;

/// A closure that swaps the tracing filter to `level`, returning whether it parsed + applied.
type LogReloader = Box<dyn Fn(&str) -> bool + Send + Sync>;

/// Set once at boot by `run()`; swaps the tracing `EnvFilter`. `None` in tests (no subscriber) → PATCH 503s.
static LOG_RELOAD: OnceLock<LogReloader> = OnceLock::new();

pub fn set_log_reloader(f: LogReloader) {
    let _ = LOG_RELOAD.set(f);
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/_debug/echo", post(echo))
        .route("/api/_debug/log-level", patch(set_log_level))
}

const REDACT: &[&str] = &[
    "cookie",
    "set-cookie",
    "authorization",
    "proxy-authorization",
    "x-api-key",
];

async fn echo(
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Response> {
    // invisible unless explicitly enabled — 404 hides the surface entirely.
    if !config::env_flag("NUMU_DEBUG") {
        return Err(AppError::not_found().with_request_id(ctx.request_id.clone()));
    }
    if !caller.is_platform_admin {
        return Err(AppError::forbidden().with_request_id(ctx.request_id.clone()));
    }
    let hdrs: serde_json::Map<String, Value> = headers
        .iter()
        .map(|(k, v)| {
            let name = k.as_str().to_string();
            let val = if REDACT.contains(&name.as_str()) {
                "<redacted>".to_string()
            } else {
                v.to_str().unwrap_or("<binary>").to_string()
            };
            (name, json!(val))
        })
        .collect();
    Ok(Json(json!({
        "request_id": ctx.request_id,
        "headers": hdrs,
        "body": String::from_utf8_lossy(&body),
    }))
    .into_response())
}

#[derive(Deserialize)]
struct LevelInput {
    level: String,
}

async fn set_log_level(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    body: Bytes,
) -> AppResult<Response> {
    if !caller.is_platform_admin {
        return Err(AppError::forbidden().with_request_id(ctx.request_id.clone()));
    }
    let input: LevelInput = serde_json::from_slice(&body).map_err(|e| {
        AppError::bad_request(format!("expected {{\"level\":\"...\"}}: {e}"))
            .with_request_id(ctx.request_id.clone())
    })?;
    match LOG_RELOAD.get() {
        Some(reload) if reload(&input.level) => {
            // a privileged mutation of server-wide state — audit it (audit-everything).
            db::record_event(
                &st.pool,
                &ctx,
                &caller.actor_id,
                None,
                "debug.log_level_changed",
                json!({ "level": input.level }),
            )
            .await;
            Ok(Json(json!({ "level": input.level })).into_response())
        }
        Some(_) => Err(
            AppError::bad_request(format!("invalid log filter: {}", input.level))
                .with_request_id(ctx.request_id.clone()),
        ),
        None => Err(AppError::unavailable().with_request_id(ctx.request_id.clone())),
    }
}
