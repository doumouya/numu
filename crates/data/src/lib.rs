//! numu data engine — the server-typing subset ported from redpash-rust-pwa's pure-compute `data` crate:
//! parse (decode + sniff), dtype detection (storage + semantic), the sentinel vocabulary, and the
//! cleanness score. Native-only here (the client compute / wasm surface stays the frontend's job).
//! Contract: docs/numu-csv-flow-and-datatypes.md.

pub mod dtype;
pub mod encoding;
pub mod error;
pub mod parse;
pub mod sentinels;
pub mod stats;

pub use error::DataError;

/// Crate result alias.
pub type Result<T> = std::result::Result<T, DataError>;
