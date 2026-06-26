//! E1 — OAuth flow test with a MOCK Fetcher (no live server, no SSRF-gate bypass). Proves
//! complete_login: first login mints an actor + identity + session; a second login with the SAME (provider,
//! sub) resolves to the SAME actor (upsert by sub, never email). See docs/cases/0005-rbac-enforcement.md.
#![cfg(feature = "db-tests")]

use numu_api::error::AppResult;
use numu_api::http_client::Fetcher;
use numu_api::oauth::{complete_login, Provider};
use serde_json::{json, Value};
use sqlx::PgPool;

struct Mock {
    token: Value,
    userinfo: Value,
}

#[axum::async_trait]
impl Fetcher for Mock {
    async fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> AppResult<Value> {
        Ok(self.token.clone())
    }
    async fn get_json(&self, _url: &str, _bearer: Option<&str>) -> AppResult<Value> {
        Ok(self.userinfo.clone())
    }
}

fn test_provider() -> Provider {
    Provider {
        name: "google".into(),
        authorize_url: "https://x/a".into(),
        token_url: "https://x/t".into(),
        userinfo_url: "https://x/u".into(),
        scopes: "openid email profile".into(),
        client_id: "cid".into(),
        client_secret: "secret".into(),
        redirect_uri: "https://x/cb".into(),
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn google_login_upserts_by_sub(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let mock = Mock {
        token: json!({ "access_token": "at" }),
        userinfo: json!({ "sub": "g-123", "email": "a@b.com", "name": "Alice" }),
    };
    let p = test_provider();

    // first login → an actor entity + identity + a session cookie
    let cookie = complete_login(&pool, &p, &mock, "code1").await?;
    assert!(cookie.starts_with("numu_session="));
    let actor: String = sqlx::query_scalar(
        "select actor_id from auth_identities where provider = 'google' and sub = 'g-123'",
    )
    .fetch_one(&pool)
    .await?;
    let typ: String = sqlx::query_scalar("select type from entities where id = $1")
        .bind(&actor)
        .fetch_one(&pool)
        .await?;
    assert_eq!(typ, "actor");
    let email: Option<String> =
        sqlx::query_scalar("select data->>'email' from entity_data where entity_id = $1")
            .bind(&actor)
            .fetch_one(&pool)
            .await?;
    assert_eq!(email.as_deref(), Some("a@b.com"));

    // second login with the SAME sub → SAME actor, no duplicate
    let _ = complete_login(&pool, &p, &mock, "code2").await?;
    let identities: i64 =
        sqlx::query_scalar("select count(*) from auth_identities where sub = 'g-123'")
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        identities, 1,
        "upsert by (provider, sub) — no duplicate identity"
    );
    let new_actors: i64 = sqlx::query_scalar(
        "select count(*) from entities where type = 'actor' and id <> 'USR_dev'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(new_actors, 1, "exactly one actor minted for the sub");
    Ok(())
}
