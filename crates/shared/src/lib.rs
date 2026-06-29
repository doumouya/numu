//! Purpose: wire DTOs — the single vocabulary the api↔data seam speaks.
//! Ported (subset) from redpash-rust-pwa `crates/shared`; only `file` (the
//! quality-report shapes) is needed for the server-typing path numu carries.

pub mod file;

pub use file::ColumnMeta;
