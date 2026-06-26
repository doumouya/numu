//! Liveness + readiness. `/healthz` never touches the DB (for the load balancer); `/readyz` pings PG and
//! reports degraded (503) when a dependency is down. Both report the build version. (docs/OBSERVABILITY.md §5)

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde_json::json;

use crate::state::AppState;

pub async fn healthz() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

pub async fn readyz(State(st): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    match sqlx::query("select 1").execute(&st.pool).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({ "status": "ready", "version": env!("CARGO_PKG_VERSION") })),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "degraded", "db": "down" })),
        ),
    }
}
