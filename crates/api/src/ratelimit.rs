//! A small per-client fixed-window rate limiter for the `/auth` routes — a brute-force backstop. The client
//! key is the real TCP peer (`ConnectInfo`), which a client can't forge; only when `NUMU_TRUST_PROXY=1` (a
//! reverse-proxy deployment) is the forwarded client IP (`X-Forwarded-For`) honored instead. Counters live
//! in memory with a size cap that evicts expired buckets, so a spoofed-key flood can't exhaust memory.
//! Applied via `route_layer` on the auth router in `run()` — not the object surface, not the test harness.
//! (docs/cases/0008-backend-completion.md B4; CASE 0008 review.)

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::config;
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
        // bound memory: under a spoofed-key flood, evict expired buckets before admitting a new key.
        if map.len() > 100_000 {
            map.retain(|_, (start, _)| now.duration_since(*start) <= self.window);
        }
        let entry = map.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) > self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.max
    }
}

/// Pick the trustworthy client IP from an `X-Forwarded-For` chain: the LAST entry — appended by
/// the trusted edge in front of us (Cloud Run / a real proxy). The FIRST entry is client-supplied
/// and spoofable: keying on it hands an attacker one fresh bucket per forged header (CASE 0022).
fn forwarded_ip(header_value: &str) -> Option<String> {
    header_value
        .split(',')
        .next_back()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Rate-limit keys are SHA-256 hashes of the address, kept only in this in-memory map — the
/// limiter never stores or logs a raw IP (the ingest privacy posture; docs/apps/PORTFOLIO.md).
fn hash_key(addr: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(addr.as_bytes());
    let out = h.finalize();
    out.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn client_key(req: &Request) -> String {
    // Behind a trusted reverse proxy the TCP peer is the proxy, so honor the forwarded client IP — but ONLY
    // when explicitly enabled, so a direct (unproxied) deployment can't be spoofed by a client-set header.
    if config::env_flag("NUMU_TRUST_PROXY") {
        if let Some(ip) = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(forwarded_ip)
        {
            return hash_key(&ip);
        }
    }
    // Default: the real socket peer, which a client cannot forge.
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| hash_key(&c.0.ip().to_string()))
        .unwrap_or_else(|| "global".to_string())
}

/// axum middleware: enforce the limiter, returning a leak-free 429 (carrying the request-id) when over.
pub async fn enforce(limiter: RateLimiter, req: Request, next: Next) -> Response {
    if limiter.allow(&client_key(&req)) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwarded_ip_should_take_the_last_edge_appended_entry() {
        // the first entry is client-supplied (spoofable); the LAST is appended by our edge
        assert_eq!(
            forwarded_ip("6.6.6.6, 203.0.113.9").as_deref(),
            Some("203.0.113.9")
        );
        assert_eq!(forwarded_ip("203.0.113.9").as_deref(), Some("203.0.113.9"));
        assert!(forwarded_ip("").is_none());
        assert!(forwarded_ip("6.6.6.6, ").is_none());
    }

    #[test]
    fn hash_key_should_be_stable_and_not_the_raw_ip() {
        let k = hash_key("203.0.113.9");
        assert_eq!(k, hash_key("203.0.113.9"));
        assert!(!k.contains("203"));
        assert_eq!(k.len(), 32);
    }
}
