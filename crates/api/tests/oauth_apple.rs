//! E2 — Apple id_token verification. A self-generated test RSA key signs an id_token; the mock Fetcher
//! serves the matching JWKS. Proves complete_login verifies RS256 + aud + iss + exp + nonce against the
//! JWKS and logs in, and REJECTS (401) a nonce mismatch and a wrong audience. No live Apple / no network.
//! See docs/cases/0005-rbac-enforcement.md.
#![cfg(feature = "db-tests")]

use axum::http::StatusCode;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use numu_api::error::AppResult;
use numu_api::http_client::Fetcher;
use numu_api::oauth::{complete_login, Provider, ProviderKind};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

// A throwaway 2048-bit RSA test key + its JWK modulus (e = AQAB). NOT a real secret.
const TEST_RSA_PEM: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCgLrOKs877NFGz
EtGyUI1lWFmeDnXjQI8f5vtWL7qYhu6PGzkyZfZtPJK/PQ9Jwd6pKnaD9zEToooI
RXZmWPnc9uluUCAfpzFnUJs527B56N8Pd1R8hNxVTTV730u+umMTqD+vU+jsGLIK
R9qwkoV1oyQ2SAJqzJxKHY5j7xyc1B9LrDdwkO+1UX+u5mp/gerbNFQSbrDsq0Lo
ETnTDNQyFWV0wokxJnnGspjxcYghBXsqv9+BMCbYMEFjWc4FnDahNOp2OPv9v37i
ORm3SNWzo+cgL0VDyoREOKx1cgv9H4mbAy3UGegPLlqiSwk8EplOYWs1cXkQAwe7
/FxpsGo/AgMBAAECggEANy4vYoIztNzeoipC+8L9GqL3aFgB63HTfEF1ZsjVZnLh
HoJZz09Jt3LM+L0/lYCIRE1g+2/9w45UL6pCMdrH5INYgcxvbIgLoFQnzSQtpKmA
ohLRE34vauFIoe4X6VHLDLwCiFMHI8IUHy+Gmho3iIFVWa+vyXvIAU4yPaHjAPEU
LwDDm/wEzSVP/IWT1IS8VWTwou5Z41483Ss0bquEyXUyo5xlAmwU2OBqowD6kgWm
HwQ4TO5hnBtUvOHPTp43g9s3AURf98x/5tDqfAfyuatoEQa6n5JEgAJfKy3B7woG
9yyLrheG5LrijXB9PZvdKQgpATNk6hlYfMFNfCRJMQKBgQDYPFiI6Lq2bgRChTQC
XM8H3OGSebdsLEhK9BKCy7I86CZ3MA1lK4F35IpZwd3KKJ6iq5hBVAG+rFmaPa/K
nTfHVGJoegqnNx8ge+owN5+RKJSVW1mEpDc3hycycMvh+rOabFfdw9skLEWqmR46
QcsYE4nMLJb1QDY63ziFfRaXUQKBgQC9o43G6a0E+XfOC8iGjr5rnNTIY+Rq8IUq
P9HQ70Ix8063vX+PvyuVeanMHFJhxtjKvBOYSir+TArk/SSSOHA/rK0CsO9slKNJ
TKfDSrDW5bFZPI0YO4IKaBf0eb0efEX7W7yfrLIeiO3VGxLSmABGQAPWjwU6eyTh
4lcyGoKkjwKBgCc6I1GK7rxDjxBGO94l2gTyJBW/cO/1xJOcXXNO4qG796ZtmDB/
SPhoBFUuHz8aSVT3TiKjy8E8YPDjOe3GwaSugT+0zBPzovjwodZncNITi4jgzoeK
ht3S7eBvp/zxzv03pGT9r9aLFYRSTLKC1wYiHUBl4mjRYkUh044b2CpRAoGAcApx
eVQWJRo+7j2H+/faCTpffQWHrqbsBkoubILvWROnLmeHNiZ8WZPH/g+9nIcfDqiP
6ynmvNewmBn3wWwW5Yffr/dZfY1T67qeY4N9d3m9jjt4IRkHe56EiKxkT96ceiV5
C928Xs4HtiCIvmOPxfGMUves3yBiahKP8co35YECgYB4oK0COysSEWoTqxY8+4nw
0toSOdaCerKQguSlKrhfNS6LfJk0zYk6hZsMwkiBNFCb3kqkoIYSto2XhPMXFGso
/FlSfEVNIFchmNEqk+cvXg/kqLpjhN9lv3FZxOsG8MtShNwQtMr4JUbKhl5bt8vO
2T3rH15obqdvPIqZQDwR0A==
-----END PRIVATE KEY-----
"#;

const TEST_N: &str = "oC6zirPO-zRRsxLRslCNZVhZng5140CPH-b7Vi-6mIbujxs5MmX2bTySvz0PScHeqSp2g_cxE6KKCEV2Zlj53PbpblAgH6cxZ1CbOduweejfD3dUfITcVU01e99LvrpjE6g_r1Po7BiyCkfasJKFdaMkNkgCasycSh2OY-8cnNQfS6w3cJDvtVF_ruZqf4Hq2zRUEm6w7KtC6BE50wzUMhVldMKJMSZ5xrKY8XGIIQV7Kr_fgTAm2DBBY1nOBZw2oTTqdjj7_b9-4jkZt0jVs6PnIC9FQ8qERDisdXIL_R-JmwMt1BnoDy5aoksJPBKZTmFrNXF5EAMHu_xcabBqPw";

#[derive(Serialize)]
struct IdClaims<'a> {
    sub: &'a str,
    aud: &'a str,
    iss: &'a str,
    exp: u64,
    email: &'a str,
    nonce: &'a str,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn sign_id_token(nonce: &str, aud: &str) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("testkid".into());
    let claims = IdClaims {
        sub: "apple-sub-1",
        aud,
        iss: "https://appleid.apple.com",
        exp: now() + 3600,
        email: "a@apple.com",
        nonce,
    };
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(TEST_RSA_PEM.as_bytes()).unwrap(),
    )
    .unwrap()
}

struct AppleMock {
    id_token: String,
}

#[axum::async_trait]
impl Fetcher for AppleMock {
    async fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> AppResult<Value> {
        Ok(json!({ "id_token": self.id_token }))
    }
    async fn get_json(&self, _url: &str, _bearer: Option<&str>) -> AppResult<Value> {
        Ok(
            json!({ "keys": [{ "kty": "RSA", "kid": "testkid", "use": "sig", "alg": "RS256", "n": TEST_N, "e": "AQAB" }] }),
        )
    }
}

fn apple_provider() -> Provider {
    Provider {
        name: "apple".into(),
        authorize_url: "https://x/a".into(),
        token_url: "https://x/t".into(),
        userinfo_url: String::new(),
        scopes: "name email".into(),
        client_id: "apple-client".into(),
        client_secret: "jwt".into(),
        redirect_uri: "https://x/cb".into(),
        kind: ProviderKind::IdToken {
            jwks_url: "https://x/jwks".into(),
            issuer: "https://appleid.apple.com".into(),
        },
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn verifies_and_logs_in(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let mock = AppleMock {
        id_token: sign_id_token("n1", "apple-client"),
    };
    let cookie = complete_login(&pool, &apple_provider(), &mock, "code", "n1").await?;
    assert!(cookie.starts_with("numu_session="));
    let sub: String =
        sqlx::query_scalar("select sub from auth_identities where provider = 'apple'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(sub, "apple-sub-1");
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn rejects_nonce_mismatch(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let mock = AppleMock {
        id_token: sign_id_token("n1", "apple-client"), // token nonce n1, flow expects n2
    };
    let err = complete_login(&pool, &apple_provider(), &mock, "code", "n2")
        .await
        .unwrap_err();
    assert_eq!(err.status, StatusCode::UNAUTHORIZED);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn rejects_wrong_audience(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let mock = AppleMock {
        id_token: sign_id_token("n1", "WRONG-client"),
    };
    let err = complete_login(&pool, &apple_provider(), &mock, "code", "n1")
        .await
        .unwrap_err();
    assert_eq!(err.status, StatusCode::UNAUTHORIZED);
    Ok(())
}
