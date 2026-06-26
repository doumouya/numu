//! D1 of P-DEBUG: one correlation id, edge to everywhere. Generate-or-propagate `X-Request-Id`, open the
//! root tracing span with it, echo it on the response. Handlers read `Extension<RequestCtx>`; every
//! `events` row carries it. (docs/OBSERVABILITY.md §2)

use axum::extract::Request;
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;
use tracing::Instrument;

use crate::ids;

#[derive(Clone, Debug)]
pub struct RequestCtx {
    pub request_id: String,
    pub trace_id: String,
}

pub async fn request_id_layer(mut req: Request, next: Next) -> Response {
    let incoming = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let request_id = match incoming {
        Some(s) if ids::valid_request_id(&s) => s,
        _ => ids::request_id(),
    };
    let trace_id = ids::request_id();

    req.extensions_mut().insert(RequestCtx {
        request_id: request_id.clone(),
        trace_id: trace_id.clone(),
    });

    let span = tracing::info_span!("request", request_id = %request_id, trace_id = %trace_id);
    let mut resp = next.run(req).instrument(span).await;

    if let Ok(v) = HeaderValue::from_str(&request_id) {
        resp.headers_mut().insert("x-request-id", v);
    }
    resp
}
