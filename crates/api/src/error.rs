//! AppError → RFC 9457 problem+json. One error type, one responder. Denials carry GENERIC detail
//! (leak-free); 5xx never wires its internal detail (the airlock). `instance` = the request-id.

use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub kind: &'static str,
    pub detail: String,
    pub request_id: Option<String>,
    pub allow: Option<Vec<String>>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(status: StatusCode, kind: &'static str, detail: impl Into<String>) -> Self {
        Self {
            status,
            kind,
            detail: detail.into(),
            request_id: None,
            allow: None,
        }
    }
    pub fn with_request_id(mut self, id: impl Into<String>) -> Self {
        self.request_id = Some(id.into());
        self
    }
    pub fn with_allow(mut self, allow: Vec<String>) -> Self {
        self.allow = Some(allow);
        self
    }

    // Denials — GENERIC detail so existence/fields can't be probed.
    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", "Not found")
    }
    /// No (or an invalid/expired) session — authentication required. Distinct from 404 (it leaks nothing
    /// about a resource; it's about the *caller*, not an object).
    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Authentication required",
        )
    }
    /// Authority denial AFTER existence is admitted (manage-authority on a roster, etc.) — leak-free
    /// because the caller already proved they can see the object.
    pub fn forbidden() -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", "Forbidden")
    }
    /// The Plane-B field gate (after existence) — names the field, which leaks nothing (existence admitted).
    pub fn forbidden_field(field: &str) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "field_forbidden",
            format!("field not writable for your role: {field}"),
        )
    }
    // Client errors — specific, actionable detail is fine (the request is the problem, not a secret).
    pub fn bad_request(d: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", d)
    }
    pub fn unprocessable(d: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "unprocessable_entity", d)
    }
    /// An illegal workflow transition (a status move the workflow doesn't permit). 422.
    pub fn illegal_transition(d: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "illegal_transition", d)
    }
    /// Unique / sole-owner / dependency conflict. Wired by the membership + workflow slices. Staged seam.
    #[allow(dead_code)]
    pub fn conflict(d: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", d)
    }
    pub fn unsupported_media_type() -> Self {
        Self::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "Expected application/json",
        )
    }
    pub fn precondition_required() -> Self {
        Self::new(
            StatusCode::PRECONDITION_REQUIRED,
            "precondition_required",
            "If-Match is required for this mutation",
        )
    }
    pub fn precondition_failed() -> Self {
        Self::new(
            StatusCode::PRECONDITION_FAILED,
            "precondition_failed",
            "If-Match did not match the current version",
        )
    }
    pub fn method_not_allowed(allow: Vec<String>) -> Self {
        Self::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "method_not_allowed",
            "Method not allowed",
        )
        .with_allow(allow)
    }
    pub fn internal(d: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", d)
    }
    /// Dependency down. `/readyz` already returns 503 directly; kept for handler use. Staged seam.
    #[allow(dead_code)]
    pub fn unavailable() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "service_unavailable",
            "Service unavailable",
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({}): {}",
            self.status.as_u16(),
            self.kind,
            self.detail
        )
    }
}

impl std::error::Error for AppError {}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::not_found(),
            // a foreign-key / check violation on a write is a client problem (bad ref / bad enum), not a 500
            sqlx::Error::Database(ref db) if db.code().as_deref() == Some("23503") => {
                AppError::unprocessable("a referenced entity does not exist")
            }
            other => {
                tracing::error!(error = %other, "unmapped db error");
                AppError::internal(other.to_string())
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let instance = self.request_id.clone().unwrap_or_default();
        // 5xx: log the real detail, wire only the canonical reason (airlock).
        let wire_detail = if self.status.is_server_error() {
            tracing::error!(kind = self.kind, request_id = %instance, detail = %self.detail, "server error");
            self.status
                .canonical_reason()
                .unwrap_or("Internal Server Error")
                .to_string()
        } else {
            self.detail.clone()
        };
        let body = json!({
            "type": format!("https://numu/errors/{}", self.kind),
            "title": self.status.canonical_reason().unwrap_or(""),
            "status": self.status.as_u16(),
            "detail": wire_detail,
            "instance": instance,
            "kind": self.kind,
        });
        let mut resp = (self.status, Json(body)).into_response();
        resp.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        if let Some(allow) = &self.allow {
            if let Ok(v) = HeaderValue::from_str(&allow.join(", ")) {
                resp.headers_mut().insert(header::ALLOW, v);
            }
        }
        resp
    }
}
