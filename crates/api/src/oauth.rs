//! E1 — OAuth (authorization-code) spine + Google. `GET /auth/:provider/start` redirects to the provider
//! with an HMAC-signed state cookie (CSRF; no oauth_state table — the cookie IS the state); the callback
//! verifies state, exchanges code→token→userinfo through the SSRF-gated `Fetcher`, upserts by
//! (provider, sub) (NEVER email), mints a session. The provider abstraction is shaped around the OUTPUT
//! {sub, email, name}, so OIDC-SSO is a future config and Apple (E2) is the same trait via JWT. The flow
//! core (`complete_login`) takes a `&dyn Fetcher`, so it's tested with a mock — no live server. (plan E1.)

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;

use crate::error::{AppError, AppResult};
use crate::http_client::{Fetcher, SsrfFetcher};
use crate::ids;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;
const STATE_COOKIE: &str = "numu_oauth";
const STATE_TTL_SECS: u64 = 600;
const SECURE: &str = if cfg!(debug_assertions) {
    ""
} else {
    "; Secure"
};

/// A provider, shaped around its OUTPUT. Config (id/secret/redirect) is per-env today; a `(provider,
/// tenant)` config row is the future seam for OIDC-SSO.
pub struct Provider {
    pub name: String,
    pub authorize_url: String,
    pub token_url: String,
    pub userinfo_url: String,
    pub scopes: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

fn google() -> Option<Provider> {
    Some(Provider {
        name: "google".into(),
        authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
        token_url: "https://oauth2.googleapis.com/token".into(),
        userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo".into(),
        scopes: "openid email profile".into(),
        client_id: std::env::var("GOOGLE_CLIENT_ID").ok()?,
        client_secret: std::env::var("GOOGLE_CLIENT_SECRET").ok()?,
        redirect_uri: std::env::var("GOOGLE_REDIRECT_URI").ok()?,
    })
}

fn provider(name: &str) -> Option<Provider> {
    match name {
        "google" => google(),
        _ => None,
    }
}

// ── HMAC-signed, stateless state ──────────────────────────────────────────────
fn secret() -> Vec<u8> {
    std::env::var("NUMU_SECRET")
        .unwrap_or_else(|_| "dev-insecure-secret-change-me".into())
        .into_bytes()
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Sign a payload → `payload.hexsig`. Verification is constant-time (hmac `verify_slice`).
fn sign_state(payload: &str) -> String {
    // HMAC accepts a key of any length, so new_from_slice never errors here.
    let mut mac = HmacSha256::new_from_slice(&secret())
        .unwrap_or_else(|_| unreachable!("hmac any-length key"));
    mac.update(payload.as_bytes());
    format!("{payload}.{}", hex(&mac.finalize().into_bytes()))
}

fn verify_state(signed: &str) -> Option<String> {
    let (payload, sig_hex) = signed.rsplit_once('.')?;
    let sig = unhex(sig_hex)?;
    let mut mac = HmacSha256::new_from_slice(&secret()).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&sig).ok()?;
    Some(payload.to_string())
}

// ── the testable flow core ────────────────────────────────────────────────────
/// Provider-specific extraction of the canonical OUTPUT from the userinfo JSON. (Google/FB/TikTok are
/// userinfo-shaped; Apple, E2, supplies the same shape from a verified id_token.)
fn extract_identity(userinfo: &Value) -> AppResult<(String, Option<String>, String)> {
    let sub = userinfo
        .get("sub")
        .or_else(|| userinfo.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::bad_request("provider returned no subject"))?
        .to_string();
    let email = userinfo
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let name = userinfo
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok((sub, email, name))
}

/// Find the actor linked to (provider, sub), or mint one (actor entity + identity) in a txn.
async fn upsert_identity(
    pool: &PgPool,
    provider: &str,
    sub: &str,
    email: Option<&str>,
    name: &str,
) -> AppResult<String> {
    if let Some(actor_id) = sqlx::query_scalar::<_, String>(
        "select actor_id from auth_identities where provider = $1 and sub = $2",
    )
    .bind(provider)
    .bind(sub)
    .fetch_optional(pool)
    .await?
    {
        return Ok(actor_id);
    }
    let actor_id = ids::mint("USR");
    let handle = format!("u_{}", &actor_id[4..14.min(actor_id.len())]);
    let data = json!({
        "display_name": if name.is_empty() { handle.as_str() } else { name },
        "handle": handle,
        "email": email,
        "kind": "human",
        "platform_role": "member",
        "status": "active",
    });
    let mut tx = pool.begin().await?;
    sqlx::query("insert into entities (id, type, created_by) values ($1, 'actor', $1)")
        .bind(&actor_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into entity_data (entity_id, type_id, data) values ($1, 'actor', $2)")
        .bind(&actor_id)
        .bind(&data)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "insert into auth_identities (provider, sub, actor_id, email) values ($1, $2, $3, $4)",
    )
    .bind(provider)
    .bind(sub)
    .bind(&actor_id)
    .bind(email)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(actor_id)
}

/// Exchange code→token→userinfo via the (SSRF-gated) fetcher, upsert by sub, mint a session. Returns the
/// session `Set-Cookie`. Pure of the HTTP layer (takes a `&dyn Fetcher`), so it's unit-tested with a mock.
pub async fn complete_login(
    pool: &PgPool,
    p: &Provider,
    fetcher: &dyn Fetcher,
    code: &str,
) -> AppResult<String> {
    let token = fetcher
        .post_form(
            &p.token_url,
            &[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("client_id", &p.client_id),
                ("client_secret", &p.client_secret),
                ("redirect_uri", &p.redirect_uri),
            ],
        )
        .await?;
    let access = token
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::bad_request("token endpoint returned no access_token"))?;
    let userinfo = fetcher.get_json(&p.userinfo_url, Some(access)).await?;
    let (sub, email, name) = extract_identity(&userinfo)?;
    let actor_id = upsert_identity(pool, &p.name, &sub, email.as_deref(), &name).await?;
    crate::auth::mint_session(pool, &actor_id).await
}

// ── handlers ──────────────────────────────────────────────────────────────────
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/:provider/start", get(start))
        .route("/auth/:provider/callback", get(callback))
}

async fn start(Path(name): Path<String>) -> AppResult<Response> {
    let p = provider(&name).ok_or_else(AppError::not_found)?;
    let nonce = ids::mint("st");
    let payload = format!("{nonce}:{}", now_unix() + STATE_TTL_SECS);
    let signed = sign_state(&payload);
    let url = reqwest::Url::parse_with_params(
        &p.authorize_url,
        &[
            ("response_type", "code"),
            ("client_id", p.client_id.as_str()),
            ("redirect_uri", p.redirect_uri.as_str()),
            ("scope", p.scopes.as_str()),
            ("state", nonce.as_str()),
        ],
    )
    .map_err(|_| AppError::internal("bad authorize url"))?;
    let cookie = format!(
        "{STATE_COOKIE}={signed}; HttpOnly; SameSite=Lax; Path=/; Max-Age={STATE_TTL_SECS}{SECURE}"
    );
    Ok((
        StatusCode::FOUND,
        [
            (header::LOCATION, url.to_string()),
            (header::SET_COOKIE, cookie),
        ],
    )
        .into_response())
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

fn cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())?
        .split(';')
        .map(str::trim)
        .find_map(|kv| kv.strip_prefix(&format!("{name}=")))
        .map(str::to_string)
}

async fn callback(
    State(st): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<CallbackQuery>,
    headers: axum::http::HeaderMap,
) -> AppResult<Response> {
    let p = provider(&name).ok_or_else(AppError::not_found)?;
    // CSRF + freshness: the signed cookie must verify, not be expired, and its nonce must equal `state`.
    let signed = cookie_value(&headers, STATE_COOKIE).ok_or_else(AppError::unauthorized)?;
    let payload = verify_state(&signed).ok_or_else(AppError::unauthorized)?;
    let (nonce, exp) = payload.split_once(':').ok_or_else(AppError::unauthorized)?;
    let exp: u64 = exp.parse().unwrap_or(0);
    if nonce != q.state || now_unix() > exp {
        return Err(AppError::unauthorized());
    }
    let session = complete_login(&st.pool, &p, &SsrfFetcher, &q.code).await?;
    // clear the state cookie, set the session cookie, land the user
    let cleared = format!("{STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{SECURE}");
    Ok((
        StatusCode::OK,
        [(header::SET_COOKIE, session), (header::SET_COOKIE, cleared)],
        axum::Json(json!({ "ok": true })),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_roundtrips_and_rejects_tampering() {
        let signed = sign_state("nonce123:9999999999");
        assert_eq!(
            verify_state(&signed).as_deref(),
            Some("nonce123:9999999999")
        );
        // a flipped payload byte breaks the HMAC
        let tampered = signed.replace("nonce123", "nonceXXX");
        assert!(verify_state(&tampered).is_none());
        // malformed input never verifies
        assert!(verify_state("no-signature").is_none());
    }
}
