//! numu-server — the COMPOSED production binary: the generic numu core plus the apps tier
//! (docs/apps/PORTFOLIO.md §doctrine). Each app is linked here and mounted by
//! `numu_api::run_with` under `/api/apps/<name>` iff its env flag is `"1"` at boot, so one
//! image serves any combination of apps per deployment. The dev binary (`numu-api`) stays
//! core-only; adding an app to production is one line here. (CASE 0019)

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    numu_api::run_with(vec![numu_app_portfolio::mount()]).await
}
