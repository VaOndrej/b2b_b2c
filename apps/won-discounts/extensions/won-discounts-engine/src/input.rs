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
//   margin (MVP 2)  only while the shared config has margin protection on: the
//                   variant's `{cost, cur}` (variant metafield) and
//                   `presentmentCurrencyRate`; the product's `marginRefs` only
//                   when the payload also has collection settings (`col`) — as
//                   read, the engine (margin.rs) decides what is usable. Off (or
//                   without `col`), they are never read: the plan cannot use them.
//
// The input is read straight from its JSON value (the input query's shape,
// src/*.graphql), not through the typed accessors `#[query]` generates: every
// property read is a call into Shopify's input provider, and the generated
// accessors look each key up by its text (copied into the provider on every
// call) and read `__typename` as a string. Here every key is interned once per
// run (json.rs `Key`), and a line's merchandise is read by its fields: with the
// query's `... on ProductVariant`, only a ProductVariant has `product`,
// `wonVariant` and `id` (README "Accepted edge differences", schema-invalid
// input). What a run reads is owned by `RunInput`; the cart borrows from it.

use shopify_function::wasm_api::Value;

use crate::engine::cart::{CampaignInput, CartInput, LineInput};
use crate::engine::config::Config;
use crate::engine::emit::NodeRole;
use crate::engine::hash::{parse_hash, MAX_ENTERED_CODES};
use crate::engine::js;
use crate::engine::margin::MarginRef;
use crate::engine::money::{currency_exponent, to_minor_units_with};
use crate::json::{is_true, non_empty, number, prop, string, DecimalNumber, DecimalText, Key, NodeVars, OutletLists, WonProduct, WonVariant};

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

/// `obj[key]` when `value` is an object; anything else (null, a missing
/// metafield) reads as nothing without a call into the input provider.
fn field(value: &Value, key: Key) -> Option<Value> {
    value.is_obj().then(|| prop(value, key))
}

/// `obj[key]` of an object whose one field in the input query is `key` (a
/// metafield's `jsonValue`, `product { wonProduct }`, `cost { amountPerQuantity
/// { amount } }`, the gift attribute's `value`, an `isoCode`, a `code`, an
/// `id`), read by position: the provider finds a key by comparing it with the
/// object's keys (~580 instructions for `wonProduct`), by position it only
/// indexes (~270). Five such reads a cart line. An object of another size (not
/// the query's shape) is read by name. Not an object → none, like `field`.
fn sole(value: &Value, key: Key) -> Option<Value> {
    match value.obj_len()? {
        1 => Some(value.get_at_index(0)),
        _ => Some(prop(value, key)),
    }
}

/// The node's discount classes (`discount.discountClasses`, strings).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Classes {
    pub product: bool,
    pub order: bool,
    pub shipping: bool,
}

/// `discount` of the input and the node's classes: read first, a node without
/// the target's classes reads nothing else.
pub fn node(root: &Value) -> (Value, Classes) {
    let discount = prop(root, Key::Discount);
    let mut classes = Classes::default();
    if let Some(list) = field(&discount, Key::DiscountClasses) {
        for i in 0..list.array_len().unwrap_or(0) {
            match list.get_at_index(i).as_string().as_deref() {
                Some("PRODUCT") => classes.product = true,
                Some("ORDER") => classes.order = true,
                Some("SHIPPING") => classes.shipping = true,
                _ => {}
            }
        }
    }
    (discount, classes)
}

/// `cart.deliveryGroups[].id`, the non-empty ones (delivery target).
pub fn delivery_group_ids(root: &Value) -> Vec<String> {
    let Some(groups) = field(root, Key::Cart).and_then(|cart| field(&cart, Key::DeliveryGroups)) else { return Vec::new() };
    let len = groups.array_len().unwrap_or(0);
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        if let Some(id) = sole(&groups.get_at_index(i), Key::Id).and_then(|id| non_empty(&id)) {
            out.push(id);
        }
    }
    out
}

/// One cart line as read (`readLine`), owned; `LineInput` borrows it.
struct ReadLine {
    id: String,
    quantity: i64,
    unit_price: i64,
    outlet: bool,
    gift: bool,
    rule_ids: Vec<String>,
    variant_rule_ids: Vec<String>,
    unit_cost: Option<f64>,
    unit_cost_currency: Option<String>,
    margin_refs: Vec<MarginRef>,
    margin_ref_count: usize,
}

/// Everything a run reads from its input (`adaptInput`), owned: the plan borrows from it.
pub struct RunInput {
    pub role: NodeRole,
    pub triggering_code: Option<String>,
    pub config: Config,
    campaign_id: Option<String>,
    vars_version: Option<String>,
    campaign_active: bool,
    today: Option<String>,
    currency: String,
    country_code: Option<String>,
    locale_en: bool,
    entered_codes: Vec<String>,
    shop_to_cart_rate: Option<f64>,
    lines: Vec<ReadLine>,
    /// `cart.lines.length`: Shopify's output limit counts every line.
    pub line_count: usize,
}

impl RunInput {
    /// `adaptInput`. `None` when the node emits nothing whatever the cart holds
    /// (unknown role, or no valid shared config: planCart's `config_missing`),
    /// before any cart line is read. `discount` is `node(root).0`.
    pub fn read(root: &Value, discount: &Value) -> Option<Self> {
        let triggering_code = non_empty(&prop(root, Key::TriggeringDiscountCode));
        let vars = field(discount, Key::Vars).and_then(|vars| sole(&vars, Key::JsonValue)).map(|json| NodeVars::read(&json));
        let role = read_role(vars.as_ref(), triggering_code.as_deref())?;
        let shop = prop(root, Key::Shop);
        // The cart currency first: the config's money is read in it only.
        let cart = prop(root, Key::Cart);
        let currency = field(&cart, Key::Cost)
            .and_then(|cost| sole(&cost, Key::SubtotalAmount))
            .and_then(|subtotal| sole(&subtotal, Key::CurrencyCode))
            .and_then(|code| string(&code))
            .map_or_else(String::new, |code| js::upper(&code));
        let config = field(&shop, Key::Config)
            .and_then(|metafield| sole(&metafield, Key::JsonValue))
            .and_then(|json| Config::read_in(&json, Some(&currency)))?;
        let vars = vars.unwrap_or_default();

        let margin_on = config.margin.is_some();
        // A ref matters only when some collection has a setting (resolveMargin).
        let margin_refs_on = config.margin.as_ref().is_some_and(|m| !m.col.is_empty());
        let exponent = currency_exponent(&currency);
        let lines_value = field(&cart, Key::Lines);
        let line_count = lines_value.and_then(|l| l.array_len()).unwrap_or(0);
        let mut lines = Vec::with_capacity(line_count);
        let mut outlet_lists = OutletLists::default();
        for line in lines_value.iter().flat_map(|l| (0..line_count).map(|i| l.get_at_index(i))) {
            // (A line, its merchandise, product and cost are objects in any input
            // built from the query; `prop` of anything else is an undefined value.)
            let Some(id) = non_empty(&prop(&line, Key::Id)) else { continue };
            let mut read = ReadLine {
                id,
                quantity: 0,
                unit_price: 0,
                outlet: false,
                gift: false,
                rule_ids: Vec::new(),
                variant_rule_ids: Vec::new(),
                unit_cost: None,
                unit_cost_currency: None,
                margin_refs: Vec::new(),
                margin_ref_count: 0,
            };
            let merchandise = prop(&line, Key::Merchandise);
            let won = sole(&prop(&merchandise, Key::Product), Key::WonProduct).and_then(|metafield| sole(&metafield, Key::JsonValue));
            if let Some(won) = won {
                let mut won = WonProduct::read(&won, margin_refs_on);
                // The variant id is read only when the metafield needs it.
                let variant_id = if won.needs_variant_id() { string(&prop(&merchandise, Key::Id)).unwrap_or_default() } else { String::new() };
                read.variant_rule_ids = won.variant_refs(&variant_id);
                read.outlet = won.is_outlet(&variant_id, &mut outlet_lists);
                if margin_refs_on {
                    read.margin_ref_count = won.margin_ref_count();
                    read.margin_refs = won.margin_refs();
                }
                read.rule_ids = won.take_rule_ids();
            }
            if margin_on {
                if let Some(cost) = sole(&prop(&merchandise, Key::WonVariant), Key::JsonValue) {
                    let cost = WonVariant::read(&cost);
                    read.unit_cost = cost.cost;
                    read.unit_cost_currency = cost.cur;
                }
            }
            // `nonNegativeInt` (normalizeCart): a positive number, floored; else 0.
            read.quantity = number(&prop(&line, Key::Quantity)).filter(|q| *q > 0.0).map_or(0, js::floor_to_i64);
            let amount = sole(&prop(&line, Key::Cost), Key::AmountPerQuantity).and_then(|per| sole(&per, Key::Amount));
            read.unit_price =
                amount.and_then(|amount| DecimalText::read(&amount).text().and_then(|text| to_minor_units_with(text, exponent))).unwrap_or(0);
            read.gift = sole(&prop(&line, Key::Gift), Key::Value).and_then(|value| non_empty(&value)).is_some();
            lines.push(read);
        }

        // The entered codes matter only to a code rule with a hash an entered code
        // can have (plan.rs `match_codes`); without one none is read (each costs
        // ~3 k instructions, and a cart can hold 250).
        let codes_matter = config.rules.iter().any(|r| r.method_code && r.code_hashes.iter().any(|h| parse_hash(h).is_some()));
        // Only the first MAX_ENTERED_CODES codes count (cart.ts): the reader
        // stops after the 25th, whatever follows (Shopify still walks the rest).
        let mut entered_codes = Vec::new();
        if let Some(entered) = field(root, Key::EnteredDiscountCodes).filter(|_| codes_matter) {
            for i in 0..entered.array_len().unwrap_or(0) {
                if entered_codes.len() == MAX_ENTERED_CODES {
                    break;
                }
                if let Some(code) = sole(&entered.get_at_index(i), Key::Code).and_then(|code| non_empty(&code)) {
                    entered_codes.push(code);
                }
            }
        }
        let local_time = field(&shop, Key::LocalTime);
        let localization = prop(root, Key::Localization);
        let iso_code = |key: Key| field(&localization, key).and_then(|v| sole(&v, Key::IsoCode)).and_then(|code| string(&code));
        Some(Self {
            role,
            triggering_code,
            config,
            campaign_id: vars.campaign_id,
            vars_version: vars.vars_version,
            campaign_active: local_time.and_then(|t| field(&t, Key::CampaignActive)).is_some_and(|v| is_true(&v)),
            today: local_time.and_then(|t| field(&t, Key::Date)).and_then(|d| non_empty(&d)),
            currency,
            country_code: iso_code(Key::Country).filter(|c| !c.is_empty()),
            locale_en: iso_code(Key::Language).is_some_and(|c| locale_en(&c)),
            entered_codes,
            shop_to_cart_rate: if margin_on { DecimalNumber::read(&prop(root, Key::PresentmentCurrencyRate)).0 } else { None },
            lines,
            line_count,
        })
    }

    /// The cart the engine plans (CartPlanInput), borrowing what was read.
    pub fn cart(&self) -> CartInput<'_> {
        CartInput {
            currency: self.currency.clone(),
            country_code: self.country_code.as_deref(),
            lines: self
                .lines
                .iter()
                .map(|l| LineInput {
                    id: &l.id,
                    quantity: l.quantity,
                    unit_price: l.unit_price,
                    outlet: l.outlet,
                    gift: l.gift,
                    rule_ids: &l.rule_ids,
                    variant_rule_ids: &l.variant_rule_ids,
                    unit_cost: l.unit_cost,
                    unit_cost_currency: l.unit_cost_currency.as_deref(),
                    margin_refs: &l.margin_refs,
                    margin_ref_count: l.margin_ref_count,
                })
                .collect(),
            entered_codes: self.entered_codes.iter().map(String::as_str).collect(),
            campaign: CampaignInput {
                id: self.campaign_id.as_deref(),
                active: self.campaign_active,
                vars_version: self.vars_version.as_deref(),
            },
            today: self.today.as_deref(),
            locale_en: self.locale_en,
            shop_to_cart_rate: self.shop_to_cart_rate,
        }
    }
}
