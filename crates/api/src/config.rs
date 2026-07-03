//! Typed configuration, read from the environment in ONE place so the rest of the app takes values rather
//! than scattering `std::env` reads. `run()` builds this once at boot. (docs/cases/0008-backend-completion.md B4.)

/// The boot-time config. Missing optionals fall back to safe defaults; only `DATABASE_URL` is required.
pub struct Config {
    pub bind: String,
    pub database_url: String,
    /// gates `/api/_debug/echo` (the re-homed TRACE) — off unless `NUMU_DEBUG=1`.
    pub debug: bool,
    /// per-client `/auth` fixed-window limit (requests per window).
    pub auth_rate_limit: u32,
    pub auth_rate_window_secs: u64,
    /// browser origins allowed to call the API with credentials (the frontend's dev/prod origins).
    pub cors_origins: Vec<String>,
}

/// The insecure dev fallback for `NUMU_SECRET` (oauth.rs signs the OAuth state cookie with it).
/// A release build must never run on this value — see `validate_secret`.
pub(crate) const DEV_SECRET: &str = "dev-insecure-secret-change-me";

/// `NUMU_SECRET` boot guard (ASSESSMENT S-1, CASE 0013): in a release build, an unset or
/// dev-literal secret is a boot ERROR — a forgotten env var must not ship a forgeable OAuth
/// state cookie. Dev builds keep the fallback (oauth.rs) but get a loud stderr warning here.
fn validate_secret(secret: Option<&str>, release: bool) -> Result<(), String> {
    match secret {
        Some(s) if !s.is_empty() && s != DEV_SECRET => Ok(()),
        _ if !release => {
            eprintln!(
                "WARN: NUMU_SECRET is unset or the dev literal — OK in dev, a release build refuses to boot on this."
            );
            Ok(())
        }
        _ => Err(
            "NUMU_SECRET is unset or equals the dev literal — a release build refuses to boot \
             (the OAuth state cookie would be forgeable). Set NUMU_SECRET to a strong random value."
                .to_string(),
        ),
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let database_url = std::env::var("DATABASE_URL").map_err(|_| {
            "DATABASE_URL is not set (e.g. postgres://user@localhost/numu)".to_string()
        })?;
        let secret = std::env::var("NUMU_SECRET").ok();
        validate_secret(secret.as_deref(), !cfg!(debug_assertions))?;
        Ok(Self {
            bind: std::env::var("NUMU_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            database_url,
            debug: env_flag("NUMU_DEBUG"),
            auth_rate_limit: env_parse("NUMU_AUTH_RATE_LIMIT", 30),
            auth_rate_window_secs: env_parse("NUMU_AUTH_RATE_WINDOW_SECS", 60),
            // comma-separated; defaults cover the common Vite/Next dev ports so a local frontend works
            // out of the box. Set NUMU_CORS_ORIGINS to your real origin(s) in any other setup.
            cors_origins: std::env::var("NUMU_CORS_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_else(|_| {
                    vec![
                        "http://localhost:5173".to_string(),
                        "http://localhost:3000".to_string(),
                    ]
                }),
        })
    }
}

/// `true` for `1`/`true` (case-insensitive); any other value (or unset) is `false`.
pub fn env_flag(key: &str) -> bool {
    std::env::var(key).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_secret_release_should_refuse_unset() {
        assert!(validate_secret(None, true).is_err());
    }

    #[test]
    fn validate_secret_release_should_refuse_dev_literal() {
        assert!(validate_secret(Some(DEV_SECRET), true).is_err());
    }

    #[test]
    fn validate_secret_release_should_accept_real_value() {
        assert!(validate_secret(Some("a-strong-random-value"), true).is_ok());
    }

    #[test]
    fn validate_secret_dev_should_allow_fallback() {
        assert!(validate_secret(None, false).is_ok());
        assert!(validate_secret(Some(DEV_SECRET), false).is_ok());
    }
}
