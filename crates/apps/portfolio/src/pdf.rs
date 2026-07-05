//! pdf — the genpdf CV writer (CASE 0024). Consumes the cv-data JSON contract (the portfolio
//! front's `src/pages/cv-data.ts` — one content model, three renderers: docx history, the
//! site's HTML page, this PDF) and renders the house style: Montserrat 10.5pt body,
//! DARK #1F1F1F, accent BLUE #0B57D0, MUTED #5F6368, mono-ish uppercase section rules.
//! Inline mini-markdown (**bold** · *italic* · `code` · [label](url)) maps to styled spans —
//! the same vocabulary the reference tokenizer (bdf/cv-build add_inline) and the web `inline()`
//! parse. Links render as blue label text (PDF annotations aren't exposed by genpdf; the web
//! page carries interactivity, the PDF carries print fidelity).
//!
//! Fonts are EMBEDDED from crates/apps/portfolio/assets/fonts (Montserrat, SIL OFL 1.1 —
//! OFL.txt ships alongside; the license permits redistribution + embedding).

use genpdf::elements::{Break, LinearLayout, Paragraph, TableLayout};
use genpdf::fonts::{FontData, FontFamily};
use genpdf::style::{Color, Style};
use genpdf::{Alignment, Document, Element, Margins, SimplePageDecorator};
use serde_json::Value;

const DARK: Color = Color::Rgb(31, 31, 31); // #1F1F1F skin-ok: the PDF house style, not web styling
const BLUE: Color = Color::Rgb(11, 87, 208); // #0B57D0 skin-ok: same
const MUTED: Color = Color::Rgb(95, 99, 104); // #5F6368 skin-ok: same
const BODY_PT: u8 = 10;
const SMALL_PT: u8 = 9;

fn fonts() -> Result<FontFamily<FontData>, String> {
    let load = |bytes: &'static [u8]| {
        FontData::new(bytes.to_vec(), None).map_err(|e| format!("font load: {e}"))
    };
    Ok(FontFamily {
        regular: load(include_bytes!("../assets/fonts/Montserrat-Regular.ttf"))?,
        bold: load(include_bytes!("../assets/fonts/Montserrat-Bold.ttf"))?,
        italic: load(include_bytes!("../assets/fonts/Montserrat-Italic.ttf"))?,
        bold_italic: load(include_bytes!("../assets/fonts/Montserrat-BoldItalic.ttf"))?,
    })
}

/// One inline mini-md span, resolved to a genpdf style.
struct Span {
    text: String,
    bold: bool,
    italic: bool,
    link: bool,
}

/// The mini-md tokenizer — the Rust port of the web `inline()` / add_inline: **b**, *i*,
/// `c` (rendered muted — Montserrat has no mono face; the PDF favors readability), [t](url).
fn inline(md: &str) -> Vec<Span> {
    let mut out = Vec::new();
    let mut rest = md;
    let push = |out: &mut Vec<Span>, text: &str, bold: bool, italic: bool, link: bool| {
        if !text.is_empty() {
            out.push(Span {
                text: text.to_string(),
                bold,
                italic,
                link,
            });
        }
    };
    while !rest.is_empty() {
        // find the earliest token opener
        let candidates = [
            rest.find("**").map(|i| (i, "**")),
            rest.find('*').map(|i| (i, "*")),
            rest.find('`').map(|i| (i, "`")),
            rest.find("[").map(|i| (i, "[")),
        ];
        let first = candidates.into_iter().flatten().min_by_key(|(i, _)| *i);
        let Some((i, tok)) = first else {
            push(&mut out, rest, false, false, false);
            break;
        };
        push(&mut out, &rest[..i], false, false, false);
        rest = &rest[i..];
        match tok {
            "**" => {
                if let Some(end) = rest[2..].find("**") {
                    push(&mut out, &rest[2..2 + end], true, false, false);
                    rest = &rest[2 + end + 2..];
                } else {
                    push(&mut out, "**", false, false, false);
                    rest = &rest[2..];
                }
            }
            "*" => {
                if let Some(end) = rest[1..].find('*') {
                    push(&mut out, &rest[1..1 + end], false, true, false);
                    rest = &rest[1 + end + 1..];
                } else {
                    push(&mut out, "*", false, false, false);
                    rest = &rest[1..];
                }
            }
            "`" => {
                if let Some(end) = rest[1..].find('`') {
                    // muted stand-in for code (no mono face in the family)
                    out.push(Span {
                        text: rest[1..1 + end].to_string(),
                        bold: false,
                        italic: true,
                        link: false,
                    });
                    rest = &rest[1 + end + 1..];
                } else {
                    push(&mut out, "`", false, false, false);
                    rest = &rest[1..];
                }
            }
            _ => {
                // [label](url) — label only, blue
                if let (Some(close), Some(popen)) = (rest.find(']'), rest.find("](")) {
                    if popen == close {
                        if let Some(pclose) = rest[popen..].find(')') {
                            push(&mut out, &rest[1..close], false, false, true);
                            rest = &rest[popen + pclose + 1..];
                            continue;
                        }
                    }
                }
                push(&mut out, "[", false, false, false);
                rest = &rest[1..];
            }
        }
    }
    out
}

fn styled_paragraph(md: &str, base_pt: u8, base_color: Color) -> Paragraph {
    let mut p = Paragraph::default();
    for s in inline(md) {
        let mut st =
            Style::new()
                .with_font_size(base_pt)
                .with_color(if s.link { BLUE } else { base_color });
        if s.bold {
            st = st.bold();
        }
        if s.italic {
            st = st.italic();
        }
        p.push_styled(s.text, st);
    }
    p
}

fn bullet(md: &str) -> Paragraph {
    let mut p = Paragraph::default();
    p.push_styled(
        "•  ",
        Style::new().with_font_size(BODY_PT).with_color(BLUE).bold(),
    );
    for s in inline(md) {
        let mut st =
            Style::new()
                .with_font_size(BODY_PT)
                .with_color(if s.link { BLUE } else { DARK });
        if s.bold {
            st = st.bold();
        }
        if s.italic {
            st = st.italic();
        }
        p.push_styled(s.text, st);
    }
    p
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// Render the CvData JSON document → PDF bytes.
pub fn render_cv(doc_json: &Value) -> Result<Vec<u8>, String> {
    let mut doc = Document::new(fonts()?);
    doc.set_title(format!("{} — CV", s(doc_json, "name")));
    doc.set_minimal_conformance();
    let mut dec = SimplePageDecorator::new();
    dec.set_margins(Margins::trbl(13, 20, 12, 20)); // mm
    doc.set_page_decorator(dec);

    let mut body = LinearLayout::vertical();

    // header
    body.push(
        Paragraph::new(s(doc_json, "name"))
            .styled(Style::new().bold().with_font_size(20).with_color(DARK)),
    );
    body.push(
        Paragraph::new(s(doc_json, "headline"))
            .styled(Style::new().bold().with_font_size(11).with_color(BLUE)),
    );
    body.push(
        Paragraph::new(s(doc_json, "contact"))
            .styled(Style::new().with_font_size(SMALL_PT).with_color(MUTED)),
    );
    if let Some(links) = doc_json.get("links").and_then(|l| l.as_array()) {
        let line = links
            .iter()
            .map(|l| s(l, "label"))
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("  ·  ");
        body.push(
            Paragraph::new(line).styled(Style::new().with_font_size(SMALL_PT).with_color(BLUE)),
        );
    }
    body.push(Break::new(0.6));
    body.push(styled_paragraph(s(doc_json, "summary"), BODY_PT, DARK));

    // sections
    if let Some(sections) = doc_json.get("sections").and_then(|x| x.as_array()) {
        for sec in sections {
            body.push(Break::new(0.8));
            body.push(
                Paragraph::new(s(sec, "title").to_uppercase())
                    .styled(Style::new().bold().with_font_size(10).with_color(BLUE)),
            );
            for entry in sec
                .get("entries")
                .and_then(|e| e.as_array())
                .into_iter()
                .flatten()
            {
                let head = s(entry, "head");
                let when = s(entry, "when");
                if !head.is_empty() && !when.is_empty() {
                    // two columns: head left, dates right
                    let mut t = TableLayout::new(vec![4, 1]);
                    t.row()
                        .element(styled_paragraph(head, BODY_PT, DARK))
                        .element(
                            Paragraph::new(when)
                                .aligned(Alignment::Right)
                                .styled(Style::new().with_font_size(SMALL_PT).with_color(MUTED)),
                        )
                        .push()
                        .map_err(|e| format!("row: {e}"))?;
                    body.push(t);
                } else if !head.is_empty() {
                    body.push(styled_paragraph(head, BODY_PT, DARK));
                }
                let sub = s(entry, "sub");
                if !sub.is_empty() {
                    body.push(styled_paragraph(sub, SMALL_PT, MUTED));
                }
                for b in entry
                    .get("bullets")
                    .and_then(|b| b.as_array())
                    .into_iter()
                    .flatten()
                {
                    if let Some(text) = b.as_str() {
                        body.push(bullet(text));
                    }
                }
                body.push(Break::new(0.3));
            }
        }
    }

    doc.push(body);
    let mut out = Vec::new();
    doc.render(&mut out).map_err(|e| format!("render: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn inline_should_tokenize_the_mini_md_vocabulary() {
        let spans = inline("plain **bold** *ital* `code` [numu](https://numu.im) tail");
        let texts: Vec<_> = spans.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(
            texts,
            vec!["plain ", "bold", " ", "ital", " ", "code", " ", "numu", " tail"]
        );
        assert!(spans[1].bold && !spans[1].italic);
        assert!(spans[3].italic);
        assert!(spans[7].link);
    }

    #[test]
    fn render_cv_should_emit_a_real_pdf() {
        let doc = json!({
            "name": "EMMANUEL DOUMOUYA",
            "headline": "AI Software Engineer | AI Solution Architect",
            "contact": "Dublin, Ireland · em.doumouya@gmail.com",
            "links": [ {"label": "em.numu.im", "href": "https://em.numu.im"} ],
            "summary": "Engineer who builds **end-to-end with AI agents in the loop** — see [the site](https://em.numu.im).",
            "sections": [
                { "id": "work", "title": "Selected work", "entries": [
                    { "head": "**Portfolio platform** — [em.numu.im](https://em.numu.im)",
                      "sub": "all mine, end-to-end",
                      "bullets": ["A numu data workspace with **two flagship demos**."] },
                    { "head": "**Technical Support Engineer**", "sub": "Informatica / Salesforce",
                      "when": "2023–Present",
                      "bullets": ["Advise enterprise customers on *ETL/ELT* architecture."] }
                ]}
            ]
        });
        let bytes = render_cv(&doc).expect("renders");
        assert!(bytes.starts_with(b"%PDF"), "PDF magic bytes");
        assert!(bytes.len() > 5_000, "non-trivial output: {}", bytes.len());
    }
}
