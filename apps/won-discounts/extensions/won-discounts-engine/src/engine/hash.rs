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

/// The FNV-1a hash of `codeHash` as its number: over the UTF-16 code units of
/// an already normalized code (ASCII bytes are their own units).
pub fn hash_value(text: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    if text.is_ascii() {
        for &b in text.as_bytes() {
            hash ^= u32::from(b);
            hash = hash.wrapping_mul(0x0100_0193);
        }
        return hash;
    }
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// cart.ts MAX_ENTERED_CODES: the engine considers the first 25 codes as
/// entered ([spec], audit round 5b); a later one is never matched. The cap
/// counts entries, so repeats cannot make the reader read more.
pub const MAX_ENTERED_CODES: usize = 25;

/// The entered codes the engine considers (normalizeCart `consideredCodes` +
/// plan.ts `matchCodes`): of the first MAX_ENTERED_CODES as entered, each
/// normalized (`normalizeCode`), empty ones dropped, each once, in entry order.
pub fn considered_codes(entered: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(entered.len().min(MAX_ENTERED_CODES));
    for raw in entered.iter().take(MAX_ENTERED_CODES) {
        let code = normalized(raw);
        if !code.is_empty() && !out.iter().any(|c| c.as_str() == code.as_ref()) {
            out.push(code.into_owned());
        }
    }
    out
}

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
        // Of the first 25 codes as entered: normalized, empty ones and repeats dropped.
        let raw: Vec<String> = (0..40).map(|k| format!(" code{} ", k % 20)).collect();
        let mut entered: Vec<&str> = vec![" ", "\u{FEFF}", "Code0"];
        entered.extend(raw.iter().map(String::as_str));
        let considered = considered_codes(&entered);
        assert_eq!(considered.len(), 20, "entries 1–25: 2 empty, CODE0 twice, CODE0…CODE19, then CODE0–CODE1 again");
        assert_eq!(considered[..3], ["CODE0", "CODE1", "CODE2"]);
        assert_eq!(MAX_ENTERED_CODES, 25);
        assert_eq!(normalized(" c1code "), "C1CODE");
        assert_eq!(normalized("STRASSE"), "STRASSE");
        assert_eq!(normalized("straße"), "STRASSE");
    }
}
