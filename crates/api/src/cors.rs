//! Case 0017 — a preflight-accurate, explicit-allowlist, credentialed-correct CORS layer that REPLACES
//! the blanket `tower_http::cors::CorsLayer`. tower-http treated *every* `OPTIONS` as a preflight and
//! short-circuited it 200/empty BEFORE the router — shadowing numu's OPTIONS self-description handlers
//! (objects.rs `coll_options`/`item_options`). This layer only short-circuits a TRUE preflight (OPTIONS
//! carrying `Access-Control-Request-Method` + an allowlisted `Origin`); every other request (incl. a
//! NON-preflight OPTIONS) reaches the router, restoring self-description over real HTTP.
//!
//! Credentialed-correct (cookie sessions are on): the spec forbids `*` anywhere, so we echo the EXACT
//! allowlisted `Origin`, set `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and explicit
//! method/header/expose lists (never `*`). Deny-by-default: a non-allowlisted origin gets no ACAO header
//! and the browser blocks the read. (docs/HTTP.md, docs/decisions/0004-build-router-and-startup-self-check.md)

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::Request;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// The explicit per-origin allowlist + the localhost-dev flag, cloned into the `from_fn` closure.
#[derive(Clone)]
pub struct CorsCfg {
    /// the exact origins permitted to call the API with credentials (`cfg.cors_origins`).
    pub origins: Arc<HashSet<String>>,
    /// `NUMU_CORS_DEV` — when set, ANY `http://localhost[:port]` / `http://127.0.0.1[:port]` origin is
    /// treated as allowlisted (still the exact-origin echo, never `*`).
    pub dev: bool,
}

impl CorsCfg {
    /// Build from the configured origins + the dev flag.
    pub fn new(origins: &[String], dev: bool) -> Self {
        Self {
            origins: Arc::new(origins.iter().cloned().collect()),
            dev,
        }
    }

    /// Is this `Origin` permitted? An exact allowlist hit, or (in dev) any localhost origin.
    fn allows(&self, origin: &str) -> bool {
        self.origins.contains(origin) || (self.dev && is_localhost(origin))
    }
}

/// Matches `http://localhost` / `http://127.0.0.1`, with or without a `:port` (dev only — never `*`).
fn is_localhost(origin: &str) -> bool {
    for host in ["http://localhost", "http://127.0.0.1"] {
        if let Some(rest) = origin.strip_prefix(host) {
            // exact host, or host followed by a `:port` of ASCII digits.
            if rest.is_empty() {
                return true;
            }
            if let Some(port) = rest.strip_prefix(':') {
                return !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit());
            }
        }
    }
    false
}

/// The fixed credentialed header sets (the existing 0009 lists — never `*`).
const ALLOW_METHODS: &str = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS: &str = "content-type, if-match, if-none-match, cookie";
const EXPOSE_HEADERS: &str = "etag, location";
const MAX_AGE: &str = "7200";

/// The CORS middleware. Wire via `axum::middleware::from_fn` with a captured `CorsCfg` clone.
pub async fn cors_layer(cfg: CorsCfg, req: Request, next: Next) -> Response {
    // the request `Origin` (a non-browser / same-origin request has none → no CORS headers at all).
    let origin = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let allowed = origin.as_deref().is_some_and(|o| cfg.allows(o));

    // a TRUE preflight = OPTIONS + Access-Control-Request-Method + an Origin present.
    let is_preflight = req.method() == Method::OPTIONS
        && req.headers().contains_key("access-control-request-method")
        && origin.is_some();

    if is_preflight {
        // short-circuit 204; the router handler does NOT run for a true preflight.
        let mut resp = StatusCode::NO_CONTENT.into_response();
        if allowed {
            // safe: `allowed` implies the origin parsed as a valid header string above.
            if let Some(o) = origin
                .as_deref()
                .and_then(|o| HeaderValue::from_str(o).ok())
            {
                let h = resp.headers_mut();
                h.insert("access-control-allow-origin", o);
                h.insert(
                    "access-control-allow-credentials",
                    HeaderValue::from_static("true"),
                );
                h.insert(
                    "access-control-allow-methods",
                    HeaderValue::from_static(ALLOW_METHODS),
                );
                h.insert(
                    "access-control-allow-headers",
                    HeaderValue::from_static(ALLOW_HEADERS),
                );
                h.insert("access-control-max-age", HeaderValue::from_static(MAX_AGE));
            }
        }
        // NOT allowed → 204 with NO Access-Control-Allow-Origin (deny-by-default; the browser blocks).
        // Cache safety (F1): `Vary: Origin` whenever an Origin was present — on BOTH the allowed and the
        // denied preflight — so a shared cache never serves an allowed-origin response to a denied one.
        vary_if_origin(resp.headers_mut(), origin.is_some());
        return resp;
    }

    // everything else (incl. non-preflight OPTIONS): run the router, then stamp the actual-response set.
    let mut resp = next.run(req).await;
    if allowed {
        if let Some(o) = origin
            .as_deref()
            .and_then(|o| HeaderValue::from_str(o).ok())
        {
            let h = resp.headers_mut();
            h.insert("access-control-allow-origin", o);
            h.insert(
                "access-control-allow-credentials",
                HeaderValue::from_static("true"),
            );
            h.insert(
                "access-control-expose-headers",
                HeaderValue::from_static(EXPOSE_HEADERS),
            );
        }
    }
    // No Origin / not allowed → stamp no ACAO (same-origin needs none; deny-by-default for cross-origin),
    // but still `Vary: Origin` whenever an Origin was present (F1) so the actual-response branch — allowed
    // AND denied — is cache-safe too.
    vary_if_origin(resp.headers_mut(), origin.is_some());
    resp
}

/// Append `Vary: Origin` when the request carried an `Origin` header (F1). Appending (not inserting)
/// composes with any `Vary` a handler already set, and is correct on both the allowed and denied paths:
/// the response varies by origin regardless of whether this particular origin was allowlisted.
fn vary_if_origin(headers: &mut axum::http::HeaderMap, origin_present: bool) {
    if origin_present {
        headers.append(header::VARY, HeaderValue::from_static("origin"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_matches_with_and_without_port() {
        assert!(is_localhost("http://localhost"));
        assert!(is_localhost("http://localhost:5173"));
        assert!(is_localhost("http://127.0.0.1:8080"));
        assert!(!is_localhost("http://localhost:abc"));
        assert!(!is_localhost("http://localhost.evil.com"));
        assert!(!is_localhost("https://localhost:5173")); // https is not the dev http shortcut
        assert!(!is_localhost("http://example.com"));
    }

    #[test]
    fn allows_exact_then_dev_localhost() {
        let cfg = CorsCfg::new(&["https://app.example".to_string()], false);
        assert!(cfg.allows("https://app.example"));
        assert!(!cfg.allows("http://localhost:5173"));

        let dev = CorsCfg::new(&[], true);
        assert!(dev.allows("http://localhost:5173"));
        assert!(!dev.allows("https://app.example"));
    }
}
