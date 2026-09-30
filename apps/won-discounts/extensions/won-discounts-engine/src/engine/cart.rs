// cart.ts: the cart the engine plans (CartPlanInput, filled by src/input.rs the
// way the TS adapter fills it) and its defensive normalization. Strings are
// borrowed from the function input (lifetime 'a): a 200-line cart is read once
// and never copied.

use super::hash::normalize_code;
use super::js;
use super::margin::MarginRef;
use super::money::mul_sat;
use super::table::bytes_eq;

/// One cart line as the adapter hands it over (CartLineInput).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct LineInput<'a> {
    pub id: &'a str,
    pub quantity: i64,
    /// Minor units per item (toMinorUnits of `amountPerQuantity.amount`, 0 when unreadable).
    pub unit_price: i64,
    /// Outlet run on the variant (product metafield `outlet`).
    pub outlet: bool,
    /// A Won gift line (`_won_gift` attribute, non-empty).
    pub gift: bool,
    /// Product-wide refs (product metafield `ruleIds`).
    pub rule_ids: &'a [String],
    /// This variant's refs (product metafield `variantRuleIds`), usually none.
    pub variant_rule_ids: &'a [String],
    /// Margin protection (MVP 2): cost of one item in MAJOR units of the shop
    /// currency, as read from the variant metafield (`cost`); margin.rs decides
    /// whether it is usable. Read only while margin protection is on.
    pub unit_cost: Option<f64>,
    /// The currency of `unit_cost` (the variant metafield's `cur`).
    pub unit_cost_currency: Option<&'a str>,
    /// Numeric ids of the product's decisive margin collections (product metafield
    /// `marginRefs`); read only while the payload has collection settings, and
    /// only when there are at most MAX_MARGIN_REFS of them.
    pub margin_refs: &'a [MarginRef],
    /// How many entries the metafield's `marginRefs` has, junk included (0 when
    /// not read): above MAX_MARGIN_REFS the payload's strictest setting applies.
    pub margin_ref_count: usize,
}

/// The node's campaign variables (C4/C7): `id` + `varsVersion` from its
/// `function_vars`, `active` = `shop.localTime.dateTimeBetween(start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CampaignInput<'a> {
    pub id: Option<&'a str>,
    pub active: bool,
    pub vars_version: Option<&'a str>,
}

/// CartPlanInput (the fields the function fills).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CartInput<'a> {
    pub currency: String,
    pub country_code: Option<&'a str>,
    pub lines: Vec<LineInput<'a>>,
    /// Every entered code, raw.
    pub entered_codes: Vec<&'a str>,
    pub campaign: CampaignInput<'a>,
    pub today: Option<&'a str>,
    /// `locale === "en"` (anything else plans Czech messages).
    pub locale_en: bool,
    /// Shop currency → cart currency (`presentmentCurrencyRate`), for margin protection.
    pub shop_to_cart_rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedLine<'a> {
    pub id: &'a str,
    pub quantity: i64,
    pub unit_price: i64,
    pub subtotal: i64,
    pub outlet: bool,
    pub gift: bool,
    /// Product-wide refs (`ruleIds`).
    pub rule_ids: &'a [String],
    /// This variant's refs.
    pub variant_rule_ids: &'a [String],
    pub unit_cost: Option<f64>,
    pub unit_cost_currency: Option<&'a str>,
    pub margin_refs: &'a [MarginRef],
    pub margin_ref_count: usize,
}

impl NormalizedLine<'_> {
    /// Product-wide refs + this variant's refs (normalizeCart `ruleIds`).
    pub fn refs(&self) -> impl Iterator<Item = &str> {
        self.rule_ids.iter().chain(self.variant_rule_ids.iter()).map(String::as_str)
    }

    /// The same product-wide refs and variant refs as `other`, text by text.
    pub fn same_refs(&self, other: &NormalizedLine) -> bool {
        let same = |a: &[String], b: &[String]| a.len() == b.len() && a.iter().zip(b).all(|(x, y)| bytes_eq(x.as_bytes(), y.as_bytes()));
        same(self.rule_ids, other.rule_ids) && same(self.variant_rule_ids, other.variant_rule_ids)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedCart<'a> {
    pub currency: String,
    /// Upper-case ISO 3166-1 alpha-2, or none.
    pub country_code: Option<String>,
    pub lines: Vec<NormalizedLine<'a>>,
    /// Upper-cased, trimmed, unique, in entry order.
    pub entered_codes: Vec<String>,
    pub campaign: CampaignInput<'a>,
    pub today: Option<&'a str>,
    pub locale_en: bool,
    pub shop_to_cart_rate: Option<f64>,
}

fn is_country(s: &str) -> bool {
    s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase())
}

/// `normalizeCart` (cart.ts).
pub fn normalize_cart(input: CartInput<'_>) -> NormalizedCart<'_> {
    let lines = input
        .lines
        .into_iter()
        .map(|line| {
            // `nonNegativeInt`: a positive number, floored; else 0.
            let quantity = line.quantity.max(0);
            let unit_price = line.unit_price.max(0);
            NormalizedLine {
                id: line.id,
                quantity,
                unit_price,
                subtotal: mul_sat(quantity, unit_price),
                outlet: line.outlet,
                gift: line.gift,
                rule_ids: line.rule_ids,
                variant_rule_ids: line.variant_rule_ids,
                unit_cost: line.unit_cost,
                unit_cost_currency: line.unit_cost_currency,
                margin_refs: line.margin_refs,
                margin_ref_count: line.margin_ref_count,
            }
        })
        .collect();

    let mut entered_codes: Vec<String> = Vec::new();
    for raw in &input.entered_codes {
        let code = normalize_code(raw);
        if !code.is_empty() && !entered_codes.contains(&code) {
            entered_codes.push(code);
        }
    }

    let country = input.country_code.map(|c| js::upper(js::trim(c)));
    NormalizedCart {
        currency: js::upper(&input.currency),
        country_code: country.filter(|c| is_country(c)),
        lines,
        entered_codes,
        campaign: input.campaign,
        today: input.today.filter(|d| js::is_local_date(d)),
        locale_en: input.locale_en,
        shop_to_cart_rate: input.shop_to_cart_rate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_like_cart_ts() {
        let refs = vec!["a".to_string()];
        let variant = vec!["b".to_string()];
        let cart = normalize_cart(CartInput {
            currency: "czk".into(),
            country_code: Some(" cz "),
            lines: vec![LineInput {
                id: "l1",
                quantity: -2,
                unit_price: 500,
                rule_ids: &refs,
                variant_rule_ids: &variant,
                ..Default::default()
            }],
            entered_codes: vec!["welcome15", " WELCOME15 ", "   ", "b"],
            today: Some("2026-10-01T12:00"),
            ..Default::default()
        });
        assert_eq!(cart.currency, "CZK");
        assert_eq!(cart.country_code.as_deref(), Some("CZ"));
        assert_eq!(cart.lines[0].quantity, 0);
        assert_eq!(cart.lines[0].subtotal, 0);
        assert_eq!(cart.lines[0].refs().collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(cart.entered_codes, vec!["WELCOME15", "B"]);
        assert_eq!(cart.today, None);
        let unknown = normalize_cart(CartInput { country_code: Some("CZE"), ..Default::default() });
        assert_eq!(unknown.country_code, None);
    }
}
