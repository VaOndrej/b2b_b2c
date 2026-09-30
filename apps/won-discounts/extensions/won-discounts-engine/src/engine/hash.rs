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
/// trimmed code, when it can be a Won code: not empty, and trimmed at most
/// `max` UTF-16 units long. Upper-casing never shortens a text (in UTF-16
/// units, for every scalar value in both engines' Unicode tables), so a longer
/// one can never become a Won code (plan.ts `matchCodes`): it is left after at
/// most `max` + 1 of its characters, or at once when its bytes alone rule it
/// out. The upper-case form is hashed as it is read from the case table, never
/// built (audit round 6: upper-casing through the standard library and then
/// hashing cost ~620 instructions a non-ASCII character; this costs ~45 an
/// ASCII one, ~90–130 another).
pub fn normalized_hash_within(raw: &str, max: usize) -> Option<(u32, &str)> {
    let code = js::trim(raw);
    // A UTF-16 unit is 1–3 UTF-8 bytes (a 4-byte character is 2 units).
    if code.is_empty() || code.len() > 3 * max {
        return None;
    }
    let mut hash = FNV_OFFSET;
    let mut units = 0;
    for c in code.chars() {
        let cp = c as u32;
        if cp < 0x80 {
            hash = (hash ^ u32::from((cp as u8).to_ascii_uppercase())).wrapping_mul(FNV_PRIME);
            units += 1;
        } else {
            units += c.len_utf16();
            match js::upper_entry(cp) {
                0 => hash = hash_code_point(hash, cp),
                entry @ 0xD800..=0xDFFF => {
                    // Two or three BMP characters, 0-padded.
                    for unit in js::upper_many(entry).copied().unwrap_or_default() {
                        if unit == 0 {
                            break;
                        }
                        hash = (hash ^ u32::from(unit)).wrapping_mul(FNV_PRIME);
                    }
                }
                // Upper-casing never leaves the character's plane.
                entry => hash = hash_code_point(hash, (cp & !0xFFFF) | u32::from(entry)),
            }
        }
        if units > max {
            return None;
        }
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

    /// `normalize_within` is `normalizeCode` for a code whose trimmed text is at
    /// most `max` UTF-16 units long, and refuses every longer or empty one — for
    /// every scalar value around ASCII, ß and white space, and for lengths
    /// around every bound (1–4-byte characters, mixed).
    /// `normalized_hash_within` is `codeHash`'s number (and the trimmed code) for
    /// a code whose trimmed text is at most `max` UTF-16 units long, and refuses
    /// every longer or empty one — for every scalar value around ASCII, ß and
    /// white space, and for lengths around every bound (1–4-byte characters,
    /// characters with a multi-character upper-case form, mixed).
    #[test]
    fn normalized_hash_within_is_code_hash_up_to_the_longest_code() {
        let check = |text: &str, max: usize| {
            let units = js::trim(text).encode_utf16().count();
            let got = normalized_hash_within(text, max);
            assert_eq!(got.is_some(), units > 0 && units <= max, "{text:?} {max}");
            if let Some((hash, trimmed)) = got {
                assert_eq!(trimmed, js::trim(text), "{text:?}");
                assert_eq!(hash, hash_value(&normalize_code(text)), "{text:?}");
                assert_eq!(parse_hash(&code_hash(text)), Some(hash), "{text:?}");
            }
        };
        for n in 0u32..=0x10_FFFF {
            let Some(c) = char::from_u32(n) else { continue };
            for text in [c.to_string(), format!(" aZ{c}q ß{c}ﬁ\u{3000}")] {
                let units = js::trim(&text).encode_utf16().count();
                for max in [0, units.saturating_sub(1), units, 64] {
                    check(&text, max);
                }
            }
        }
        let texts = ["", "A", "ž", "ｚ", "\u{10428}", "Až", "žｚ\u{10428}A", "ﬃ", "中文", "\u{1F600}\u{1F600}", " ", "\u{3000}", "ᾀ"];
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
    }
}
