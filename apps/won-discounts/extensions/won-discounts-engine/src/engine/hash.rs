// Discount codes travel in the shared config as FNV-1a hashes (code-hash.ts):
// 32 bit, over the normalized code (trimmed, upper-cased), as 8 lowercase hex
// digits. JS hashes UTF-16 code units (`charCodeAt`), so this does too.

use super::js;

/// `normalizeCode` (cart.ts): trimmed and upper-cased, as Shopify codes are case-insensitive.
pub fn normalize_code(code: &str) -> String {
    js::upper(js::trim(code))
}

/// `codeHash` (code-hash.ts) of an already normalized code.
pub fn hash_normalized(text: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x0100_0193);
    }
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
    }
}
