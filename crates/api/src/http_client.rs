//! E0 — the SSRF-gated outbound client. EVERY provider token/userinfo/JWKS fetch goes through here:
//! https-only, redirect=none, resolve + PIN the host IP (no TOCTOU), reject any private/loopback/
//! link-local/metadata address (the cloud-metadata SSRF class), timeout, body cap. The OAuth flow takes a
//! `Fetcher` (this in prod, a mock in tests) so the provider logic is testable without a live server.
//! (the http skill's ssrf-gate.md / client.md.)

use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use axum::http::StatusCode;
use serde_json::Value;

use crate::error::{AppError, AppResult};

const MAX_BODY: usize = 1 << 20; // 1 MiB
const TIMEOUT: Duration = Duration::from_secs(10);

/// The outbound JSON fetcher the OAuth providers call. Prod = `SsrfFetcher`; tests inject a mock.
#[axum::async_trait]
pub trait Fetcher: Send + Sync {
    /// POST `application/x-www-form-urlencoded`, parse the JSON response (the OAuth token endpoint).
    async fn post_form(&self, url: &str, form: &[(&str, &str)]) -> AppResult<Value>;
    /// GET with an optional `Bearer` token, parse the JSON response (userinfo / JWKS).
    async fn get_json(&self, url: &str, bearer: Option<&str>) -> AppResult<Value>;
}

/// True if an IP must NEVER be the target of an outbound fetch (the SSRF blocklist).
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_v4(v4);
            }
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

fn is_blocked_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local() // 169.254/16 — incl. the 169.254.169.254 metadata endpoint
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || o[0] == 0 // 0.0.0.0/8
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // CGNAT 100.64/10
}

fn net_err(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::new(
            StatusCode::GATEWAY_TIMEOUT,
            "upstream_timeout",
            "upstream timed out",
        )
    } else {
        AppError::new(
            StatusCode::BAD_GATEWAY,
            "upstream_error",
            "upstream request failed",
        )
    }
}

/// Build a reqwest client that can only reach the gated, IP-pinned host (https, no redirects).
async fn guarded_client(url: &str) -> AppResult<(reqwest::Client, reqwest::Url)> {
    let parsed = reqwest::Url::parse(url).map_err(|_| AppError::bad_request("invalid url"))?;
    if parsed.scheme() != "https" {
        return Err(AppError::bad_request("only https outbound is allowed"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::bad_request("url has no host"))?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| AppError::bad_request("dns resolution failed"))?
        .collect();
    if addrs.is_empty() {
        return Err(AppError::bad_request("host did not resolve"));
    }
    // Reject if ANY resolved address is blocked, then PIN the first (so reqwest can't re-resolve to a
    // different, unchecked address — closes the DNS-rebinding/TOCTOU window).
    for a in &addrs {
        if is_blocked_ip(a.ip()) {
            return Err(AppError::new(
                StatusCode::FORBIDDEN,
                "ssrf_blocked",
                "destination not allowed",
            ));
        }
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .resolve(&host, addrs[0])
        .build()
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok((client, parsed))
}

async fn read_json(resp: reqwest::Response) -> AppResult<Value> {
    if !resp.status().is_success() {
        return Err(AppError::bad_request(format!(
            "upstream returned {}",
            resp.status()
        )));
    }
    let bytes = resp.bytes().await.map_err(net_err)?;
    if bytes.len() > MAX_BODY {
        return Err(AppError::bad_request("upstream body too large"));
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::bad_request("upstream returned non-JSON"))
}

/// The production fetcher — reqwest behind the SSRF gate.
pub struct SsrfFetcher;

#[axum::async_trait]
impl Fetcher for SsrfFetcher {
    async fn post_form(&self, url: &str, form: &[(&str, &str)]) -> AppResult<Value> {
        let (client, url) = guarded_client(url).await?;
        let resp = client.post(url).form(form).send().await.map_err(net_err)?;
        read_json(resp).await
    }

    async fn get_json(&self, url: &str, bearer: Option<&str>) -> AppResult<Value> {
        let (client, url) = guarded_client(url).await?;
        let mut req = client.get(url);
        if let Some(b) = bearer {
            req = req.bearer_auth(b);
        }
        let resp = req.send().await.map_err(net_err)?;
        read_json(resp).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_the_ssrf_classes() {
        let blocked = [
            "169.254.169.254", // cloud metadata
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.1",
            "172.16.0.1",
            "0.0.0.0",
            "100.64.0.1", // CGNAT
            "::1",
            "fd00::1",                // unique-local
            "fe80::1",                // link-local
            "::ffff:169.254.169.254", // IPv4-mapped metadata
        ];
        for s in blocked {
            assert!(is_blocked_ip(s.parse().unwrap()), "{s} must be blocked");
        }
        let allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
        for s in allowed {
            assert!(!is_blocked_ip(s.parse().unwrap()), "{s} must be allowed");
        }
    }
}
