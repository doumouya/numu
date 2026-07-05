//! github — the publish pipeline's Contents-API client (CASE 0024). One pinned host
//! (`api.github.com`), mirroring the SsrfFetcher hardening recipe: https-only, NO redirects,
//! 10s timeout, capped response reads. The token is a fine-grained PAT scoped to contents:rw on
//! the ONE portfolio repo (env `GITHUB_TOKEN` via Secret Manager in prod — docs/ops/DEPLOY.md);
//! it is never logged. Behind a trait so publish tests run against a mock.

use base64::Engine;
use numu_api::error::{AppError, AppResult};
use serde_json::{json, Value};

const API: &str = "https://api.github.com";
const MAX_RESPONSE: usize = 5 * 1024 * 1024; // our two files are far smaller; cap reads anyway

/// The publish destination: one repo, one branch, one token — grouped so every call names the
/// whole target once instead of threading three loose strings.
pub struct Target {
    pub repo: String,
    pub branch: String,
    pub token: String,
}

#[axum::async_trait]
pub trait GitHost: Send + Sync {
    /// Current blob (sha, decoded bytes) at `path`, or None if absent.
    async fn get_file(&self, t: &Target, path: &str) -> AppResult<Option<(String, Vec<u8>)>>;
    /// Create/update `path`; `prev_sha` required for updates. Returns the commit sha.
    async fn put_file(
        &self,
        t: &Target,
        path: &str,
        message: &str,
        content: &[u8],
        prev_sha: Option<&str>,
    ) -> AppResult<String>;
}

pub struct GitHub {
    client: reqwest::Client,
}

impl GitHub {
    pub fn new() -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("numu-portfolio-publisher")
            .build()
            .map_err(|_| AppError::internal("http client"))?;
        Ok(Self { client })
    }

    fn url(repo: &str, path: &str) -> String {
        format!("{API}/repos/{repo}/contents/{path}")
    }
}

impl Default for GitHub {
    fn default() -> Self {
        Self::new().unwrap_or_else(|_| unreachable!("static client config"))
    }
}

async fn read_capped(resp: reqwest::Response) -> AppResult<Value> {
    if resp.content_length().unwrap_or(0) as usize > MAX_RESPONSE {
        return Err(AppError::internal("github response too large"));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| AppError::internal("github read"))?;
    if bytes.len() > MAX_RESPONSE {
        return Err(AppError::internal("github response too large"));
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::internal("github json"))
}

#[axum::async_trait]
impl GitHost for GitHub {
    async fn get_file(&self, t: &Target, path: &str) -> AppResult<Option<(String, Vec<u8>)>> {
        let resp = self
            .client
            .get(Self::url(&t.repo, path))
            .query(&[("ref", t.branch.as_str())])
            .bearer_auth(&t.token)
            .header("accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|_| AppError::internal("github get"))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(AppError::internal(format!(
                "github get failed: {}",
                resp.status()
            )));
        }
        let v = read_capped(resp).await?;
        let sha = v
            .get("sha")
            .and_then(|s| s.as_str())
            .ok_or_else(|| AppError::internal("github get: no sha"))?
            .to_string();
        // content is base64 with embedded newlines
        let b64: String = v
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap_or_default();
        Ok(Some((sha, bytes)))
    }

    async fn put_file(
        &self,
        t: &Target,
        path: &str,
        message: &str,
        content: &[u8],
        prev_sha: Option<&str>,
    ) -> AppResult<String> {
        let mut body = json!({
            "message": message,
            "branch": t.branch,
            "content": base64::engine::general_purpose::STANDARD.encode(content),
        });
        if let Some(sha) = prev_sha {
            body["sha"] = json!(sha);
        }
        let resp = self
            .client
            .put(Self::url(&t.repo, path))
            .bearer_auth(&t.token)
            .header("accept", "application/vnd.github+json")
            .json(&body)
            .send()
            .await
            .map_err(|_| AppError::internal("github put"))?;
        if !resp.status().is_success() {
            return Err(AppError::internal(format!(
                "github put failed: {}",
                resp.status()
            )));
        }
        let v = read_capped(resp).await?;
        Ok(v.get("commit")
            .and_then(|c| c.get("sha"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string())
    }
}
