//! Case 0017 — the no-DB regression test that would have caught the CORS-shadows-OPTIONS breach.
//!
//! Verification path: `[CARGO]` — this file is INTENTIONALLY *not* `#[cfg(feature = "db-tests")]`,
//! so it compiles and runs under plain `cargo test` (the safe `tools/ci.sh` gate). It must never need
//! a live Postgres: it drives the REAL, fully-layered app via `numu_api::build_router` over a
//! NON-connecting pool (`PgPool::connect_lazy`). The cookieless OPTIONS path 401s inside the `Caller`
//! extractor (auth.rs:74-79) BEFORE any `sqlx::query`, so no DB connection is ever opened.
//!
//! Maps acceptance criteria (docs/internal/specs/cors-contract-safety.md):
//!   - AC2 / AC8-test : a non-preflight OPTIONS is ROUTED (401 non-empty), NOT CORS-shadowed (200/204 empty).
//!   - AC1            : a true preflight short-circuits 204 + the exact credentialed header set.
//!   - AC3            : a non-allowlisted origin gets NO `Access-Control-Allow-Origin` (deny-by-default).
//!   - AC4            : an actual (non-preflight) cross-origin response is stamped for an allowlisted origin.
//!
//! RED STATE: `numu_api::build_router` does not exist yet, nor do the no-DB cache seams
//! (`TypeDefCache::empty()` / `WorkflowCache::empty()`). This file therefore FAILS TO COMPILE today —
//! that compile error IS the intended TDD red (Part D, AC8-test). The coder makes it green by:
//!   1. adding `pub fn build_router(state: AppState, cfg: &Config) -> Router` to `lib.rs` (AC6) that
//!      folds `.with_state(state)` so the returned `Router` is ready to `oneshot` (spec lib.rs:196-198,
//!      "preferred, so tests get a ready router");
//!   2. adding `pub fn empty() -> Self` to `TypeDefCache` and `WorkflowCache` (a `#[cfg(test)]`-or-public
//!      no-DB constructor — spec Risks (c));
//!   3. landing the new `cors.rs` layer inside `build_router` (AC1/AC3/AC4 contracts).

use axum::body::Body;
use axum::http::{Request, StatusCode};
use numu_api::config::Config;
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use tower::ServiceExt; // `oneshot`

/// An allowlisted origin the test `Config` permits. Must be in `cfg.cors_origins`.
const ALLOWED_ORIGIN: &str = "https://app.example";
/// An origin deliberately NOT in the allowlist.
const EVIL_ORIGIN: &str = "https://evil.example";
/// A localhost dev origin that is NOT in `cfg.cors_origins` — only `cfg.cors_dev = true` may allow it.
const DEV_ORIGIN: &str = "http://localhost:5173";

/// Build the REAL fully-layered app (CORS + trace + request-id + fallback + every route) over a
/// non-connecting pool and an empty registry/workflows. The cookieless OPTIONS / preflight paths
/// asserted below never query the pool, so `connect_lazy` to a dead URL is safe and the empty caches
/// suffice (the `Caller` 401 / the CORS short-circuit both fire before any registry lookup).
fn build_test_app() -> axum::Router {
    // builds a pool handle WITHOUT connecting — see sqlx::PgPool::connect_lazy.
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/never")
        .expect("connect_lazy builds a pool handle without connecting");
    let state = AppState::new(pool, TypeDefCache::empty(), WorkflowCache::empty());
    let cfg = test_cfg();
    numu_api::build_router(state, &cfg)
}

/// A minimal `Config` literal for the layered router: an explicit CORS allowlist containing
/// `ALLOWED_ORIGIN`, a `web_dir` that exists (so `ServeDir` fallback is happy), and the auth
/// rate-limit values. (Constructed directly, not via `from_env`, so the test reads no environment.)
fn test_cfg() -> Config {
    cfg_with_dev(false)
}

/// Same minimal `Config`, parametrised on the dev flag so AC5 can flip `cors_dev` without env reads.
/// `cors_dev` is the review-round promotion of `NUMU_CORS_DEV` to a typed `Config` field — wiring the
/// dev flag through `Config` (not a process-global env var) is what makes AC5 deterministically
/// testable via `build_router` (the env-based wiring could not be asserted in-process). `cors_origins`
/// deliberately does NOT contain `DEV_ORIGIN`, so the only way a localhost preflight is allowed is via
/// `cors_dev = true`.
fn cfg_with_dev(dev: bool) -> Config {
    Config {
        bind: "127.0.0.1:0".to_string(),
        database_url: "postgres://localhost/never".to_string(),
        debug: false,
        auth_rate_limit: 30,
        auth_rate_window_secs: 60,
        cors_origins: vec![ALLOWED_ORIGIN.to_string()],
        cors_dev: dev,
        data_dir: std::path::PathBuf::from("."),
        web_dir: std::path::PathBuf::from("."),
    }
}

/// Build the real layered router with an explicit `cors_dev` value (AC5) over the same non-connecting
/// pool + empty caches as `build_test_app`. The dev-mode + non-allowlisted assertions never query the
/// pool (the preflight is short-circuited / denied in the CORS layer before the router runs).
fn build_app_with_dev(dev: bool) -> axum::Router {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/never")
        .expect("connect_lazy builds a pool handle without connecting");
    let state = AppState::new(pool, TypeDefCache::empty(), WorkflowCache::empty());
    numu_api::build_router(state, &cfg_with_dev(dev))
}

/// Read the full response body into bytes.
async fn body_bytes(resp: axum::response::Response) -> Vec<u8> {
    axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("read body")
        .to_vec()
}

fn header<'a>(resp: &'a axum::response::Response, name: &str) -> Option<&'a str> {
    resp.headers().get(name).and_then(|v| v.to_str().ok())
}

// ── AC2 / AC8-test — the assertion that would have caught Case 0017 ──────────────────────────────
//
// A NON-preflight cookieless `OPTIONS /api/objects/:type` (no `Origin`, no
// `Access-Control-Request-Method`) must be PASSED TO THE ROUTER, not short-circuited by the CORS layer.
// Routed signal = 401 (the `Caller` extractor rejects the missing cookie at auth.rs:79 before any DB
// hit) WITH a non-empty problem+json body. The old blanket `CorsLayer` returned 200/204 with an EMPTY
// body here (the shadow) — that is exactly the bug this test forbids.
#[tokio::test]
async fn non_preflight_options_is_routed_not_cors_shadowed() {
    let app = build_test_app();
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/objects/anything")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    let status = resp.status();
    let bytes = body_bytes(resp).await;

    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "AC2/AC8-test: a cookieless non-preflight OPTIONS must be ROUTED (401 from the Caller \
         extractor), not CORS-shadowed. Got {status} — a 200/204 here means the CORS layer is still \
         shadowing the OPTIONS self-description route (the Case 0017 breach)."
    );
    assert!(
        !bytes.is_empty(),
        "AC2/AC8-test: the routed 401 must carry a non-empty problem+json body. An EMPTY body is the \
         CORS short-circuit signature — the breach this test exists to catch."
    );
}

// ── AC1 — true preflight short-circuits with the exact credentialed header set ──────────────────
#[tokio::test]
async fn true_preflight_short_circuits_with_credentialed_headers() {
    let app = build_test_app();
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/objects/anything")
        .header("origin", ALLOWED_ORIGIN)
        .header("access-control-request-method", "POST")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    let status = resp.status();
    let acao = header(&resp, "access-control-allow-origin").map(str::to_string);
    let acac = header(&resp, "access-control-allow-credentials").map(str::to_string);
    let methods = header(&resp, "access-control-allow-methods").map(str::to_string);
    let allow_headers = header(&resp, "access-control-allow-headers").map(str::to_string);
    let max_age = header(&resp, "access-control-max-age").map(str::to_string);
    let vary = header(&resp, "vary").map(|v| v.to_ascii_lowercase());
    let bytes = body_bytes(resp).await;

    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "AC1: a true preflight (allowlisted Origin + Access-Control-Request-Method) must short-circuit \
         204 No Content. Got {status}."
    );
    assert!(
        bytes.is_empty(),
        "AC1: a 204 preflight must have an empty body; got {} bytes.",
        bytes.len()
    );
    assert_eq!(
        acao.as_deref(),
        Some(ALLOWED_ORIGIN),
        "AC1: Access-Control-Allow-Origin must echo the EXACT request Origin (never `*`), for \
         credentialed requests."
    );
    assert_eq!(
        acac.as_deref(),
        Some("true"),
        "AC1: Access-Control-Allow-Credentials must be `true`."
    );
    assert_eq!(
        methods.as_deref(),
        Some("GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"),
        "AC1: Access-Control-Allow-Methods must be the explicit 0009 method list (never `*`)."
    );
    assert_eq!(
        allow_headers.as_deref(),
        Some("content-type, if-match, if-none-match, cookie"),
        "AC1: Access-Control-Allow-Headers must be the fixed 0009 header set (spec decision (b): fixed, \
         not reflect-requested)."
    );
    assert_eq!(
        max_age.as_deref(),
        Some("7200"),
        "AC1: Access-Control-Max-Age must be 7200."
    );
    assert!(
        vary.as_deref().is_some_and(|v| v.contains("origin")),
        "AC1: Vary must contain `Origin` (credentialed, per-origin response). Got {vary:?}."
    );
}

// ── AC3 — deny-by-default: a non-allowlisted origin gets no ACAO ─────────────────────────────────
#[tokio::test]
async fn non_allowlisted_preflight_gets_no_allow_origin() {
    let app = build_test_app();
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/objects/anything")
        .header("origin", EVIL_ORIGIN)
        .header("access-control-request-method", "POST")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    assert!(
        header(&resp, "access-control-allow-origin").is_none(),
        "AC3: a preflight from a NON-allowlisted origin must receive NO Access-Control-Allow-Origin \
         header (the browser then blocks the read). Got {:?}.",
        header(&resp, "access-control-allow-origin")
    );
}

// ── AC4 — an actual cross-origin response is stamped for an allowlisted origin ───────────────────
//
// A GET to a no-auth route (`/healthz`) carrying an allowlisted Origin runs the router, and the
// response must carry the credentialed actual-response stamp (ACAO exact, ACAC true, Vary: Origin).
#[tokio::test]
async fn actual_cross_origin_response_is_stamped() {
    let app = build_test_app();
    let req = Request::builder()
        .method("GET")
        .uri("/healthz")
        .header("origin", ALLOWED_ORIGIN)
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    let acao = header(&resp, "access-control-allow-origin").map(str::to_string);
    let acac = header(&resp, "access-control-allow-credentials").map(str::to_string);
    let vary = header(&resp, "vary").map(|v| v.to_ascii_lowercase());

    assert_eq!(
        acao.as_deref(),
        Some(ALLOWED_ORIGIN),
        "AC4: an actual cross-origin response for an allowlisted origin must be stamped with the EXACT \
         Origin in Access-Control-Allow-Origin (never `*`)."
    );
    assert_eq!(
        acac.as_deref(),
        Some("true"),
        "AC4: an actual cross-origin response must carry Access-Control-Allow-Credentials: true."
    );
    assert!(
        vary.as_deref().is_some_and(|v| v.contains("origin")),
        "AC4: an actual cross-origin response must carry Vary: Origin. Got {vary:?}."
    );
}

// ── T4 / AC3 — actual-request (non-OPTIONS) deny-by-default ──────────────────────────────────────
//
// AC3 says "a request (ANY method) carrying an Origin NOT in the allowlist receives NO
// Access-Control-Allow-Origin header." The existing AC3 test above only covers the *preflight*
// branch. This pins the ACTUAL-response branch: a plain `GET /healthz` carrying a non-allowlisted
// Origin runs the router (200) but must NOT be stamped with ACAO — deny-by-default applies to the
// stamp path, not just the preflight short-circuit. Pairs with `actual_cross_origin_response_is_stamped`
// (the allow-case on the same branch).
#[tokio::test]
async fn actual_non_allowlisted_cross_origin_response_is_not_stamped() {
    let app = build_test_app();
    let req = Request::builder()
        .method("GET")
        .uri("/healthz")
        .header("origin", EVIL_ORIGIN)
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    assert!(
        header(&resp, "access-control-allow-origin").is_none(),
        "AC3: an ACTUAL (non-preflight) request from a NON-allowlisted origin must receive NO \
         Access-Control-Allow-Origin header on the response — deny-by-default applies to the \
         actual-response stamp branch, not only to preflight. Got {:?}.",
        header(&resp, "access-control-allow-origin")
    );
    assert!(
        header(&resp, "access-control-allow-credentials").is_none(),
        "AC3: a non-allowlisted actual response must also carry NO Access-Control-Allow-Credentials. \
         Got {:?}.",
        header(&resp, "access-control-allow-credentials")
    );
}

// ── T2 / AC5 — localhost dev mode echoes the localhost origin (never `*`), gated on `cfg.cors_dev` ─
//
// AC5: with the dev flag set, a localhost origin NOT in `cfg.cors_origins` is treated as allowlisted
// (exact-origin echo + the AC1 credentialed preflight set); with the flag unset, the same origin is
// denied. The review-round promotes the flag from `NUMU_CORS_DEV` (a process-global env read inside
// `build_router`) to a typed `Config.cors_dev` field, so this test drives the contract through
// `build_router(state, &cfg)` deterministically — no env mutation, parallel-safe.
//
// RED until: (1) `Config` gains `cors_dev: bool`, AND (2) `build_router` reads `cfg.cors_dev` instead
// of `config::env_flag("NUMU_CORS_DEV")` when constructing the CORS layer.
#[tokio::test]
async fn dev_mode_echoes_localhost_origin_exact_never_wildcard() {
    // dev ON: a localhost origin NOT in cors_origins is allowed; preflight short-circuits 204 with
    // the EXACT origin echoed (never `*`) + credentials true.
    let app = build_app_with_dev(true);
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/api/objects/anything")
        .header("origin", DEV_ORIGIN)
        .header("access-control-request-method", "POST")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();

    let status = resp.status();
    let acao = header(&resp, "access-control-allow-origin").map(str::to_string);
    let acac = header(&resp, "access-control-allow-credentials").map(str::to_string);

    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "AC5: with cfg.cors_dev = true, a localhost preflight must short-circuit 204 (treated as \
         allowlisted). Got {status}."
    );
    assert_eq!(
        acao.as_deref(),
        Some(DEV_ORIGIN),
        "AC5: dev mode must echo the EXACT localhost Origin in Access-Control-Allow-Origin — never \
         `*` (credentials are on). Got {acao:?}."
    );
    assert_ne!(
        acao.as_deref(),
        Some("*"),
        "AC5: Access-Control-Allow-Origin must NEVER be `*` in any mode (credentialed invariant)."
    );
    assert_eq!(
        acac.as_deref(),
        Some("true"),
        "AC5: a dev-allowed localhost preflight must carry Access-Control-Allow-Credentials: true."
    );

    // dev OFF: the SAME localhost origin (not in cors_origins) is denied — NO ACAO header.
    let app_off = build_app_with_dev(false);
    let req_off = Request::builder()
        .method("OPTIONS")
        .uri("/api/objects/anything")
        .header("origin", DEV_ORIGIN)
        .header("access-control-request-method", "POST")
        .body(Body::empty())
        .unwrap();
    let resp_off = app_off.oneshot(req_off).await.unwrap();

    assert!(
        header(&resp_off, "access-control-allow-origin").is_none(),
        "AC5: with cfg.cors_dev = false, a localhost origin NOT in cors_origins must be DENIED — no \
         Access-Control-Allow-Origin header. Got {:?}.",
        header(&resp_off, "access-control-allow-origin")
    );
}

// ── T1 — the monitor predicate truth-table (the class-guard) ──────────────────────────────────────
//
// The review-round inverts the startup self-check from the old negative `2xx + empty` fingerprint to
// the POSITIVE contract, extracted as a pure, unit-testable predicate:
//
//     pub fn options_self_check_routed(status: StatusCode, body_empty: bool) -> bool
//
// returning `true` IFF the cookieless OPTIONS probe was ROUTED = `status == 401 (UNAUTHORIZED)` AND
// `!body_empty` (the `Caller` extractor's problem+json 401). EVERYTHING else — any 2xx empty, a
// FORBIDDEN, a 500, a 405, an empty 401, a non-empty 200 — is a shadow / contract-drift → `false`.
// Pinning the WHOLE positive contract (not just the old 2xx-empty fingerprint) is what makes the
// monitor catch the entire shadow class, not one fingerprint.
//
// RED until the coder extracts `pub fn options_self_check_routed` in lib.rs.
#[test]
fn options_self_check_routed_truth_table() {
    use axum::http::StatusCode;

    // The ONLY routed case: a cookieless `Caller` 401 with a non-empty problem+json body.
    assert!(
        numu_api::options_self_check_routed(StatusCode::UNAUTHORIZED, false),
        "(UNAUTHORIZED, body_empty=false) is the one ROUTED case → true."
    );

    // Every other (status, body_empty) pair is a shadow / contract-drift → false.
    assert!(
        !numu_api::options_self_check_routed(StatusCode::OK, true),
        "(OK, empty) is the classic CORS short-circuit shadow → false."
    );
    assert!(
        !numu_api::options_self_check_routed(StatusCode::NO_CONTENT, true),
        "(NO_CONTENT, empty) is a preflight short-circuit shadow → false."
    );
    assert!(
        !numu_api::options_self_check_routed(StatusCode::OK, false),
        "(OK, non-empty) is not the 401 routed signal → false."
    );
    assert!(
        !numu_api::options_self_check_routed(StatusCode::FORBIDDEN, true),
        "(FORBIDDEN, empty) is not the 401 routed signal → false."
    );
    assert!(
        !numu_api::options_self_check_routed(StatusCode::INTERNAL_SERVER_ERROR, false),
        "(INTERNAL_SERVER_ERROR, non-empty) is contract-drift, not the 401 signal → false."
    );
    assert!(
        !numu_api::options_self_check_routed(StatusCode::METHOD_NOT_ALLOWED, false),
        "(METHOD_NOT_ALLOWED, non-empty) is contract-drift, not the 401 signal → false."
    );
}
