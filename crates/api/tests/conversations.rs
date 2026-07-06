//! SLICE 2a — persistent per-workspace feed (CAS_00742b86). Proves the conversation cores:
//! empty→append→append (not replace), replace, and the reach gate (a non-member gets a leak-free
//! error on BOTH read and write). See docs/frontend/SEAM.md §conversations.
#![cfg(feature = "db-tests")]

use numu_api::caller::{Caller, Surface, SurfaceKind};
use numu_api::conversations::{get_feed_core, post_feed_core};
use numu_api::registry::TypeDefCache;
use numu_api::request_id::RequestCtx;
use numu_api::state::AppState;
use numu_api::workflow::WorkflowCache;
use serde_json::{json, Value};
use sqlx::PgPool;

type R = Result<(), Box<dyn std::error::Error>>;

async fn state(pool: &PgPool) -> AppState {
    let registry = TypeDefCache::load(pool).await.unwrap();
    let workflows = WorkflowCache::load(pool).await.unwrap();
    AppState::new(pool.clone(), registry, workflows)
}

fn ctx() -> RequestCtx {
    RequestCtx {
        request_id: "req_test".into(),
        trace_id: "trace_test".into(),
    }
}

async fn seed_actor(pool: &PgPool, id: &str) -> sqlx::Result<()> {
    sqlx::query("insert into entities(id,type,created_by) values ($1,'actor','USR_dev')")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query(
        "insert into entity_data(entity_id,type_id,data) values ($1,'actor', \
         jsonb_build_object('display_name','A','handle','a','kind','human','platform_role','member','status','active'))",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn seed_workspace(pool: &PgPool, ws: &str, member: &str, role: &str) -> sqlx::Result<()> {
    seed_actor(pool, member).await?; // memberships.member_id FK → entities
    sqlx::query("insert into entities(id,type,created_by) values ($1,'workspace','USR_dev')")
        .bind(ws)
        .execute(pool)
        .await?;
    sqlx::query(
        "insert into entity_data(entity_id,type_id,data) \
         values ($1,'workspace', jsonb_build_object('name','W','slug','w','status','active'))",
    )
    .bind(ws)
    .execute(pool)
    .await?;
    sqlx::query("insert into memberships(object_id,member_id,role) values ($1,$2,$3)")
        .bind(ws)
        .bind(member)
        .bind(role)
        .execute(pool)
        .await?;
    Ok(())
}

fn len(v: &Value) -> usize {
    v.as_array().map(|a| a.len()).unwrap_or(0)
}

#[sqlx::test(migrations = "../../migrations")]
async fn feed_persists_appends_replaces_and_reach_gates(pool: PgPool) -> R {
    let st = state(&pool).await;
    let ws = "ORG_conv0000000000000000000000000a";
    let member = "USR_member000000000000000000000001";
    let outsider = "USR_outsider0000000000000000000002";
    seed_workspace(&pool, ws, member, "member").await?; // member = rank 2 (edit)
    let member_c = Caller::console(member, false);
    let outsider_c = Caller::console(outsider, false); // no membership → no reach

    // empty until written
    assert_eq!(get_feed_core(&st, &ctx(), &member_c, ws).await?, json!([]));

    // two appends accumulate (not replace)
    post_feed_core(
        &st,
        &ctx(),
        &member_c,
        ws,
        vec![json!({"type":"sent","text":"hi"})],
        false,
    )
    .await?;
    post_feed_core(
        &st,
        &ctx(),
        &member_c,
        ws,
        vec![json!({"type":"step","nacl":"read:article"})],
        false,
    )
    .await?;
    assert_eq!(len(&get_feed_core(&st, &ctx(), &member_c, ws).await?), 2);

    // replace collapses to the new set
    post_feed_core(
        &st,
        &ctx(),
        &member_c,
        ws,
        vec![json!({"type":"sent","text":"reset"})],
        true,
    )
    .await?;
    let after = get_feed_core(&st, &ctx(), &member_c, ws).await?;
    assert_eq!(len(&after), 1);
    assert_eq!(after[0]["text"], "reset");

    // a non-member reaches nothing: leak-free error on read AND write
    assert!(get_feed_core(&st, &ctx(), &outsider_c, ws).await.is_err());
    assert!(post_feed_core(
        &st,
        &ctx(),
        &outsider_c,
        ws,
        vec![json!({"type":"sent","text":"x"})],
        false
    )
    .await
    .is_err());
    // and the outsider's rejected write left the feed untouched
    assert_eq!(len(&get_feed_core(&st, &ctx(), &member_c, ws).await?), 1);
    Ok(())
}

/// SLICE 2 pre-push review (HIGH): the feed gate must run Plane C, not just workspace reach. A confined
/// AGENT surface with no capability grant is fenced off the object surface; it must be fenced off the
/// feed too — EVEN holding an owner membership on the workspace. The same membership under a CONSOLE
/// surface (Plane C default-allow) IS admitted, proving the denial is Plane C, not reach.
#[sqlx::test(migrations = "../../migrations")]
async fn a_confined_agent_is_denied_the_feed_despite_workspace_membership(pool: PgPool) -> R {
    let st = state(&pool).await;
    let ws = "ORG_conv0000000000000000000000000b";
    let principal = "USR_agent00000000000000000000000c";
    seed_workspace(&pool, ws, principal, "owner").await?; // OWNER rank — reach is not the question here

    let agent = Caller {
        actor_id: principal.into(),
        is_platform_admin: false,
        surface: Surface {
            kind: SurfaceKind::Agent,
            id: principal.into(),
        },
        purpose: None,
        data_class_ceiling: None,
    };
    // Plane C default-denies an agent with no capability grant — on read AND write, leak-free.
    assert!(
        get_feed_core(&st, &ctx(), &agent, ws).await.is_err(),
        "agent read must be Plane-C denied"
    );
    assert!(
        post_feed_core(
            &st,
            &ctx(),
            &agent,
            ws,
            vec![json!({"type":"sent","text":"x"})],
            false
        )
        .await
        .is_err(),
        "agent append must be Plane-C denied"
    );

    // the identical membership under a console surface IS admitted → the denial above was Plane C.
    let console = Caller::console(principal, false);
    assert!(
        get_feed_core(&st, &ctx(), &console, ws).await.is_ok(),
        "console with the same membership is admitted"
    );
    Ok(())
}
