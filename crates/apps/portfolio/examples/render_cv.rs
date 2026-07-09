//! render_cv — local CV preview: render a CvData JSON document to PDF with the
//! SAME `pdf::render_cv` the publish pipeline uses, without touching the DB or
//! publishing anything. Fills the pipeline's preview gap (the console previews
//! HTML only; the PDF was previously only observable by publishing).
//!
//!   cargo run -p numu-app-portfolio --example render_cv -- cv.json out.pdf
//!
//! The input is the `cv` document object (the CvData contract the console's
//! Raw JSON mode edits), not the whole site.json.

use std::error::Error;
use std::{env, fs, process};

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let (input, output) = match (args.next(), args.next()) {
        (Some(i), Some(o)) => (i, o),
        _ => return Err("usage: render_cv <cv.json> <out.pdf>".into()),
    };
    let doc: serde_json::Value = serde_json::from_str(&fs::read_to_string(&input)?)?;
    let bytes = numu_app_portfolio::pdf::render_cv(&doc)?;
    fs::write(&output, &bytes)?;
    println!("wrote {output} ({} bytes)", bytes.len());
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("render_cv: {e}");
        process::exit(2);
    }
}
