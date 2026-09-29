// money.ts: integer minor units of the cart currency. The decimal strings
// Shopify speaks are parsed from their digits (never via float
// multiplication) and printed back the same way.

use super::js;

/// `Number.MAX_SAFE_INTEGER`: toMinorUnits refuses anything above it.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// `currencyExponent` (money.ts): minor-unit digits (CZK/EUR 2, JPY 0, KWD 3).
pub fn currency_exponent(currency: &str) -> usize {
    // The cart currency arrives upper-case; only other text is upper-cased (JS toUpperCase).
    let upper;
    let code = if currency.bytes().all(|b| b.is_ascii_uppercase()) {
        currency
    } else {
        upper = js::upper(currency);
        upper.as_str()
    };
    match code {
        "BIF" | "CLP" | "DJF" | "GNF" | "ISK" | "JPY" | "KMF" | "KRW" | "PYG" | "RWF" | "UGX" | "VND" | "VUV" | "XAF" | "XOF"
        | "XPF" => 0,
        "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => 3,
        _ => 2,
    }
}

/// `toMinorUnits` (money.ts) of an already trimmed decimal text: "1234.5" in CZK
/// → 123450. `^(\d+)(?:\.(\d+))?$`, digits beyond the currency's precision are
/// rounded half up; malformed, negative or above 2^53 − 1 → None.
pub fn to_minor_units(text: &str, currency: &str) -> Option<i64> {
    to_minor_units_with(text, currency_exponent(currency))
}

/// `to_minor_units` with the currency's exponent already known (once per run, not per line).
pub fn to_minor_units_with(text: &str, digits: usize) -> Option<i64> {
    let (whole, fraction) = match text.split_once('.') {
        Some((w, f)) => (w, Some(f)),
        None => (text, None),
    };
    let digits_only = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !digits_only(whole) || !fraction.map_or(true, digits_only) {
        return None;
    }
    let fraction = fraction.unwrap_or("").as_bytes();
    let mut value: u64 = 0;
    let mut push = |d: u8| -> Option<()> {
        value = value.checked_mul(10)?.checked_add(u64::from(d - b'0'))?;
        Some(())
    };
    for d in whole.bytes() {
        push(d)?;
    }
    for i in 0..digits {
        push(*fraction.get(i).unwrap_or(&b'0'))?;
    }
    if fraction.len() > digits && fraction[digits] >= b'5' {
        value = value.checked_add(1)?;
    }
    if value > MAX_SAFE_INTEGER {
        return None;
    }
    Some(value as i64)
}

/// `fromMinorUnits` (money.ts): 123450 minor units → "1234.50".
pub fn from_minor_units(minor: i64, currency: &str) -> String {
    from_minor_units_with(minor, currency_exponent(currency))
}

/// `from_minor_units` with the currency's exponent already known (once per output, not per amount).
pub fn from_minor_units_with(minor: i64, digits: usize) -> String {
    // Digits of max(0, minor), written by hand (no fmt machinery on the hot path).
    let mut buf = [0u8; 24];
    let mut n = minor.max(0) as u64;
    let mut start = buf.len();
    loop {
        start -= 1;
        buf[start] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    // padStart(digits + 1, "0")
    while buf.len() - start < digits + 1 {
        start -= 1;
        buf[start] = b'0';
    }
    let text = &buf[start..];
    let mut out = String::with_capacity(text.len() + 1);
    let split = text.len() - digits;
    out.extend(text[..split].iter().map(|&b| b as char));
    if digits > 0 {
        out.push('.');
        out.extend(text[split..].iter().map(|&b| b as char));
    }
    out
}

/// `fromMinorUnits(minor, currency).length`, without building the text.
pub fn minor_units_len(minor: i64, currency: &str) -> usize {
    minor_units_len_with(minor, currency_exponent(currency))
}

/// `minor_units_len` with the currency's exponent already known.
pub fn minor_units_len_with(minor: i64, digits: usize) -> usize {
    let mut n = minor.max(0) as u64;
    let mut len = 1;
    while n >= 10 {
        n /= 10;
        len += 1;
    }
    if digits == 0 {
        len
    } else {
        len.max(digits + 1) + 1
    }
}

const NBSP: &str = "\u{A0}";

fn group_thousands(digits: &str, separator: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 * separator.len());
    let len = digits.len();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push_str(separator);
        }
        out.push(c);
    }
    out
}

/// `formatMoney` (describe.ts): 123450 CZK → "1 234,50 Kč" (cs) / "CZK 1,234.50" (en).
/// `minor` is the raw config number (the checkout message rounds it; the engine floors it).
pub fn format_money(minor: f64, currency: &str, cs: bool) -> String {
    let code = js::upper(currency);
    let digits = currency_exponent(&code);
    let n = js::round(minor.abs());
    let scale = 10f64.powi(digits as i32);
    let major = (n / scale).floor();
    let fraction = n % scale;
    let sign = if minor < 0.0 { "-" } else { "" };
    let mut number = group_thousands(&js::number_to_string(major), if cs { NBSP } else { "," });
    if fraction > 0.0 {
        number.push_str(if cs { "," } else { "." });
        number.push_str(&js::pad_start_zeros(&js::number_to_string(fraction), digits));
    }
    if cs {
        let symbol = match code.as_str() {
            "CZK" => "Kč",
            "EUR" => "€",
            other => other,
        };
        return format!("{sign}{number}{NBSP}{symbol}");
    }
    let prefix = match code.as_str() {
        "EUR" => Some("€"),
        "USD" => Some("$"),
        "GBP" => Some("£"),
        _ => None,
    };
    match prefix {
        Some(symbol) => format!("{sign}{symbol}{number}"),
        None => format!("{sign}{code} {number}"),
    }
}

/// `formatPercent` (describe.ts): 12.5 → "12,5 %" (cs) / "12.5%" (en).
pub fn format_percent(percent: f64, cs: bool) -> String {
    let text = js::number_to_string(js::round(percent * 100.0) / 100.0);
    if cs {
        format!("{}{NBSP}%", text.replacen('.', ",", 1))
    } else {
        format!("{text}%")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_decimal_strings_like_to_minor_units() {
        assert_eq!(to_minor_units("100.0", "CZK"), Some(10000));
        assert_eq!(to_minor_units("249.9", "CZK"), Some(24990));
        assert_eq!(to_minor_units("0.29", "CZK"), Some(29));
        assert_eq!(to_minor_units("12.345", "EUR"), Some(1235));
        assert_eq!(to_minor_units("12.344", "EUR"), Some(1234));
        assert_eq!(to_minor_units("1500", "JPY"), Some(1500));
        assert_eq!(to_minor_units("1500.5", "JPY"), Some(1501));
        assert_eq!(to_minor_units("1.2345", "KWD"), Some(1235));
        assert_eq!(to_minor_units("007", "CZK"), Some(700));
        assert_eq!(to_minor_units("-5", "CZK"), None);
        assert_eq!(to_minor_units("1e3", "CZK"), None);
        assert_eq!(to_minor_units("1.", "CZK"), None);
        assert_eq!(to_minor_units(".5", "CZK"), None);
        assert_eq!(to_minor_units("", "CZK"), None);
        assert_eq!(to_minor_units("90071992547409.91", "CZK"), Some(9_007_199_254_740_991));
        assert_eq!(to_minor_units("90071992547409.92", "CZK"), None);
        assert_eq!(to_minor_units("99999999999999999999999", "CZK"), None);
    }

    #[test]
    fn prints_minor_units_like_from_minor_units() {
        assert_eq!(from_minor_units(3000, "CZK"), "30.00");
        assert_eq!(from_minor_units(5, "EUR"), "0.05");
        assert_eq!(from_minor_units(0, "CZK"), "0.00");
        assert_eq!(from_minor_units(-10, "CZK"), "0.00");
        assert_eq!(from_minor_units(1500, "JPY"), "1500");
        assert_eq!(from_minor_units(1235, "KWD"), "1.235");
        assert_eq!(from_minor_units(9_007_199_254_740_991, "CZK"), "90071992547409.91");
        for (minor, currency) in [(0, "CZK"), (5, "EUR"), (3000, "CZK"), (1500, "JPY"), (7, "KWD"), (123456789, "kwd"), (-4, "CZK")] {
            assert_eq!(minor_units_len(minor, currency), from_minor_units(minor, currency).len(), "{minor} {currency}");
        }
        assert_eq!(currency_exponent("jpy"), 0);
        assert_eq!(currency_exponent("Kwd"), 3);
        assert_eq!(currency_exponent("CZK"), 2);
    }

    #[test]
    fn formats_money_and_percent_like_describe_ts() {
        assert_eq!(format_money(123450.0, "CZK", true), "1\u{A0}234,50\u{A0}Kč");
        assert_eq!(format_money(10000.0, "CZK", true), "100\u{A0}Kč");
        assert_eq!(format_money(123450.0, "CZK", false), "CZK 1,234.50");
        assert_eq!(format_money(500.0, "EUR", false), "€5");
        assert_eq!(format_money(505.0, "eur", true), "5,05\u{A0}€");
        assert_eq!(format_money(150.5, "CZK", true), "1,51\u{A0}Kč");
        assert_eq!(format_money(1500.0, "JPY", false), "JPY 1,500");
        assert_eq!(format_percent(10.0, true), "10\u{A0}%");
        assert_eq!(format_percent(12.5, true), "12,5\u{A0}%");
        assert_eq!(format_percent(12.345, false), "12.35%");
        assert_eq!(format_percent(33.333333, false), "33.33%");
    }
}
