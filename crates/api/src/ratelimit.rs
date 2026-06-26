//! A small per-client fixed-window rate limiter for the `/auth` routes — a brute-force backstop. The client
//! key is the proxy-forwarded IP (`X-Forwarded-For` / `X-Real-IP`), so it works behind a reverse proxy;
//! with no such header all callers share the `"global"` bucket. v1 keeps counters in memory (a reaper for
//! idle keys is a follow-on). Applied via `route_layer` on the auth router in `run()` — not on the object
//! surface, and not in the test harness. (docs/cases/0008-backend-completion.md B4.)

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::Request;
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::AppError;
use crate::request_id::RequestCtx;

#[derive(Clone)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<String, (Instant, u32)>>>,
    max: u32,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max: u32, window: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            max,
            window,
        }
    }

    /// Record a hit for `key`; `true` = within the limit, `false` = over it (→ 429). Lock poisoning is
    /// recovered (a panic elsewhere must not wedge the limiter into failing every request).
    pub fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let entry = map.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) > self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.max
    }
}

fn client_key(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "global".to_string())
}

/// axum middleware: enforce the limiter, returning a leak-free 429 (carrying the request-id) when over.
pub async fn enforce(limiter: RateLimiter, req: Request, next: Next) -> Response {
    if limiter.allow(&client_key(req.headers())) {
        return next.run(req).await;
    }
    let rid = req
        .extensions()
        .get::<RequestCtx>()
        .map(|c| c.request_id.clone())
        .unwrap_or_default();
    AppError::too_many_requests()
        .with_request_id(rid)
        .into_response()
}
