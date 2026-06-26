//! ② Type-registration API. Proves the keystone: an admin registers a type over HTTP and it's usable
//! IMMEDIATELY (POST /api/types → POST /api/objects/<newtype> with no restart), the enum default applies,
//! OPTIONS self-describes it, and GET /api/types lists it. Plus the gate matrix: non-admin → 403, a taken
//! id_prefix → 409, a bad scope_parent → 422, a required-readonly field without a default → 422.
//! See docs/cases/0007-type-registration-api.md.
#![cfg(feature = "db-tests")]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::{middleware, Router};
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use numu_api::{auth, members, objects, request_id, types};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn build_app(pool: &PgPool) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    // mirror production routing: objects nested under /api/objects, types merged at /api/types.
    Router::new()
        .nest("/api/objects", objects::router().merge(members::router()))
        .merge(types::router())
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

const INVOICE: &str = r#"{
  "type_id":"invoice","id_prefix":"INV","display_name":"Invoice","scope_parents":["project_id"],
  "fields":[
    {"field":"project_id","label":"Project","kind":"ref","required":true,"editable":false,"options":{"ref":"PRJ"}},
    {"field":"amount","label":"Amount","kind":"int","required":true},
    {"field":"status","label":"Status","kind":"enum","options":{"enum":["draft","sent","paid","void"],"default":"draft"}}
  ]}"#;

#[sqlx::test(migrations = "../../migrations")]
async fn register_then_use_with_no_restart(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;

    let (st, _) = req(&app, "POST", "/api/types", &admin, Some(INVOICE)).await;
    assert_eq!(st, StatusCode::CREATED);

    // the new type is live with NO restart — make a project, then file an invoice under it.
    let (st, prj) = req(
        &app,
        "POST",
        "/api/objects/project",
        &admin,
        Some(r#"{"name":"P","slug":"p"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let pid = prj["id"].as_str().unwrap();

    let body = format!(r#"{{"project_id":"{pid}","amount":100}}"#);
    let (st, inv) = req(&app, "POST", "/api/objects/invoice", &admin, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(inv["data"]["status"].as_str(), Some("draft")); // the enum default was applied
    assert_eq!(inv["data"]["amount"].as_i64(), Some(100));

    // OPTIONS self-describes the brand-new type; GET /api/types lists it.
    let (st, opt) = req(&app, "OPTIONS", "/api/objects/invoice", &admin, None).await;
    assert_eq!(st, StatusCode::OK);
    let fields: Vec<&str> = opt["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|f| f["field"].as_str())
        .collect();
    assert!(fields.contains(&"amount") && fields.contains(&"status"));

    let (st, list) = req(&app, "GET", "/api/types", &admin, None).await;
    assert_eq!(st, StatusCode::OK);
    let ids: Vec<&str> = list["types"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["type_id"].as_str())
        .collect();
    assert!(ids.contains(&"invoice"));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn non_admin_cannot_register(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query("insert into entities(id,type,created_by) values ('USR_bob','actor','USR_dev')")
        .execute(&pool)
        .await?;
    sqlx::query(
        r#"insert into entity_data(entity_id,type_id,data) values ('USR_bob','actor','{"display_name":"Bob","handle":"bob","kind":"human","platform_role":"member","status":"active"}')"#,
    )
    .execute(&pool)
    .await?;
    let app = build_app(&pool).await;
    let bob = login(&app, "USR_bob").await;
    let (st, _) = req(&app, "POST", "/api/types", &bob, Some(INVOICE)).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn duplicate_prefix_conflicts(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    // PRJ is the project type's prefix — taken.
    let spec = r#"{"type_id":"widget","id_prefix":"PRJ","display_name":"Widget","fields":[{"field":"name","kind":"text","required":true}]}"#;
    let (st, _) = req(&app, "POST", "/api/types", &admin, Some(spec)).await;
    assert_eq!(st, StatusCode::CONFLICT);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn bad_scope_parent_is_unprocessable(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    // scope_parent names `name`, which is a text field, not a required set-once ref.
    let spec = r#"{"type_id":"widget","id_prefix":"WID","display_name":"Widget","scope_parents":["name"],
      "fields":[{"field":"name","kind":"text","required":true}]}"#;
    let (st, _) = req(&app, "POST", "/api/types", &admin, Some(spec)).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn required_readonly_without_default_is_unprocessable(
    pool: PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    // required + readonly with no default — every create would 422; the validator catches it at registration.
    let spec = r#"{"type_id":"widget","id_prefix":"WID","display_name":"Widget",
      "fields":[{"field":"code","kind":"text","required":true,"perm_class":"readonly"}]}"#;
    let (st, _) = req(&app, "POST", "/api/types", &admin, Some(spec)).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    Ok(())
}
