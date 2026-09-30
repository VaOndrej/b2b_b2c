// Discount codes travel in the shared config as FNV-1a hashes (code-hash.ts):
// 32 bit, over the normalized code (trimmed, upper-cased), as 8 lowercase hex
// digits. JS hashes UTF-16 code units (`charCodeAt`), so this does too.

use std::borrow::Cow;

use super::js;

/// `normalizeCode` (cart.ts): trimmed and upper-cased, as Shopify codes are case-insensitive.
pub fn normalize_code(code: &str) -> String {
    normalized(code).into_owned()
}

/// `normalizeCode`, borrowed when it changes nothing (trimmed ASCII without a
/// lower-case letter, as a normalized code is): no copy.
pub fn normalized(code: &str) -> Cow<'_, str> {
    let trimmed = js::trim(code);
    if trimmed.len() == code.len() && code.bytes().all(|b| b.is_ascii() && !b.is_ascii_lowercase()) {
        Cow::Borrowed(code)
    } else {
        Cow::Owned(js::upper(trimmed))
    }
}

const FNV_OFFSET: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

/// The FNV-1a hash of `codeHash` as its number: over the UTF-16 code units of
/// an already normalized code (ASCII bytes are their own units).
pub fn hash_value(text: &str) -> u32 {
    let mut hash = FNV_OFFSET;
    if text.is_ascii() {
        for &b in text.as_bytes() {
            hash ^= u32::from(b);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        return hash;
    }
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// The number of `codeHash(raw)` — the hash of `normalizeCode(raw)` — with the
/// trimmed code, when the entry can be a Won code (plan.ts `matchCodes`, audit
/// rounds 6 and 7): at most `max` + CODE_PADDING UTF-16 units long as entered,
/// and its normalized form (trimmed, upper-cased) not empty and at most `max`
/// units long. A Won code is at most `max` units long normalized, so no other
/// entry can be one; one padded with more than CODE_PADDING white space
/// characters is left out too (fail closed; a code is entered without them).
/// The work is bounded by `max` whatever the entry holds: a text of more than 3
/// bytes a unit is left at once, trimming stops after `max` + CODE_PADDING
/// characters, hashing after `max` + 1 units of the upper-case form. That form
/// is hashed as it is read from the case table, never built (audit round 6:
/// upper-casing through the standard library and then hashing cost ~620
/// instructions a non-ASCII character; this costs ~45 an ASCII one, ~90–130
/// another), and a character whose upper-case form is longer (ß → SS, ΐ → three
/// characters) counts that long.
pub fn normalized_hash_within(raw: &str, max: usize) -> Option<(u32, &str)> {
    let bound = max.saturating_add(CODE_PADDING);
    // A UTF-16 unit is 1–3 UTF-8 bytes (a 4-byte character is 2 units).
    if raw.len() > bound.saturating_mul(3) {
        return None;
    }
    let (code, padding) = js::trim_counted(raw, bound)?;
    let mut hash = FNV_OFFSET;
    // UTF-16 units of the upper-case form, and how many more that is than the code's own.
    let (mut units, mut longer) = (0usize, 0usize);
    for c in code.chars() {
        let cp = c as u32;
        let unit = if cp < 0x80 {
            hash = (hash ^ u32::from((cp as u8).to_ascii_uppercase())).wrapping_mul(FNV_PRIME);
            units += 1;
            if units > max {
                return None;
            }
            continue;
        } else if cp < 0x800 {
            u32::from(js::upper_unit_2byte(cp))
        } else if cp < 0x1_0000 {
            match js::upper_entry(cp) {
                0 => cp,
                entry => u32::from(entry),
            }
        } else {
            // Two units; upper-casing never leaves the character's plane.
            let up = match js::upper_entry(cp) {
                0 => cp,
                entry => (cp & !0xFFFF) | u32::from(entry),
            };
            hash = hash_code_point(hash, up);
            units += 2;
            if units > max {
                return None;
            }
            continue;
        };
        if unit & 0xF800 == 0xD800 {
            // Two or three BMP characters, 0-padded, from one BMP character.
            let [a, b, third] = js::upper_many(unit as u16).copied().unwrap_or_default();
            hash = (hash ^ u32::from(a)).wrapping_mul(FNV_PRIME);
            hash = (hash ^ u32::from(b)).wrapping_mul(FNV_PRIME);
            if third == 0 {
                units += 2;
                longer += 1;
            } else {
                hash = (hash ^ u32::from(third)).wrapping_mul(FNV_PRIME);
                units += 3;
                longer += 2;
            }
        } else {
            hash = (hash ^ unit).wrapping_mul(FNV_PRIME);
            units += 1;
        }
        if units > max {
            return None;
        }
    }
    // As entered: the white space around it and the code's own units.
    if units == 0 || padding + (units - longer) > bound {
        return None;
    }
    Some((hash, code))
}

/// FNV-1a over a code point's UTF-16 units.
#[inline]
fn hash_code_point(hash: u32, cp: u32) -> u32 {
    if cp < 0x1_0000 {
        return (hash ^ cp).wrapping_mul(FNV_PRIME);
    }
    let v = cp - 0x1_0000;
    let hash = (hash ^ (0xD800 | (v >> 10))).wrapping_mul(FNV_PRIME);
    (hash ^ (0xDC00 | (v & 0x3FF))).wrapping_mul(FNV_PRIME)
}

/// cart.ts MAX_ENTERED_CODES: the engine considers the first 25 entries of the
/// entered codes ([spec], audit round 5b). Every entry counts, whatever it holds
/// (an empty code, a code longer than every Won code): repeats or junk cannot
/// make the reader read more.
pub const MAX_ENTERED_CODES: usize = 25;

/// cart.ts ENTERED_CODE_PADDING: an entered code longer as entered (UTF-16
/// units, white space included) than the longest Won code + this is never
/// matched, nor trimmed (audit round 7): a Won code is entered without padding
/// (Shopify's checkout and the Storefront API take the code as typed; a pasted
/// code may carry a space or a line break), and 16 characters of it still match.
pub const CODE_PADDING: usize = 16;

/// CONFIG_LIMITS.codeLength (limits.ts): a Won code has at most 64 characters
/// (UTF-16 units, after trimming and upper-casing; audit round 6). The shared
/// config's `modules.codes.maxCodeLength` is the longest one; missing or not a
/// whole number ≥ 0 reads as this, and a larger one is capped to it.
pub const MAX_CODE_LENGTH: usize = 64;

/// A config's code hash as the number `hash_value` gives: exactly 8 lower-case
/// hex digits (what codeHash writes), else none — such a text equals no
/// codeHash, so it can never match an entered code.
pub fn parse_hash(text: &str) -> Option<u32> {
    let bytes = text.as_bytes();
    if bytes.len() != 8 {
        return None;
    }
    let mut n: u32 = 0;
    for &b in bytes {
        let digit = match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => b - b'a' + 10,
            _ => return None,
        };
        n = (n << 4) | u32::from(digit);
    }
    Some(n)
}

/// `codeHash` (code-hash.ts) of an already normalized code.
pub fn hash_normalized(text: &str) -> String {
    let hash = hash_value(text);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(8);
    for shift in (0..8).rev() {
        out.push(HEX[((hash >> (shift * 4)) & 0xf) as usize] as char);
    }
    out
}

/// `codeHash` (code-hash.ts).
pub fn code_hash(code: &str) -> String {
    hash_normalized(&normalize_code(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_code_hash_ts() {
        // Values from the committed fixtures (buildShopFunctionConfig → codeHashes).
        assert_eq!(code_hash("C1CODE"), "9af9f910");
        assert_eq!(code_hash("C2CODE"), "587c2195");
        assert_eq!(code_hash("F1A"), "0dbdb69b");
        // Case- and space-insensitive: the customer's typing does not matter.
        assert_eq!(code_hash("  c1code "), "9af9f910");
        // Empty text is the FNV offset basis.
        assert_eq!(code_hash(""), "811c9dc5");
        // UTF-16 code units (a surrogate pair hashes as two units), full upper-casing.
        assert_eq!(code_hash("\u{1F600}x"), "bf58eca0");
        assert_eq!(code_hash("straße"), "d2cc11f4");
        // The number form agrees with the text form, and only codeHash's own texts parse.
        for code in ["C1CODE", "straße", "\u{1F600}x", "", "  c1code "] {
            assert_eq!(parse_hash(&code_hash(code)), Some(hash_value(&normalize_code(code))), "{code}");
        }
        for junk in ["9AF9F910", "9af9f91", "9af9f9100", "9af9f91g", " af9f910"] {
            assert_eq!(parse_hash(junk), None, "{junk}");
        }
        assert!(matches!(normalized("C1CODE"), Cow::Borrowed(_)));
        assert_eq!(MAX_ENTERED_CODES, 25);
        assert_eq!(MAX_CODE_LENGTH, 64);
        assert_eq!(normalized(" c1code "), "C1CODE");
        assert_eq!(normalized("STRASSE"), "STRASSE");
        assert_eq!(normalized("straße"), "STRASSE");
    }

    /// `normalized_hash_within` is `codeHash`'s number (and the trimmed code) for
    /// an entry at most `max` + CODE_PADDING UTF-16 units long whose normalized
    /// form is not empty and at most `max` units long, and refuses every other —
    /// for every scalar value around ASCII, ß and white space, and for lengths
    /// and paddings around every bound (1–4-byte characters, characters with a
    /// multi-character upper-case form, mixed).
    #[test]
    fn normalized_hash_within_is_code_hash_up_to_the_longest_code() {
        let check = |text: &str, max: usize| {
            let raw_units = text.encode_utf16().count();
            let units = normalize_code(text).encode_utf16().count();
            let got = normalized_hash_within(text, max);
            assert_eq!(got.is_some(), raw_units <= max + CODE_PADDING && units > 0 && units <= max, "{text:?} {max}");
            if let Some((hash, trimmed)) = got {
                assert_eq!(trimmed, js::trim(text), "{text:?}");
                assert_eq!(hash, hash_value(&normalize_code(text)), "{text:?}");
                assert_eq!(parse_hash(&code_hash(text)), Some(hash), "{text:?}");
            }
        };
        for n in 0u32..=0x10_FFFF {
            let Some(c) = char::from_u32(n) else { continue };
            for text in [c.to_string(), format!(" aZ{c}q ß{c}ﬁ\u{3000}"), format!("{c}{c}{c}{c}\u{2000}")] {
                let raw = text.encode_utf16().count();
                let units = normalize_code(&text).encode_utf16().count();
                for max in [0, units.saturating_sub(1), units, units + 1, raw.saturating_sub(CODE_PADDING + 1), raw.saturating_sub(CODE_PADDING), 64] {
                    check(&text, max);
                }
            }
        }
        let texts = ["", "A", "ž", "ｚ", "\u{10428}", "Až", "žｚ\u{10428}A", "ﬃ", "ΐ", "ß", "中文", "\u{1F600}\u{1F600}", " ", "\u{3000}", "ᾀ", "\u{200A}", "\u{FEFF}"];
        for a in texts {
            for b in texts {
                for k in 0..30 {
                    let text = format!("{}{}{}", b, a.repeat(k), b);
                    for max in [0, 1, 2, 3, 5, 8, 13, 21, 40, 64, 100] {
                        check(&text, max);
                    }
                }
            }
        }
        // Padding around a code, up to and past CODE_PADDING, at every length of the code.
        for pad in [" ", "\t", "\u{A0}", "\u{3000}", "\u{2000}", "\u{FEFF}"] {
            for code in ["W", "welcome15", "ž", "ß", "ΐ", "\u{10428}"] {
                for k in 0..=70 {
                    for (lead, trail) in [(0, 0), (1, 0), (0, 1), (8, 8), (8, 9), (16, 0), (17, 0), (0, 17), (40, 40)] {
                        let text = format!("{}{}{}", pad.repeat(lead), code.repeat(k), pad.repeat(trail));
                        for max in [0, 9, 20, 21, 32, 63, 64] {
                            check(&text, max);
                        }
                    }
                }
            }
        }
        // Long entries are refused after a bounded amount of work, whatever they hold.
        for text in ["A".repeat(100_000), " ".repeat(100_000), format!("x{}", "\u{200A}".repeat(50_000)), "ž".repeat(40_000)] {
            assert_eq!(normalized_hash_within(&text, 64), None);
        }
    }
}
