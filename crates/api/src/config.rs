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
    /// Deny-by-default: empty unless `NUMU_CORS_ORIGINS` is set (localhost dev rides `cors_dev`).
    pub cors_origins: Vec<String>,
    /// `NUMU_CORS_DEV` — localhost dev mode: additionally allowlist any `http://localhost[:port]` /
    /// `http://127.0.0.1[:port]` origin (still the exact-origin echo, never `*`). Off in prod.
    pub cors_dev: bool,
    /// where uploaded file blobs live on disk (`<data_dir>/files/<FIL>.bin`). Default `./data`.
    pub data_dir: std::path::PathBuf,
    /// static frontend root served same-origin via `ServeDir`; `NUMU_WEB_DIR`, default `./web`.
    pub web_dir: std::path::PathBuf,
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
            // comma-separated explicit allowlist. Deny-by-default (Case 0017 F4): when unset, this is
            // EMPTY — all cross-origin requests are denied (same-origin only). Set NUMU_CORS_ORIGINS to
            // your real prod origin(s); localhost cross-origin dev rides NUMU_CORS_DEV=1 instead.
            cors_origins: std::env::var("NUMU_CORS_ORIGINS")
                .map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            cors_dev: env_flag("NUMU_CORS_DEV"),
            data_dir: std::env::var("NUMU_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("./data")),
            web_dir: std::env::var("NUMU_WEB_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("./web")),
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
