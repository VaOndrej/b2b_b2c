// Function input (either run target) → the engine's cart, the shared config and
// the node's role: tests/reference-adapter.js `adaptInput`, field for field.
//
//   shared config   shop.config.jsonValue (SHOP metafield function_config, C7)
//   node variables  discount.vars.jsonValue (role, ruleId, campaignId, varsVersion)
//   campaign        shop.localTime.campaignActive = dateTimeBetween(start, end)
//   today           shop.localTime.date (shop-local day; schedules are day-granular)
//   country         localization.country.isoCode (Pro market targeting)
//   per line        ruleIds ∪ variantRuleIds[variant] + outlet from the product
//                   metafield; the gift from the `_won_gift` line attribute
//
// The two targets have their own generated input types, so the reading is one
// macro expanded for each (identical code, one definition).

use crate::engine::cart::CartInput;
use crate::engine::config::Config;
use crate::engine::emit::NodeRole;
use crate::json::NodeVars;

/// What the run needs besides the cart.
pub struct Adapted<'a> {
    pub cart: CartInput<'a>,
    pub config: &'a Config,
    pub role: NodeRole,
    pub triggering_code: Option<&'a str>,
}

/// The node's role from its `function_vars`. A code node MUST have a rule id; an
/// automatic node never has a triggering code (C1), so an automatic role with
/// one is inconsistent and emits nothing rather than giving automatic value twice.
pub fn read_role(vars: Option<&NodeVars>, triggering_code: Option<&str>) -> Option<NodeRole> {
    let vars = vars?;
    match vars.role.as_deref() {
        Some("automatic") if triggering_code.is_none() => Some(NodeRole::Automatic),
        Some("code") => vars.rule_id.clone().map(NodeRole::Code),
        _ => None,
    }
}

/// LanguageCode → Czech messages for CS/SK, English otherwise (`readLocale`);
/// none (no language) plans Czech. Rule names win; this only phrases unnamed rules.
pub fn locale_en(iso_code: &str) -> bool {
    if iso_code.is_empty() {
        return false;
    }
    let lang: String = iso_code.chars().take(2).collect();
    !matches!(crate::engine::js::upper(&lang).as_str(), "CS" | "SK")
}

/// `adaptInput` for one target's generated input. Evaluates to `None` when the
/// node emits nothing whatever the cart holds (unknown role, or no valid shared
/// config: planCart's `config_missing`), before any cart line is read.
#[macro_export]
macro_rules! adapt_input {
    ($input:expr, $target:ident) => {{
        use $crate::schema::$target::input::cart::lines::Merchandise;
        let input = $input;
        let triggering_code = input.triggering_discount_code().map(String::as_str).filter(|c| !c.is_empty());
        let vars = input.discount().vars().map(|m| m.json_value());
        let role = $crate::input::read_role(vars, triggering_code);
        let config = input.shop().config().and_then(|m| m.json_value().0.as_ref());
        match (role, config) {
            (Some(role), Some(config)) => {
                let cart = input.cart();
                let currency = $crate::engine::js::upper(cart.cost().subtotal_amount().currency_code());
                let mut lines = Vec::with_capacity(cart.lines().len());
                for line in cart.lines() {
                    let id = line.id().as_str();
                    if id.is_empty() {
                        continue;
                    }
                    let mut outlet = false;
                    let mut rule_ids: &[String] = &[];
                    let mut variant_rule_ids = Vec::new();
                    if let Merchandise::ProductVariant(variant) = line.merchandise() {
                        if let Some(won) = variant.product().won_product().map(|m| m.json_value()) {
                            rule_ids = won.rule_ids();
                            // The variant id is read only when the metafield needs it.
                            let variant_id = if won.needs_variant_id() { variant.id().as_str() } else { "" };
                            variant_rule_ids = won.variant_refs(variant_id);
                            outlet = won.is_outlet(variant_id);
                        }
                    }
                    lines.push($crate::engine::cart::LineInput {
                        id,
                        quantity: i64::from(*line.quantity()),
                        unit_price: line
                            .cost()
                            .amount_per_quantity()
                            .amount()
                            .text()
                            .and_then(|text| $crate::engine::money::to_minor_units(text, &currency))
                            .unwrap_or(0),
                        outlet,
                        gift: line.gift().and_then(|g| g.value()).is_some_and(|v| !v.is_empty()),
                        rule_ids,
                        variant_rule_ids,
                    });
                }
                let local_time = input.shop().local_time();
                let localization = input.localization();
                Some($crate::input::Adapted {
                    cart: $crate::engine::cart::CartInput {
                        currency,
                        country_code: Some(localization.country().iso_code().as_str()).filter(|c| !c.is_empty()),
                        lines,
                        entered_codes: input
                            .entered_discount_codes()
                            .iter()
                            .map(|e| e.code().as_str())
                            .filter(|c| !c.is_empty())
                            .collect(),
                        campaign: $crate::engine::cart::CampaignInput {
                            id: vars.and_then(|v| v.campaign_id.as_deref()),
                            active: *local_time.campaign_active(),
                            vars_version: vars.and_then(|v| v.vars_version.as_deref()),
                        },
                        today: Some(local_time.date().as_str()).filter(|d| !d.is_empty()),
                        locale_en: $crate::input::locale_en(localization.language().iso_code()),
                    },
                    config,
                    role,
                    triggering_code,
                })
            }
            _ => None,
        }
    }};
}
