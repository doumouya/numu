//! G7 — the connector "run" action. The connector TYPE is a registry row (full CRUD via the generic
//! handler); this adds the one behavior beyond CRUD: `POST /api/connectors/:id/run` fetches the connector's
//! `target` through the SSRF gate and returns the result. Reach-gated (Edit on the connector). v1 runs
//! `http_json` sources, reusing `http_client::SsrfFetcher` (already https-only + IP-pinned + metadata-
//! blocked); other kinds → 422 until their target/runtime is chosen. (docs/api/OBJECTS.md G7, CASE 0011.)

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Extension, Json, Router};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::caller::{self, Action, Caller};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::http_client::{Fetcher, SsrfFetcher};
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/connectors/:id/run", post(run_connector))
}

fn deny_404(ctx: &RequestCtx) -> AppError {
    AppError::not_found().with_request_id(ctx.request_id.clone())
}

async fn run_connector(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Path(id): Path<String>,
) -> AppResult<Response> {
    let row =
        sqlx::query("select data from entity_data where entity_id = $1 and type_id = 'connector'")
            .bind(id.as_str())
            .fetch_optional(&st.pool)
            .await?;
    let Some(row) = row else {
        return Err(deny_404(&ctx));
    };
    // running a connector is an Edit-grade action on it (it mutates last_run/status + reaches out).
    if !caller::reach_action(&st, &caller, &id, Action::Edit).await? {
        return Err(deny_404(&ctx));
    }
    let data: Value = row.try_get("data")?;
    let kind = data.get("kind").and_then(Value::as_str).unwrap_or("");
    let target = data.get("target").and_then(Value::as_str).unwrap_or("");
    if kind != "http_json" {
        return Err(AppError::unprocessable(format!(
            "connector kind '{kind}' is not runnable in v1 (only http_json)"
        ))
        .with_request_id(ctx.request_id.clone()));
    }
    if target.is_empty() {
        return Err(AppError::unprocessable("connector has no target")
            .with_request_id(ctx.request_id.clone()));
    }

    // the actual reach-out, through the SSRF gate (https-only, IP-pinned, metadata-blocked). Stamp the
    // connector's status on BOTH paths so its state reflects the run before we return.
    let result = match SsrfFetcher.get_json(target, None).await {
        Ok(v) => v,
        Err(e) => {
            let _ = stamp_run(&st.pool, &id, "error").await;
            return Err(e.with_request_id(ctx.request_id.clone()));
        }
    };
    let version = stamp_run(&st.pool, &id, "active").await?;
    db::record_event(
        &st.pool,
        &ctx,
        &caller.actor_id,
        Some(&id),
        "connector.ran",
        json!({ "id": id, "target": target }),
    )
    .await;

    // return the bumped version/ETag so a client holding the pre-run tag isn't left stale.
    Ok((
        StatusCode::OK,
        [(header::ETAG, format!("W/\"{version}\""))],
        Json(json!({ "connector": id, "ran": true, "version": version, "result": result })),
    )
        .into_response())
}

/// Stamp `last_run_at` + `status` on the connector (engine-owned readonly fields), bumping `version` so a
/// client's ETag stays correct. Returns the new version.
async fn stamp_run(pool: &PgPool, id: &str, status: &str) -> AppResult<i32> {
    let version: i32 = sqlx::query_scalar(
        "update entity_data set \
         data = jsonb_set(jsonb_set(data, '{last_run_at}', to_jsonb(now()::text)), '{status}', to_jsonb($2::text)), \
         version = version + 1, updated_at = now() \
         where entity_id = $1 and type_id = 'connector' returning version",
    )
    .bind(id)
    .bind(status)
    .fetch_one(pool)
    .await?;
    Ok(version)
}
