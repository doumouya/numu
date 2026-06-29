//! Purpose: THE one sentinel vocabulary — the "missing value disguised as a
//! value" tokens that the cleanness score, the semantic-dtype sniff, and the
//! user-facing scan all reason about. Ported from redpash-rust-pwa.
//!
//! FR-first: the founding (Fleury) locale's junk — inconnu / non disponible /
//! sans objet — stays first-class. `is_sentinel` canonicalises (trim +
//! lowercase) before matching, so the casing question lives in the caller.

/// The canonical lowercase sentinel tokens. The empty string is included so
/// the dtype sniff (which skips sentinels when sampling) treats blanks as
/// missing — the scan that wants to preserve original casing handles empties
/// separately upstream.
pub const SENTINELS: &[&str] = &[
    "", // blank — a sentinel for the sniff; the scan filters empties itself
    // English + symbolic
    "n/a",
    "na",
    "n.a.",
    "-",
    "--",
    "—",
    "–",
    "?",
    "??",
    "???",
    "null",
    "(null)",
    "<null>",
    "none",
    "nan",
    "nil",
    ".",
    "..",
    "tbd",
    "tba",
    "x",
    "unknown",
    "undefined",
    "missing",
    "(blank)",
    "blank",
    // French — the founding locale
    "inconnu",
    "n/d",
    "nd",
    "n.d.",
    "non disponible",
    "non communiqué",
    "s/o",
    "s.o.",
    "n.c.",
    "sans objet",
    // Excel error literals exported as text
    "#n/a",
    "#name?",
    "#ref!",
    "#value!",
    "#div/0!",
    "#num!",
    "#null!",
];

/// Canonicalise (trim + lowercase) and test membership. The single predicate
/// every consumer shares — there is no second list to drift.
pub fn is_sentinel(raw: &str) -> bool {
    let c = raw.trim().to_lowercase();
    SENTINELS.contains(&c.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unifies_the_two_legacy_lists() {
        assert!(is_sentinel("missing"));
        assert!(is_sentinel("inconnu"));
        assert!(is_sentinel("nd"));
        assert!(is_sentinel("  N/A "));
        assert!(is_sentinel(""));
        assert!(!is_sentinel("Alice"));
    }
}
