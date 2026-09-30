// JavaScript semantics the TS engine relies on, reproduced exactly where they
// can change a result: Math.round, String.prototype.trim / toUpperCase, string
// `<` (UTF-16 code units), the `\d{4}-\d{2}-\d{2}` date test and Number → String
// for the values the engine prints.

use std::cmp::Ordering;

/// `Math.round`: nearest integer, ties toward +∞ (not away from zero).
pub fn round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `Math.floor` of a finite JSON number into an integer; saturates far outside
/// any real money amount (the TS engine would lose precision there anyway).
pub fn floor_to_i64(x: f64) -> i64 {
    x.floor() as i64
}

/// The characters `String.prototype.trim` removes (WhiteSpace + LineTerminator);
/// `trim` reads them from their bytes, and is tested against this.
#[cfg(test)]
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{A}'
            | '\u{B}'
            | '\u{C}'
            | '\u{D}'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `String.prototype.trim`. A text that starts and ends with a visible ASCII
/// character (every price and rate Shopify sends) is returned as it is; any
/// other is trimmed by its UTF-8 bytes (`trim_counted`).
#[inline]
pub fn trim(s: &str) -> &str {
    let b = s.as_bytes();
    let visible = |c: u8| c > b' ' && c < 0x80;
    if b.first().is_some_and(|&c| visible(c)) && b.last().is_some_and(|&c| visible(c)) {
        return s;
    }
    trim_counted(s, usize::MAX).map_or(s, |(trimmed, _)| trimmed)
}

/// `String.prototype.trim`, counting what it removes: the trimmed text and how
/// many white space characters it removed (each one UTF-16 unit: every JS white
/// space character is in the BMP), or none as soon as more than `limit` would be
/// removed (audit round 7: an entered code can carry any amount of padding, and
/// trimming it all cost ~20–35 instructions a byte). A white space character is
/// matched by its UTF-8 bytes at either end (decoding each character cost ~50
/// instructions): U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A,
/// U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. A match at the start is a
/// lead byte and its continuation bytes, and at the end a lead byte that is 1–3
/// bytes before it, so it is always one whole character.
pub fn trim_counted(s: &str, limit: usize) -> Option<(&str, usize)> {
    let b = s.as_bytes();
    let visible = |c: u8| c > b' ' && c < 0x80;
    if b.first().is_some_and(|&c| visible(c)) && b.last().is_some_and(|&c| visible(c)) {
        return Some((s, 0));
    }
    let mut rest = b;
    let mut removed = 0usize;
    loop {
        rest = match rest {
            [c, tail @ ..] if *c == b' ' || c.wrapping_sub(0x09) < 5 => tail,
            [0xC2, 0xA0, tail @ ..] => tail,
            [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, tail @ ..] | [0xE2, 0x81, 0x9F, tail @ ..] | [0xE3, 0x80, 0x80, tail @ ..] | [0xEF, 0xBB, 0xBF, tail @ ..] | [0xE1, 0x9A, 0x80, tail @ ..] => tail,
            _ => break,
        };
        removed += 1;
        if removed > limit {
            return None;
        }
    }
    let start = b.len() - rest.len();
    loop {
        rest = match rest {
            [head @ .., c] if *c == b' ' || c.wrapping_sub(0x09) < 5 => head,
            [head @ .., 0xC2, 0xA0] => head,
            [head @ .., 0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF] | [head @ .., 0xE2, 0x81, 0x9F] | [head @ .., 0xE3, 0x80, 0x80] | [head @ .., 0xEF, 0xBB, 0xBF] | [head @ .., 0xE1, 0x9A, 0x80] => head,
            _ => break,
        };
        removed += 1;
        if removed > limit {
            return None;
        }
    }
    // Both ends are character boundaries (only whole characters were skipped).
    Some((s.get(start..start + rest.len()).unwrap_or(s), removed))
}

/// The upper-case form of a non-ASCII character (`char::to_uppercase`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpperChar {
    /// It has none: the character itself.
    Same,
    One(char),
    /// Two or three characters (ß → SS, ﬃ → FFI; all in the BMP, so each is
    /// one UTF-16 unit), 0-padded.
    Many(&'static [u16; 3]),
}

/// `char::to_uppercase` of a non-ASCII character by table lookup (audit round
/// 6): the standard library searches its table for every character (~620
/// instructions a character in Wasm, so 25 entered codes of 64 non-ASCII
/// characters took ~1 M), this reads two array cells. The tables
/// (`upper_table.rs`) are generated from this toolchain's `char::to_uppercase`
/// and checked against it for every scalar value (tests below).
#[inline]
pub fn upper_char(c: char) -> UpperChar {
    let cp = c as u32;
    match upper_entry(cp) {
        0 => UpperChar::Same,
        entry @ 0xD800..=0xDFFF => upper_many(entry).map_or(UpperChar::Same, UpperChar::Many),
        // Upper-casing never leaves the character's plane.
        entry => char::from_u32((cp & !0xFFFF) | u32::from(entry)).map_or(UpperChar::Same, UpperChar::One),
    }
}

/// The case table's entry of a code point: 0 = no upper-case form of its own;
/// 0xD800 + i = `upper_many`; else the low 16 bits of its upper-case character
/// (in the same plane).
#[inline]
pub fn upper_entry(cp: u32) -> u16 {
    use super::upper_table::{PAGES, PAGE_OF};
    match PAGE_OF.get((cp >> 6) as usize) {
        Some(&page) if page != 0 => PAGES.get(usize::from(page) - 1).map_or(0, |p| p[(cp & 63) as usize]),
        _ => 0,
    }
}

/// The upper-case form of a 2-byte character (U+0080–U+07FF) as one table read
/// (audit round 7: the two-level `upper_entry` cost ~30 instructions more a
/// character): the UTF-16 unit of its upper-case character, itself when it has
/// none, or 0xD800 + i = `upper_many`.
#[inline]
pub fn upper_unit_2byte(cp: u32) -> u16 {
    super::upper_table::UPPER2.get(cp as usize).copied().unwrap_or(0)
}

/// The characters (UTF-16 units, 0-padded) of an entry 0xD800 + i.
#[inline]
pub fn upper_many(entry: u16) -> Option<&'static [u16; 3]> {
    super::upper_table::MULTI.get(usize::from(entry.wrapping_sub(0xD800)))
}

/// Appends the upper-case form of `c` (`char::to_uppercase`) to `out`.
#[inline]
pub fn push_upper(out: &mut String, c: char) {
    if c.is_ascii() {
        out.push(c.to_ascii_uppercase());
        return;
    }
    match upper_char(c) {
        UpperChar::Same => out.push(c),
        UpperChar::One(u) => out.push(u),
        UpperChar::Many(units) => {
            for &unit in units.iter().take_while(|&&unit| unit != 0) {
                out.push(char::from_u32(u32::from(unit)).unwrap_or(char::REPLACEMENT_CHARACTER));
            }
        }
    }
}

/// `String.prototype.toUpperCase` (locale-independent full case mapping).
/// Character by character, as str::to_uppercase maps (upper-casing has no
/// context rule): ASCII directly, anything else through `upper_char`.
pub fn upper(s: &str) -> String {
    if s.is_ascii() {
        return s.to_ascii_uppercase();
    }
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        push_upper(&mut out, c);
    }
    out
}

/// JS string comparison (`a < b`): by UTF-16 code units. The first byte where
/// the texts differ decides when it is ASCII on both sides: the bytes before it
/// are the same whole characters (an ASCII byte starts a character), so the
/// UTF-16 units before it are equal too, and these two ASCII bytes are the next
/// units. Otherwise (a multi-byte character there) it compares UTF-16 units.
/// The texts are compared 8 bytes at a time (a byte loop, compiler-builtins'
/// `memcmp`, costs ~8 Wasm instructions a byte; rule ids are 22 characters).
pub fn cmp_str(a: &str, b: &str) -> Ordering {
    let (x, y) = (a.as_bytes(), b.as_bytes());
    let n = x.len().min(y.len());
    let mut i = 0;
    while i + 8 <= n {
        let (wx, wy) = (u64::from_le_bytes(x[i..i + 8].try_into().unwrap_or([0; 8])), u64::from_le_bytes(y[i..i + 8].try_into().unwrap_or([0; 8])));
        if wx != wy {
            i += ((wx ^ wy).trailing_zeros() / 8) as usize;
            break;
        }
        i += 8;
    }
    while i < n && x[i] == y[i] {
        i += 1;
    }
    if i == n {
        return x.len().cmp(&y.len());
    }
    if x[i] < 0x80 && y[i] < 0x80 {
        return x[i].cmp(&y[i]);
    }
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `/^\d{4}-\d{2}-\d{2}$/.test(s)` (`\d` is ASCII only; `$` is the end of input).
pub fn is_local_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// `String(n)` for a finite number whose JS rendering is plain decimal notation
/// (1e-6 ≤ |n| < 1e21, or 0): shortest round-trip digits, no trailing ".0".
/// Both Rust's `Display` for f64 and JS pick the shortest digits that round-trip
/// to the same double.
pub fn number_to_string(n: f64) -> String {
    if n == 0.0 {
        return "0".to_string();
    }
    let mut out = String::new();
    use std::fmt::Write;
    let _ = write!(out, "{}", n);
    out
}

/// `"x".padStart(width, "0")`.
pub fn pad_start_zeros(s: &str, width: usize) -> String {
    let len = s.encode_utf16().count();
    if len >= width {
        return s.to_string();
    }
    let mut out = "0".repeat(width - len);
    out.push_str(s);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_is_math_round() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-2.6), -3.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(round(1234.4999), 1234.0);
        // 249.90 Kč × 3 × 13 % = 9746.1 haléřů.
        assert_eq!(round((74970.0 * 13.0) / 100.0), 9746.0);
    }

    #[test]
    fn trim_and_upper_follow_js() {
        assert_eq!(trim("\u{FEFF} welcome15\u{A0}\n"), "welcome15");
        // NEL (U+0085) is white space for Rust, not for JS.
        assert_eq!(trim("\u{85}x"), "\u{85}x");
        // By bytes, the same as trimming JS white space character by character, for
        // every scalar value at either end, alone, doubled and next to white space.
        for n in 0u32..=0x10_FFFF {
            let Some(c) = char::from_u32(n) else { continue };
            for text in [format!("{c}"), format!("{c}{c}"), format!("{c}x{c}"), format!(" {c}\u{3000}"), format!("\u{A0}{c}\u{2029}"), format!("x{c}"), format!("{c}\u{FEFF}x")] {
                assert_eq!(trim(&text), text.trim_matches(is_js_space), "U+{n:04X} {text:?}");
                // trim_counted: the same text, and the characters it removed, up to its limit.
                let removed = text.chars().count() - text.trim_matches(is_js_space).chars().count();
                for limit in [0, removed.saturating_sub(1), removed, removed + 1] {
                    let want = (removed <= limit).then(|| (text.trim_matches(is_js_space), removed));
                    assert_eq!(trim_counted(&text, limit), want, "U+{n:04X} {text:?} {limit}");
                }
            }
        }
        let padded = format!("{}x{}", "\u{2000}\u{3000} \u{FEFF}".repeat(40), "\t\u{200A}\u{A0}".repeat(40));
        assert_eq!(trim_counted(&padded, 280), Some(("x", 280)));
        assert_eq!(trim_counted(&padded, 279), None);
        assert_eq!(trim_counted("   ", 3), Some(("", 3)));
        assert_eq!(trim_counted("   ", 2), None);
        assert_eq!(upper("welcome15"), "WELCOME15");
        assert_eq!(upper("straße"), "STRASSE");
        // Character by character with ASCII directly: the same text as str::to_uppercase
        // for every scalar value up to U+30000, ASCII around it (Greek sigma, ligatures, ß…).
        for n in (0x80u32..0x3_0000).step_by(1) {
            let Some(c) = char::from_u32(n) else { continue };
            let text = format!("aZ{c}q ß{c}ﬁx");
            assert_eq!(upper(&text), text.to_uppercase(), "U+{n:04X}");
        }
    }

    /// The generated tables are this toolchain's `char::to_uppercase`, for every
    /// scalar value (a toolchain whose Unicode tables changed fails here:
    /// regenerate with `write_upper_table`).
    #[test]
    fn upper_char_is_char_to_uppercase_for_every_scalar_value() {
        for n in 0x80u32..=0x10_FFFF {
            let Some(c) = char::from_u32(n) else { continue };
            let want: Vec<char> = c.to_uppercase().collect();
            let got: Vec<char> = match upper_char(c) {
                UpperChar::Same => vec![c],
                UpperChar::One(u) => vec![u],
                UpperChar::Many(units) => units.iter().take_while(|&&u| u != 0).map(|&u| char::from_u32(u32::from(u)).unwrap()).collect(),
            };
            assert_eq!(got, want, "U+{n:04X}");
            if let UpperChar::One(u) = upper_char(c) {
                assert_ne!(u, c, "U+{n:04X}: Same, not One of itself");
            }
            let up = upper(&c.to_string());
            assert_eq!(up, c.to_uppercase().collect::<String>(), "U+{n:04X}");
            // Upper-casing is idempotent and never shortens a text in UTF-16 units: a
            // normalized code normalizes to itself, and an entered code longer than
            // every Won code can never become one (hash.rs `normalized_hash_within`).
            assert_eq!(upper(&up), up, "U+{n:04X}");
            assert!(up.encode_utf16().count() >= c.len_utf16(), "U+{n:04X}");
            if n < 0x800 {
                let entry = upper_entry(n);
                assert_eq!(upper_unit_2byte(n), if entry == 0 { n as u16 } else { entry }, "U+{n:04X}: UPPER2");
            }
        }
    }

    /// Writes `upper_table.rs` from `char::to_uppercase` (run by hand after a
    /// toolchain update: `cargo test write_upper_table -- --ignored`).
    #[test]
    #[ignore]
    fn write_upper_table() {
        const TOP: u32 = 0x1_F000;
        let mut entry = vec![0u16; TOP as usize];
        let mut multi: Vec<[u16; 3]> = Vec::new();
        for n in 0x80u32..=0x10_FFFF {
            let Some(c) = char::from_u32(n) else { continue };
            let up: Vec<char> = c.to_uppercase().collect();
            if up == [c] {
                continue;
            }
            assert!(n < TOP, "U+{n:04X} changes above the table");
            if let [u] = up[..] {
                let (u, n16) = (u as u32, n);
                assert_eq!(u >> 16, n16 >> 16, "U+{n:04X} leaves its plane");
                let low = (u & 0xFFFF) as u16;
                assert!(low != 0 && !(0xD800..=0xDFFF).contains(&low), "U+{n:04X}: low 16 bits {low:04X} are a marker");
                entry[n as usize] = low;
            } else {
                let mut units = [0u16; 3];
                assert!(up.len() <= 3);
                for (slot, u) in units.iter_mut().zip(&up) {
                    assert!((*u as u32) < 0x1_0000 && !(0xD800..=0xDFFF).contains(&(*u as u32)), "U+{n:04X}: a multi-character form outside the BMP");
                    *slot = *u as u16;
                }
                entry[n as usize] = 0xD800 + u16::try_from(multi.len()).unwrap();
                multi.push(units);
                assert!(multi.len() <= 0x800);
            }
        }
        let mut page_of = vec![0u8; (TOP >> 6) as usize];
        let mut pages: Vec<&[u16]> = Vec::new();
        for (p, chunk) in entry.chunks(64).enumerate() {
            if chunk.iter().any(|&e| e != 0) {
                pages.push(chunk);
                page_of[p] = u8::try_from(pages.len()).unwrap();
            }
        }
        let hex = |v: &[u16]| v.iter().map(|x| format!("0x{x:04X}")).collect::<Vec<_>>().join(", ");
        let mut out = String::new();
        out.push_str("// Generated by `cargo test write_upper_table -- --ignored` (engine/js.rs) from\n");
        out.push_str("// this toolchain's `char::to_uppercase`; `upper_char_is_char_to_uppercase_for_every_scalar_value`\n");
        out.push_str("// checks it against every scalar value. Do not edit by hand.\n\n");
        out.push_str("/// Page (code point >> 6, below U+1F000, above which no character changes)\n");
        out.push_str("/// → 1 + its index in `PAGES`; 0 = no character of the page changes.\n");
        out.push_str(&format!("pub static PAGE_OF: [u8; {}] = [\n", page_of.len()));
        for row in page_of.chunks(32) {
            out.push_str(&format!("    {},\n", row.iter().map(u8::to_string).collect::<Vec<_>>().join(", ")));
        }
        out.push_str("];\n\n");
        out.push_str("/// Per character of a page: 0 = unchanged; 0xD800 + i = `MULTI[i]`; else the\n");
        out.push_str("/// low 16 bits of its upper-case character (always in the same plane).\n");
        out.push_str(&format!("pub static PAGES: [[u16; 64]; {}] = [\n", pages.len()));
        for page in &pages {
            out.push_str("    [\n");
            for row in page.chunks(16) {
                out.push_str(&format!("        {},\n", hex(row)));
            }
            out.push_str("    ],\n");
        }
        out.push_str("];\n\n");
        out.push_str("/// The code points below U+0800 (2 UTF-8 bytes from U+0080; below it unused):\n");
        out.push_str("/// the UTF-16 unit of the upper-case character, the code point itself when it\n");
        out.push_str("/// has none, or the `PAGES` marker 0xD800 + i (`js::upper_unit_2byte`).\n");
        let upper2: Vec<u16> = (0u32..0x800).map(|n| if n < 0x80 { 0 } else if entry[n as usize] == 0 { n as u16 } else { entry[n as usize] }).collect();
        out.push_str("pub static UPPER2: [u16; 2048] = [\n");
        for row in upper2.chunks(16) {
            out.push_str(&format!("    {},\n", hex(row)));
        }
        out.push_str("];\n\n");
        out.push_str("/// Upper-case forms of more than one character (all in the BMP), 0-padded.\n");
        out.push_str(&format!("pub static MULTI: [[u16; 3]; {}] = [\n", multi.len()));
        for m in &multi {
            out.push_str(&format!("    [{}],\n", hex(m)));
        }
        out.push_str("];\n");
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/src/engine/upper_table.rs"), out).unwrap();
    }

    #[test]
    fn compares_like_js() {
        assert_eq!(cmp_str("a", "b"), Ordering::Less);
        assert_eq!(cmp_str("B", "a"), Ordering::Less);
        // U+FF61 sorts after a surrogate pair's lead unit in UTF-16 order.
        assert_eq!(cmp_str("\u{FF61}", "\u{1F600}"), Ordering::Greater);
        // Every pair of these (prefixes, a difference in or after the first word,
        // ASCII next to multi-byte and astral characters) orders as UTF-16 does.
        let texts = [
            "", "a", "ab", "abcdefgh", "abcdefghi", "abcdefgi", "r_0123456789abcdef0123", "r_0123456789abcdef0124", "r_0123456789abcdeg",
            "abcdefgh\u{FF61}", "abcdefgh\u{1F600}", "abcdefgh\u{E9}", "abcdefgh\u{E8}x", "\u{E9}", "z", "Z", "ř_x", "r_x", "abcdefghabcdefgh",
            "abcdefghabcdefgZ", "abcdefghabcdefg\u{7F}", "abcdefghabcdefg\u{80}",
        ];
        for a in texts {
            for b in texts {
                assert_eq!(cmp_str(a, b), a.encode_utf16().cmp(b.encode_utf16()), "{a:?} {b:?}");
            }
        }
    }

    #[test]
    fn local_dates() {
        assert!(is_local_date("2026-10-01"));
        assert!(!is_local_date("2026-10-1"));
        assert!(!is_local_date("2026-10-01\n"));
        assert!(!is_local_date("2026-10-01T00:00:00"));
        assert!(!is_local_date("２０２６-10-01"));
    }

    #[test]
    fn numbers_print_like_js() {
        assert_eq!(number_to_string(10.0), "10");
        assert_eq!(number_to_string(12.5), "12.5");
        assert_eq!(number_to_string(0.07), "0.07");
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(33.33), "33.33");
        assert_eq!(number_to_string(0.1 + 0.2), "0.30000000000000004");
    }
}
