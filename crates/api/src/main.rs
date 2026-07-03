//! numu-api binary — a thin entry point over the library's `run()`. All the wiring (pool, migrations,
//! registry, router, middleware) lives in `lib.rs` so integration tests can link it. (docs/api/HTTP.md)

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    numu_api::run().await
}
