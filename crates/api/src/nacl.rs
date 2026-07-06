//! nacl — the server command plane (SLICE 2b, CAS_00742b86). `POST /api/nacl {text, ctx}` parses ONE
//! nacl command and executes it over the SAME gated object path the REST surface uses — no new privilege
//! road. It's a deliberate SUBSET of the grammar (`web/sim/numu-nacl.js` is the executable spec):
//!
//!   read:<type>[.attr=value]   → the caller's reachable rows (objectTable, or a single object card)
//!   new:<type> field=value …   → create one (object card + an `openObjectId` effect)
//!   anything else              → an honest chat block ("full nacl runs in the sim")
//!
//! Leak-free throughout: an unreadable type reads the same as an unknown one, and a per-command
//! RBAC/validation failure becomes a `warn` block — only a genuine 5xx propagates. Result is
//! `{blocks, effects}` — the shape the console renders (docs/frontend/SEAM.md §wire-shapes). The feed is
//! persisted by the FRONT (pushBlocks → /api/conversations), so this route is stateless beyond the create
//! it performs (which rides `objects::create_object`: gated, owner-granted, evented).

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::caller::Caller;
use crate::error::AppResult;
use crate::objects;
use crate::registry::TypeDef;
use crate::request_id::RequestCtx;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/nacl", post(nacl))
}

/// The console thread context (SEAM.md ctx). `itFileId`/`channel` ride along for parity but the server
/// subset doesn't consume them yet; `workspace`/`projectId` seed a scoped create's parent when omitted.
#[derive(Deserialize, Default)]
pub struct NaclCtx {
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default, rename = "projectId")]
    pub project_id: Option<String>,
}

#[derive(Deserialize)]
struct NaclBody {
    #[serde(default)]
    text: String,
    #[serde(default)]
    ctx: NaclCtx,
}

async fn nacl(
    State(st): State<AppState>,
    Extension(ctx): Extension<RequestCtx>,
    caller: Caller,
    Json(body): Json<NaclBody>,
) -> AppResult<Response> {
    Ok(Json(nacl_core(&st, &ctx, &caller, &body.text, &body.ctx).await?).into_response())
}

/// The testable core: classify one command, resolve its target against the live registry, execute over
/// the gated object path, and return `{blocks, effects}`. Per-command failures are honest blocks; only a
/// real server fault is an `Err`.
pub async fn nacl_core(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    text: &str,
    nctx: &NaclCtx,
) -> AppResult<Value> {
    let t = text.trim();
    let reg = st.registry.load_full();
    // friendly target word → a registered type_id (mirrors the console READ_TYPE + the sim REG):
    // user(s)→actor, else the word (or its singular) iff the registry knows it.
    let resolve = |word: &str| -> Option<String> {
        let w = word.trim().trim_end_matches('.').to_lowercase();
        let candidates: Vec<String> = match w.as_str() {
            "user" | "users" => vec!["actor".to_string()],
            other => {
                let mut v = vec![other.to_string()];
                if let Some(singular) = other.strip_suffix('s') {
                    v.push(singular.to_string());
                }
                v
            }
        };
        candidates.into_iter().find(|c| reg.get(c).is_some())
    };

    match classify(t) {
        Command::Chat(msg) => Ok(result(vec![chat_block(t, &msg)], vec![])),
        Command::Read { word, filter } => match resolve(&word) {
            None => Ok(result(
                vec![chat_block(t, &unknown_type_msg(&word))],
                vec![],
            )),
            Some(type_id) => read_exec(st, ctx, caller, &type_id, filter, t).await,
        },
        Command::New { word, pairs } => match resolve(&word) {
            None => Ok(result(
                vec![chat_block(t, &unknown_type_msg(&word))],
                vec![],
            )),
            Some(type_id) => match reg.get(&type_id) {
                Some(td) => new_exec(st, ctx, caller, td, pairs, nctx, t).await,
                None => Ok(result(
                    vec![chat_block(t, &unknown_type_msg(&word))],
                    vec![],
                )),
            },
        },
    }
}

// ── parsing (pure) ───────────────────────────────────────────────────────────

enum Command {
    Read {
        word: String,
        filter: Option<(String, String)>,
    },
    New {
        word: String,
        pairs: Vec<(String, String)>,
    },
    Chat(String),
}

fn classify(t: &str) -> Command {
    if let Some(rest) = t.strip_prefix("new:").or_else(|| t.strip_prefix("create ")) {
        return new_from(rest.trim());
    }
    if let Some(arg) = t.strip_prefix("read:").or_else(|| t.strip_prefix("list ")) {
        let (word, filter) = split_filter(arg.trim());
        return Command::Read { word, filter };
    }
    // bare single alphabetic word → a read (e.g. "articles", "cases")
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_alphabetic() || c == '_') {
        return Command::Read {
            word: t.to_string(),
            filter: None,
        };
    }
    Command::Chat(HELP.to_string())
}

fn new_from(rest: &str) -> Command {
    let tokens = tokenize(rest);
    let Some(head) = tokens.first() else {
        return Command::Chat("new what? try `new:case title=\"…\"`.".to_string());
    };
    // the head is the type, optionally carrying the first field inline: `new:case.title=Foo`.
    let (word, inline) = match head.split_once('.') {
        Some((type_word, pair)) => (type_word.to_string(), parse_pair(pair)),
        None => (head.clone(), None),
    };
    let mut pairs: Vec<(String, String)> = inline.into_iter().collect();
    for tok in &tokens[1..] {
        if let Some(p) = parse_pair(tok) {
            pairs.push(p);
        }
    }
    Command::New { word, pairs }
}

/// `type` | `type.attr=value` | `type.attr` → (type word, optional equality filter).
fn split_filter(arg: &str) -> (String, Option<(String, String)>) {
    match arg.split_once('.') {
        Some((word, rest)) => {
            let filter = rest
                .split_once('=')
                .map(|(a, v)| (a.trim().to_string(), unquote(v)));
            (word.to_string(), filter)
        }
        None => (arg.to_string(), None),
    }
}

/// Whitespace-split, honouring double-quoted runs so `title="my case"` stays one token.
fn tokenize(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for ch in s.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn parse_pair(tok: &str) -> Option<(String, String)> {
    tok.split_once('=')
        .map(|(k, v)| (k.trim().to_string(), v.to_string()))
        .filter(|(k, _)| !k.is_empty())
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_string()
}

/// Coerce a parsed string value to the field's declared registry kind so int/bool/json fields survive
/// create_object's validation. An unparseable value falls back to the string (create_object then
/// rejects it with a clear 4xx → warn block, rather than a silent type failure).
fn coerce_value(kind: &str, v: String) -> Value {
    match kind {
        "int" => v
            .trim()
            .parse::<i64>()
            .map(|n| Value::Number(n.into()))
            .unwrap_or(Value::String(v)),
        "bool" => match v.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Value::Bool(true),
            "false" | "0" | "no" | "off" => Value::Bool(false),
            _ => Value::String(v),
        },
        "json" => serde_json::from_str::<Value>(&v).unwrap_or(Value::String(v)),
        _ => Value::String(v), // text · enum · ref · date stay strings
    }
}

// ── execution (over the gated object path) ───────────────────────────────────

async fn read_exec(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    type_id: &str,
    filter: Option<(String, String)>,
    raw: &str,
) -> AppResult<Value> {
    // With a `.attr=value` filter we must fetch a wider window than the 40 shown, or a match past row 40
    // would silently vanish; list_core clamps to 200, so that's the honest ceiling for a filtered read.
    let fetch = if filter.is_some() { 200 } else { 40 };
    let items = match objects::list_core(st, ctx, caller, type_id, Some(fetch), Some(0)).await {
        Ok(v) => v,
        // a View denial (confined/out-of-reach caller) is leak-free — a warn block, not an HTTP error.
        Err(e) if e.status.is_client_error() => {
            return Ok(result(
                vec![warn_block(
                    raw,
                    &format!("you don't have access to read \"{type_id}\""),
                )],
                vec![],
            ));
        }
        Err(e) => return Err(e),
    };
    let filtered: Vec<&Value> = match &filter {
        Some((attr, val)) => items
            .iter()
            .filter(|it| data_str(it, attr).is_some_and(|s| s.eq_ignore_ascii_case(val)))
            .collect(),
        None => items.iter().collect(),
    };
    let n = filtered.len();
    let icon = type_icon(type_id);
    let where_clause = filter
        .as_ref()
        .map(|(a, v)| format!(" WHERE {a}='{v}'"))
        .unwrap_or_default();
    let mut blocks = vec![step_block(
        raw,
        "read",
        &format!("SELECT * FROM {type_id}{where_clause} · {n} rows · RBAC-scoped"),
    )];
    if n == 1 {
        blocks.push(object_card(type_id, icon, filtered[0]));
    } else if n > 1 {
        let rows: Vec<Value> = filtered.iter().take(40).map(|it| table_row(it)).collect();
        blocks.push(json!({
            "type": "objectTable", "objType": type_id, "icon": icon,
            "title": format!("{type_id} · {n} rows"), "rows": rows,
        }));
    }
    Ok(result(blocks, vec![]))
}

async fn new_exec(
    st: &AppState,
    ctx: &RequestCtx,
    caller: &Caller,
    td: &TypeDef,
    pairs: Vec<(String, String)>,
    nctx: &NaclCtx,
    raw: &str,
) -> AppResult<Value> {
    let type_id = td.type_id.as_str();
    let mut fields = Map::new();
    for (k, v) in pairs {
        // coerce to the field's declared kind — the composer only ever produces strings, but an int/bool
        // field must reach create_object as a number/bool or its validation rejects the whole create.
        let kind = td
            .fields
            .iter()
            .find(|f| f.field == k)
            .map(|f| f.kind.as_str())
            .unwrap_or("text");
        fields.insert(k, coerce_value(kind, v));
    }
    // seed a scoped type's parent from the thread ctx when the caller didn't name it (mirrors the sim:
    // `new:case` inherits the active project, `new:booking` the workspace).
    for parent in &td.scope_parents {
        if fields.contains_key(parent) {
            continue;
        }
        let seed = match parent.as_str() {
            "workspace_id" => nctx.workspace.clone(),
            "project_id" => nctx.project_id.clone(),
            _ => None,
        };
        if let Some(val) = seed {
            fields.insert(parent.clone(), Value::String(val));
        }
    }
    let payload = Value::Object(fields);
    match objects::create_object(st, ctx, caller, td, &payload).await {
        Ok((id, data)) => {
            let item = json!({ "id": id, "data": data, "version": 1 });
            Ok(result(
                vec![
                    step_block(
                        raw,
                        "new",
                        &format!("INSERT {type_id} · {id} · owner edge granted · audited"),
                    ),
                    object_card(type_id, type_icon(type_id), &item),
                ],
                vec![json!({ "kind": "openObjectId", "id": id })],
            ))
        }
        Err(e) if e.status.is_client_error() => {
            let msg = if e.kind == "not_found" {
                format!("can't create a {type_id} here — you don't reach the parent scope")
            } else {
                e.detail.clone()
            };
            Ok(result(vec![warn_block(raw, &msg)], vec![]))
        }
        Err(e) => Err(e),
    }
}

// ── block builders (the SEAM.md wire shapes) ─────────────────────────────────

fn result(blocks: Vec<Value>, effects: Vec<Value>) -> Value {
    json!({ "blocks": blocks, "effects": effects })
}

fn step_block(nacl: &str, kind: &str, impact: &str) -> Value {
    json!({ "type": "step", "nacl": nacl, "kind": kind, "impact": impact })
}

fn warn_block(nacl: &str, impact: &str) -> Value {
    step_block(nacl, "warn", impact)
}

fn chat_block(nacl: &str, impact: &str) -> Value {
    step_block(nacl, "chat", impact)
}

fn object_card(type_id: &str, icon: &str, it: &Value) -> Value {
    let data = &it["data"];
    let id = it["id"].as_str().unwrap_or("");
    let version = it["version"].as_i64().unwrap_or(0);
    let status = status_of(data);
    let meta = if status.is_empty() {
        format!("v{version}")
    } else {
        format!("{status} · v{version}")
    };
    json!({
        "type": "object", "objType": type_id, "objIcon": icon, "accentColor": "var(--chart-2)",
        "title": title_of(data, id), "meta": meta, "objRef": id, "status": status,
    })
}

fn table_row(it: &Value) -> Value {
    let data = &it["data"];
    let id = it["id"].as_str().unwrap_or("");
    let version = it["version"].as_i64().unwrap_or(0);
    let handle = data["handle"]
        .as_str()
        .map(|h| format!("@{h} · "))
        .unwrap_or_default();
    json!({
        "id": id,
        "title": title_of(data, id),
        "status": status_of(data),
        "meta": format!("{handle}v{version}"),
        "objRef": id,
    })
}

fn title_of(data: &Value, id: &str) -> String {
    for key in ["name", "title", "display_name", "label"] {
        if let Some(s) = data[key].as_str() {
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    id.to_string()
}

fn status_of(data: &Value) -> String {
    if let Some(s) = data["status"].as_str() {
        return s.to_string();
    }
    match data["published"].as_bool() {
        Some(true) => "published".to_string(),
        Some(false) => "draft".to_string(),
        None => String::new(),
    }
}

fn data_str<'a>(it: &'a Value, key: &str) -> Option<&'a str> {
    it["data"][key].as_str()
}

fn type_icon(type_id: &str) -> &'static str {
    match type_id {
        "case" | "project" => "kanban",
        "actor" => "person",
        "workspace" => "building",
        "article" | "site_copy" | "cv" => "file-text",
        "connector" => "plug",
        "milestone" => "flag",
        "conversation" => "chat",
        _ => "collection",
    }
}

const HELP: &str =
    "I can run `read:<type>` and `new:<type> field=value` here — e.g. `read:article`, \
`read:case`, `new:case title=\"…\"`. The full nacl grammar (pipelines, set/del/on, chaining, \
projections) runs in the sim — open ?sim=1.";

fn unknown_type_msg(word: &str) -> String {
    format!(
        "I don't know a type called \"{}\". Try read:article · read:case · read:workspace · read:user.",
        word.trim()
    )
}
