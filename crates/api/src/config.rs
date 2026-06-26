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
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let database_url = std::env::var("DATABASE_URL").map_err(|_| {
            "DATABASE_URL is not set (e.g. postgres://user@localhost/numu)".to_string()
        })?;
        Ok(Self {
            bind: std::env::var("NUMU_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            database_url,
            debug: env_flag("NUMU_DEBUG"),
            auth_rate_limit: env_parse("NUMU_AUTH_RATE_LIMIT", 30),
            auth_rate_window_secs: env_parse("NUMU_AUTH_RATE_WINDOW_SECS", 60),
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
