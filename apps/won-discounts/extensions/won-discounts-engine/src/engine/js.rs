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

/// The characters `String.prototype.trim` removes (WhiteSpace + LineTerminator).
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
/// character (every price and rate Shopify sends) is returned as it is without
/// decoding a character.
pub fn trim(s: &str) -> &str {
    let b = s.as_bytes();
    let visible = |c: u8| c > b' ' && c < 0x80;
    if b.first().is_some_and(|&c| visible(c)) && b.last().is_some_and(|&c| visible(c)) {
        return s;
    }
    s.trim_matches(is_js_space)
}

/// `String.prototype.toUpperCase` (locale-independent full case mapping).
pub fn upper(s: &str) -> String {
    if s.is_ascii() {
        s.to_ascii_uppercase()
    } else {
        s.to_uppercase()
    }
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
        assert_eq!(upper("welcome15"), "WELCOME15");
        assert_eq!(upper("straße"), "STRASSE");
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
