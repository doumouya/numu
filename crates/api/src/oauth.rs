//! OAuth (authorization-code) spine — four live providers: google · apple · facebook · tiktok.
//! `GET /auth/:provider/start` redirects with an HMAC-signed state cookie (CSRF; no oauth_state table —
//! the cookie IS the state, signed with NUMU_SECRET); the callback verifies state, exchanges
//! code→token→userinfo through the SSRF-gated `Fetcher`, upserts by (provider, sub) (NEVER email), mints
//! a session. Apple's id_token is verified in-module (`verify_id_token`). The provider abstraction is
//! shaped around the OUTPUT {sub, email, name}, so OIDC-SSO stays a config away. The flow core
//! (`complete_login`) takes a `&dyn Fetcher`, so it's tested with a mock — no live server.

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
const STATE_TTL_SECS: u64 = 600;
const SECURE: &str = if cfg!(debug_assertions) {
    ""
} else {
    "; Secure"
};

/// The state cookie is the SESSION cookie name carrying an `st.`-prefixed signed value: Firebase
/// Hosting forwards only one cookie (`__session`) to Cloud Run, so state and session must share
/// it (auth.rs::session_cookie_name, CASE 0021). The callback's session Set-Cookie overwrites
/// the state in place — no separate clear needed.
fn state_cookie(signed: &str) -> String {
    format!(
        "{}={}{signed}; HttpOnly; SameSite=Lax; Path=/; Max-Age={STATE_TTL_SECS}{SECURE}",
        crate::auth::session_cookie_name(),
        crate::auth::OAUTH_STATE_PREFIX,
    )
}

/// How a provider yields the identity after the token exchange.
pub enum ProviderKind {
    /// Google/Facebook/TikTok: GET `userinfo` with the access token.
    Userinfo,
    /// Apple (OIDC): the token response carries an `id_token` (a JWT) verified against the provider's JWKS.
    IdToken { jwks_url: String, issuer: String },
}

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
    pub kind: ProviderKind,
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
        kind: ProviderKind::Userinfo,
    })
}

fn apple() -> Option<Provider> {
    Some(Provider {
        name: "apple".into(),
        authorize_url: "https://appleid.apple.com/auth/authorize".into(),
        token_url: "https://appleid.apple.com/auth/token".into(),
        userinfo_url: String::new(), // unused — Apple returns an id_token
        scopes: "name email".into(),
        client_id: std::env::var("APPLE_CLIENT_ID").ok()?,
        // For Apple the "client_secret" is a generated ES256 JWT signed with the Apple key (a deploy
        // concern); the token POST is otherwise standard.
        client_secret: std::env::var("APPLE_CLIENT_SECRET").ok()?,
        redirect_uri: std::env::var("APPLE_REDIRECT_URI").ok()?,
        kind: ProviderKind::IdToken {
            jwks_url: "https://appleid.apple.com/auth/keys".into(),
            issuer: "https://appleid.apple.com".into(),
        },
    })
}

fn facebook() -> Option<Provider> {
    Some(Provider {
        name: "facebook".into(),
        authorize_url: "https://www.facebook.com/v19.0/dialog/oauth".into(),
        token_url: "https://graph.facebook.com/v19.0/oauth/access_token".into(),
        userinfo_url: "https://graph.facebook.com/me?fields=id,name,email".into(),
        scopes: "email public_profile".into(),
        client_id: std::env::var("FACEBOOK_CLIENT_ID").ok()?,
        client_secret: std::env::var("FACEBOOK_CLIENT_SECRET").ok()?,
        redirect_uri: std::env::var("FACEBOOK_REDIRECT_URI").ok()?,
        kind: ProviderKind::Userinfo,
    })
}

fn tiktok() -> Option<Provider> {
    Some(Provider {
        name: "tiktok".into(),
        authorize_url: "https://www.tiktok.com/v2/auth/authorize/".into(),
        token_url: "https://open.tiktokapis.com/v2/oauth/token/".into(),
        userinfo_url: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name"
            .into(),
        scopes: "user.info.basic".into(),
        // NOTE: TikTok names the credential `client_key` in the authorize/token params (not `client_id`)
        // and its userinfo nests under data.user; the token-param rename is the one live-integration detail
        // to finalize at app-review time. Identity extraction (the testable part) is handled here.
        client_id: std::env::var("TIKTOK_CLIENT_KEY").ok()?,
        client_secret: std::env::var("TIKTOK_CLIENT_SECRET").ok()?,
        redirect_uri: std::env::var("TIKTOK_REDIRECT_URI").ok()?,
        kind: ProviderKind::Userinfo,
    })
}

fn provider(name: &str) -> Option<Provider> {
    match name {
        "google" => google(),
        "apple" => apple(),
        "facebook" => facebook(),
        "tiktok" => tiktok(),
        _ => None,
    }
}

// ── HMAC-signed, stateless state ──────────────────────────────────────────────
fn secret() -> Vec<u8> {
    // The dev fallback is guarded at boot: a release build refuses to start on it
    // (config::validate_secret, CASE 0013) — so this branch only runs in dev.
    std::env::var("NUMU_SECRET")
        .unwrap_or_else(|_| crate::config::DEV_SECRET.into())
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
/// The canonical identity a provider yields: `(sub, email, email_verified, name, picture)`.
type ProviderIdentity = (String, Option<String>, Option<bool>, String, Option<String>);

/// Provider-specific extraction of the canonical OUTPUT from the userinfo JSON. (Google/FB/TikTok are
/// userinfo-shaped; Apple, E2, supplies the same shape from a verified id_token.)
fn extract_identity(userinfo: &Value) -> AppResult<ProviderIdentity> {
    // TikTok nests the user under data.user; Google/Facebook are flat. The subject is `sub` (OIDC),
    // `id` (Facebook), or `open_id` (TikTok); the name is `name` or `display_name`. Email may be absent
    // (app-review-gated) — identity always resolves by (provider, sub), never by email. The avatar is
    // `picture` (OIDC/Google) or `avatar_url` (TikTok) — provider-owned, refreshed on every login.
    let root = userinfo
        .get("data")
        .and_then(|d| d.get("user"))
        .unwrap_or(userinfo);
    let sub = root
        .get("sub")
        .or_else(|| root.get("id"))
        .or_else(|| root.get("open_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::bad_request("provider returned no subject"))?
        .to_string();
    let email = root
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let email_verified = bool_ish(root.get("email_verified"));
    let name = root
        .get("name")
        .or_else(|| root.get("display_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let picture = root
        .get("picture")
        .or_else(|| root.get("avatar_url"))
        .and_then(|v| v.as_str())
        .filter(|s| s.starts_with("https://"))
        .map(str::to_string);
    Ok((sub, email, email_verified, name, picture))
}

/// Providers ship `email_verified` as a bool (Google userinfo) or a string ("true" — Apple id_token).
fn bool_ish(v: Option<&Value>) -> Option<bool> {
    match v {
        Some(Value::Bool(b)) => Some(*b),
        Some(Value::String(s)) => Some(s == "true"),
        _ => None,
    }
}

// ── the login allowlist (prod hardening, CASE 0021) ─────────────────────────
/// Pure allowlist check. Empty lists = open (today's dev behavior). When ANY list is configured,
/// login requires a provider-VERIFIED email that matches an allowed address or domain — the
/// server-side layer behind the Internal (Workspace-only) OAuth consent screen.
fn identity_allowed(
    email: Option<&str>,
    email_verified: Option<bool>,
    domains: &[String],
    emails: &[String],
) -> bool {
    if domains.is_empty() && emails.is_empty() {
        return true;
    }
    let Some(email) = email else { return false };
    if email_verified != Some(true) {
        return false;
    }
    let email = email.to_ascii_lowercase();
    if emails.iter().any(|e| e == &email) {
        return true;
    }
    match email.rsplit_once('@') {
        Some((_, dom)) => domains.iter().any(|d| d == dom),
        None => false,
    }
}

fn env_list(key: &str) -> Vec<String> {
    std::env::var(key)
        .map(|v| {
            v.split(',')
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// `NUMU_AUTH_ALLOWED_DOMAINS` / `NUMU_AUTH_ALLOWED_EMAILS` (comma lists; read once).
fn allowlist() -> &'static (Vec<String>, Vec<String>) {
    use std::sync::OnceLock;
    static LISTS: OnceLock<(Vec<String>, Vec<String>)> = OnceLock::new();
    LISTS.get_or_init(|| {
        (
            env_list("NUMU_AUTH_ALLOWED_DOMAINS"),
            env_list("NUMU_AUTH_ALLOWED_EMAILS"),
        )
    })
}

/// Find the actor linked to (provider, sub) — refreshing its provider-owned fields — or mint one
/// (actor entity + identity) in a txn.
async fn upsert_identity(
    pool: &PgPool,
    provider: &str,
    sub: &str,
    email: Option<&str>,
    name: &str,
    picture: Option<&str>,
) -> AppResult<String> {
    if let Some(actor_id) = sqlx::query_scalar::<_, String>(
        "select actor_id from auth_identities where provider = $1 and sub = $2",
    )
    .bind(provider)
    .bind(sub)
    .fetch_optional(pool)
    .await?
    {
        refresh_identity(pool, &actor_id, name, picture).await?;
        return Ok(actor_id);
    }
    let actor_id = ids::mint("USR");
    let handle = format!("u_{}", &actor_id[4..14.min(actor_id.len())]);
    // seed first/last from the provider's name (first token / the rest); display_name stays the
    // whole name and a later user edit is never clobbered (refresh_identity's backfill rule).
    let (first, last) = name.split_once(' ').unwrap_or((name, ""));
    let data = json!({
        "display_name": if name.is_empty() { handle.as_str() } else { name },
        "handle": handle,
        "email": email,
        "kind": "human",
        "platform_role": "member",
        "status": "active",
        "avatar_url": picture,
        "first_name": if first.is_empty() { Value::Null } else { json!(first) },
        "last_name": if last.is_empty() { Value::Null } else { json!(last) },
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

/// Refresh the provider-OWNED identity fields on an existing actor at login: `avatar_url` follows
/// the provider whenever it changes; `display_name` is only BACKFILLED while it still wears the
/// auto-minted handle (a user's own edit is never clobbered by a login).
async fn refresh_identity(
    pool: &PgPool,
    actor_id: &str,
    name: &str,
    picture: Option<&str>,
) -> AppResult<()> {
    let data: Option<Value> = sqlx::query_scalar(
        "select data from entity_data where entity_id = $1 and type_id = 'actor'",
    )
    .bind(actor_id)
    .fetch_optional(pool)
    .await?;
    let Some(data) = data else { return Ok(()) };
    let mut patch = serde_json::Map::new();
    if let Some(pic) = picture {
        if data.get("avatar_url").and_then(|v| v.as_str()) != Some(pic) {
            patch.insert("avatar_url".into(), json!(pic));
        }
    }
    let current = data
        .get("display_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let handle = data.get("handle").and_then(|v| v.as_str()).unwrap_or("");
    if !name.is_empty() && (current.is_empty() || current == handle) && current != name {
        patch.insert("display_name".into(), json!(name));
    }
    if !patch.is_empty() {
        sqlx::query(
            "update entity_data set data = data || $2, updated_at = now() \
             where entity_id = $1 and type_id = 'actor'",
        )
        .bind(actor_id)
        .bind(Value::Object(patch))
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct IdClaims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    /// Apple ships this as a bool OR the string "true" — coerced via `bool_ish`.
    #[serde(default)]
    email_verified: Option<Value>,
    #[serde(default)]
    nonce: Option<String>,
}

/// Verify an OIDC `id_token` (Apple): RS256 against the provider's JWKS (kid-matched), audience ==
/// client_id, issuer, `exp` (default leeway), and the `nonce` == the per-flow value. Any failure → 401
/// (an untrusted token must never mint a session). The JWKS fetch goes through the SSRF gate.
pub async fn verify_id_token(
    id_token: &str,
    client_id: &str,
    issuer: &str,
    jwks_url: &str,
    fetcher: &dyn Fetcher,
    expected_nonce: &str,
) -> AppResult<(String, Option<String>, Option<bool>)> {
    use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
    let header = decode_header(id_token).map_err(|_| AppError::unauthorized())?;
    let kid = header.kid.ok_or_else(AppError::unauthorized)?;
    let jwks = fetcher.get_json(jwks_url, None).await?;
    let jwk = jwks
        .get("keys")
        .and_then(|k| k.as_array())
        .ok_or_else(AppError::unauthorized)?
        .iter()
        .find(|k| k.get("kid").and_then(|v| v.as_str()) == Some(kid.as_str()))
        .ok_or_else(AppError::unauthorized)?;
    let n = jwk
        .get("n")
        .and_then(|v| v.as_str())
        .ok_or_else(AppError::unauthorized)?;
    let e = jwk
        .get("e")
        .and_then(|v| v.as_str())
        .ok_or_else(AppError::unauthorized)?;
    let key = DecodingKey::from_rsa_components(n, e).map_err(|_| AppError::unauthorized())?;
    let mut v = Validation::new(Algorithm::RS256);
    v.set_audience(&[client_id]);
    v.set_issuer(&[issuer]);
    let data = decode::<IdClaims>(id_token, &key, &v).map_err(|_| AppError::unauthorized())?;
    if data.claims.nonce.as_deref() != Some(expected_nonce) {
        return Err(AppError::unauthorized());
    }
    let verified = bool_ish(data.claims.email_verified.as_ref());
    Ok((data.claims.sub, data.claims.email, verified))
}

/// Exchange code→token, derive the identity (userinfo OR a verified id_token), upsert by (provider, sub),
/// mint a session → the session `Set-Cookie`. Takes a `&dyn Fetcher`, so it's tested with a mock (E1/E2).
pub async fn complete_login(
    pool: &PgPool,
    p: &Provider,
    fetcher: &dyn Fetcher,
    code: &str,
    nonce: &str,
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
    let (sub, email, email_verified, name, picture) = match &p.kind {
        ProviderKind::Userinfo => {
            let access = token
                .get("access_token")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::bad_request("token endpoint returned no access_token"))?;
            let userinfo = fetcher.get_json(&p.userinfo_url, Some(access)).await?;
            extract_identity(&userinfo)?
        }
        ProviderKind::IdToken { jwks_url, issuer } => {
            let id_token = token
                .get("id_token")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::bad_request("token endpoint returned no id_token"))?;
            let (sub, email, email_verified) =
                verify_id_token(id_token, &p.client_id, issuer, jwks_url, fetcher, nonce).await?;
            (sub, email, email_verified, String::new(), None)
        }
    };
    // The login allowlist (CASE 0021): when configured, only provider-VERIFIED emails on the
    // allowed domains/addresses may mint a session — the server-side layer behind the Internal
    // (Workspace-only) OAuth consent screen. Deny is a plain 401: leak-free, no detail.
    let (domains, emails) = allowlist();
    if !identity_allowed(email.as_deref(), email_verified, domains, emails) {
        return Err(AppError::unauthorized());
    }
    let actor_id = upsert_identity(
        pool,
        &p.name,
        &sub,
        email.as_deref(),
        &name,
        picture.as_deref(),
    )
    .await?;
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
            ("nonce", nonce.as_str()),
        ],
    )
    .map_err(|_| AppError::internal("bad authorize url"))?;
    Ok((
        StatusCode::FOUND,
        [
            (header::LOCATION, url.to_string()),
            (header::SET_COOKIE, state_cookie(&signed)),
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
    // CSRF + freshness: the state rides the SESSION cookie as an `st.`-prefixed signed value
    // (one-cookie multiplexing — see state_cookie()); it must verify, not be expired, and its
    // nonce must equal `state`. Every failure from here on is browser-facing → a redirect
    // (callback_redirect), never a bare problem+json page in the user's tab.
    let result = async {
        let signed = cookie_value(&headers, crate::auth::session_cookie_name())
            .and_then(|v| {
                v.strip_prefix(crate::auth::OAUTH_STATE_PREFIX)
                    .map(str::to_string)
            })
            .ok_or_else(AppError::unauthorized)?;
        let payload = verify_state(&signed).ok_or_else(AppError::unauthorized)?;
        let (nonce, exp) = payload.split_once(':').ok_or_else(AppError::unauthorized)?;
        let exp: u64 = exp.parse().unwrap_or(0);
        if nonce != q.state || now_unix() > exp {
            return Err(AppError::unauthorized());
        }
        // the session Set-Cookie overwrites the in-flight state on the SAME cookie name — no
        // separate clear (there is only one cookie through the Firebase rewrite).
        complete_login(&st.pool, &p, &SsrfFetcher, &q.code, nonce).await
    }
    .await;
    Ok(callback_redirect(result))
}

/// The callback is a BROWSER flow: success carries the session `Set-Cookie` and lands in the
/// console; failure lands on the console (its login page) with a coarse `?error=` slug — the
/// kind only, never detail (the leak-free posture of the JSON errors, kept through the redirect).
fn callback_redirect(result: AppResult<String>) -> Response {
    match result {
        Ok(session) => (
            StatusCode::FOUND,
            [
                (header::SET_COOKIE, session),
                (header::LOCATION, "/console/".to_string()),
            ],
        )
            .into_response(),
        Err(e) => {
            let slug = if e.status == StatusCode::UNAUTHORIZED {
                "denied"
            } else {
                "auth_failed"
            };
            (
                StatusCode::FOUND,
                [(header::LOCATION, format!("/console/?error={slug}"))],
            )
                .into_response()
        }
    }
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

    #[test]
    fn extract_identity_should_take_https_picture_and_avatar_url_alias() {
        let (.., pic) =
            extract_identity(&json!({ "sub": "s", "name": "A", "picture": "https://lh3.g/p.jpg" }))
                .unwrap();
        assert_eq!(pic.as_deref(), Some("https://lh3.g/p.jpg"));
        // TikTok-shaped alias
        let (.., pic) = extract_identity(
            &json!({ "data": { "user": { "open_id": "o", "avatar_url": "https://t/av.png" } } }),
        )
        .unwrap();
        assert_eq!(pic.as_deref(), Some("https://t/av.png"));
        // a non-https avatar never lands in entity data
        let (.., pic) =
            extract_identity(&json!({ "sub": "s", "picture": "http://plain/p.jpg" })).unwrap();
        assert_eq!(pic, None);
    }

    #[test]
    fn callback_redirect_should_land_in_console_or_carry_a_coarse_error() {
        let ok = callback_redirect(Ok("numu_session=tok; Path=/".into()));
        assert_eq!(ok.status(), StatusCode::FOUND);
        assert_eq!(ok.headers().get(header::LOCATION).unwrap(), "/console/");
        assert!(ok.headers().get(header::SET_COOKIE).is_some());

        let denied = callback_redirect(Err(AppError::unauthorized()));
        assert_eq!(denied.status(), StatusCode::FOUND);
        assert_eq!(
            denied.headers().get(header::LOCATION).unwrap(),
            "/console/?error=denied"
        );
        assert!(denied.headers().get(header::SET_COOKIE).is_none());

        let failed = callback_redirect(Err(AppError::bad_request("token endpoint fell over")));
        assert_eq!(
            failed.headers().get(header::LOCATION).unwrap(),
            "/console/?error=auth_failed"
        );
    }

    #[test]
    fn state_cookie_should_ride_the_session_cookie_name_with_prefix() {
        let c = state_cookie("payload.sig");
        assert!(c.starts_with(&format!(
            "{}={}payload.sig;",
            crate::auth::session_cookie_name(),
            crate::auth::OAUTH_STATE_PREFIX
        )));
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn identity_allowed_empty_lists_should_stay_open() {
        assert!(identity_allowed(None, None, &[], &[]));
        assert!(identity_allowed(Some("x@y.z"), Some(false), &[], &[]));
    }

    #[test]
    fn identity_allowed_should_admit_allowed_domain_verified_only() {
        let domains = v(&["numu.im"]);
        assert!(identity_allowed(
            Some("em@numu.im"),
            Some(true),
            &domains,
            &[]
        ));
        // case-insensitive on the email side
        assert!(identity_allowed(
            Some("EM@NUMU.IM"),
            Some(true),
            &domains,
            &[]
        ));
        // unverified / missing verification / no email / wrong domain all deny
        assert!(!identity_allowed(
            Some("em@numu.im"),
            Some(false),
            &domains,
            &[]
        ));
        assert!(!identity_allowed(Some("em@numu.im"), None, &domains, &[]));
        assert!(!identity_allowed(None, Some(true), &domains, &[]));
        assert!(!identity_allowed(
            Some("em@evil.example"),
            Some(true),
            &domains,
            &[]
        ));
    }

    #[test]
    fn identity_allowed_should_admit_exact_email() {
        let emails = v(&["em@numu.im"]);
        assert!(identity_allowed(
            Some("em@numu.im"),
            Some(true),
            &[],
            &emails
        ));
        assert!(!identity_allowed(
            Some("other@numu.im"),
            Some(true),
            &[],
            &emails
        ));
    }

    #[test]
    fn bool_ish_should_coerce_provider_shapes() {
        assert_eq!(bool_ish(Some(&Value::Bool(true))), Some(true));
        assert_eq!(bool_ish(Some(&Value::String("true".into()))), Some(true));
        assert_eq!(bool_ish(Some(&Value::String("false".into()))), Some(false));
        assert_eq!(bool_ish(None), None);
    }
}
