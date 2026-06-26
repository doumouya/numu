//! B3 — registry-native omnisearch. Proves a full-text query finds a matching object by its string field
//! values, that results are reach-filtered (a non-member sees nothing), and that a blank `q` is a 400.
//! See CASE 0008 (B3).
#![cfg(feature = "db-tests")]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::{middleware, Router};
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_api::{auth, members, objects, request_id, search};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn build_app(pool: &PgPool) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    Router::new()
        .nest("/api/objects", objects::router().merge(members::router()))
        .merge(search::router())
        .merge(auth::router())
        .layer(middleware::from_fn(request_id::request_id_layer))
        .with_state(state)
}

async fn login(app: &Router, actor_id: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/auth/dev-login")
        .header("content-type", "application/json")
        .body(Body::from(format!(r#"{{"actor_id":"{actor_id}"}}"#)))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let set = resp.headers().get("set-cookie").unwrap().to_str().unwrap();
    set.split(';').next().unwrap().to_string()
}

async fn req(
    app: &Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie);
    let request = match body {
        Some(j) => builder
            .header("content-type", "application/json")
            .body(Body::from(j.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(request).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, json)
}

#[sqlx::test(migrations = "../../migrations")]
async fn search_finds_and_is_reach_filtered(
    pool: PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;

    let (st, _) = req(
        &app,
        "POST",
        "/api/objects/project",
        &admin,
        Some(r#"{"name":"Findable Widget","slug":"findable-widget"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let (st, _) = req(
        &app,
        "POST",
        "/api/objects/project",
        &admin,
        Some(r#"{"name":"Other Thing","slug":"other-thing"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);

    // admin finds the matching project by a word in its name.
    let (st, res) = req(&app, "GET", "/api/search?q=widget", &admin, None).await;
    assert_eq!(st, StatusCode::OK);
    let titles: Vec<&str> = res["results"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["title"].as_str())
        .collect();
    assert!(
        titles.contains(&"Findable Widget"),
        "expected the widget project, got {titles:?}"
    );

    // a member with no reach sees nothing — search is leak-free like every other read.
    sqlx::query("insert into entities(id,type,created_by) values ('USR_bob','actor','USR_dev')")
        .execute(&pool)
        .await?;
    sqlx::query(
        r#"insert into entity_data(entity_id,type_id,data) values ('USR_bob','actor','{"display_name":"Bob","handle":"bob","kind":"human","platform_role":"member","status":"active"}')"#,
    )
    .execute(&pool)
    .await?;
    let bob = login(&app, "USR_bob").await;
    let (st, res) = req(&app, "GET", "/api/search?q=widget", &bob, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(res["results"].as_array().unwrap().len(), 0);

    // a blank query is a 400.
    let (st, _) = req(&app, "GET", "/api/search?q=", &admin, None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    Ok(())
}
