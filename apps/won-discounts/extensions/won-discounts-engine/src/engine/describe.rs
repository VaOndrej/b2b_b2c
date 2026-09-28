// The checkout message of a rule without a name: describeRule(rule, locale,
// currency, { short: true }) of describe.ts — value and target only.

use super::config::TargetKind;
use super::money::{format_money, format_percent};

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
}
