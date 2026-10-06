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
//   tiers (MVP 3)   only while the shared config has tier sets: the product
//                   metafield's `tierRef`, and the product's id when the line's
//                   set counts per product (the only use of it)
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

use crate::engine::cart::{is_country, CampaignInput, CartInput, LineInput, LineTier};
use crate::engine::config::{Config, TierCount};
use crate::engine::emit::NodeRole;
use crate::engine::batch::PREFIX;
use crate::engine::hash::{parse_hash, MAX_ENTERED_CODES};
use crate::engine::js;
use crate::engine::margin::MarginRef;
use crate::engine::money::{currency_exponent, to_minor_units_with};
use crate::engine::tiers::{resolve_set, SetIndex};
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
/// metafield's `jsonValue`, `cost { amountPerQuantity { amount } }`, the gift
/// attribute's `value`, an `isoCode`, a `code`, an `id`), read by position: the provider finds a key by comparing it with the
/// object's keys (~580 instructions for `wonProduct`), by position it only
/// indexes (~270). Four such reads a cart line. An object of another size (not
/// the query's shape) is read by name. Not an object → none, like `field`.
fn sole(value: &Value, key: Key) -> Option<Value> {
    match value.obj_len()? {
        1 => Some(value.get_at_index(0)),
        _ => Some(prop(value, key)),
    }
}

/// A query object with more than one field, read by position (audit round 6): a
/// read by name makes the input provider compare the key with the object's
/// keys, ~1.5 k instructions a cart line more for its 8 such fields (3 % of
/// the limit on a 200-line cart; `product { id wonProduct }` is a third shape
/// since MVP 3). The
/// provider's key order need not be the query's (function-runner sorts the
/// keys), so the positions are learned from the first object of the query's
/// size (its keys read once a run) and used for every later one of that size:
/// Shopify builds every object of a query field with the same keys. An object
/// of another size (not the query's shape: a CustomProduct's merchandise) is
/// read by name, and so is every object of a shape whose first one did not have
/// the query's keys (README "Accepted edge differences", schema-invalid input).
struct Shape<const N: usize> {
    keys: [Key; N],
    at: Positions,
}

/// The most fields a query object read by position has (a cart line's 5).
const MAX_FIELDS: usize = 5;

enum Positions {
    Unknown,
    Learned([usize; MAX_FIELDS]),
    ByName,
}

impl<const N: usize> Shape<N> {
    /// A learned shape has at most MAX_FIELDS fields (checked at compile time).
    const FITS: () = assert!(N <= MAX_FIELDS, "a learned shape has at most MAX_FIELDS fields");

    fn new(keys: [Key; N]) -> Self {
        let () = Self::FITS;
        Self { keys, at: Positions::Unknown }
    }

    /// `value[self.keys[field]]`.
    fn get(&mut self, value: &Value, field: usize) -> Value {
        self.get_sized(value, value.obj_len(), field)
    }

    /// `get` of a value whose `obj_len()` is `len` (read once by the caller).
    fn get_sized(&mut self, value: &Value, len: Option<usize>, field: usize) -> Value {
        if len != Some(N) {
            return prop(value, self.keys[field]);
        }
        if let Positions::Unknown = self.at {
            self.at = learn(&self.keys, value);
        }
        match &self.at {
            Positions::Learned(at) => value.get_at_index(at[field]),
            _ => prop(value, self.keys[field]),
        }
    }
}

/// The positions of `keys` in `value` (an object of `keys.len()` keys), one
/// copy for every shape (Wasm size).
fn learn(keys: &[Key], value: &Value) -> Positions {
    let mut at = [usize::MAX; MAX_FIELDS];
    for i in 0..keys.len() {
        let Some(name) = value.get_obj_key_at_index(i) else { return Positions::ByName };
        match keys.iter().position(|key| key.text() == name) {
            Some(field) if at[field] == usize::MAX => at[field] = i,
            _ => return Positions::ByName,
        }
    }
    Positions::Learned(at)
}

/// The node's discount classes (`discount.discountClasses`, strings).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Classes {
    pub product: bool,
    pub order: bool,
    pub shipping: bool,
    /// `discount.discountClasses` was in the input (not null): the delivery query no longer asks for it (MVP 5:
    /// its point paid for `wonOutlet`) — Shopify runs the delivery target only for a SHIPPING node.
    pub listed: bool,
}

/// `discount` of the input and the node's classes: read first, a node without
/// the target's classes reads nothing else.
pub fn node(root: &Value) -> (Value, Classes) {
    let discount = prop(root, Key::Discount);
    let mut classes = Classes::default();
    if let Some(list) = field(&discount, Key::DiscountClasses) {
        classes.listed = !list.is_null();
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

/// The numeric tail of a variant GID (plan-rewards.ts `variantNumber`: `/(\d+)$/`), when it is a safe integer.
fn variant_number(id: &str) -> Option<u64> {
    let digits = id.len() - id.bytes().rev().take_while(u8::is_ascii_digit).count();
    let tail = &id[digits..];
    if tail.is_empty() {
        return None;
    }
    // Number(tail) as an exact integer: at most 2^53 - 1 (anything above matches no payload id).
    tail.parse::<u64>().ok().filter(|n| *n <= 9_007_199_254_740_991)
}

/// One cart line as read (`readLine`), owned; `LineInput` borrows it.
struct ReadLine {
    id: String,
    quantity: i64,
    unit_price: i64,
    outlet: bool,
    gift: bool,
    gift_tier: Option<u32>,
    rule_ids: Vec<String>,
    variant_rule_ids: Vec<String>,
    unit_cost: Option<f64>,
    unit_cost_currency: Option<String>,
    margin_refs: Vec<MarginRef>,
    margin_ref_count: usize,
}

/// What quantity tiers need of a line (`LineTier`), owned: its set, resolved once here.
#[derive(Default)]
struct ReadTier {
    set: Option<usize>,
    product_id: String,
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
    /// Per line what quantity tiers read; empty without tier sets.
    tiers: Vec<ReadTier>,
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
        let localization = prop(root, Key::Localization);
        let iso_code = |key: Key| field(&localization, key).and_then(|v| sole(&v, Key::IsoCode)).and_then(|code| string(&code));
        let country_code = iso_code(Key::Country).filter(|c| !c.is_empty());
        // The cart's country as normalizeCart makes it: the config's markets are read only as far as it decides them.
        let country = country_code.as_deref().map(|c| js::upper(js::trim(c))).filter(|c| is_country(c));
        let local_time = field(&shop, Key::LocalTime);
        let campaign_active = local_time.and_then(|t| field(&t, Key::CampaignActive)).is_some_and(|v| is_true(&v));
        let vars = vars.unwrap_or_default();
        // The node's campaign while its window is live: the config's tier sets are then the campaign's (MVP 6.1).
        let node = if campaign_active { vars.campaign_id.as_deref().zip(vars.vars_version.as_deref()) } else { None };
        let config = field(&shop, Key::Config)
            .and_then(|metafield| sole(&metafield, Key::JsonValue))
            .and_then(|json| Config::read_in(&json, Some(&currency), country.as_deref(), node))?;

        let margin_on = config.margin.is_some();
        // A ref matters only when some collection has a setting (resolveMargin).
        let margin_refs_on = config.margin.as_ref().is_some_and(|m| !m.col.is_empty());
        let exponent = currency_exponent(&currency);
        let lines_value = field(&cart, Key::Lines);
        let line_count = lines_value.and_then(|l| l.array_len()).unwrap_or(0);
        let mut lines = Vec::with_capacity(line_count);
        let mut outlet_lists = OutletLists::default();
        // `cart.lines[]` and its `merchandise` (a ProductVariant), in the query's field order.
        let mut line_shape = Shape::new([Key::Id, Key::Quantity, Key::Cost, Key::Gift, Key::Merchandise]);
        let mut variant_shape = Shape::new([Key::Typename, Key::Id, Key::WonVariant, Key::WonOutlet, Key::Product]);
        let mut product_shape = Shape::new([Key::Id, Key::WonProduct]);
        // Tier sets (MVP 3): a line's `tierRef` matters only when the config has
        // some, and resolves to its set here, once (plan-tiers.ts step 1: the
        // sets by id in a table built once); its product's id only when that
        // set counts per product (K2).
        let tiers = &config.tiers;
        let tiers_on = !tiers.sets.is_empty();
        let gift_tiers = &config.rewards.tiers;
        let set_index: Option<SetIndex> = tiers_on.then(|| SetIndex::of(&tiers.sets));
        let mut read_tiers: Vec<ReadTier> = Vec::with_capacity(if tiers_on { line_count } else { 0 });
        for line in lines_value.iter().flat_map(|l| (0..line_count).map(|i| l.get_at_index(i))) {
            // (A line, its merchandise, product and cost are objects in any input
            // built from the query; `prop` of anything else is an undefined value.)
            let Some(id) = non_empty(&line_shape.get(&line, 0)) else { continue };
            let mut read = ReadLine {
                id,
                quantity: 0,
                unit_price: 0,
                outlet: false,
                gift: false,
                gift_tier: None,
                rule_ids: Vec::new(),
                variant_rule_ids: Vec::new(),
                unit_cost: None,
                unit_cost_currency: None,
                margin_refs: Vec::new(),
                margin_ref_count: 0,
            };
            let mut tier_ref: Option<String> = None;
            let merchandise = line_shape.get(&line, 4);
            let product = variant_shape.get(&merchandise, 4);
            // `product { id wonProduct }`; a product of one key (an input of the
            // MVP 2 query, a hand-made one) is read by position like `sole`.
            let product_keys = product.obj_len();
            let won = match product_keys {
                Some(1) => Some(product.get_at_index(0)),
                _ => Some(product_shape.get_sized(&product, product_keys, 1)),
            }
            .and_then(|metafield| sole(&metafield, Key::JsonValue));
            if let Some(won) = won {
                let mut won = WonProduct::read(&won, margin_refs_on, tiers_on);
                // The variant id is read only when the metafield needs it.
                let variant_id = if won.needs_variant_id() { string(&variant_shape.get(&merchandise, 1)).unwrap_or_default() } else { String::new() };
                read.variant_rule_ids = won.variant_refs(&variant_id);
                read.outlet = won.is_outlet(&variant_id, &mut outlet_lists);
                if margin_refs_on {
                    read.margin_ref_count = won.margin_ref_count();
                    read.margin_refs = won.margin_refs();
                }
                read.rule_ids = won.take_rule_ids();
                tier_ref = won.take_tier_ref();
            }
            // MVP 5 (Výprodej, contract O6): the variant's own flag `outlet` = true.
            if !read.outlet {
                read.outlet = sole(&variant_shape.get(&merchandise, 3), Key::JsonValue).is_some_and(|flag| is_true(&flag));
            }
            if margin_on {
                if let Some(cost) = sole(&variant_shape.get(&merchandise, 2), Key::JsonValue) {
                    let cost = WonVariant::read(&cost);
                    read.unit_cost = cost.cost;
                    read.unit_cost_currency = cost.cur;
                }
            }
            // `nonNegativeInt` (normalizeCart): a positive number, floored; else 0.
            read.quantity = number(&line_shape.get(&line, 1)).filter(|q| *q > 0.0).map_or(0, js::floor_to_i64);
            let amount = sole(&line_shape.get(&line, 2), Key::AmountPerQuantity).and_then(|per| sole(&per, Key::Amount));
            read.unit_price =
                amount.and_then(|amount| DecimalText::read(&amount).text().and_then(|text| to_minor_units_with(text, exponent))).unwrap_or(0);
            let gift = sole(&line_shape.get(&line, 3), Key::Value).and_then(|value| non_empty(&value));
            read.gift = gift.is_some();
            // MVP 4 (R3): the tier it names, valid only with a variant that tier offers
            // (rewards.ts: the variant id's numeric tail among the tier's variants).
            if let Some(name) = gift.filter(|_| !gift_tiers.is_empty()) {
                if let Some(index) = gift_tiers.iter().position(|t| t.id == name) {
                    let variant = string(&variant_shape.get(&merchandise, 1)).unwrap_or_default();
                    if variant_number(&variant).is_some_and(|n| gift_tiers[index].variants.contains(&n)) {
                        read.gift_tier = Some(index as u32);
                    }
                }
            }
            if let Some(index) = set_index.as_ref() {
                // A gift line has no set (step 1).
                let mut tier = ReadTier::default();
                if !read.gift {
                    tier.set = resolve_set(tiers, index, tier_ref.as_deref());
                    if tier.set.is_some_and(|s| tiers.sets[s].count == TierCount::Product) {
                        tier.product_id = string(&product_shape.get_sized(&product, product_keys, 0)).unwrap_or_default();
                    }
                }
                read_tiers.push(tier);
            }
            lines.push(read);
        }

        // The entered codes matter only to a code rule with a hash an entered code
        // can have, or with a generated batch's text (plan.rs `match_codes`); without one none is read (each costs
        // ~2 k instructions, and a cart can hold 250).
        let codes_matter = config.rules.iter().any(|r| r.method_code && r.code_hashes.iter().any(|h| h.len() > PREFIX || parse_hash(h).is_some()));
        // Only the first MAX_ENTERED_CODES entries count (cart.ts), whatever they
        // hold: the reader reads those and no more (Shopify still walks the rest).
        // An entry without a code string is an empty code, which matches nothing.
        let mut entered_codes = Vec::new();
        if let Some(entered) = field(root, Key::EnteredDiscountCodes).filter(|_| codes_matter) {
            for i in 0..entered.array_len().unwrap_or(0).min(MAX_ENTERED_CODES) {
                entered_codes.push(sole(&entered.get_at_index(i), Key::Code).and_then(|code| string(&code)).unwrap_or_default());
            }
        }
        Some(Self {
            role,
            triggering_code,
            config,
            campaign_id: vars.campaign_id,
            vars_version: vars.vars_version,
            campaign_active,
            today: local_time.and_then(|t| field(&t, Key::Date)).and_then(|d| non_empty(&d)),
            currency,
            country_code,
            locale_en: iso_code(Key::Language).is_some_and(|c| locale_en(&c)),
            entered_codes,
            shop_to_cart_rate: if margin_on { DecimalNumber::read(&prop(root, Key::PresentmentCurrencyRate)).0 } else { None },
            lines,
            tiers: read_tiers,
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
                    gift_tier: l.gift_tier,
                    rule_ids: &l.rule_ids,
                    variant_rule_ids: &l.variant_rule_ids,
                    unit_cost: l.unit_cost,
                    unit_cost_currency: l.unit_cost_currency.as_deref(),
                    margin_refs: &l.margin_refs,
                    margin_ref_count: l.margin_ref_count,
                })
                .collect(),
            tiers: self.tiers.iter().map(|t| LineTier { set: t.set, product_id: &t.product_id }).collect(),
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
