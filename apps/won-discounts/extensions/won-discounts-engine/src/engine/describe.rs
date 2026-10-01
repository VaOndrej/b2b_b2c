// The checkout message of a rule without a name: describeRule(rule, locale,
// currency, { short: true }) of describe.ts — value and target only; and of a
// quantity tier (MVP 3): describeTierBreak of the break it reached.

use super::config::TargetKind;
use super::js;
use super::money::{format_money, format_percent};

/// What a reached tier break takes off each item, in the cart currency.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TierBreakValue {
    Percent(f64),
    /// The configured amount (minor units), not the one capped at the item price.
    Amount(i64),
}

/// `describeCappedTierBreak` (describe.ts): a tier break margin protection
/// lowered, named without a value — "Množstevní sleva od 5 ks", "Quantity
/// discount from 1 item", "Quantity discount from 5 items".
pub fn describe_capped_tier_break(min_qty: f64, cs: bool) -> String {
    let mut out = String::with_capacity(32);
    out.push_str(if cs { "Množstevní sleva od " } else { "Quantity discount from " });
    out.push_str(&js::number_to_string(min_qty));
    out.push_str(if cs { " ks" } else if min_qty == 1.0 { " item" } else { " items" });
    out
}

/// `describeTierBreak(tierStepBreak(reached, currency), { locale, currency })`
/// (describe.ts) of a break offered in the cart currency: "Od 3 ks −10 %",
/// "From 1 item −10%", "Od 5 ks −50 Kč za kus", "From 5 items −CZK 50 per item".
pub fn describe_tier_break(min_qty: f64, value: TierBreakValue, cs: bool, currency: &str) -> String {
    // Built piece by piece: one message per set and break reached, without the
    // formatting machinery (~4 k Wasm instructions a message; instruction budget).
    let mut out = String::with_capacity(40);
    out.push_str(if cs { "Od " } else { "From " });
    out.push_str(&js::number_to_string(min_qty));
    out.push_str(if !cs { if min_qty == 1.0 { " item \u{2212}" } else { " items \u{2212}" } } else { " ks \u{2212}" });
    match value {
        TierBreakValue::Percent(p) => out.push_str(&format_percent(p, cs)),
        TierBreakValue::Amount(minor) => {
            out.push_str(&format_money(minor as f64, currency, cs));
            out.push_str(if cs { " za kus" } else { " per item" });
        }
    }
    out
}

/// The value a rule describes itself with (plan.ts `describedValue`).
#[derive(Debug, Clone, PartialEq)]
pub enum DescribedValue {
    Percentage(f64),
    /// The raw config number for the cart currency (`moneyFor`), when it is a number.
    Fixed(Option<f64>),
    FreeShipping,
}

/// `describeValue` (describe.ts) with the cart currency.
pub fn describe_short(value: &DescribedValue, target: TargetKind, cs: bool, currency: &str) -> String {
    match value {
        DescribedValue::FreeShipping => (if cs { "Doprava zdarma" } else { "Free shipping" }).to_string(),
        DescribedValue::Percentage(percent) => {
            let p = format_percent(*percent, cs);
            let tail = match (cs, target) {
                (true, TargetKind::Order) => "z objednávky",
                (true, TargetKind::Products) => "na vybrané produkty",
                (true, TargetKind::Collections) => "na vybrané kolekce",
                (true, TargetKind::Shipping) => "z dopravy",
                (false, TargetKind::Order) => "off the order",
                (false, TargetKind::Products) => "off selected products",
                (false, TargetKind::Collections) => "off selected collections",
                (false, TargetKind::Shipping) => "off shipping",
            };
            format!("{p} {tail}")
        }
        DescribedValue::Fixed(None) => {
            if cs {
                format!("Pevná sleva (pro {currency} bez hodnoty)")
            } else {
                format!("Fixed amount (no value for {currency})")
            }
        }
        DescribedValue::Fixed(Some(minor)) => {
            let m = format_money(*minor, currency, cs);
            let tail = match (cs, target) {
                (true, TargetKind::Order) => "z objednávky",
                (true, TargetKind::Products) => "z každého kusu vybraných produktů",
                (true, TargetKind::Collections) => "z každého kusu z vybraných kolekcí",
                (true, TargetKind::Shipping) => "z dopravy",
                (false, TargetKind::Order) => "off the order",
                (false, TargetKind::Products) => "off each selected item",
                (false, TargetKind::Collections) => "off each item in selected collections",
                (false, TargetKind::Shipping) => "off shipping",
            };
            format!("{m} {tail}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_descriptions_match_describe_ts() {
        let cs = |v: DescribedValue, t: TargetKind| describe_short(&v, t, true, "CZK");
        let en = |v: DescribedValue, t: TargetKind| describe_short(&v, t, false, "CZK");
        assert_eq!(cs(DescribedValue::Percentage(10.0), TargetKind::Order), "10\u{A0}% z objednávky");
        assert_eq!(en(DescribedValue::Percentage(12.5), TargetKind::Products), "12.5% off selected products");
        assert_eq!(cs(DescribedValue::FreeShipping, TargetKind::Shipping), "Doprava zdarma");
        assert_eq!(
            cs(DescribedValue::Fixed(Some(5000.0)), TargetKind::Collections),
            "50\u{A0}Kč z každého kusu z vybraných kolekcí"
        );
        assert_eq!(en(DescribedValue::Fixed(Some(10000.0)), TargetKind::Order), "CZK 100 off the order");
        assert_eq!(en(DescribedValue::Fixed(None), TargetKind::Order), "Fixed amount (no value for CZK)");
    }

    #[test]
    fn tier_breaks_match_describe_tier_break() {
        use TierBreakValue::{Amount, Percent};
        assert_eq!(describe_tier_break(3.0, Percent(10.0), true, "CZK"), "Od 3 ks \u{2212}10\u{A0}%");
        assert_eq!(describe_tier_break(1.0, Percent(12.5), false, "EUR"), "From 1 item \u{2212}12.5%");
        assert_eq!(describe_tier_break(5.0, Percent(12.5), true, "EUR"), "Od 5 ks \u{2212}12,5\u{A0}%");
        assert_eq!(describe_tier_break(5.0, Amount(5000), true, "CZK"), "Od 5 ks \u{2212}50\u{A0}Kč za kus");
        assert_eq!(describe_tier_break(2.0, Amount(5000), false, "CZK"), "From 2 items \u{2212}CZK 50 per item");
        assert_eq!(describe_tier_break(10.0, Amount(250), false, "EUR"), "From 10 items \u{2212}€2.50 per item");
        assert_eq!(describe_capped_tier_break(5.0, true), "Množstevní sleva od 5 ks");
        assert_eq!(describe_capped_tier_break(1.0, false), "Quantity discount from 1 item");
        assert_eq!(describe_capped_tier_break(5.0, false), "Quantity discount from 5 items");
    }
}
