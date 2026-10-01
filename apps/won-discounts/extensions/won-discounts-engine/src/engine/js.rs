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

/// `String(n)` (ECMAScript Number::toString, radix 10) for a finite number:
/// the shortest digits that round-trip to the same double, in plain notation
/// for 1e-6 ≤ |n| < 1e21 and exponent notation ("1e-7", "1.5e+21") outside.
/// Written out here instead of Rust's float `Display` (MVP 4 Wasm size pass:
/// `core::fmt`'s float printing was ~15 kB of the 256 kB limit); the digits are
/// tested against Rust's own shortest `{:e}` on random doubles of every
/// magnitude, the layout against JS.
pub fn number_to_string(n: f64) -> String {
    if n == 0.0 || !n.is_finite() {
        // (A non-finite number never reaches here: every caller reads JSON numbers.)
        return "0".to_string();
    }
    let mut out = String::with_capacity(24);
    if n < 0.0 {
        out.push('-');
    }
    let v = n.abs();
    // A whole number below 2^53 (a quantity, a whole percent, an amount): its
    // digits, without the digit search (a few dozen instructions).
    if v.fract() == 0.0 && v < 9_007_199_254_740_992.0 {
        push_digits(&mut out, v as u64);
        return out;
    }
    let (digits, point) = shortest_digits(v);
    let k = digits.len() as i32;
    let digit = |i: usize| char::from(b'0' + digits[i]);
    if k <= point && point <= 21 {
        digits.iter().for_each(|&d| out.push(char::from(b'0' + d)));
        (0..point - k).for_each(|_| out.push('0'));
    } else if 0 < point && point <= 21 {
        for (i, &d) in digits.iter().enumerate() {
            if i as i32 == point {
                out.push('.');
            }
            out.push(char::from(b'0' + d));
        }
    } else if -6 < point && point <= 0 {
        out.push_str("0.");
        (0..-point).for_each(|_| out.push('0'));
        digits.iter().for_each(|&d| out.push(char::from(b'0' + d)));
    } else {
        out.push(digit(0));
        if k > 1 {
            out.push('.');
            digits[1..].iter().for_each(|&d| out.push(char::from(b'0' + d)));
        }
        let e = point - 1;
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        push_digits(&mut out, u64::from(e.unsigned_abs()));
    }
    out
}

/// A small unsigned big integer, little-endian base 2^32 (the digit search's
/// numbers reach 2^1077 × 10).
#[derive(Clone)]
struct Big(Vec<u32>);

impl Big {
    fn from_u64(v: u64) -> Big {
        Big(vec![v as u32, (v >> 32) as u32])
    }
    fn mul_small(&mut self, m: u32) {
        let mut carry = 0u64;
        for limb in self.0.iter_mut() {
            let x = u64::from(*limb) * u64::from(m) + carry;
            *limb = x as u32;
            carry = x >> 32;
        }
        if carry > 0 {
            self.0.push(carry as u32);
        }
    }
    fn shl(&mut self, bits: u32) {
        for _ in 0..bits / 32 {
            self.0.insert(0, 0);
        }
        let b = bits % 32;
        if b > 0 {
            let mut carry = 0u32;
            for limb in self.0.iter_mut() {
                let next = *limb >> (32 - b);
                *limb = (*limb << b) | carry;
                carry = next;
            }
            if carry > 0 {
                self.0.push(carry);
            }
        }
    }
    fn trim(&mut self) {
        while self.0.len() > 1 && self.0.last() == Some(&0) {
            self.0.pop();
        }
    }
    fn cmp(&self, other: &Big) -> Ordering {
        let (a, b) = (self.0.iter().rposition(|&x| x != 0), other.0.iter().rposition(|&x| x != 0));
        match (a, b) {
            (None, None) => Ordering::Equal,
            (None, _) => Ordering::Less,
            (_, None) => Ordering::Greater,
            (Some(i), Some(j)) if i != j => i.cmp(&j),
            (Some(i), _) => (0..=i).rev().map(|k| self.0[k].cmp(&other.0[k])).find(|o| o.is_ne()).unwrap_or(Ordering::Equal),
        }
    }
    fn add(&self, other: &Big) -> Big {
        let len = self.0.len().max(other.0.len());
        let mut out = Vec::with_capacity(len + 1);
        let mut carry = 0u64;
        for i in 0..len {
            let x = u64::from(*self.0.get(i).unwrap_or(&0)) + u64::from(*other.0.get(i).unwrap_or(&0)) + carry;
            out.push(x as u32);
            carry = x >> 32;
        }
        if carry > 0 {
            out.push(carry as u32);
        }
        Big(out)
    }
    /// self -= other (self ≥ other).
    fn sub(&mut self, other: &Big) {
        let mut borrow = 0i64;
        for i in 0..self.0.len() {
            let x = i64::from(self.0[i]) - i64::from(*other.0.get(i).unwrap_or(&0)) - borrow;
            borrow = i64::from(x < 0);
            self.0[i] = (x + (borrow << 32)) as u32;
        }
        self.trim();
    }
}

/// The shortest decimal digits of a finite v > 0 that read back as v, and the
/// position of the decimal point: v ≈ 0.d₁d₂… × 10^point (Burger & Dybvig's
/// free-format algorithm on exact big integers; a tie between two candidates
/// goes to the closer one, an exact half to the larger digit — what Rust's
/// shortest float printing gives too).
fn shortest_digits(v: f64) -> (Vec<u8>, i32) {
    let bits = v.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1u64 << 52) - 1);
    let (f, e) = if biased == 0 { (fraction, -1074) } else { (fraction | (1u64 << 52), biased - 1075) };
    // IEEE round-half-even reading: a boundary itself reads back as v when f is even.
    let even = f % 2 == 0;
    let lower_closer = biased > 1 && fraction == 0;
    // v = r / s; the neighbours' midpoints are v ± m⁺/s, v − m⁻/s.
    let (mut r, mut s, mut mp, mut mm);
    if e >= 0 {
        r = Big::from_u64(f);
        r.shl(e as u32 + if lower_closer { 2 } else { 1 });
        s = Big::from_u64(if lower_closer { 4 } else { 2 });
        mp = Big::from_u64(1);
        mp.shl(e as u32 + u32::from(lower_closer));
        mm = Big::from_u64(1);
        mm.shl(e as u32);
    } else {
        r = Big::from_u64(f);
        r.shl(if lower_closer { 2 } else { 1 });
        s = Big::from_u64(1);
        s.shl((-e) as u32 + if lower_closer { 2 } else { 1 });
        mp = Big::from_u64(if lower_closer { 2 } else { 1 });
        mm = Big::from_u64(1);
    }
    // point = ⌈log10 v⌉, from the binary exponent (may be one low), then fixed up.
    let top = e + 63 - f.leading_zeros() as i32;
    let mut point = ((f64::from(top) * 0.301_029_995_663_981_2) - 1e-10).ceil() as i32;
    if point >= 0 {
        (0..point).for_each(|_| s.mul_small(10));
    } else {
        for _ in 0..-point {
            r.mul_small(10);
            mp.mul_small(10);
            mm.mul_small(10);
        }
    }
    let high = |r: &Big, mp: &Big, s: &Big| {
        let o = r.add(mp).cmp(s);
        if even { o.is_ge() } else { o.is_gt() }
    };
    while high(&r, &mp, &s) {
        s.mul_small(10);
        point += 1;
    }
    let mut digits = Vec::with_capacity(17);
    loop {
        r.mul_small(10);
        mp.mul_small(10);
        mm.mul_small(10);
        let mut d = 0u8;
        while r.cmp(&s).is_ge() {
            r.sub(&s);
            d += 1;
        }
        let low = if even { r.cmp(&mm).is_le() } else { r.cmp(&mm).is_lt() };
        let high = high(&r, &mp, &s);
        if !low && !high {
            digits.push(d);
            continue;
        }
        let up = match (low, high) {
            (true, false) => false,
            (false, true) => true,
            _ => {
                let mut twice = r.clone();
                twice.mul_small(2);
                twice.cmp(&s).is_ge()
            }
        };
        digits.push(d + u8::from(up));
        break;
    }
    (digits, point)
}

/// The decimal digits of `n`, appended.
pub fn push_digits(out: &mut String, mut n: u64) {
    let mut buf = [0u8; 20];
    let mut at = buf.len();
    loop {
        at -= 1;
        buf[at] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    out.push_str(std::str::from_utf8(&buf[at..]).unwrap_or_default());
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
        // JS's exponent notation outside 1e-6 ≤ |n| < 1e21 (MVP 4: was plain decimals).
        assert_eq!(number_to_string(1e-7), "1e-7");
        assert_eq!(number_to_string(0.000001), "0.000001");
        assert_eq!(number_to_string(1.5e-7), "1.5e-7");
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(number_to_string(1.2345e22), "1.2345e+22");
        assert_eq!(number_to_string(123456789012345680000.0), "123456789012345680000");
        assert_eq!(number_to_string(-14.285714285714286), "-14.285714285714286");
        assert_eq!(number_to_string(5e-324), "5e-324");
        assert_eq!(number_to_string(f64::MAX), "1.7976931348623157e+308");
        assert_eq!(number_to_string(2.2250738585072014e-308), "2.2250738585072014e-308");
        assert_eq!(number_to_string(9007199254740993.0), "9007199254740992");
    }

    /// The layout (plain vs exponent notation, the point, the sign) as node's
    /// `String(n)` printed it for these doubles (generated 2026-10-01).
    #[test]
    fn layout_matches_js_string() {
        let cases: [(f64, &str); 36] = [
            (f64::from_bits(0x3e7ad7f29abcaf48), "1e-7"),
            (f64::from_bits(0x3eb0c2ac1dbbe3d8), "9.99e-7"),
            (f64::from_bits(0x3eb0c6f7a0b5ed8d), "0.000001"),
            (f64::from_bits(0x3eb92a737110e454), "0.0000015"),
            (f64::from_bits(0x3fb999999999999a), "0.1"),
            (f64::from_bits(0x3fe0000000000000), "0.5"),
            (f64::from_bits(0x3ff4000000000000), "1.25"),
            (f64::from_bits(0x4040aa9fbe76c8b4), "33.333"),
            (f64::from_bits(0x4058ffae147ae148), "99.995"),
            (f64::from_bits(0x405edd2f1a9fbe77), "123.456"),
            (f64::from_bits(0x430c6bf526340004), "1000000000000000.5"),
            (f64::from_bits(0x432fffffffffffff), "4503599627370495.5"),
            (f64::from_bits(0x4415af1d78b58c40), "100000000000000000000"),
            (f64::from_bits(0x444b1a333426c08b), "999900000000000000000"),
            (f64::from_bits(0x444b1ae4d6e2ef50), "1e+21"),
            (f64::from_bits(0x444b1ae4d6e2ef52), "1.0000000000000003e+21"),
            (f64::from_bits(0x4454542ba12a337c), "1.5e+21"),
            (f64::from_bits(0x4490f0cf064dd592), "2e+22"),
            (f64::from_bits(0x54b249ad2594c37d), "1e+100"),
            (f64::from_bits(0x7fefffffffffffff), "1.7976931348623157e+308"),
            (f64::from_bits(0x0000000000000001), "5e-324"),
            (f64::from_bits(0x0000000000000005), "2.5e-323"),
            (f64::from_bits(0x01a56e1fc2f8f359), "1e-300"),
            (f64::from_bits(0x3f0078921ac6c11f), "0.0000314159"),
            (f64::from_bits(0xbf201f31f46ed246), "-0.000123"),
            (f64::from_bits(0xbe7ad7f29abcaf48), "-1e-7"),
            (f64::from_bits(0xc534adf4b7320335), "-2.5e+25"),
            (f64::from_bits(0x3fd3333333333334), "0.30000000000000004"),
            (f64::from_bits(0x3fd5555555555555), "0.3333333333333333"),
            (f64::from_bits(0x3fe5555555555555), "0.6666666666666666"),
            (f64::from_bits(0x402c924924924925), "14.285714285714286"),
            (f64::from_bits(0x402c924924924925), "14.285714285714286"),
            (f64::from_bits(0x3eb0c6f7a0b5ed8d), "0.000001"),
            (f64::from_bits(0x419d6f34547df3b6), "123456789.123"),
            (f64::from_bits(0x3f505e1c15097c81), "0.000999"),
            (f64::from_bits(0x426cbe991ee87000), "987654321987.5")
        ];
        for (v, js) in cases {
            assert_eq!(number_to_string(v), js, "{v:e}");
        }
    }

    /// The digits and decimal point equal Rust's own shortest round-trip
    /// printing (`{:e}`, the algorithm JS uses too) on random doubles of every
    /// magnitude, subnormals, powers of two and neighbours of powers of ten.
    #[test]
    fn shortest_digits_match_rusts_shortest_printing() {
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut values: Vec<f64> = (0..200_000).map(|_| f64::from_bits(next() & 0x7fef_ffff_ffff_ffff)).filter(|v| *v > 0.0).collect();
        values.extend((0..2000).map(|i| f64::from_bits(i + 1)));
        values.extend((-1074..1024).map(|e| 2f64.powi(e)).filter(|v| *v > 0.0 && v.is_finite()));
        for e in -300..300 {
            let p = format!("1e{e}").parse::<f64>().unwrap();
            values.extend([p, f64::from_bits(p.to_bits() + 1), f64::from_bits(p.to_bits() - 1)]);
        }
        values.extend((1..100_000).map(|i| f64::from(i) / 100.0));
        for v in values {
            let (digits, point) = shortest_digits(v);
            let expected = format!("{v:e}");
            let (mantissa, exp) = expected.split_once('e').unwrap();
            let want: String = mantissa.chars().filter(char::is_ascii_digit).collect();
            let got: String = digits.iter().map(|d| char::from(b'0' + d)).collect();
            assert_eq!((got.as_str(), point), (want.as_str(), exp.parse::<i32>().unwrap() + 1), "{v:e}");
        }
    }
}
