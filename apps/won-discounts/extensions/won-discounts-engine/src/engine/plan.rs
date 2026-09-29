// planCart (plan.ts): the one discount brain, the part of it a node's emission
// depends on. Same stages, same order, same ties:
//   resolveRules → matchCodes → prepareLines → gateRules (minimum: the whole
//   cart, or the rule's own lines when its scope is "entitled") → planProducts →
//   (margin hook: identity) → planOrderStage → planShipping.
// Left out on purpose (explain/admin only, never emitted): rule outcomes and
// their states beyond "eligible or not", `betterRuleIds`, `combinedInto`,
// `missing`, totals and gifts/warnings/progress.
//
// Money is integer minor units (i64). Where the TS engine computes with
// fractions (percentages), this computes the same float expression in the same
// order and rounds with Math.round semantics (engine/js.rs), so every amount is
// bit-for-bit the TS amount. Ties: amount desc, priority desc, id asc (JS
// string order), never config order.

use std::borrow::Cow;

use super::cart::{normalize_cart, CartInput, NormalizedCart, NormalizedLine};
use super::config::{Config, EngineFlags, FieldsRef, RawCampaign, RawRule, TargetKind, ValueSpec};
use super::describe::{describe_short, DescribedValue};
use super::fnv::FnvMap;
use super::hash::code_hash;
use super::js;

// --- Plan shape -------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscountClass {
    Product,
    Order,
    Shipping,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueKind {
    Percentage,
    Fixed,
    FreeShipping,
}

/// Why a rule is out of play (plan.ts RuleState, the gate part).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleState {
    Disabled,
    CodeNotEntered,
    NotStarted,
    Ended,
    ScheduleUnknown,
    Market,
    Unsupported,
    CurrencyMissing,
    NoTargetLines,
    OutletOnly,
    BelowMinimum,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanFailure {
    ConfigMissing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Excluded {
    Outlet,
    Gift,
}

/// What a node emits for a stack: maps 1:1 to the function's candidate value.
#[derive(Debug, Clone, PartialEq)]
pub enum EmittedValue {
    Percent(f64),
    FixedPerItem(i64),
    FixedTotal(i64),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ShippingValue {
    Percent(f64),
    FixedTotal(i64),
}

/// A rule as it is right now (campaign applied), in the cart currency.
#[derive(Debug, Clone)]
pub struct Rule<'a> {
    pub id: &'a str,
    /// The checkout message: the rule's name, else its short description.
    pub label: Cow<'a, str>,
    pub method_code: bool,
    pub enabled: bool,
    pub cls: DiscountClass,
    pub value_kind: ValueKind,
    pub percent: f64,
    /// Fixed amount in the cart currency; none = no value for it.
    pub fixed: Option<i64>,
    pub priority: i64,
    pub code_hashes: &'a [String],
    pub min_subtotal: Option<i64>,
    pub min_subtotal_missing: bool,
    pub min_quantity: i64,
    /// The minimum counts only the rule's own lines (scope "entitled").
    pub min_entitled: bool,
    pub scheduled: bool,
    pub schedule_invalid: bool,
    pub starts_on: Option<&'a str>,
    pub ends_on: Option<&'a str>,
    pub markets: Option<&'a [String]>,
    pub segment_targeted: bool,
    pub combines: &'a [String],
    /// None = eligible.
    pub state: Option<RuleState>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Component {
    /// Index into `CartPlan::rules`.
    pub rule: usize,
    /// Minor units this rule contributes (components sum to the stack amount).
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanStack<'a> {
    /// Rank order (amount desc, priority desc, id asc); one unless Pro stacking.
    pub components: Vec<Component>,
    pub amount: i64,
    /// The rule whose node emits this stack (index into `CartPlan::rules`).
    pub owner: usize,
    pub value: EmittedValue,
    pub message: Cow<'a, str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanLine<'a> {
    pub line_id: &'a str,
    pub excluded: Option<Excluded>,
    pub quantity: i64,
    pub unit_price: i64,
    pub subtotal: i64,
    pub product: Option<PlanStack<'a>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanOrder<'a> {
    pub stack: PlanStack<'a>,
    /// Subtotal of the discountable lines after product discounts.
    pub base: i64,
    /// Outlet and gift lines, in cart order (the candidate's excludedCartLineIds).
    pub excluded_line_ids: Vec<&'a str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanShipping<'a> {
    pub rule: usize,
    pub value: ShippingValue,
    pub message: Cow<'a, str>,
}

#[derive(Debug, Clone)]
pub struct CartPlan<'a> {
    pub currency: String,
    pub reason: Option<PlanFailure>,
    /// One per readable rule, in config order (plan.ts `rules` outcomes).
    pub rules: Vec<Rule<'a>>,
    /// Per rule: its entered codes (normalized, entry order).
    pub entered_by_rule: Vec<Vec<String>>,
    /// The campaign whose overrides were applied.
    pub campaign_id: Option<&'a str>,
    pub lines: Vec<PlanLine<'a>>,
    pub order: Option<PlanOrder<'a>>,
    pub shipping: Option<PlanShipping<'a>>,
}

impl CartPlan<'_> {
    pub fn rule_index(&self, id: &str) -> Option<usize> {
        self.rules.iter().position(|r| r.id == id)
    }
}

type IdMap<'a> = FnvMap<&'a str, usize>;

// --- Stage: rules as they are right now ------------------------------------------------------

fn read_rule<'a>(raw: &'a RawRule, fields: FieldsRef<'a>, cart: &NormalizedCart) -> Option<Rule<'a>> {
    let currency = cart.currency.as_str();
    let (value_kind, percent, fixed, described) = match fields.value {
        ValueSpec::Percentage(p) => (ValueKind::Percentage, *p, None, DescribedValue::Percentage(*p)),
        ValueSpec::Fixed(money) => {
            (ValueKind::Fixed, 0.0, money.amount_in(currency), DescribedValue::Fixed(money.money_for(currency)))
        }
        ValueSpec::FreeShipping => (ValueKind::FreeShipping, 0.0, None, DescribedValue::FreeShipping),
        ValueSpec::Invalid => return None,
    };
    let target = fields.target?;
    let cls = if value_kind == ValueKind::FreeShipping || target == TargetKind::Shipping {
        DiscountClass::Shipping
    } else if target == TargetKind::Order {
        DiscountClass::Order
    } else {
        DiscountClass::Product
    };
    let has_subtotal = fields.minimum.subtotal.is_non_empty_record();
    let min_subtotal = if has_subtotal { fields.minimum.subtotal.amount_in(currency) } else { None };
    // `rule.name || describeRule(rule.describable, locale, currency, { short: true })`
    let label = if fields.name.is_empty() {
        Cow::Owned(describe_short(&described, target, !cart.locale_en, currency))
    } else {
        Cow::Borrowed(fields.name)
    };
    Some(Rule {
        id: &raw.id,
        label,
        method_code: raw.method_code,
        enabled: fields.enabled,
        cls,
        value_kind,
        percent,
        fixed,
        priority: raw.priority,
        code_hashes: &raw.code_hashes,
        min_subtotal,
        min_subtotal_missing: has_subtotal && min_subtotal.is_none(),
        min_quantity: fields.minimum.quantity,
        min_entitled: fields.minimum.entitled,
        scheduled: raw.scheduled,
        schedule_invalid: raw.schedule_invalid,
        starts_on: raw.starts_on.as_deref(),
        ends_on: raw.ends_on.as_deref(),
        markets: fields.targeting.markets.as_deref(),
        segment_targeted: fields.targeting.segment_targeted,
        combines: fields.combines,
        state: None,
    })
}

/// The campaign whose overrides apply: the node says its window is live AND its
/// variables (campaign id + varsVersion) are the ones the shop config was built
/// with (C4/C7). Anything else plans without a campaign, deterministically.
fn active_campaign<'a>(config: &'a Config, cart: &NormalizedCart) -> Option<&'a RawCampaign> {
    let node = &cart.campaign;
    let (true, Some(id), Some(version)) = (node.active, node.id, node.vars_version) else {
        return None;
    };
    if config.campaign_id.as_deref() != Some(id) || config.campaign_vars_version.as_deref() != Some(version) {
        return None;
    }
    config.campaigns.iter().find(|c| c.id.as_deref() == Some(id) && !c.killed)
}

struct Resolved<'a> {
    campaign_id: Option<&'a str>,
    rules: Vec<Rule<'a>>,
    retargeted: Vec<bool>,
}

fn resolve_rules<'a>(config: &'a Config, cart: &NormalizedCart) -> Resolved<'a> {
    let campaign = active_campaign(config, cart);
    let mut rules: Vec<Rule<'a>> = Vec::with_capacity(config.rules.len());
    let mut retargeted = Vec::with_capacity(config.rules.len());
    for raw in &config.rules {
        if rules.iter().any(|r| r.id == raw.id) {
            continue;
        }
        let mut fields = raw.fields.view();
        let mut retargets = false;
        for (rule_id, patch) in campaign.map_or(&[][..], |c| c.overrides.as_slice()) {
            if *rule_id == raw.id {
                fields = patch.overlay(fields);
                retargets |= patch.retargets();
            }
        }
        let Some(rule) = read_rule(raw, fields, cart) else { continue };
        retargeted.push(retargets);
        rules.push(rule);
    }
    Resolved { campaign_id: campaign.and_then(|c| c.id.as_deref()), rules, retargeted }
}

// --- Stage: codes ------------------------------------------------------------------------------

/// Entered codes → code rules by hash (the first rule listing a hash owns it).
fn match_codes(rules: &[Rule], cart: &NormalizedCart) -> Vec<Vec<String>> {
    let mut entered_by_rule = vec![Vec::new(); rules.len()];
    if cart.entered_codes.is_empty() {
        return entered_by_rule;
    }
    let mut owner_by_hash: FnvMap<&str, usize> = FnvMap::default();
    for (i, rule) in rules.iter().enumerate() {
        if !rule.method_code {
            continue;
        }
        for hash in rule.code_hashes {
            owner_by_hash.entry(hash.as_str()).or_insert(i);
        }
    }
    for code in &cart.entered_codes {
        if let Some(&owner) = owner_by_hash.get(code_hash(code).as_str()) {
            entered_by_rule[owner].push(code.clone());
        }
    }
    entered_by_rule
}

// --- Stage: lines, exclusions, targeting, scopes ------------------------------------------------

#[derive(Debug, Clone, Copy, Default)]
struct Scope {
    subtotal: i64,
    quantity: i64,
    lines: i64,
    discountable: i64,
}

impl Scope {
    fn add(&mut self, line: &NormalizedLine, discountable: bool) {
        self.subtotal = self.subtotal.saturating_add(line.subtotal);
        self.quantity = self.quantity.saturating_add(line.quantity);
        self.lines += 1;
        self.discountable += i64::from(discountable);
    }
}

struct WorkLine<'a> {
    excluded: Option<Excluded>,
    /// The rules that target this line (`lineRuleIds`), as rule indices, deduplicated.
    rule_set: Vec<usize>,
    product: Option<PlanStack<'a>>,
}

/// `lineRuleIds` (targeting.ts): unscoped refs for rules the campaign does not
/// re-target, `ruleId@<campaign>` refs only for the ones it does.
fn line_rule_ids<'r>(
    refs: impl Iterator<Item = &'r str>,
    campaign_id: Option<&str>,
    retargeted: &[bool],
    by_id: &IdMap,
) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::new();
    for r in refs {
        let hit = match r.find('@') {
            None => by_id.get(r).copied().filter(|&i| !retargeted[i]),
            Some(at) => by_id
                .get(&r[..at])
                .copied()
                .filter(|&i| retargeted[i] && campaign_id == Some(&r[at + 1..])),
        };
        if let Some(i) = hit {
            if !out.contains(&i) {
                out.push(i);
            }
        }
    }
    out
}

// --- Stage: eligibility ---------------------------------------------------------------------------

fn in_market(rule: &Rule, cart: &NormalizedCart, market_countries: &[(String, Vec<String>)]) -> bool {
    let (Some(markets), Some(country)) = (rule.markets, cart.country_code.as_ref()) else { return false };
    markets.iter().any(|handle| {
        market_countries.iter().find(|(h, _)| h == handle).is_some_and(|(_, countries)| countries.contains(country))
    })
}

/// Rule gate, in the order a merchant would ask "why not?". None = eligible.
fn gate(
    rule: &Rule,
    cart: &NormalizedCart,
    market_countries: &[(String, Vec<String>)],
    cart_scope: &Scope,
    target_scope: &Scope,
    entered: bool,
) -> Option<RuleState> {
    if !rule.enabled {
        return Some(RuleState::Disabled);
    }
    if rule.method_code && !entered {
        return Some(RuleState::CodeNotEntered);
    }
    if rule.scheduled {
        let Some(today) = cart.today.filter(|_| !rule.schedule_invalid) else {
            return Some(RuleState::ScheduleUnknown);
        };
        if rule.starts_on.is_some_and(|s| js::cmp_str(today, s).is_lt()) {
            return Some(RuleState::NotStarted);
        }
        if rule.ends_on.is_some_and(|e| js::cmp_str(today, e).is_gt()) {
            return Some(RuleState::Ended);
        }
    }
    if rule.segment_targeted {
        return Some(RuleState::Unsupported);
    }
    if rule.markets.is_some() && !in_market(rule, cart, market_countries) {
        return Some(RuleState::Market);
    }
    if (rule.value_kind == ValueKind::Fixed && rule.fixed.is_none()) || rule.min_subtotal_missing {
        return Some(RuleState::CurrencyMissing);
    }
    if target_scope.lines == 0 {
        return Some(RuleState::NoTargetLines);
    }
    if rule.cls != DiscountClass::Shipping && target_scope.discountable == 0 {
        return Some(RuleState::OutletOnly);
    }
    // [spec] „Minimum košíku“ = the WHOLE cart (every non-gift line, outlet
    // included), whatever the rule targets; the same for the quantity minimum.
    // An "entitled" minimum counts only a product rule's own lines, measured the
    // same way; an order or shipping rule is entitled to the whole cart.
    let scope = if rule.min_entitled && rule.cls == DiscountClass::Product { target_scope } else { cart_scope };
    let missing_subtotal = rule.min_subtotal.map_or(0, |m| m.saturating_sub(scope.subtotal).max(0));
    let missing_quantity = if rule.min_quantity > 0 { rule.min_quantity.saturating_sub(scope.quantity).max(0) } else { 0 };
    if missing_subtotal > 0 || missing_quantity > 0 {
        return Some(RuleState::BelowMinimum);
    }
    None
}

// --- Ranking and stacking ------------------------------------------------------------------

/// amount desc, then priority desc, then id asc (never config order).
fn by_rank(rules: &[Rule], a: &Component, b: &Component) -> std::cmp::Ordering {
    b.amount
        .cmp(&a.amount)
        .then_with(|| rules[b.rule].priority.cmp(&rules[a.rule].priority))
        .then_with(|| js::cmp_str(rules[a.rule].id, rules[b.rule].id))
}

/// Owner of a stack: among its CODE components when there is one (the code shows
/// as applied, Shopify counts its use), else among all; highest priority, then id asc.
fn owner_of(rules: &[Rule], components: &[Component]) -> usize {
    let has_code = components.iter().any(|c| rules[c.rule].method_code);
    let mut pool = components.iter().filter(|c| !has_code || rules[c.rule].method_code);
    let mut owner = pool.next().map_or(components[0].rule, |c| c.rule);
    for c in pool {
        let (r, o) = (&rules[c.rule], &rules[owner]);
        if r.priority > o.priority || (r.priority == o.priority && js::cmp_str(r.id, o.id).is_lt()) {
            owner = c.rule;
        }
    }
    owner
}

/// Symmetric Pro combinesWith relation: A stacks with B if either lists the other.
fn partners_of(rules: &[Rule], by_id: &IdMap) -> Vec<Vec<usize>> {
    let mut partners = vec![Vec::new(); rules.len()];
    let mut link = |a: usize, b: usize| {
        if a != b && !partners[a].contains(&b) {
            partners[a].push(b);
        }
    };
    for (i, rule) in rules.iter().enumerate() {
        for other in rule.combines {
            if let Some(&j) = by_id.get(other.as_str()) {
                link(i, j);
                link(j, i);
            }
        }
    }
    partners
}

struct Picked {
    components: Vec<Component>,
    total: i64,
}

/// The best stack for one target (a line, or the order): the single best
/// candidate, or — when Pro combinesWith links candidates — the combinable set
/// that saves the customer the most (greedy from every linked seed not already
/// covered; ties keep the earlier-ranked seed). Amounts are then capped at `cap`
/// in rank order.
fn pick(rules: &[Rule], positive: &mut [Component], cap: i64, partners: &[Vec<usize>], any_partners: bool) -> Picked {
    if positive.len() > 1 {
        positive.sort_by(|a, b| by_rank(rules, a, b));
    }
    if !any_partners || positive.len() == 1 {
        // The single best candidate (no Pro stacking possible), capped at `cap`.
        let best = positive[0];
        let amount = best.amount.min(cap);
        let components = if amount > 0 { vec![Component { rule: best.rule, amount }] } else { Vec::new() };
        return Picked { components, total: amount.max(0) };
    }
    let mut chosen: Vec<Component> = vec![positive[0]];
    let mut best_total = cap.min(positive[0].amount);
    let mut covered = vec![false; positive.len()];
    for (si, seed) in positive.iter().enumerate() {
        let mine = &partners[seed.rule];
        if mine.is_empty() || covered[si] {
            continue;
        }
        // Indices into `positive`, which is in rank order: ascending index = rank order.
        let mut set = vec![si];
        for (ci, c) in positive.iter().enumerate() {
            if ci == si || !mine.contains(&c.rule) {
                continue;
            }
            if set.iter().all(|&s| s == si || partners[positive[s].rule].contains(&c.rule)) {
                set.push(ci);
            }
        }
        if set.len() == 1 {
            continue;
        }
        for &c in &set {
            covered[c] = true;
        }
        set.sort_unstable();
        let total = cap.min(set.iter().map(|&i| positive[i].amount).fold(0i64, i64::saturating_add));
        if total > best_total {
            best_total = total;
            chosen = set.iter().map(|&i| positive[i]).collect();
        }
    }
    let mut components = Vec::with_capacity(chosen.len());
    let mut remaining = cap;
    for c in chosen {
        let amount = c.amount.min(remaining);
        if amount <= 0 {
            continue;
        }
        components.push(Component { rule: c.rule, amount });
        remaining -= amount;
    }
    Picked { components, total: cap - remaining }
}

fn build_stack<'a>(
    rules: &[Rule<'a>],
    picked: Picked,
    natural_value: impl Fn(&Component) -> EmittedValue,
) -> Option<PlanStack<'a>> {
    if picked.components.is_empty() {
        return None;
    }
    let owner = owner_of(rules, &picked.components);
    let (value, message) = if picked.components.len() == 1 {
        (natural_value(&picked.components[0]), rules[picked.components[0].rule].label.clone())
    } else {
        let labels: Vec<&str> = picked.components.iter().map(|c| rules[c.rule].label.as_ref()).collect();
        (EmittedValue::FixedTotal(picked.total), Cow::Owned(labels.join(" + ")))
    };
    Some(PlanStack { components: picked.components, amount: picked.total, owner, value, message })
}

fn product_amount(rule: &Rule, line: &NormalizedLine) -> i64 {
    match (rule.value_kind, rule.fixed) {
        (ValueKind::Percentage, _) => js::round((line.subtotal as f64 * rule.percent) / 100.0) as i64,
        (ValueKind::Fixed, Some(fixed)) => fixed.min(line.unit_price).saturating_mul(line.quantity),
        _ => 0,
    }
}

fn order_amount(rule: &Rule, base: i64) -> i64 {
    match (rule.value_kind, rule.fixed) {
        (ValueKind::Percentage, _) => js::round((base as f64 * rule.percent) / 100.0) as i64,
        (ValueKind::Fixed, Some(fixed)) => fixed.min(base),
        _ => 0,
    }
}

struct StackContext<'c, 'a> {
    rules: &'c [Rule<'a>],
    partners: &'c [Vec<usize>],
    any_partners: bool,
    cart: &'c NormalizedCart<'a>,
}

// --- Stage: product discounts --------------------------------------------------------------------

fn plan_products<'a>(work: &mut [WorkLine<'a>], ctx: &StackContext<'_, 'a>) {
    let rules = ctx.rules;
    let mut positive: Vec<Component> = Vec::new();
    for (w, line) in work.iter_mut().zip(&ctx.cart.lines) {
        if w.excluded.is_some() || w.rule_set.is_empty() {
            continue;
        }
        positive.clear();
        for &i in &w.rule_set {
            let rule = &rules[i];
            if rule.cls != DiscountClass::Product || rule.state.is_some() {
                continue;
            }
            let amount = product_amount(rule, line);
            if amount > 0 {
                positive.push(Component { rule: i, amount });
            }
        }
        if positive.is_empty() {
            continue;
        }
        let unit_price = line.unit_price;
        let picked = pick(rules, &mut positive, line.subtotal, ctx.partners, ctx.any_partners);
        w.product = build_stack(
            rules,
            picked,
            |single| {
                let rule = &rules[single.rule];
                if rule.value_kind == ValueKind::Percentage {
                    EmittedValue::Percent(rule.percent)
                } else {
                    EmittedValue::FixedPerItem(rule.fixed.unwrap_or(0).min(unit_price))
                }
            },
        );
    }
}

// --- Stage: order discount ---------------------------------------------------------------------

fn plan_order_stage<'a>(work: &mut [WorkLine<'a>], engine: &EngineFlags, ctx: &StackContext<'_, 'a>) -> Option<PlanOrder<'a>> {
    let rules = ctx.rules;
    let order_rules: Vec<usize> =
        (0..rules.len()).filter(|&i| rules[i].cls == DiscountClass::Order && rules[i].state.is_none()).collect();
    if order_rules.is_empty() && engine.product_with_order {
        return None;
    }
    let excluded_line_ids: Vec<&'a str> =
        work.iter().zip(&ctx.cart.lines).filter(|(w, _)| w.excluded.is_some()).map(|(_, line)| line.id).collect();
    let plan_at = |base: i64| -> Option<PlanOrder<'a>> {
        let mut positive: Vec<Component> = order_rules
            .iter()
            .map(|&i| Component { rule: i, amount: order_amount(&rules[i], base) })
            .filter(|c| c.amount > 0)
            .collect();
        if positive.is_empty() {
            return None;
        }
        let picked = pick(rules, &mut positive, base, ctx.partners, ctx.any_partners);
        let stack = build_stack(
            rules,
            picked,
            |single| {
                if rules[single.rule].value_kind == ValueKind::Percentage {
                    EmittedValue::Percent(rules[single.rule].percent)
                } else {
                    EmittedValue::FixedTotal(single.amount)
                }
            },
        )?;
        Some(PlanOrder { stack, base, excluded_line_ids: excluded_line_ids.clone() })
    };
    let product_total = work.iter().map(|w| w.product.as_ref().map_or(0, |p| p.amount)).fold(0i64, i64::saturating_add);
    let discountable_subtotal =
        work.iter().zip(&ctx.cart.lines).filter(|(w, _)| w.excluded.is_none()).map(|(_, l)| l.subtotal).fold(0i64, i64::saturating_add);
    // [spec] The order discount is taken from the subtotal AFTER product discounts.
    if engine.product_with_order {
        return plan_at(discountable_subtotal - product_total);
    }
    // Exclusive (Free switch off): the better scenario for the customer wins, a tie keeps products.
    let order_only = plan_at(discountable_subtotal);
    let order_wins = order_only.as_ref().is_some_and(|o| o.stack.amount > product_total);
    if order_wins {
        for w in work.iter_mut() {
            w.product = None;
        }
        return order_only;
    }
    None
}

// --- Stage: shipping -----------------------------------------------------------------------------

/// One shipping winner. The function never knows the delivery cost, so [spec]
/// percent (free = 100 %) ranks above a fixed amount, larger first. When a Free
/// switch forbids shipping next to the product/order discounts that apply,
/// there is no winner.
fn plan_shipping<'a>(
    work: &[WorkLine<'a>],
    order: Option<&PlanOrder<'a>>,
    engine: &EngineFlags,
    ctx: &StackContext<'_, 'a>,
) -> Option<PlanShipping<'a>> {
    let rules = ctx.rules;
    struct Candidate {
        rule: usize,
        value: ShippingValue,
        key: (f64, f64),
    }
    let mut candidates: Vec<Candidate> = Vec::new();
    for (i, rule) in rules.iter().enumerate() {
        if rule.cls != DiscountClass::Shipping || rule.state.is_some() {
            continue;
        }
        let percent = match rule.value_kind {
            ValueKind::FreeShipping => Some(100.0),
            ValueKind::Percentage => Some(rule.percent),
            ValueKind::Fixed => None,
        };
        let fixed = if rule.value_kind == ValueKind::Fixed { rule.fixed.unwrap_or(0) } else { 0 };
        let (value, worth, key) = match percent {
            Some(p) => (ShippingValue::Percent(p), p > 0.0, (1.0, p)),
            None => (ShippingValue::FixedTotal(fixed), fixed > 0, (0.0, fixed as f64)),
        };
        if worth {
            candidates.push(Candidate { rule: i, value, key });
        }
    }
    candidates.sort_by(|a, b| {
        let (ra, rb) = (&rules[a.rule], &rules[b.rule]);
        b.key
            .0
            .partial_cmp(&a.key.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.key.1.partial_cmp(&a.key.1).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| rb.priority.cmp(&ra.priority))
            .then_with(|| js::cmp_str(ra.id, rb.id))
    });
    let winner = candidates.into_iter().next()?;
    let blocked = (!engine.product_with_shipping && work.iter().any(|w| w.product.is_some()))
        || (!engine.order_with_shipping && order.is_some());
    if blocked {
        return None;
    }
    Some(PlanShipping { rule: winner.rule, value: winner.value, message: rules[winner.rule].label.clone() })
}

// --- The plan -------------------------------------------------------------------------------

fn failed_plan<'a>(cart: &NormalizedCart<'a>, reason: PlanFailure) -> CartPlan<'a> {
    CartPlan {
        currency: cart.currency.clone(),
        reason: Some(reason),
        rules: Vec::new(),
        entered_by_rule: Vec::new(),
        campaign_id: None,
        lines: cart
            .lines
            .iter()
            .map(|l| PlanLine {
                line_id: l.id,
                excluded: if l.gift {
                    Some(Excluded::Gift)
                } else if l.outlet {
                    Some(Excluded::Outlet)
                } else {
                    None
                },
                quantity: l.quantity,
                unit_price: l.unit_price,
                subtotal: l.subtotal,
                product: None,
            })
            .collect(),
        order: None,
        shipping: None,
    }
}

fn build_plan<'a>(cart: NormalizedCart<'a>, config: &'a Config) -> CartPlan<'a> {
    let engine = config.engine;
    let Resolved { campaign_id, mut rules, retargeted } = resolve_rules(config, &cart);
    let entered_by_rule = match_codes(&rules, &cart);

    let by_id: IdMap = rules.iter().enumerate().map(|(i, r)| (r.id, i)).collect();
    let mut work: Vec<WorkLine> = Vec::with_capacity(cart.lines.len());
    let mut cart_scope = Scope::default();
    let mut rule_scopes = vec![Scope::default(); rules.len()];
    for line in &cart.lines {
        let excluded = if line.gift {
            Some(Excluded::Gift)
        } else if line.outlet && !engine.outlet_with_anything {
            Some(Excluded::Outlet)
        } else {
            None
        };
        let rule_set = line_rule_ids(line.refs(), campaign_id, &retargeted, &by_id);
        if excluded != Some(Excluded::Gift) {
            let discountable = excluded.is_none();
            cart_scope.add(line, discountable);
            for &i in &rule_set {
                rule_scopes[i].add(line, discountable);
            }
        }
        work.push(WorkLine { excluded, rule_set, product: None });
    }
    let partners = partners_of(&rules, &by_id);
    drop(by_id);

    for (i, rule) in rules.iter_mut().enumerate() {
        let target_scope = if rule.cls == DiscountClass::Product { rule_scopes[i] } else { cart_scope };
        rule.state = gate(rule, &cart, &config.market_countries, &cart_scope, &target_scope, !entered_by_rule[i].is_empty());
    }

    let any_partners = partners.iter().any(|p| !p.is_empty());
    let ctx = StackContext { rules: &rules, partners: &partners, any_partners, cart: &cart };
    plan_products(&mut work, &ctx);
    // MVP 2 hook (A1.7 margin protection): identity for now.
    let order = plan_order_stage(&mut work, &engine, &ctx);
    let shipping = plan_shipping(&work, order.as_ref(), &engine, &ctx);

    let lines = work
        .into_iter()
        .zip(&cart.lines)
        .map(|(w, line)| PlanLine {
            line_id: line.id,
            excluded: w.excluded,
            quantity: line.quantity,
            unit_price: line.unit_price,
            subtotal: line.subtotal,
            product: w.product,
        })
        .collect();
    CartPlan { currency: cart.currency.clone(), reason: None, rules, entered_by_rule, campaign_id, lines, order, shipping }
}

/// Plan the discounts for one cart. Never fails: a missing/invalid shared config
/// (e.g. a shop metafield over 10 000 B arrives as null, C7) is
/// `reason: ConfigMissing`, and that plan emits nothing.
pub fn plan_cart<'a>(input: CartInput<'a>, config: Option<&'a Config>) -> CartPlan<'a> {
    let cart = normalize_cart(input);
    match config {
        None => failed_plan(&cart, PlanFailure::ConfigMissing),
        Some(config) => build_plan(cart, config),
    }
}
