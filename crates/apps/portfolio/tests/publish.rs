//! Publish db-tests (CASE 0024): assemble from published entities → site.json + PDF committed
//! via a MOCK GitHost (sha-then-put, correct paths); a second publish with unchanged content is
//! a no-op (the version hash is the idempotence key); non-admin gets the leak-free 404;
//! missing content pieces fail loudly (422), never a half-empty site.
#![cfg(feature = "db-tests")]

use std::sync::Mutex;

use numu_api::caller::Caller;
use numu_api::error::AppResult;
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_app_portfolio::github::{GitHost, Target};
use numu_app_portfolio::publish::publish_core;
use serde_json::{json, Value};
use sqlx::PgPool;

type R = Result<(), Box<dyn std::error::Error>>;

/// In-memory GitHost: files live in a map; puts are recorded.
#[derive(Default)]
struct MockHost {
    files: Mutex<std::collections::HashMap<String, Vec<u8>>>,
    puts: Mutex<Vec<String>>,
}

#[axum::async_trait]
impl GitHost for MockHost {
    async fn get_file(&self, _t: &Target, path: &str) -> AppResult<Option<(String, Vec<u8>)>> {
        Ok(self
            .files
            .lock()
            .unwrap()
            .get(path)
            .map(|b| ("mocksha".to_string(), b.clone())))
    }
    async fn put_file(
        &self,
        _t: &Target,
        path: &str,
        _message: &str,
        content: &[u8],
        _prev_sha: Option<&str>,
    ) -> AppResult<String> {
        self.files
            .lock()
            .unwrap()
            .insert(path.to_string(), content.to_vec());
        self.puts.lock().unwrap().push(path.to_string());
        Ok("commitsha".to_string())
    }
}

async fn state(pool: &PgPool) -> Result<AppState, Box<dyn std::error::Error>> {
    Ok(AppState::new(
        pool.clone(),
        TypeDefCache::load(pool).await?,
        WorkflowCache::load(pool).await?,
    ))
}

async fn seed_entity(pool: &PgPool, id: &str, type_id: &str, data: Value) -> sqlx::Result<()> {
    sqlx::query("insert into entities(id, type, created_by) values ($1, $2, 'USR_dev')")
        .bind(id)
        .bind(type_id)
        .execute(pool)
        .await?;
    sqlx::query("insert into entity_data(entity_id, type_id, data) values ($1, $2, $3)")
        .bind(id)
        .bind(type_id)
        .bind(data)
        .execute(pool)
        .await?;
    Ok(())
}

async fn seed_content(pool: &PgPool) -> sqlx::Result<()> {
    seed_entity(
        pool,
        "ART_1",
        "article",
        json!({ "slug": "the-orchestrator", "label": "The orchestrator", "tag": "METHOD",
                "md": "# The orchestrator\n\n### How I run a fleet.", "published": true, "ordinal": 1 }),
    )
    .await?;
    seed_entity(
        pool,
        "ART_2",
        "article",
        json!({ "slug": "draft-essay", "label": "Draft", "tag": "DATA",
                "md": "# Draft", "published": false, "ordinal": 2 }),
    )
    .await?;
    for (id, key, md) in [
        ("SCP_1", "overview.lead", "AI Software Engineer."),
        (
            "SCP_2",
            "overview.body",
            "This site boots into **Datacore**.",
        ),
        ("SCP_3", "overview.muted", "Honest framing: solo builds."),
    ] {
        seed_entity(pool, id, "site_copy", json!({ "key": key, "md": md })).await?;
    }
    seed_entity(
        pool,
        "CVD_1",
        "cv",
        json!({ "name": "CV", "doc": {
            "name": "EMMANUEL DOUMOUYA", "headline": "AI Software Engineer",
            "contact": "Dublin", "links": [], "summary": "Engineer.",
            "sections": [ { "id": "w", "title": "Work", "entries": [
                { "head": "**numu**", "bullets": ["Built it."] } ] } ]
        }}),
    )
    .await?;
    Ok(())
}

#[sqlx::test(migrations = "../../../migrations")]
async fn publish_commits_both_artifacts_then_noops(pool: PgPool) -> R {
    // GITHUB_TOKEN must exist for the core (value is irrelevant against the mock)
    std::env::set_var("GITHUB_TOKEN", "test-token");
    seed_content(&pool).await?;
    let st = state(&pool).await?;
    let host = MockHost::default();
    let admin = Caller::console("USR_dev", true);

    let out = publish_core(&st, &admin, &host).await?;
    let committed: Vec<&str> = out["committed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(
        committed,
        vec![
            "portfolio/content/site.json",
            "portfolio/cv/Emmanuel_Doumouya_CV.pdf"
        ]
    );

    // the shipped site.json: only the PUBLISHED article, overview assembled, version stamped
    let files = host.files.lock().unwrap();
    let site: Value = serde_json::from_slice(&files["portfolio/content/site.json"])?;
    assert_eq!(site["articles"].as_array().unwrap().len(), 1);
    assert_eq!(site["articles"][0]["id"], "the-orchestrator");
    assert_eq!(site["overview"]["lead"], "AI Software Engineer.");
    assert_eq!(site["version"], out["version"]);
    assert!(files["portfolio/cv/Emmanuel_Doumouya_CV.pdf"].starts_with(b"%PDF"));
    drop(files);

    // unchanged content → no writes, both paths skipped
    let again = publish_core(&st, &admin, &host).await?;
    assert!(again["committed"].as_array().unwrap().is_empty());
    assert_eq!(host.puts.lock().unwrap().len(), 2, "no extra puts");
    Ok(())
}

#[sqlx::test(migrations = "../../../migrations")]
async fn publish_gates_and_fails_loudly(pool: PgPool) -> R {
    std::env::set_var("GITHUB_TOKEN", "test-token");
    let st = state(&pool).await?;
    let host = MockHost::default();

    // non-admin → leak-free 404
    let member = Caller::console("USR_member", false);
    assert!(publish_core(&st, &member, &host).await.is_err());

    // admin but NO content yet → 422, nothing committed
    let admin = Caller::console("USR_dev", true);
    assert!(publish_core(&st, &admin, &host).await.is_err());
    assert!(host.puts.lock().unwrap().is_empty());
    Ok(())
}
