// Generated code batches (plan 2026-10-06, dávka 4): code-batch.ts, the part
// the function runs — `readCodeBatch` + `matchesCodeBatch` as one question,
// "is this entered code a code of the batch this text describes?". A batch
// travels in the shared config as ONE text among a code rule's `codeHashes`
// (20 characters or more: never one of the 8-digit hashes),
//   <check key: 16 ASCII characters, the SipHash key's bytes>
//   <alphabet: "0" / "1" / "2"><code length: "0" + n><suffix length: "0" + s><prefix>
// never its codes: an entered code is the batch's when it has that length,
// starts with the prefix, and the K characters before its last `s` ones are
// the keyed check (SipHash-2-4) of ALL its other characters. The layout, the
// alphabets and the reason for the check are in the header of code-batch.ts.

use super::hash::MAX_CODE_LENGTH;

/// CODE_BATCH_CHARS, by the payload's alphabet index (0 both, 1 letters, 2 digits).
const CHARS: [&[u8]; 3] = [b"23456789ABCDEFGHJKMNPQRSTUVWXYZ", b"ABCDEFGHJKMNPQRSTUVWXYZ", b"23456789"];
/// CODE_BATCH_CHECK_LENGTH, by the same index.
const CHECK_LENGTH: [usize; 3] = [4, 4, 6];
/// Where the prefix starts in the batch's text (CODE_BATCH_PAYLOAD_HEAD): after the key and its three characters.
pub const PREFIX: usize = 19;

/// `readCodeBatch(text)` reads as a batch AND `matchesCodeBatch(batch, code)`:
/// `code` = an entered code as entered, trimmed (compared as its upper-case
/// form; one with a character that is not ASCII is never a batch's: cart.ts
/// `ascii`). The text must be exactly of the form above — 16 ASCII characters,
/// one of "0" / "1" / "2", "0" + the code's length (at most MAX_CODE_LENGTH),
/// "0" + the suffix's, a non-empty prefix of `[A-Z0-9_-]` that leaves at least
/// one character before the check — else it is no batch and nothing is its
/// code. The cheap questions come first (the length, the prefix): a code of
/// another batch costs a few dozen instructions.
#[inline(never)]
pub fn is_batch_code(text: &str, code: &[u8]) -> bool {
    let Some((head, prefix)) = text.as_bytes().split_first_chunk::<PREFIX>() else { return false };
    let [k0 @ .., a, n, s] = head;
    // (A byte below "0" wraps to a number no alphabet or length is.)
    let number = |c: &u8| usize::from(c.wrapping_sub(b'0'));
    let (alphabet, n, suffix) = (number(a), number(n), number(s));
    let (Some(&chars), Some(&check_length)) = (CHARS.get(alphabet), CHECK_LENGTH.get(alphabet)) else { return false };
    if code.len() != n || n > MAX_CODE_LENGTH || prefix.is_empty() || n <= prefix.len() + suffix + check_length {
        return false;
    }
    // The key's 16 bytes, as SipHash reads them; ASCII only (then the text's first 19 characters are these bytes).
    let (low, high) = k0.split_at(8);
    let word = |bytes: &[u8]| u64::from_le_bytes(bytes.try_into().unwrap_or([0x80; 8]));
    let key = (word(low), word(high));
    if (key.0 | key.1) & 0x8080_8080_8080_8080 != 0 {
        return false;
    }
    let end = n - suffix;
    let start = end - check_length;
    // `hashChars`' message: the code without its check, upper-cased, then "|" and the block number.
    let mut message = [0u8; MAX_CODE_LENGTH + 2];
    let mut at = 0;
    for (i, &raw) in code.iter().enumerate() {
        let c = raw.to_ascii_uppercase();
        if let Some(&p) = prefix.get(i) {
            // A prefix of `[A-Z0-9_-]`, and the code's start.
            if p != c || !(p.is_ascii_uppercase() || p.is_ascii_digit() || p == b'_' || p == b'-') {
                return false;
            }
        }
        if raw >= 0x80 {
            return false;
        }
        if i < start || i >= end {
            message[at] = c;
            at += 1;
        }
    }
    message[at] = b'|';
    // 4 characters a block of SipHash(key, message + block), low 16 bits first.
    let mut hash = 0;
    for (j, raw) in code[start..end].iter().enumerate() {
        if j % 4 == 0 {
            message[at + 1] = b'0' + (j / 4) as u8;
            hash = sip_hash_24(key, &message[..at + 2]);
        }
        let word = (hash >> (16 * (j % 4))) & 0xffff;
        if chars[((word * chars.len() as u64) >> 16) as usize] != raw.to_ascii_uppercase() {
            return false;
        }
    }
    true
}

/// SipHash-2-4 (code-batch.ts `sipHash24`).
#[inline(never)]
pub fn sip_hash_24(key: (u64, u64), message: &[u8]) -> u64 {
    let (k0, k1) = key;
    let mut v = [k0 ^ 0x736f_6d65_7073_6575, k1 ^ 0x646f_7261_6e64_6f6d, k0 ^ 0x6c79_6765_6e65_7261, k1 ^ 0x7465_6462_7974_6573];
    #[inline(never)]
    fn round(v: &mut [u64; 4]) {
        v[0] = v[0].wrapping_add(v[1]);
        v[1] = v[1].rotate_left(13) ^ v[0];
        v[0] = v[0].rotate_left(32);
        v[2] = v[2].wrapping_add(v[3]);
        v[3] = v[3].rotate_left(16) ^ v[2];
        v[0] = v[0].wrapping_add(v[3]);
        v[3] = v[3].rotate_left(21) ^ v[0];
        v[2] = v[2].wrapping_add(v[1]);
        v[1] = v[1].rotate_left(17) ^ v[2];
        v[2] = v[2].rotate_left(32);
    }
    let absorb = |v: &mut [u64; 4], m: u64| {
        v[3] ^= m;
        round(v);
        round(v);
        v[0] ^= m;
    };
    let mut chunks = message.chunks_exact(8);
    for chunk in &mut chunks {
        absorb(&mut v, u64::from_le_bytes(chunk.try_into().unwrap_or([0; 8])));
    }
    let mut last = (message.len() as u64 & 0xff) << 56;
    for (i, &b) in chunks.remainder().iter().enumerate() {
        last |= u64::from(b) << (8 * i);
    }
    absorb(&mut v, last);
    v[2] ^= 0xff;
    for _ in 0..4 {
        round(&mut v);
    }
    v[0] ^ v[1] ^ v[2] ^ v[3]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sip_hash_24_reference_vectors() {
        // The key bytes 00 01 … 0f; messages 00 01 … (code-batch.test.ts pins the same four).
        let key = (0x0706_0504_0302_0100, 0x0f0e_0d0c_0b0a_0908);
        let message: Vec<u8> = (0u8..15).collect();
        assert_eq!(sip_hash_24(key, &message), 0xa129_ca61_49be_45e5);
        assert_eq!(sip_hash_24(key, &[]), 0x726f_db47_dd0e_0e31);
        assert_eq!(sip_hash_24(key, &message[..8]), 0x93f5_f579_9a93_2462);
        assert_eq!(sip_hash_24(key, &message[..9]), 0x9e00_82df_0ba9_e4b0);
    }

    // codeBatchCheckKey("000102030405060708090a0b0c0d0e0f").
    const KEY: &str = "fMMWc55qaEgjTq67";
    // generateBatchCodes({prefix: "BF-", length: 10, alphabet: "both"}) and
    // ({prefix: "VIP", length: 13, alphabet: "digits", middle: "-X-", suffix: "_24"}) of that seed
    // (code-batch.test.ts pins the same codes), and their payload texts.
    const CODES_BOTH: [&str; 3] = ["BF-KZG8E2NAVT", "BF-EHG852G9N8", "BF-RPH79S627G"];
    const BOTH: &str = "fMMWc55qaEgjTq670=0BF-";
    const CODES_DIGITS: [&str; 2] = ["VIP6953524-X-899542_24", "VIP5653323-X-537345_24"];
    const DIGITS: &str = "fMMWc55qaEgjTq672F3VIP";

    #[test]
    fn only_the_text_code_batch_ts_writes_is_a_batch() {
        // The same texts as code-batch.test.ts ("the payload text is read tolerantly…"): with a
        // valid text the batch's first code is its code; with any other, nothing is.
        let code = CODES_BOTH[0].as_bytes();
        let is = |text: &str| is_batch_code(text, code);
        assert!(is(BOTH));
        assert_eq!(BOTH, format!("{KEY}0=0BF-"));
        for bad in ["", "0=", "0=0", "0=0bf-", "0=0BF ", "0=0BF-\n", "0=0BF-é", "3=0BF-", "/=0BF-", "0>0BF-", "0<0BF-", "0=1BF-", "0=/BF-", "0=0B_-", "1=0BF-"] {
            assert!(!is(&format!("{KEY}{bad}")), "{bad}");
        }
        assert!(!is(&format!("{}0=0BF-", &KEY[1..])));
        assert!(!is(&format!("é{}0=0BF-", &KEY[2..])));
        assert!(!is(KEY));
        // The bounds: at most 64 characters, at least one character between the prefix and the check.
        assert!(!is_batch_code(&format!("{KEY}0q0BF-"), &[b'A'; 65]));
        assert!(!is_batch_code(&format!("{KEY}070BF-"), b"BF-2222"));
        assert!(!is_batch_code(&format!("{KEY}290BF-"), b"BF-222222"));
    }

    #[test]
    fn matches_the_codes_code_batch_ts_generates() {
        for code in [CODES_BOTH[0], CODES_BOTH[1], CODES_BOTH[2], &CODES_BOTH[0].to_lowercase()] {
            assert!(is_batch_code(BOTH, code.as_bytes()), "{code}");
        }
        let flipped = format!("{}{}", &CODES_BOTH[0][..12], if CODES_BOTH[0].ends_with('2') { '3' } else { '2' });
        let body_off = format!("BF-{}{}", if &CODES_BOTH[0][3..4] == "2" { '3' } else { '2' }, &CODES_BOTH[0][4..]);
        for code in [flipped.as_str(), body_off.as_str(), &CODES_BOTH[0].replace("BF-", "BG-"), &CODES_BOTH[0][..12], &format!("{}2", CODES_BOTH[0]), "BF-ANYTHING12", "", "BF-", "BF-KZG8E2NAV\u{17f}"] {
            assert!(!is_batch_code(BOTH, code.as_bytes()), "{code}");
        }
        // A middle inside the random part and a suffix after the check (6 check digits = two blocks):
        // the function knows neither literal — a wrong one fails the check.
        for code in [CODES_DIGITS[0], CODES_DIGITS[1], &CODES_DIGITS[0].to_lowercase()] {
            assert!(is_batch_code(DIGITS, code.as_bytes()), "{code}");
        }
        for code in [CODES_DIGITS[0].replace("-X-", "-Y-"), CODES_DIGITS[0].replace("_24", "_25"), CODES_DIGITS[0].replace("VIP", "VIQ")] {
            assert!(!is_batch_code(DIGITS, code.as_bytes()), "{code}");
        }
    }
}
