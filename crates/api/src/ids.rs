//! Id minting. Entity ids are `<PREFIX>_<hex>` (random v4); request ids are `req_<hex>` (v7 = time-sortable).

use uuid::Uuid;

pub fn mint(prefix: &str) -> String {
    format!("{}_{}", prefix, Uuid::new_v4().simple())
}

pub fn request_id() -> String {
    format!("req_{}", Uuid::now_v7().simple())
}

/// Validate a client-supplied X-Request-Id's *shape* before we echo/store it (never trust it as a key).
pub fn valid_request_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_has_prefix() {
        let id = mint("CAS");
        assert!(id.starts_with("CAS_"));
        assert_eq!(id.len(), 4 + 32); // "CAS_" + 32 hex
    }

    #[test]
    fn request_id_shape() {
        assert!(valid_request_id(&request_id()));
        assert!(valid_request_id("req_abc-123_DEF"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("has space"));
        assert!(!valid_request_id("inject\"quote"));
        assert!(!valid_request_id(&"x".repeat(129)));
    }
}
