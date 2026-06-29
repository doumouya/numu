//! G4.1 — the Cases workflow engine over HTTP. Proves a case is created at the workflow's initial state,
//! a legal status move succeeds (and the typed `cases` mirror stays in sync), an illegal skip is
//! `422 illegal_transition`, and a case can't be created in a non-initial state. See CASE 0006.
#![cfg(feature = "db-tests")]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use numu_api::config::Config;
use numu_api::registry::TypeDefCache;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

/// Case 0017 / AC7 — drive the REAL layered stack via the one canonical `build_router`.
async fn build_app(pool: &PgPool) -> Router {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    let state = AppState::new(pool.clone(), registry, workflows);
    numu_api::build_router(state, &test_cfg())
}

fn test_cfg() -> Config {
    Config {
        bind: "127.0.0.1:0".to_string(),
        database_url: "postgres://localhost/never".to_string(),
        debug: false,
        auth_rate_limit: 30,
        auth_rate_window_secs: 60,
        cors_origins: vec!["https://app.example".to_string()],
        data_dir: std::path::PathBuf::from("."),
        web_dir: std::path::PathBuf::from("."),
    }
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

/// Send a request; return (status, ETag, body json).
async fn req(
    app: &Router,
    method: &str,
    uri: &str,
    cookie: &str,
    if_match: Option<&str>,
    body: Option<&str>,
) -> (StatusCode, Option<String>, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(uri)
        .header("cookie", cookie);
    if let Some(m) = if_match {
        b = b.header("if-match", m);
    }
    let request = match body {
        Some(j) => b
            .header("content-type", "application/json")
            .body(Body::from(j.to_string()))
            .unwrap(),
        None => b.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(request).await.unwrap();
    let status = resp.status();
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, etag, json)
}

async fn make_project(app: &Router, admin: &str) -> String {
    let (st, _, prj) = req(
        app,
        "POST",
        "/project",
        admin,
        None,
        Some(r#"{"name":"P","slug":"p"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    prj["id"].as_str().unwrap().to_string()
}

async fn patch_status(
    app: &Router,
    cid: &str,
    admin: &str,
    etag: Option<&str>,
    status: &str,
) -> (StatusCode, Option<String>) {
    let body = format!(r#"{{"status":"{status}"}}"#);
    let (st, e, _) = req(
        app,
        "PATCH",
        &format!("/case/{cid}"),
        admin,
        etag,
        Some(&body),
    )
    .await;
    (st, e)
}

#[sqlx::test(migrations = "../../migrations")]
async fn close_gate_blocks_done_until_checks_pass(
    pool: PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let pid = make_project(&app, &admin).await;
    let body = format!(r#"{{"title":"T","type":"task","project_id":"{pid}"}}"#);
    let (_, etag, c) = req(&app, "POST", "/case", &admin, None, Some(&body)).await;
    let cid = c["id"].as_str().unwrap().to_string();

    // walk backlog -> todo -> in_progress -> in_review
    let (st, e) = patch_status(&app, &cid, &admin, etag.as_deref(), "todo").await;
    assert_eq!(st, StatusCode::OK);
    let (st, e) = patch_status(&app, &cid, &admin, e.as_deref(), "in_progress").await;
    assert_eq!(st, StatusCode::OK);
    let (st, review_etag) = patch_status(&app, &cid, &admin, e.as_deref(), "in_review").await;
    assert_eq!(st, StatusCode::OK);

    // in_review -> done WITHOUT docs_reconciled: blocked by the close gate
    let (st, _, err) = req(
        &app,
        "PATCH",
        &format!("/case/{cid}"),
        &admin,
        review_etag.as_deref(),
        Some(r#"{"status":"done"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["kind"].as_str(), Some("close_preconditions_unmet"));

    // record the close-check passed (the failed move didn't bump the version, so the etag still holds)
    let (st, _, _) = req(
        &app,
        "POST",
        &format!("/case/{cid}/checks/docs_reconciled"),
        &admin,
        None,
        Some(r#"{"passed":true}"#),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // now the terminal move is allowed
    let (st, _) = patch_status(&app, &cid, &admin, review_etag.as_deref(), "done").await;
    assert_eq!(st, StatusCode::OK);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn case_workflow_transitions(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let pid = make_project(&app, &admin).await;

    // a case starts at the workflow's initial state (backlog)
    let body = format!(r#"{{"title":"T","type":"task","project_id":"{pid}"}}"#);
    let (st, etag, c) = req(&app, "POST", "/case", &admin, None, Some(&body)).await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(c["data"]["status"].as_str(), Some("backlog"));
    let cid = c["id"].as_str().unwrap().to_string();

    // backlog -> todo: legal
    let (st, etag2, _) = req(
        &app,
        "PATCH",
        &format!("/case/{cid}"),
        &admin,
        etag.as_deref(),
        Some(r#"{"status":"todo"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // the typed mirror reflects the move
    let mirror: String = sqlx::query_scalar("select status from cases where entity_id = $1")
        .bind(&cid)
        .fetch_one(&pool)
        .await?;
    assert_eq!(mirror, "todo");

    // todo -> done: an illegal skip
    let (st, _, err) = req(
        &app,
        "PATCH",
        &format!("/case/{cid}"),
        &admin,
        etag2.as_deref(),
        Some(r#"{"status":"done"}"#),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["kind"].as_str(), Some("illegal_transition"));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn case_must_start_at_initial(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    let app = build_app(&pool).await;
    let admin = login(&app, "USR_dev").await;
    let pid = make_project(&app, &admin).await;

    let body = format!(r#"{{"title":"T","type":"task","status":"done","project_id":"{pid}"}}"#);
    let (st, _, err) = req(&app, "POST", "/case", &admin, None, Some(&body)).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(err["kind"].as_str(), Some("illegal_transition"));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn comment_reaches_via_case_cascade(pool: PgPool) -> Result<(), Box<dyn std::error::Error>> {
    // alice owns P1; case C1 is under P1; comment CMT1 is on C1 — the project -> case -> comment cascade.
    sqlx::query(
        "insert into entities(id,type,created_by) values \
         ('USR_alice','actor','USR_dev'),('USR_bob','actor','USR_dev'),('PRJ_1','project','USR_dev'),\
         ('CAS_1','case','USR_dev'),('CMT_1','comment','USR_dev')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert into entity_data(entity_id,type_id,data,scope_parent_id) values \
         ('USR_alice','actor','{}',null),('USR_bob','actor','{}',null),('PRJ_1','project','{}',null),\
         ('CAS_1','case','{}','PRJ_1'),('CMT_1','comment','{}','CAS_1')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "insert into memberships(object_id,member_id,role) values ('PRJ_1','USR_alice','owner')",
    )
    .execute(&pool)
    .await?;

    // alice reaches the comment two hops up (she owns the project); bob reaches nothing.
    assert_eq!(
        numu_api::rbac::effective_rank(&pool, "USR_alice", "CMT_1").await?,
        Some(4)
    );
    assert_eq!(
        numu_api::rbac::effective_rank(&pool, "USR_bob", "CMT_1").await?,
        None
    );
    Ok(())
}
