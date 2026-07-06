//! SLICE 2b — the server nacl command plane (CAS_00742b86). Proves nacl_core: `new:<type>` creates
//! through the gated path (card block + openObjectId effect), `read:<type>` lists the caller's reachable
//! rows (objectTable, or a single object card for a `.attr=` filter), an unknown verb/type is an honest
//! chat block, and the read plane is reach-scoped (a non-member never sees another's rows).
#![cfg(feature = "db-tests")]

use numu_api::caller::Caller;
use numu_api::nacl::{nacl_core, NaclCtx};
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

fn blocks(v: &Value) -> &Vec<Value> {
    v["blocks"].as_array().unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn read_new_unknown_and_reach_scope(pool: PgPool) -> R {
    let st = state(&pool).await;
    let admin_id = "USR_admin00000000000000000000001a";
    let member_id = "USR_member0000000000000000000002b";
    seed_actor(&pool, admin_id).await?;
    seed_actor(&pool, member_id).await?;
    let admin = Caller::console(admin_id, true); // platform admin — bypasses reach
    let member = Caller::console(member_id, false); // no article membership → reaches none
    let nctx = NaclCtx::default();

    // new:<type> — create through the gated path → object card + openObjectId effect
    let created = nacl_core(
        &st,
        &ctx(),
        &admin,
        "new:article slug=alpha label=\"Alpha\" tag=DATA md=\"# hi\"",
        &nctx,
    )
    .await?;
    assert!(
        blocks(&created)
            .iter()
            .any(|b| b["type"] == "object" && b["title"] == "Alpha"),
        "new: returns an object card"
    );
    assert!(
        created["effects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "openObjectId"),
        "new: emits openObjectId"
    );

    // a second article, so the read is a table (n > 1)
    nacl_core(
        &st,
        &ctx(),
        &admin,
        "new:article slug=beta label=\"Beta\" tag=METHOD md=\"# yo\"",
        &nctx,
    )
    .await?;

    // read:<type> → objectTable of the reachable rows (admin sees both)
    let read = nacl_core(&st, &ctx(), &admin, "read:article", &nctx).await?;
    let table = blocks(&read)
        .iter()
        .find(|b| b["type"] == "objectTable")
        .expect("read returns an objectTable");
    assert_eq!(table["rows"].as_array().unwrap().len(), 2);

    // read:<type>.attr=value → in-memory filter to the single match → object card
    let one = nacl_core(&st, &ctx(), &admin, "read:article.slug=alpha", &nctx).await?;
    assert!(
        blocks(&one)
            .iter()
            .any(|b| b["type"] == "object" && b["title"] == "Alpha"),
        "filtered read narrows to one card"
    );

    // an unknown verb → honest chat block; an unknown type → chat block too (no leak, no error)
    let chat = nacl_core(&st, &ctx(), &admin, "hey there team", &nctx).await?;
    assert_eq!(blocks(&chat)[0]["kind"], "chat");
    let unknown_type = nacl_core(&st, &ctx(), &admin, "read:dragons", &nctx).await?;
    assert_eq!(blocks(&unknown_type)[0]["kind"], "chat");

    // reach-scoped: the member reaches no article, so the read never surfaces the admin's rows
    let leaked = nacl_core(&st, &ctx(), &member, "read:article", &nctx).await?;
    let leaks_rows = blocks(&leaked).iter().any(|b| {
        b["type"] == "objectTable" && !b["rows"].as_array().map(|r| r.is_empty()).unwrap_or(true)
    });
    assert!(!leaks_rows, "a non-member must not see another's articles");
    Ok(())
}

/// SLICE 2 pre-push review (MEDIUM): `new:` must coerce field values to their declared kind, or an
/// int/bool field arrives as a string and create_object's validation rejects the whole create. Here
/// `ordinal=7 published=true` must land as a JSON number + bool (not "7"/"true"), so the article creates.
#[sqlx::test(migrations = "../../migrations")]
async fn new_coerces_int_and_bool_field_values(pool: PgPool) -> R {
    let st = state(&pool).await;
    let admin_id = "USR_admin00000000000000000000009z";
    seed_actor(&pool, admin_id).await?;
    let admin = Caller::console(admin_id, true);
    let nctx = NaclCtx::default();

    let out = nacl_core(
        &st,
        &ctx(),
        &admin,
        "new:article slug=gamma label=\"Gamma\" tag=DATA md=\"# g\" ordinal=7 published=true",
        &nctx,
    )
    .await?;
    // the create landed (a `new` step block, not a validation `warn`) — proves coercion happened
    assert_eq!(
        blocks(&out)[0]["kind"],
        "new",
        "typed create must succeed, not warn"
    );

    // and the values are stored with the right JSON types, not as strings
    let (ordinal,): (Value,) = sqlx::query_as(
        "select data->'ordinal' from entity_data where type_id='article' and data->>'slug'=$1",
    )
    .bind("gamma")
    .fetch_one(&pool)
    .await?;
    assert!(
        ordinal.is_i64(),
        "ordinal stored as a JSON number, got {ordinal:?}"
    );
    assert_eq!(ordinal, json!(7));
    let (published,): (Value,) = sqlx::query_as(
        "select data->'published' from entity_data where type_id='article' and data->>'slug'=$1",
    )
    .bind("gamma")
    .fetch_one(&pool)
    .await?;
    assert_eq!(published, json!(true), "published stored as a JSON bool");
    Ok(())
}
