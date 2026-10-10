// planCart (plan.ts): the one discount brain, the part of it a node's emission
// depends on. Same stages, same order, same ties:
//   resolveRules → matchCodes (by hash, else by generated batch: batch.rs) →
//   prepareLines → gateRules (minimum: the whole cart, or the rule's own lines
//   when its scope is "entitled") → applyItemMinimums (per-item minimum
//   quantities: plan.ts "Per-item minimum" is the port spec; here ONE cold
//   function after the unchanged gate, `apply_item_minimums`) → prepareTiers
//   (MVP 3, engine/tiers.rs: each line's quantity-tier candidate) →
//   planProducts (a tier competes like a rule, never in a Pro stack) → margin
//   protection (MVP 2, only while `modules.margin` is on: computeFloors +
//   applyMarginProtection) → planOrderStage (margin on: protectOrder) →
//   planShipping.
// A tier set is a pseudo-rule of the plan (`tier:<setId>`, automatic, priority
// 0), after the rules in `CartPlan::rules`: it ranks, owns and is emitted like
// an automatic rule; its value and message are its line's own.
// Left out on purpose (explain/admin only, never emitted): rule outcomes and
// their states beyond "eligible or not" (margin_floor included), `betterRuleIds`,
// `combinedInto`, `missing`, the margin caps' reasons, totals and
// gifts/warnings/progress.
//
// Money is integer minor units (i64). Where the TS engine computes with
// fractions (percentages), this computes the same float expression in the same
// order and rounds with Math.round semantics (engine/js.rs), so every amount is
// bit-for-bit the TS amount. Ties: amount desc, priority desc, id asc (JS
// string order), never config order.

use std::borrow::Cow;
use std::cell::RefCell;

use super::batch::{is_batch_code, PREFIX};
use super::cart::{normalize_cart, CartInput, NormalizedCart, NormalizedLine};
use super::config::{threshold_in, Config, EngineFlags, FieldsRef, RawCampaign, RawRule, TargetKind, TierSet, ValueSpec};
use super::describe::{describe_short, DescribedValue};
use super::table::{bytes_eq, Message, Table, Text};
use super::hash::{hash_value, normalized_hash_within, parse_hash, MAX_ENTERED_CODES};
use super::js;
use super::margin::{apply_product_margin, resolve_margin, strictest_margin, CostContext, FloorRule, MarginPayload, MarginRef, MAX_MARGIN_REFS};
use super::money::mul_sat;
use super::order_search::{order_set_limit, search_order_sets, OrderSetLine, EXACT_LINES, SAFE_BELOW};
use super::tiers::{prepare_tiers, SetIndex, TierCandidate};

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
    /// Code rules: its codes' hashes, and one longer text per generated batch (batch.rs).
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
    /// The rule's position in (priority desc, id asc in JS string order) order,
    /// unique (ids are): the ties after the amount (`by_rank`, `owner_of`, the
    /// shipping winner) compare this one number instead of priorities and texts.
    pub order: u32,
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
    /// Margin protection lowered this line's product discount (`marginCapped`):
    /// the output emits it as its exact amount and never relaxes it.
    pub margin_capped: bool,
    /// Margin on, the line has a product discount AND no minor unit is left above
    /// its floor or it is in the order discount's base (`marginTight`,
    /// markTightLines): the output never relaxes a rounding tie on it to a percent.
    pub margin_tight: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanOrder<'a> {
    pub stack: PlanStack<'a>,
    /// Subtotal after product discounts of the lines the order discount is taken
    /// from (margin-excluded lines left out).
    pub base: i64,
    /// Outlet, gift and margin-excluded lines, in cart order (the candidate's excludedCartLineIds).
    pub excluded_line_ids: Vec<&'a str>,
    /// Margin protection is on (`marginProtected`): every node emits this order
    /// discount as its exact amount, never a percent (function-output.ts rule 4).
    pub margin_protected: bool,
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
    /// Per rule: the entries that are its codes (`match_codes`: each code's
    /// hash and trimmed text, entry order, repeats kept).
    pub entered_by_rule: Vec<Vec<(u32, &'a str)>>,
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

    /// `rule.enteredCodes.includes(code)` (emit.ts) for a normalized code: one
    /// of the rule's entries normalizes to it. Only an entry with its hash is
    /// upper-cased to compare.
    pub fn rule_has_code(&self, rule: usize, code: &str) -> bool {
        let hash = hash_value(code);
        self.entered_by_rule[rule].iter().any(|&(h, entry)| h == hash && js::upper(entry) == code)
    }

    /// The rule's entered codes as plan.ts lists them (`enteredCodes`):
    /// normalized, each once, in entry order.
    #[cfg(test)]
    pub fn entered_codes(&self, rule: usize) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for &(_, entry) in &self.entered_by_rule[rule] {
            let code = js::upper(entry);
            if !out.contains(&code) {
                out.push(code);
            }
        }
        out
    }
}

type IdMap<'a> = Table<Text<'a>, usize>;

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
        order: 0,
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
        if rules.iter().any(|r| bytes_eq(r.id.as_bytes(), raw.id.as_bytes())) {
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

/// Entered codes → code rules: by hash (the first rule listing a hash owns it),
/// else by generated batch (batch.rs `CodeBatch::matches`: the first batch in
/// rule order, then batch order; only an entry that is all ASCII once trimmed
/// is tried, which `is_batch_code` sees to — plan.ts `matchCodes`, cart.ts `ascii`). Of the first MAX_ENTERED_CODES entries as entered
/// (every entry counts: an empty one, one that cannot be a Won code), only an
/// entry that can be a Won code is matched (`normalized_hash_within`): at most
/// the longest Won code (`max_code_length`) + CODE_PADDING UTF-16 units as
/// entered, and its upper-case form at most `max_code_length` long (audit
/// rounds 6 and 7). Any other is left without being upper-cased or trimmed
/// past the bound. The rest are hashed as they would be upper-cased; an entry
/// whose hash a rule has is that rule's, kept as its hash and trimmed text in
/// entry order. Nothing is upper-cased here: what the function needs of a
/// rule's codes is whether it has one and whether the triggering code is one
/// of them (`CartPlan::rule_has_code`), and a repeat changes neither.
fn match_codes<'a>(rules: &[Rule], cart: &NormalizedCart<'a>, max_code_length: usize) -> Vec<Vec<(u32, &'a str)>> {
    let mut entered_by_rule = vec![Vec::new(); rules.len()];
    if cart.entered_codes.is_empty() {
        return entered_by_rule;
    }
    // By the hash's number: a config text that is not 8 lower-case hex digits
    // equals no codeHash and is left out; the first rule listing a hash owns it.
    let mut owner_by_hash: Table<u64, usize> = Table::default();
    let mut any_batch = false;
    for (i, rule) in rules.iter().enumerate() {
        if !rule.method_code {
            continue;
        }
        for hash in rule.code_hashes {
            if let Some(n) = parse_hash(hash) {
                owner_by_hash.get_or_insert_with(u64::from(n), || i);
            } else {
                // Longer than a hash: a generated batch's text (batch.rs), matched by `batch_owner`.
                any_batch |= hash.len() > PREFIX;
            }
        }
    }
    if owner_by_hash.is_empty() && !any_batch {
        return entered_by_rule;
    }
    for &raw in cart.entered_codes.iter().take(MAX_ENTERED_CODES) {
        let Some((hash, code)) = normalized_hash_within(raw, max_code_length) else { continue };
        let owner = match owner_by_hash.get(&u64::from(hash)) {
            Some(&owner) => Some(owner),
            // Else the first code rule with a generated batch the code is a code of (batch.rs).
            None if any_batch => {
                rules.iter().position(|r| r.method_code && r.code_hashes.iter().any(|text| text.len() > PREFIX && is_batch_code(text, code.as_bytes())))
            }
            None => None,
        };
        if let Some(owner) = owner {
            entered_by_rule[owner].push((hash, code));
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
    /// A sale line that takes only some discounts: the classes it stays out of (`NormalizedLine::outlet_no`).
    no: u8,
    /// The rules that target this line (`lineRuleIds`), as rule indices, deduplicated.
    rule_set: Vec<usize>,
    product: Option<PlanStack<'a>>,
    /// Margin on: the floor of one item of a discountable line (computeFloors); none otherwise.
    floor: Option<i64>,
    /// Margin protection lowered the product discount (`marginCapped`).
    margin_capped: bool,
    /// Margin on: left out of the order discount by protectOrder (`marginExcludedLineIds`).
    order_left: bool,
    /// `marginTight` (markTightLines).
    margin_tight: bool,
}

/// `lineRuleIds` (targeting.ts): unscoped refs for rules the campaign does not
/// re-target, `ruleId@<campaign>` refs only for the ones it does. Each rule once,
/// in the order of the refs (product-wide, then the variant's).
fn line_rule_ids(refs: &RuleRefs, rule_ids: &[String], variant_rule_ids: &[String], seen: &mut Seen) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::with_capacity(rule_ids.len() + variant_rule_ids.len());
    seen.next_line();
    for list in [rule_ids, variant_rule_ids] {
        for r in list {
            if let Some(i) = refs.rule_of(r) {
                if seen.first(i) {
                    out.push(i);
                }
            }
        }
    }
    out
}

/// The item refs (`ruleId[@campaign]#key:min`, per-item minimum; targeting.ts
/// `lineTargeting`) of the lines some ref of which named no rule as it is
/// (`looks`: `line_rule_ids` gave them fewer rules than they have refs — nearly
/// never: the sync writes each ref once, for a rule the config has). Run once,
/// after the lines' loop, which it leaves exactly as it was (a call from inside
/// that loop cost every cart ~110 instructions a line). A ref with a "#" that
/// names no rule plainly, and whose base does, is recorded for its line; each
/// such rule, once a line, either is one the line ALSO lists by a plain ref
/// (it is among the line's rules already) and gets a mark, or joins the line's
/// rules now, with the line in its scope like any rule of the line.
#[cold]
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn collect_item_refs<'a>(
    rules: &[Rule],
    retargeted: &[bool],
    campaign_id: Option<&str>,
    lines: &[NormalizedLine<'a>],
    work: &mut [WorkLine],
    looks: &[u32],
    rule_scopes: &mut [Scope],
) -> Vec<ItemEntry<'a>> {
    let mut items: Vec<ItemEntry<'a>> = Vec::new();
    for &at in looks {
        let (Some(line), Some(w)) = (lines.get(at as usize), work.get_mut(at as usize)) else { continue };
        let first = items.len();
        for r in line.rule_ids.iter().chain(line.variant_rule_ids) {
            // An item ref — unless the text names a rule as it is (then it was that rule's plain ref).
            let Some(item) = parse_item_ref(r).filter(|_| rule_of_text(rules, retargeted, campaign_id, r).is_none()) else { continue };
            if let Some(rule) = rule_of_text(rules, retargeted, campaign_id, item.base) {
                items.push(ItemEntry { line: at, rule: rule as u32, group: 0, min: item.min, text: item.group });
            }
        }
        for k in first..items.len() {
            let Some(&ItemEntry { rule, .. }) = items.get(k) else { break };
            if items.get(first..k).is_some_and(|earlier| earlier.iter().any(|e| e.rule == rule)) {
                continue;
            }
            if w.rule_set.contains(&(rule as usize)) {
                items.push(ItemEntry { line: at, rule, group: 0, min: 0, text: "" });
                continue;
            }
            w.rule_set.push(rule as usize);
            if let (Some(scope), true) = (rule_scopes.get_mut(rule as usize), w.excluded != Some(Excluded::Gift)) {
                scope.add(line, w.excluded.is_none() && !(w.no & 2 != 0 && rules[rule as usize].cls == DiscountClass::Product));
            }
        }
    }
    items
}

/// An item ref's parts (targeting.ts `parseItemRef`).
#[derive(Debug, Clone, Copy, PartialEq)]
struct ItemRef<'a> {
    /// The plain ref before the "#".
    base: &'a str,
    /// The text before the last ":" (`base#key`): the lines naming it count together.
    group: &'a str,
    min: i64,
}

/// `parseItemRef`: after the FIRST "#" a non-empty key, the LAST ":" and 1–6
/// ASCII digits making a number ≥ 1; any other text is no item ref.
fn parse_item_ref(r: &str) -> Option<ItemRef<'_>> {
    let bytes = r.as_bytes();
    let hash = bytes.iter().position(|&b| b == b'#')?;
    let colon = bytes.iter().rposition(|&b| b == b':').filter(|&colon| colon > hash + 1)?;
    let digits = bytes.len() - colon - 1;
    if digits == 0 || digits > 6 {
        return None;
    }
    let mut min: i64 = 0;
    for &d in &bytes[colon + 1..] {
        if !d.is_ascii_digit() {
            return None;
        }
        min = min * 10 + i64::from(d - b'0');
    }
    // "#" and ":" are ASCII: both cuts are character boundaries.
    (min >= 1).then(|| ItemRef { base: r.get(..hash).unwrap_or(""), group: r.get(..colon).unwrap_or(""), min })
}

/// One item ref of one cart line (per-item minimum, plan.ts step 1), in line
/// order as the refs were read — or, with an empty `text`, the mark that the
/// line ALSO lists the rule by a plain ref (after the line's item refs;
/// `collect_item_refs`).
#[derive(Debug, Clone, Copy)]
struct ItemEntry<'a> {
    line: u32,
    rule: u32,
    /// The group's index, filled in by `apply_item_minimums`.
    group: u32,
    min: i64,
    /// The group's text (`base#key`).
    text: &'a str,
}

/// Per-item minimum, steps 2 to 5 (plan.ts `prepareLines`, `gate`,
/// `applyItemMinimums`), after the gate, only for a cart with an item ref:
///   2. a group's count = the pieces of every non-gift line naming it (a line
///      once a rule and group); the rules those lines name are the item rules;
///   3. an item rule (product class) the gate found below its minimum ONLY by
///      its common quantity minimum — the last thing the gate checks; its
///      subtotal minimum is reached — is eligible after all, and that minimum
///      decides for its plain lines;
///   4. an eligible item rule keeps a line when one of the line's groups of it
///      reached its minimum, or the line lists it plainly and the common
///      quantity minimum is reached;
///   5. one that keeps no non-gift line is below its minimum.
/// (Every index here is one the plan made: a line, a rule or a group that exists.)
#[cold]
#[inline(never)]
fn apply_item_minimums<'a>(rules: &mut [Rule], work: &mut [WorkLine], lines: &[NormalizedLine], items: &mut [ItemEntry<'a>], cart_scope: Scope, rule_scopes: &[Scope]) {
    // Per rule: 0 = not an item rule in play; 1 = eligible, its common quantity minimum missed; 2 = … reached; | 4 = keeps a line.
    let mut plays = vec![0u8; rules.len()];
    let mut groups: Vec<(&'a str, i64)> = Vec::new();
    let gift = |work: &[WorkLine], line: u32| work.get(line as usize).is_none_or(|w| w.excluded == Some(Excluded::Gift));
    for k in 0..items.len() {
        let (before, rest) = items.split_at_mut(k);
        let Some(entry) = rest.first_mut() else { break };
        if entry.text.is_empty() || gift(work, entry.line) {
            continue;
        }
        let group = groups.iter().position(|(other, _)| bytes_eq(other.as_bytes(), entry.text.as_bytes())).unwrap_or(groups.len());
        if group == groups.len() {
            groups.push((entry.text, 0));
        }
        entry.group = group as u32;
        // (An earlier entry of this line with the same rule and group already counted it.)
        let counted = before.iter().rev().take_while(|e| e.line == entry.line).any(|e| e.rule == entry.rule && e.group == entry.group && !e.text.is_empty());
        if let (false, Some(count), Some(line)) = (counted, groups.get_mut(group), lines.get(entry.line as usize)) {
            count.1 = count.1.saturating_add(line.quantity);
        }
        if let Some(play) = plays.get_mut(entry.rule as usize) {
            *play = 2;
        }
    }
    for ((rule, play), scope) in rules.iter_mut().zip(plays.iter_mut()).zip(rule_scopes) {
        if *play == 0 {
            continue;
        }
        *play = 0;
        if rule.cls != DiscountClass::Product {
            continue;
        }
        if rule.state.is_none() {
            *play = 2;
        } else if rule.state == Some(RuleState::BelowMinimum) {
            let scope = if rule.min_entitled { *scope } else { cart_scope };
            if rule.min_subtotal.is_none_or(|m| m <= scope.subtotal) {
                rule.state = None;
                *play = 1;
            }
        }
    }
    let mut rest: &[ItemEntry] = items;
    for (at, w) in work.iter_mut().enumerate() {
        // The line's entries.
        let count = rest.iter().take_while(|e| e.line as usize == at).count();
        let (entries, after) = rest.split_at(count);
        rest = after;
        if w.excluded == Some(Excluded::Gift) {
            continue;
        }
        // The line's rules, each kept or left out in place (their order stays).
        let mut len = 0;
        for k in 0..w.rule_set.len() {
            let i = w.rule_set[k];
            let mut keeps = true;
            if let Some(play) = plays.get_mut(i).filter(|play| **play != 0) {
                // A line without an item ref of the rule lists it plainly.
                let (mut listed, mut plain) = (false, false);
                keeps = false;
                for e in entries.iter().filter(|e| e.rule as usize == i) {
                    if e.text.is_empty() {
                        plain = true;
                    } else {
                        listed = true;
                        keeps |= groups.get(e.group as usize).is_some_and(|g| g.1 >= e.min);
                    }
                }
                keeps |= (plain || !listed) && *play & 2 != 0;
                if keeps {
                    *play |= 4;
                }
            }
            if keeps {
                w.rule_set[len] = i;
                len += 1;
            }
        }
        w.rule_set.truncate(len);
    }
    for (rule, play) in rules.iter_mut().zip(plays) {
        if play != 0 && play & 4 == 0 {
            rule.state = Some(RuleState::BelowMinimum);
        }
    }
}

/// What a ref names (`line_rule_ids`).
struct RuleRefs<'c, 'a> {
    by_id: &'c IdMap<'a>,
    campaign_id: Option<&'c str>,
    retargeted: &'c [bool],
    id_has_at: &'c [bool],
    /// The rule's id has no '@' and the campaign does not re-target it: a ref
    /// equal to its id is this rule — the common case, one lookup and one check.
    plain: Vec<bool>,
}

impl RuleRefs<'_, '_> {
    fn rule_of(&self, r: &str) -> Option<usize> {
        let found = self.by_id.get(&Text(r)).copied();
        if let Some(i) = found {
            if self.plain[i] {
                return Some(i);
            }
        }
        // A rule id without '@' is a ref as it is (a ref equal to such an id has no
        // '@' either); else the part before the first '@' names a rule the
        // campaign after it re-targets.
        match found.filter(|&i| !self.id_has_at[i]) {
            Some(i) => Some(i).filter(|&i| !self.retargeted[i]),
            None => match r.find('@') {
                None => found.filter(|&i| !self.retargeted[i]),
                Some(at) => self
                    .by_id
                    .get(&Text(&r[..at]))
                    .copied()
                    .filter(|&i| self.retargeted[i] && self.campaign_id == Some(&r[at + 1..])),
            },
        }
    }
}

/// `RuleRefs::rule_of`, written out once more for the item refs' cold path,
/// over the rules themselves (`rules`: the plan's rules, without the tier
/// sets'; `retargeted` and `campaign_id` as `RuleRefs` has them) — NOT through
/// `RuleRefs`: handing the lines' loop's `refs` (or its table) to another
/// function moves them from registers to memory for that loop too (measured:
/// +16 to +24 instructions a ref on every cart). A text without "@" is the id
/// of a rule the campaign does not re-target; one with "@" names, before its
/// first "@", a rule the campaign after it re-targets. (The same answers as
/// `rule_of`: a ref equal to an id with "@" is read by its "@" in both.)
#[inline(never)]
fn rule_of_text(rules: &[Rule], retargeted: &[bool], campaign_id: Option<&str>, r: &str) -> Option<usize> {
    let (id, campaign) = match r.as_bytes().iter().position(|&b| b == b'@') {
        None => (r, None),
        Some(at) => (r.get(..at)?, r.get(at + 1..)),
    };
    let i = rules.iter().position(|rule| bytes_eq(rule.id.as_bytes(), id.as_bytes()))?;
    let retargeted = retargeted.get(i).copied().unwrap_or(false);
    match campaign {
        None => !retargeted,
        Some(_) => retargeted && campaign_id == campaign,
    }
    .then_some(i)
}

/// The rules one line already listed (a stamp per rule, the line's number).
struct Seen {
    stamps: Vec<u32>,
    line: u32,
}

impl Seen {
    fn new(rules: usize) -> Self {
        Self { stamps: vec![0; rules], line: 0 }
    }

    fn next_line(&mut self) {
        self.line += 1;
    }

    /// True the first time rule `i` is seen on this line.
    fn first(&mut self, i: usize) -> bool {
        let fresh = self.stamps[i] != self.line;
        self.stamps[i] = self.line;
        fresh
    }
}

// --- Stage: eligibility ---------------------------------------------------------------------------

/// The market handles whose countries hold the cart's country, found once per
/// run in one pass over the shared config's `marketCountries` (plan.ts
/// `readMarketCountries` + `inMarket`: a handle's set `has(country)`). Keyed by
/// a hash of every byte (`Message`): handles of one pattern share their ends.
fn markets_here<'c>(cart: &NormalizedCart, market_countries: &'c [(String, Vec<String>)]) -> Table<Message<'c>, ()> {
    let mut here = Table::default();
    if let Some(country) = cart.country_code.as_ref() {
        for (handle, countries) in market_countries {
            if countries.iter().any(|c| c == country) {
                here.insert(Message(handle.as_str()), ());
            }
        }
    }
    here
}

/// `inMarket`: some of the rule's market handles holds the cart's country
/// (`markets_here`, one lookup a handle; with no country, none does).
fn in_market(rule: &Rule, markets_here: &Table<Message, ()>) -> bool {
    let Some(markets) = rule.markets else { return false };
    !markets_here.is_empty() && markets.iter().any(|handle| markets_here.get(&Message(handle.as_str())).is_some())
}

/// Rule gate, in the order a merchant would ask "why not?". None = eligible.
fn gate(
    rule: &Rule,
    cart: &NormalizedCart,
    markets_here: &Table<Message, ()>,
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
    if rule.markets.is_some() && !in_market(rule, markets_here) {
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

/// amount desc, then priority desc, then id asc (never config order): the
/// order `ranks_after` sorts by (the tests compare the sorts against it).
#[cfg(test)]
fn by_rank(rules: &[Rule], a: &Component, b: &Component) -> std::cmp::Ordering {
    b.amount.cmp(&a.amount).then_with(|| rules[a.rule].order.cmp(&rules[b.rule].order))
}

/// Every rule's `order`: its position in priority desc, id asc order.
/// Sorted by inserting each rule at its place found by halving (the order a stable
/// sort gives: a rule goes after its equals): as few comparisons as core's stable
/// sort, without its 8.8 kB of Wasm (README, "Wasm size").
fn rank_ids(rules: &mut [Rule]) {
    let mut ranked: Vec<usize> = Vec::with_capacity(rules.len());
    for i in 0..rules.len() {
        let at = ranked.partition_point(|&r| {
            rules[i].priority.cmp(&rules[r].priority).then_with(|| js::cmp_str(rules[r].id, rules[i].id)) != std::cmp::Ordering::Greater
        });
        ranked.insert(at, i);
    }
    for (order, i) in ranked.into_iter().enumerate() {
        rules[i].order = order as u32;
    }
}

/// Owner of a stack: among its CODE components when there is one (the code shows
/// as applied, Shopify counts its use), else among all; highest priority, then id asc.
fn owner_of(rules: &[Rule], components: &[Component]) -> usize {
    let has_code = components.iter().any(|c| rules[c.rule].method_code);
    let mut pool = components.iter().filter(|c| !has_code || rules[c.rule].method_code);
    let mut owner = pool.next().map_or(components[0].rule, |c| c.rule);
    for c in pool {
        if rules[c.rule].order < rules[owner].order {
            owner = c.rule;
        }
    }
    owner
}

/// Symmetric Pro combinesWith relation: A stacks with B if either lists the
/// other. Kept as lists and as a bit matrix (a pair is tested in O(1) when a
/// line's candidates are searched for a stack).
struct Partners {
    lists: Vec<Vec<usize>>,
    /// Row `a` (`words` u64s): bit `b` set when a and b stack.
    bits: Vec<u64>,
    words: usize,
}

impl Partners {
    fn has_any(&self, a: usize) -> bool {
        !self.lists[a].is_empty()
    }

    fn stack(&self, a: usize, b: usize) -> bool {
        (self.bits[a * self.words + b / 64] >> (b % 64)) & 1 == 1
    }

    /// `adjacent[i]`: the candidates (bit j = `positive[j]`) that candidate i stacks with.
    fn adjacency(&self, positive: &[Component], adjacent: &mut [u64]) {
        for (i, a) in positive.iter().enumerate() {
            let mut mask = 0u64;
            for (j, b) in positive.iter().enumerate() {
                if self.stack(a.rule, b.rule) {
                    mask |= 1 << j;
                }
            }
            adjacent[i] = mask;
        }
    }
}

fn partners_of(rules: &[Rule], by_id: &IdMap) -> Partners {
    let words = rules.len().div_ceil(64);
    let mut out = Partners { lists: vec![Vec::new(); rules.len()], bits: Vec::new(), words };
    let mut link = |a: usize, b: usize| {
        if a != b && !out.lists[a].contains(&b) {
            out.lists[a].push(b);
        }
    };
    for (i, rule) in rules.iter().enumerate() {
        for other in rule.combines {
            if let Some(&j) = by_id.get(&Text(other.as_str())) {
                link(i, j);
                link(j, i);
            }
        }
    }
    if out.lists.iter().any(|l| !l.is_empty()) {
        out.bits = vec![0; rules.len() * words];
        for (a, list) in out.lists.iter().enumerate() {
            for &b in list {
                out.bits[a * words + b / 64] |= 1 << (b % 64);
            }
        }
    }
    out
}

struct Picked {
    components: Vec<Component>,
    total: i64,
}

/// plan.ts `MAX_STACK_CANDIDATES` ([spec], MVP 2 audit round 3): a Pro stack is
/// searched only among the best-ranked candidates of its target (a line, or the
/// order), at most this many. A candidate ranked below them is never part of a
/// stack. This bounds the search per target: a mesh of Pro rules with a dozen
/// distinct candidates on every line took the function over Shopify's limit.
pub const MAX_STACK_CANDIDATES: usize = 6;

/// Rank order (`sort_by` with `by_rank`) by insertion: a target's few
/// candidates (ranks never tie: a line lists a rule once and rule orders are
/// unique, so there is one sorted order).
fn sort_by_rank(rules: &[Rule], list: &mut [Component]) {
    for i in 1..list.len() {
        let c = list[i];
        let mut j = i;
        while j > 0 && ranks_after(rules, &list[j - 1], &c) {
            list[j] = list[j - 1];
            j -= 1;
        }
        list[j] = c;
    }
}

/// `by_rank(a, b).is_gt()`: `a` ranks after `b` (the amounts decide, nearly always).
#[inline]
fn ranks_after(rules: &[Rule], a: &Component, b: &Component) -> bool {
    if a.amount != b.amount {
        return a.amount < b.amount;
    }
    rules[a.rule].order > rules[b.rule].order
}

/// The `k` best-ranked candidates of `list`, moved to its front in rank order
/// (the whole list, sorted, when it has no more); the rest keep no order. One
/// pass: a candidate that ranks before the k-th so far is inserted, and the
/// k-th moves out to its place (the amounts decide, nearly always, so a step is
/// one compare).
fn best_ranked<'l>(rules: &[Rule], list: &'l mut [Component], k: usize) -> &'l [Component] {
    if list.len() <= k {
        sort_by_rank(rules, list);
        return list;
    }
    sort_by_rank(rules, &mut list[..k]);
    for i in k..list.len() {
        let c = list[i];
        if !ranks_after(rules, &list[k - 1], &c) {
            continue;
        }
        list[i] = list[k - 1];
        let mut j = k - 1;
        while j > 0 && ranks_after(rules, &list[j - 1], &c) {
            list[j] = list[j - 1];
            j -= 1;
        }
        list[j] = c;
    }
    &list[..k]
}

/// One candidate capped at `cap`.
fn single(best: Component, cap: i64) -> Picked {
    let amount = best.amount.min(cap);
    let components = if amount > 0 { vec![Component { rule: best.rule, amount }] } else { Vec::new() };
    Picked { components, total: amount.max(0) }
}

/// The best stack for one target (a line, or the order): the single best
/// candidate, or — when Pro combinesWith links candidates — the combinable set
/// that saves the customer the most (greedy from every linked seed not already
/// covered; ties keep the earlier-ranked seed), searched among the
/// `MAX_STACK_CANDIDATES` best-ranked candidates only. Amounts are then capped
/// at `cap` in rank order. `tier`: the line's quantity tier (MVP 3), a single
/// candidate only — it takes no place in the stack pool (`positive` are the
/// rule candidates), and a stack beats it only with a larger total.
fn pick(ctx: &StackContext, positive: &mut [Component], tier: Option<Component>, cap: i64) -> Picked {
    let (rules, partners) = (ctx.rules, ctx.partners);
    // No candidate here has a Pro partner: the search below would keep the single
    // best candidate too.
    let stackable = ctx.any_partners && positive.len() > 1 && positive.iter().any(|c| partners.has_any(c.rule));
    if !stackable {
        // The single best candidate (no Pro stacking possible), capped at `cap`:
        // the first in rank order, found without sorting (ranks never tie: a
        // line lists a rule once and rule orders are unique).
        let mut candidates = positive.iter().copied().chain(tier);
        let Some(mut best) = candidates.next() else { return Picked { components: Vec::new(), total: 0 } };
        for c in candidates {
            if ranks_after(rules, &best, &c) {
                best = c;
            }
        }
        return single(best, cap);
    }
    // The stack cap: only the best-ranked rule candidates can be part of a stack.
    let pool = best_ranked(rules, positive, MAX_STACK_CANDIDATES);
    // The search starts from the line's best single candidate, the tier included.
    let best = match tier {
        Some(t) if ranks_after(rules, &pool[0], &t) => t,
        _ => pool[0],
    };
    let best_total = cap.min(best.amount);
    let found = if partners.words == 1 { stack_search_rules(pool, best_total, cap, &partners.bits) } else { stack_search(pool, best_total, cap, partners) };
    let Some(mut chosen) = found else { return single(best, cap) };
    // The chosen candidates in rank order, each capped at what is left of `cap`.
    let mut remaining = cap;
    let mut components = Vec::with_capacity(chosen.count_ones() as usize);
    while chosen != 0 {
        let c = pool[chosen.trailing_zeros() as usize];
        chosen &= chosen - 1;
        let amount = c.amount.min(remaining);
        remaining -= amount.max(0);
        if amount > 0 {
            components.push(Component { rule: c.rule, amount });
        }
    }
    Picked { components, total: cap - remaining }
}

/// The Pro stack search (see `pick`) over a target's best-ranked candidates
/// (`pool`, rank order, at most `MAX_STACK_CANDIDATES`), with bit sets (bit i =
/// `pool[i]`): the candidates each one stacks with are found once
/// (`adjacency`). From every seed in rank order that has a partner here and is
/// not already in a set: the seed plus every other candidate, in rank order,
/// that stacks with all the set's members taken so far. The set that saves the
/// most (its amounts summed, then capped at `cap`) wins when it saves more than
/// `best_total` (the best single candidate's), a tie keeping the earlier
/// seed's. The chosen set; none = the single best candidate.
fn stack_search(pool: &[Component], mut best_total: i64, cap: i64, partners: &Partners) -> Option<u64> {
    let n = pool.len();
    let mut adjacent = [0u64; MAX_STACK_CANDIDATES];
    partners.adjacency(pool, &mut adjacent[..n]);
    let mut chosen: Option<u64> = None;
    let mut covered: u64 = 0;
    for si in 0..n {
        // No partner here (none at all, or none among these candidates): its set would be itself.
        if adjacent[si] == 0 || covered >> si & 1 == 1 {
            continue;
        }
        let mut others: u64 = 0;
        let mut rest = adjacent[si];
        while rest != 0 {
            let ci = rest.trailing_zeros() as usize;
            rest &= rest - 1;
            // Every member added so far (besides the seed) must stack with it too.
            if others & !adjacent[ci] == 0 {
                others |= 1 << ci;
            }
        }
        let set = others | 1 << si;
        covered |= set;
        let mut total: i64 = 0;
        let mut bits = set;
        while bits != 0 {
            total = total.saturating_add(pool[bits.trailing_zeros() as usize].amount);
            bits &= bits - 1;
        }
        let total = cap.min(total);
        if total > best_total {
            best_total = total;
            chosen = Some(set);
        }
    }
    chosen
}

/// `stack_search` for a plan of up to 64 rules (one partner word a rule): the
/// same seeds, sets and choice, over the rules' own partner bits (bit r = rule
/// r; a target lists a rule once, so a rule is one position of `pool`) instead
/// of an adjacency built for the target: a seed's set is one pass over the pool
/// that stops after its last partner. The chosen set, as a mask over `pool`;
/// none = the single best candidate.
fn stack_search_rules(pool: &[Component], mut best_total: i64, cap: i64, bits: &[u64]) -> Option<u64> {
    let rule_bit = |c: &Component| 1u64 << c.rule;
    let here = pool.iter().fold(0u64, |m, c| m | rule_bit(c));
    let mut chosen: Option<u64> = None;
    // Rules already in a set.
    let mut covered: u64 = 0;
    for (si, seed) in pool.iter().enumerate() {
        // Its partners among these candidates (never itself).
        let links = bits[seed.rule] & here;
        if links == 0 || covered & rule_bit(seed) != 0 {
            continue;
        }
        let mut others: u64 = 0;
        let mut set: u64 = 1 << si;
        let mut total = seed.amount;
        // The seed's partners in rank order, until the last one was seen.
        let mut rest = links;
        for (ci, c) in pool.iter().enumerate() {
            if rest == 0 {
                break;
            }
            if rest & rule_bit(c) == 0 {
                continue;
            }
            rest &= !rule_bit(c);
            // Taken when it stacks with every member but the seed taken so far.
            if others & !bits[c.rule] == 0 {
                others |= rule_bit(c);
                set |= 1 << ci;
                total = total.saturating_add(c.amount);
            }
        }
        covered |= others | rule_bit(seed);
        let total = cap.min(total);
        if total > best_total {
            best_total = total;
            chosen = Some(set);
        }
    }
    chosen
}

/// A hash of a list of rules (indices), for the per-run caches keyed by one.
fn rules_hash(rules: impl ExactSizeIterator<Item = usize>) -> u64 {
    let n = rules.len() as u64;
    rules.fold(n, |h, rule| (h.rotate_left(23) ^ rule as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

/// The owner (`ownerOf`) and message (`labels.join(" + ")`) of a stack of
/// several rules, by its rules in order: they depend on nothing else. A Pro cart
/// has few distinct stacks, so each is built once per run and every line with
/// it shares its message — one text, which the output then finds by its address
/// instead of comparing it (output.rs `drafts`). A message is never freed, like
/// everything else a run builds (src/alloc.rs, README).
#[derive(Default)]
struct StackLabels {
    /// A stack of at most 7 rules below 256 — every stack of a plan the
    /// sanitizer allows (≤ 200 rules, ≤ MAX_STACK_CANDIDATES components) — by
    /// its rules packed into one word (`packed`): (owner, message).
    packed: Table<u64, (usize, &'static str)>,
    /// Any other stack, by a hash of its rules: (the rules, owner, message).
    by_hash: Table<u64, Vec<(Vec<usize>, usize, &'static str)>>,
}

/// A stack's rules in order as one word: the count, then a byte a rule (none
/// when a rule is 256 or more, or there are more than 7).
fn packed(components: &[Component]) -> Option<u64> {
    if components.len() > 7 {
        return None;
    }
    let mut key = components.len() as u64;
    for (k, c) in components.iter().enumerate() {
        if c.rule > 255 {
            return None;
        }
        key |= (c.rule as u64) << (8 * (k + 1));
    }
    Some(key)
}

impl StackLabels {
    fn of(&mut self, rules: &[Rule], components: &[Component]) -> (usize, &'static str) {
        if let Some(key) = packed(components) {
            return *self.packed.get_or_insert_with(key, || Self::label(rules, components));
        }
        let known = self.by_hash.get_or_insert_with(rules_hash(components.iter().map(|c| c.rule)), Vec::new);
        let same = |list: &Vec<usize>| list.len() == components.len() && list.iter().zip(components).all(|(&r, c)| r == c.rule);
        if let Some(&(_, owner, message)) = known.iter().find(|(list, _, _)| same(list)) {
            return (owner, message);
        }
        let (owner, message) = Self::label(rules, components);
        known.push((components.iter().map(|c| c.rule).collect(), owner, message));
        (owner, message)
    }

    /// The owner and the message of a stack (built once per run and stack).
    fn label(rules: &[Rule], components: &[Component]) -> (usize, &'static str) {
        let owner = owner_of(rules, components);
        // Written once into a string of the exact size.
        let len = components.iter().map(|c| rules[c.rule].label.len() + 3).sum::<usize>() - 3;
        let mut message = String::with_capacity(len);
        for (k, c) in components.iter().enumerate() {
            if k > 0 {
                message.push_str(" + ");
            }
            message.push_str(&rules[c.rule].label);
        }
        (owner, Box::leak(message.into_boxed_str()))
    }
}

fn build_stack<'a>(
    rules: &[Rule<'a>],
    labels: &RefCell<StackLabels>,
    picked: Picked,
    natural_value: impl Fn(&Component) -> EmittedValue,
) -> Option<PlanStack<'a>> {
    let (owner, value, message) = match picked.components.as_slice() {
        [] => return None,
        [single] => (single.rule, natural_value(single), rules[single.rule].label.clone()),
        several => {
            let (owner, message) = labels.borrow_mut().of(rules, several);
            (owner, EmittedValue::FixedTotal(picked.total), Cow::Borrowed(message))
        }
    };
    Some(PlanStack { components: picked.components, amount: picked.total, owner, value, message })
}

/// What a rule gives a line in the product stage (`product_amount`), read once
/// per rule: the plan's candidate loop looks at a dozen rules on every line.
#[derive(Clone, Copy)]
enum ProductValue {
    /// Not an eligible product rule.
    Out,
    Percent(f64),
    Fixed(i64),
    Nothing,
}

impl ProductValue {
    fn of(rule: &Rule) -> Self {
        if rule.cls != DiscountClass::Product || rule.state.is_some() {
            return Self::Out;
        }
        match (rule.value_kind, rule.fixed) {
            (ValueKind::Percentage, _) => Self::Percent(rule.percent),
            (ValueKind::Fixed, Some(fixed)) => Self::Fixed(fixed),
            _ => Self::Nothing,
        }
    }

    /// `product_amount`; none for a rule out of the product stage.
    #[inline]
    fn amount(self, line: &NormalizedLine) -> Option<i64> {
        match self {
            Self::Out => None,
            Self::Percent(p) => Some(js::round((line.subtotal as f64 * p) / 100.0) as i64),
            Self::Fixed(fixed) => Some(mul_sat(fixed.min(line.unit_price), line.quantity)),
            Self::Nothing => Some(0),
        }
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
    /// `rules[first_tier..]` are the tier sets' pseudo-rules (MVP 3), payload order.
    first_tier: usize,
    /// (rule, tier pseudo-rule) for every rule whose id is a tier candidate's
    /// `tier:<setId>` (`tier_shadows`; none the sanitizer lets through).
    shadows: &'c [(usize, usize)],
    partners: &'c Partners,
    any_partners: bool,
    cart: &'c NormalizedCart<'a>,
    labels: RefCell<StackLabels>,
}

/// The rules plan.ts finds under another rule's id: it looks rules up by id in a
/// map where a tier set's pseudo-rule `tier:<setId>` replaces a rule of that id
/// (plan.ts `byId`; `:` is no id character the sanitizer allows, so only a
/// hand-made payload has one). Such a rule is then never a product candidate
/// (`plan_products`), and margin protection's order stage counts it as the tier
/// (0 %, `protect_order`): never more than plan.ts. (rule, tier pseudo-rule)
/// pairs; looked up by the set id (`SetIndex`), only for ids with the prefix.
fn tier_shadows(rules: &[Rule], first_tier: usize, sets: &[TierSet]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    if first_tier == rules.len() {
        return out;
    }
    let mut index: Option<SetIndex> = None;
    for (i, rule) in rules[..first_tier].iter().enumerate() {
        let Some(set_id) = rule.id.strip_prefix("tier:") else { continue };
        let index = index.get_or_insert_with(|| SetIndex::of(sets));
        if let Some(set) = index.get(sets, set_id) {
            out.push((i, first_tier + set));
        }
    }
    out
}

impl StackContext<'_, '_> {
    /// The rule plan.ts's rule map gives for rule `i`'s id (`tier_shadows`).
    #[inline]
    fn in_rule_map(&self, i: usize) -> usize {
        self.shadows.iter().find(|&&(rule, _)| rule == i).map_or(i, |&(_, tier)| tier)
    }
}

// --- Stage: product discounts --------------------------------------------------------------------

/// `tiers`: each line's quantity-tier candidate (`w.tier`, engine/tiers.rs), empty without tier sets.
fn plan_products<'a>(work: &mut [WorkLine<'a>], tiers: &[Option<TierCandidate>], ctx: &StackContext<'_, 'a>) {
    let rules = ctx.rules;
    let mut values: Vec<ProductValue> = rules[..ctx.first_tier].iter().map(ProductValue::of).collect();
    // A rule plan.ts finds as a tier's pseudo-rule is never a product candidate (`tier_shadows`).
    for &(i, _) in ctx.shadows {
        values[i] = ProductValue::Out;
    }
    let mut positive: Vec<Component> = Vec::new();
    for (at, (w, line)) in work.iter_mut().zip(&ctx.cart.lines).enumerate() {
        let tier = tiers.get(at).and_then(Option::as_ref);
        if w.excluded.is_some() || (w.rule_set.is_empty() && tier.is_none()) {
            continue;
        }
        positive.clear();
        // (A sale line that takes no product discounts keeps only its tier.)
        if w.no & 2 == 0 {
            for &i in &w.rule_set {
                if let Some(amount) = values[i].amount(line) {
                    if amount > 0 {
                        positive.push(Component { rule: i, amount });
                    }
                }
            }
        }
        // The line's quantity tier: one more candidate, with its own value and message.
        let tier = tier.map(|t| (Component { rule: ctx.first_tier + t.set, amount: t.amount }, t));
        if positive.is_empty() && tier.is_none() {
            continue;
        }
        let unit_price = line.unit_price;
        let picked = pick(ctx, &mut positive, tier.map(|(c, _)| c), line.subtotal);
        w.product = build_stack(
            rules,
            &ctx.labels,
            picked,
            |single| {
                if let Some((_, t)) = tier.filter(|(c, _)| c.rule == single.rule) {
                    return t.value.clone();
                }
                let rule = &rules[single.rule];
                if rule.value_kind == ValueKind::Percentage {
                    EmittedValue::Percent(rule.percent)
                } else {
                    EmittedValue::FixedPerItem(rule.fixed.unwrap_or(0).min(unit_price))
                }
            },
        );
        // A tier's message is the break it reached on this line.
        if let (Some(stack), Some((c, t))) = (w.product.as_mut(), tier) {
            if stack.components.len() == 1 && stack.owner == c.rule {
                stack.message = Cow::Borrowed(t.message);
            }
        }
    }
}

// --- Stage: margin protection, product discounts (MVP 2) ------------------------------------------

/// `floorUnit × quantity` (JS numbers; exact while below 2^53, as every real cart
/// is). A floor is at most 10^12 < 2^40, so below 2^23 items the i64 product
/// cannot overflow and needs no 128-bit overflow check (the instruction budget).
fn floor_total(floor_unit: i64, quantity: i64) -> i64 {
    if (0..1 << 23).contains(&quantity) {
        floor_unit * quantity
    } else {
        floor_unit.saturating_mul(quantity)
    }
}

/// `computeFloors`: the floor of every discountable line — its settings (the
/// strictest of its collections; with more than MAX_MARGIN_REFS refs the
/// payload's strictest setting, computed once), its cost in the cart currency,
/// its lowest item price.
fn compute_floors(work: &mut [WorkLine], margin: &MarginPayload, cart: &NormalizedCart) {
    // The cart's currency facts, once (costMinorUnits reads them per line).
    let costs = CostContext::new(cart.shop_to_cart_rate, &cart.currency, margin.cur.as_deref());
    // Without collection settings every line has the global ones: one FloorRule.
    let global = resolve_margin(margin, &[]);
    let global = FloorRule::new(global.min_margin_percent, global.max_discount_percent);
    // Lines of one product (and products with the same decisive collections)
    // share their refs: each distinct list is resolved once per run.
    let mut by_refs: Table<&[MarginRef], FloorRule> = Table::default();
    // A product listing more than MAX_MARGIN_REFS refs: the payload's strictest setting, once.
    let mut strictest: Option<FloorRule> = None;
    for (w, line) in work.iter_mut().zip(&cart.lines) {
        if w.excluded.is_some() {
            continue;
        }
        let rule = if line.margin_own.is_some() {
            // Its own setting over what its collections give it (rare lines: resolved as they come).
            let base = if line.margin_ref_count > MAX_MARGIN_REFS { strictest_margin(margin) } else { resolve_margin(margin, line.margin_refs) };
            let settings = apply_product_margin(base, line.margin_own);
            FloorRule::new(settings.min_margin_percent, settings.max_discount_percent)
        } else if line.margin_ref_count > MAX_MARGIN_REFS {
            *strictest.get_or_insert_with(|| {
                let settings = strictest_margin(margin);
                FloorRule::new(settings.min_margin_percent, settings.max_discount_percent)
            })
        } else if margin.col.is_empty() || line.margin_refs.is_empty() {
            global
        } else {
            *by_refs.get_or_insert_with(line.margin_refs, || {
                let settings = resolve_margin(margin, line.margin_refs);
                FloorRule::new(settings.min_margin_percent, settings.max_discount_percent)
            })
        };
        let cost = costs.cost_minor_units(line.unit_cost, line.unit_cost_currency);
        w.floor = Some(rule.floor_unit(line.unit_price, cost).0);
    }
}

/// `cutInRankOrder`: components (rank order) cut down to `total`, in rank order;
/// each keeps what fits in what is left, a component left with nothing is dropped.
fn cut_in_rank_order(components: &[Component], total: i64) -> Vec<Component> {
    let mut kept = Vec::with_capacity(components.len());
    let mut remaining = total;
    for c in components {
        let amount = c.amount.min(remaining);
        if amount > 0 {
            kept.push(Component { rule: c.rule, amount });
            remaining -= amount;
        }
    }
    kept
}

/// `restack`: a stack rebuilt from what margin protection left of it (non-empty):
/// owner (ownerOf) and message recomputed.
fn restack<'a>(rules: &[Rule<'a>], labels: &RefCell<StackLabels>, kept: Vec<Component>, value: EmittedValue) -> PlanStack<'a> {
    let amount = kept.iter().map(|c| c.amount).fold(0i64, i64::saturating_add);
    let (owner, message) = if kept.len() == 1 {
        (kept[0].rule, rules[kept[0].rule].label.clone())
    } else {
        let (owner, message) = labels.borrow_mut().of(rules, &kept);
        (owner, Cow::Borrowed(message))
    };
    PlanStack { components: kept, amount, owner, value, message }
}

/// `applyMarginProtection`: each line's product allocation (the winner stack
/// planProducts picked) at most its headroom = max(0, subtotal − floorUnit ×
/// quantity). A larger one is cut in rank order and emitted as that exact total;
/// no headroom → no product discount on the line. A lowered tier names its
/// break without a value (port spec step 7: never more than the line gets).
fn apply_margin_protection<'a>(work: &mut [WorkLine<'a>], tiers: &[Option<TierCandidate>], ctx: &StackContext<'_, 'a>) {
    for (at, (w, line)) in work.iter_mut().zip(&ctx.cart.lines).enumerate() {
        let (Some(stack), Some(floor)) = (w.product.as_mut(), w.floor) else { continue };
        let headroom = line.subtotal.saturating_sub(floor_total(floor, line.quantity)).max(0);
        if stack.amount <= headroom {
            continue;
        }
        w.margin_capped = true;
        if stack.components.len() == 1 && headroom > 0 {
            // One rule cut to the headroom: still its owner and its message (restack's result, in place).
            stack.components[0].amount = headroom;
            stack.amount = headroom;
            stack.value = EmittedValue::FixedTotal(headroom);
            if stack.components[0].rule >= ctx.first_tier {
                if let Some(t) = tiers.get(at).and_then(Option::as_ref) {
                    stack.message = Cow::Borrowed(t.capped_message);
                }
            }
            continue;
        }
        let kept = cut_in_rank_order(&stack.components, headroom);
        w.product = if kept.is_empty() { None } else { Some(restack(ctx.rules, &ctx.labels, kept, EmittedValue::FixedTotal(headroom))) };
    }
}

// --- Stage: order discount ---------------------------------------------------------------------

/// A line that can carry an order discount under margin protection.
struct OrderLine {
    /// Cart position (`order_left` below).
    index: usize,
    line: OrderSetLine,
}

/// The winner of both orderings' searches, found without them when it is P = the
/// lines that can give something (h > 0) and P carries its whole wanted amount:
/// - a line with h = 0 has key 0 in both orderings, so it sorts last and every
///   set that contains it has D_max = 0; P is a prefix of both orderings, and
///   the one that ends where the key changes to 0 (or the full set);
/// - wanted(S) of an order discount never falls as S grows (a percent rounds a
///   larger S × p, a fixed amount is min(fixed, S)), so no prefix inside P has
///   a larger D than wanted(P), and P is the larger set on a tie; a set beyond P
///   has D = 0.
/// So when D(P) = wanted(P) > 0, P wins both orderings (the h/s one on the tie):
/// exactly what the search returns, in O(lines) and without sorting. D_max(P) is
/// the search's own (`order_set_limit`: exact, or its bound when more than 16
/// distinct lines tie for a base's minimum). Returns (D, S, wanted); none → search.
fn all_that_can_give(giving: &[OrderSetLine], wanted_at: &dyn Fn(i64) -> i64) -> Option<(i64, i64, i64)> {
    if giving.is_empty() {
        return None;
    }
    let base = giving.iter().map(|l| l.after).fold(0i64, i64::saturating_add);
    let wanted = wanted_at(base);
    if wanted <= 0 {
        return None;
    }
    // D_max(P) is either the minimum of every line's own value or, when more than
    // 16 distinct lines tie for a base's minimum rate m, the bound
    // floor((X × m) × SAFE_BELOW), never above that minimum. So: every line's own
    // value first (stopping at the first that cannot carry its share); if both
    // bases' bounds reach `wanted` too, D_max(P) does whichever it is; only
    // otherwise does `order_set_limit` decide which it is.
    let base_before = giving.iter().map(|l| l.before).fold(0i64, i64::saturating_add);
    let (s, s0, w) = (base as f64, base_before as f64, wanted as f64);
    let (mut least_after, mut least_before) = (f64::INFINITY, f64::INFINITY);
    for l in giving {
        let (h, a, b) = (l.headroom as f64, l.after as f64, l.before as f64);
        if ((h * s) / a).floor() < w || ((h * s0) / b).floor() < w {
            return None;
        }
        least_after = least_after.min(h / a);
        least_before = least_before.min(h / b);
    }
    let bounds_fit = ((s * least_after) * SAFE_BELOW).floor() >= w && ((s0 * least_before) * SAFE_BELOW).floor() >= w;
    (bounds_fit || giving.len() <= EXACT_LINES || order_set_limit(giving) >= w).then_some((wanted, base, wanted))
}

/// `protectOrder` (plan-margin.ts): the order discount made safe for BOTH
/// proportional allocations Shopify might use (after product discounts, a_i, and
/// before them, s_i), each line keeping 1 minor unit for rounding. For a set I
/// of lines, with S_I = Σ a_i and S0_I = Σ s_i:
///   D_max(I) = min over i ∈ I of min(floor(h_i × S_I / a_i), floor(h_i × S0_I / s_i)),
///   wanted(I) = min(Σ orderAmount(rule, S_I) over the stack's components, S_I),
///   D(I) = min(wanted(I), D_max(I)).
/// Candidate sets (`searchOrderSets`): the lines with a_i > 0 by k = h_i / s_i and
/// by k = h_i / a_i, each descending (ties: cart order), each prefix that ends
/// where k changes. The largest D wins, a tie the larger set, a tie again the
/// h/s ordering's; lines outside it are margin-excluded (`order_left`). Every
/// float expression is the TS one, in its order (D_max via `NearMin`: exact over
/// at most 16 lines tied for a base's minimum, a bound never above it beyond).
/// `after_products`: a_i is the line after its product discount (else its
/// subtotal: the exclusive order-only scenario).
fn protect_order<'a>(
    order: Option<PlanOrder<'a>>,
    work: &mut [WorkLine<'a>],
    after_products: bool,
    ctx: &StackContext<'_, 'a>,
) -> Option<PlanOrder<'a>> {
    let order = order?;
    let rules = ctx.rules;
    let mut lines: Vec<OrderLine> = Vec::with_capacity(work.len());
    for (index, (w, line)) in work.iter().zip(&ctx.cart.lines).enumerate() {
        let (None, Some(floor), 0) = (w.excluded, w.floor, w.no & 4) else { continue };
        let after = if after_products { line.subtotal - w.product.as_ref().map_or(0, |p| p.amount) } else { line.subtotal };
        if after <= 0 {
            continue;
        }
        let headroom = after.saturating_sub(floor_total(floor, line.quantity)).saturating_sub(1).max(0);
        lines.push(OrderLine { index, line: OrderSetLine { after, before: line.subtotal, headroom } });
    }

    // plan.ts finds the components' rules by id (`tier_shadows`).
    let components: Vec<Component> = order.stack.components.iter().map(|c| Component { rule: ctx.in_rule_map(c.rule), amount: c.amount }).collect();
    let wanted_at = |base: i64| -> i64 {
        let sum = components.iter().map(|c| order_amount(&rules[c.rule], base)).fold(0i64, i64::saturating_add);
        sum.min(base)
    };
    // Lines with h = 0 sort last in both orderings and zero every set that holds
    // them (D_max = 0): such a set never beats a positive D, and a best D of 0
    // means no order discount whatever the set. So only P = the lines with h > 0
    // are searched — the same prefixes, sums and D as the TS search over all.
    let giving: Vec<usize> = (0..lines.len()).filter(|&at| lines[at].line.headroom > 0).collect();
    let giving_lines: Vec<OrderSetLine> = giving.iter().map(|&at| lines[at].line).collect();
    // (D, S, wanted) of the winning set, and its members (positions in `giving`; none = all of them).
    let ((amount, best_base, best_wanted), members) = match all_that_can_give(&giving_lines, &wanted_at) {
        Some(best) => (best, None),
        None => {
            let search = search_order_sets(&giving_lines, &wanted_at);
            let best = search.best();
            ((best.amount, best.base, best.wanted), Some(best.members.clone()))
        }
    };
    if amount <= 0 {
        return None;
    }
    let size = members.as_ref().map_or(giving.len(), Vec::len);
    if size == lines.len() && amount == best_wanted {
        return Some(order); // nothing to protect
    }
    let mut in_set = vec![false; lines.len()];
    match &members {
        None => giving.iter().for_each(|&at| in_set[at] = true),
        Some(members) => members.iter().for_each(|&m| in_set[giving[m]] = true),
    }
    for (l, _) in lines.iter().zip(&in_set).filter(|(_, &kept)| !kept) {
        work[l.index].order_left = true;
    }
    // The components at the winning base, in their rank order, capped at it; then cut to D.
    let mut remaining = best_base;
    let at_base: Vec<Component> = components
        .iter()
        .map(|c| {
            let amount = order_amount(&rules[c.rule], best_base).min(remaining).max(0);
            remaining -= amount;
            Component { rule: c.rule, amount }
        })
        .collect();
    let kept = cut_in_rank_order(&at_base, amount);
    let value = if amount == best_wanted && kept.len() == 1 {
        let rule = &rules[kept[0].rule];
        if rule.value_kind == ValueKind::Percentage {
            EmittedValue::Percent(rule.percent)
        } else {
            EmittedValue::FixedTotal(kept[0].amount)
        }
    } else {
        EmittedValue::FixedTotal(amount)
    };
    let excluded_line_ids =
        work.iter().zip(&ctx.cart.lines).filter(|(w, _)| w.excluded.is_some() || w.no & 4 != 0 || w.order_left).map(|(_, line)| line.id).collect();
    Some(PlanOrder { stack: restack(rules, &ctx.labels, kept, value), base: best_base, excluded_line_ids, margin_protected: false })
}

/// `markTightLines` (plan-margin.ts), margin on, after the order stage: a line
/// with a product discount is tight when no minor unit is left above its floor
/// (subtotal − product − floorUnit × q < 1) or it is in the order discount's base
/// (discountable and not left out): a tie relaxed on any base line moves that base.
fn mark_tight_lines(work: &mut [WorkLine], cart: &NormalizedCart, has_order: bool) {
    for (w, line) in work.iter_mut().zip(&cart.lines) {
        let (Some(product), Some(floor)) = (w.product.as_ref(), w.floor) else { continue };
        let room = line.subtotal.saturating_sub(product.amount).saturating_sub(floor_total(floor, line.quantity));
        let in_order_base = has_order && w.excluded.is_none() && w.no & 4 == 0 && !w.order_left;
        w.margin_tight = room < 1 || in_order_base;
    }
}

fn plan_order_stage<'a>(
    work: &mut [WorkLine<'a>],
    engine: &EngineFlags,
    ctx: &StackContext<'_, 'a>,
    margin_on: bool,
) -> Option<PlanOrder<'a>> {
    let rules = ctx.rules;
    let order_rules: Vec<usize> =
        (0..rules.len()).filter(|&i| rules[i].cls == DiscountClass::Order && rules[i].state.is_none()).collect();
    if order_rules.is_empty() && engine.product_with_order {
        return None;
    }
    let excluded_line_ids: Vec<&'a str> =
        work.iter().zip(&ctx.cart.lines).filter(|(w, _)| w.excluded.is_some() || w.no & 4 != 0).map(|(_, line)| line.id).collect();
    let plan_at = |base: i64| -> Option<PlanOrder<'a>> {
        let mut positive: Vec<Component> = order_rules
            .iter()
            .map(|&i| Component { rule: i, amount: order_amount(&rules[i], base) })
            .filter(|c| c.amount > 0)
            .collect();
        if positive.is_empty() {
            return None;
        }
        let picked = pick(ctx, &mut positive, None, base);
        let stack = build_stack(
            rules,
            &ctx.labels,
            picked,
            |single| {
                if rules[single.rule].value_kind == ValueKind::Percentage {
                    EmittedValue::Percent(rules[single.rule].percent)
                } else {
                    EmittedValue::FixedTotal(single.amount)
                }
            },
        )?;
        Some(PlanOrder { stack, base, excluded_line_ids: excluded_line_ids.clone(), margin_protected: false })
    };
    let product_total = work.iter().map(|w| w.product.as_ref().map_or(0, |p| p.amount)).fold(0i64, i64::saturating_add);
    // A sale line that takes no order discount is out of its base, with whatever product discount it got.
    let in_base = |w: &WorkLine| w.excluded.is_none() && w.no & 4 == 0;
    let base_product_total =
        work.iter().filter(|w| in_base(w)).map(|w| w.product.as_ref().map_or(0, |p| p.amount)).fold(0i64, i64::saturating_add);
    let discountable_subtotal =
        work.iter().zip(&ctx.cart.lines).filter(|(w, _)| in_base(w)).map(|(_, l)| l.subtotal).fold(0i64, i64::saturating_add);
    // [spec] The order discount is taken from the subtotal AFTER product discounts.
    if engine.product_with_order {
        let order = plan_at(discountable_subtotal - base_product_total);
        if !margin_on {
            return order;
        }
        return protect_order(order, work, true, ctx);
    }
    // Exclusive (Free switch off): the better scenario for the customer wins, a tie
    // keeps products. Margin on: the order-only scenario is protected too, on the
    // lines' full subtotals.
    let mut order_only = plan_at(discountable_subtotal);
    if margin_on {
        order_only = protect_order(order_only, work, false, ctx);
    }
    let order_wins = order_only.as_ref().is_some_and(|o| o.stack.amount > product_total);
    if order_wins {
        for w in work.iter_mut() {
            w.product = None;
            w.margin_capped = false;
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
/// The shipping winner: a rule, or the free-shipping reward (MVP 4, R2) —
/// whose pseudo-rule build_plan adds once the stacks are done.
enum ShipWinner {
    Rule(usize, ShippingValue),
    Reward,
}

/// `reward:shipping` as it ranks among the shipping rules: priority 0, its id.
const SHIPPING_REWARD_ID: &str = "reward:shipping";

fn plan_shipping(work: &[WorkLine<'_>], order: Option<&PlanOrder<'_>>, engine: &EngineFlags, ctx: &StackContext<'_, '_>, reward: bool) -> Option<ShipWinner> {
    let rules = ctx.rules;
    struct Candidate {
        /// None = the reward (100 %).
        rule: Option<usize>,
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
            candidates.push(Candidate { rule: Some(i), value, key });
        }
    }
    if reward {
        candidates.push(Candidate { rule: None, value: ShippingValue::Percent(100.0), key: (1.0, 100.0) });
    }
    // The first in (key desc, priority desc, id asc) order: keys are finite (a
    // percent or an amount), and rule orders unique, so there is one first.
    let rank = |c: &Candidate| c.rule.map_or((0, SHIPPING_REWARD_ID), |i| (rules[i].priority, rules[i].id));
    let before = |a: &Candidate, b: &Candidate| {
        let ((pa, ia), (pb, ib)) = (rank(a), rank(b));
        b.key
            .0
            .partial_cmp(&a.key.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.key.1.partial_cmp(&a.key.1).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| match (a.rule, b.rule) {
                (Some(x), Some(y)) => rules[x].order.cmp(&rules[y].order),
                _ => pb.cmp(&pa).then_with(|| js::cmp_str(ia, ib)),
            })
            .is_lt()
    };
    let winner = candidates.into_iter().reduce(|best, c| if before(&c, &best) { c } else { best })?;
    let blocked = (!engine.product_with_shipping && work.iter().any(|w| w.product.is_some()))
        || (!engine.order_with_shipping && order.is_some());
    if blocked {
        return None;
    }
    Some(match winner.rule {
        Some(i) => ShipWinner::Rule(i, winner.value),
        None => ShipWinner::Reward,
    })
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
                margin_capped: false,
                margin_tight: false,
            })
            .collect(),
        order: None,
        shipping: None,
    }
}

/// A tier set's pseudo-rule (plan-tiers.ts `tierRule`): `tier:<setId>`,
/// automatic, priority 0, never in a Pro stack; named as a rule would be where
/// a stack lists its rules (a tier's own message is its break's).
fn tier_rule<'a>(set: &'a TierSet, en: bool) -> Rule<'a> {
    pseudo_rule(&set.rule_id, if en { "Quantity discount" } else { "Množstevní sleva" }, DiscountClass::Product)
}

/// An automatic, priority-0 rule no customer or merchant wrote: a tier set's
/// (MVP 3) or a reward's (MVP 4: `reward:shipping`, `gift:<tierId>`).
fn pseudo_rule<'a>(id: &'a str, label: &'static str, cls: DiscountClass) -> Rule<'a> {
    Rule {
        id,
        label: Cow::Borrowed(label),
        method_code: false,
        enabled: true,
        cls,
        value_kind: ValueKind::Percentage,
        percent: 0.0,
        fixed: None,
        priority: 0,
        code_hashes: &[],
        min_subtotal: None,
        min_subtotal_missing: false,
        min_quantity: 0,
        min_entitled: false,
        scheduled: false,
        schedule_invalid: false,
        starts_on: None,
        ends_on: None,
        markets: None,
        segment_targeted: false,
        combines: &[],
        state: None,
        order: 0,
    }
}

fn build_plan<'a>(cart: NormalizedCart<'a>, config: &'a Config) -> CartPlan<'a> {
    let engine = config.engine;
    let Resolved { campaign_id, mut rules, retargeted } = resolve_rules(config, &cart);
    // The tier sets' pseudo-rules after the rules (campaign overrides never reach
    // them): they rank with the rules (priority desc, id asc).
    let first_tier = rules.len();
    rules.extend(config.tiers.sets.iter().map(|set| tier_rule(set, cart.locale_en)));
    rank_ids(&mut rules);
    let entered_by_rule = match_codes(&rules, &cart, config.max_code_length);

    // Refs and combinesWith name rules only (plan.ts `rulesById`, `partnersOf`).
    let mut by_id: IdMap = Table::with_capacity(first_tier);
    for (i, r) in rules[..first_tier].iter().enumerate() {
        by_id.insert(Text(r.id), i);
    }
    let id_has_at: Vec<bool> = rules[..first_tier].iter().map(|r| r.id.contains('@')).collect();
    let refs = RuleRefs {
        by_id: &by_id,
        campaign_id,
        retargeted: &retargeted,
        id_has_at: &id_has_at,
        plain: id_has_at.iter().zip(&retargeted).map(|(&at, &retargeted)| !at && !retargeted).collect(),
    };
    // Per-item minimum: the lines some ref of which named no rule as it is (`collect_item_refs`), and whether the last line was one.
    let mut looks: Vec<u32> = Vec::new();
    let mut look = false;
    let mut seen = Seen::new(rules.len());
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
        // The lines of one product list the same refs: refs equal to the previous
        // line's (compared text by text, a word at a time) are not looked up again.
        let at = work.len();
        let rule_set = match work.last() {
            // (Not after a line to look at again: this one's refs are then read one by one, to be looked at too.)
            Some(before) if !look && cart.lines[at - 1].same_refs(line) => before.rule_set.clone(),
            _ => {
                let rule_set = line_rule_ids(&refs, line.rule_ids, line.variant_rule_ids, &mut seen);
                // Some ref named no rule as it is: it may be an item ref (per-item minimum).
                look = rule_set.len() != line.rule_ids.len() + line.variant_rule_ids.len();
                if look {
                    looks.push(at as u32);
                }
                rule_set
            }
        };
        // A line out of every class (7: a gift card) stays out even when sales combine with anything.
        let no = if line.gift || (engine.outlet_with_anything && line.outlet_no != 7) { 0 } else { line.outlet_no };
        if excluded != Some(Excluded::Gift) {
            let discountable = excluded.is_none();
            cart_scope.add(line, discountable);
            for &i in &rule_set {
                // A sale line that takes no product discounts gives a product rule nothing to discount.
                rule_scopes[i].add(line, discountable && !(no & 2 != 0 && rules[i].cls == DiscountClass::Product));
            }
        }
        work.push(WorkLine {
            excluded,
            no,
            rule_set,
            product: None,
            floor: None,
            margin_capped: false,
            order_left: false,
            margin_tight: false,
        });
    }
    // Per-item minimum quantities: the item refs of the lines to look at again (none in nearly every cart).
    // (Slices and values only: nothing the lines' loop keeps in registers is handed over by reference.)
    let mut items = if looks.is_empty() {
        Vec::new()
    } else {
        collect_item_refs(&rules[..first_tier], retargeted.as_slice(), campaign_id, cart.lines.as_slice(), work.as_mut_slice(), looks.as_slice(), rule_scopes.as_mut_slice())
    };
    // The rules only: a tier never stacks (no rule can list it), and sizing the
    // partner bits by the rules keeps the one-word stack search up to 64 rules.
    let partners = partners_of(&rules[..first_tier], &by_id);
    drop(by_id);

    let markets_here = markets_here(&cart, &config.market_countries);
    for (i, rule) in rules[..first_tier].iter_mut().enumerate() {
        let target_scope = if rule.cls == DiscountClass::Product { rule_scopes[i] } else { cart_scope };
        rule.state = gate(rule, &cart, &markets_here, &cart_scope, &target_scope, !entered_by_rule[i].is_empty());
    }
    // Per-item minimum quantities: only a cart with an item ref.
    if !items.is_empty() {
        apply_item_minimums(&mut rules[..first_tier], work.as_mut_slice(), cart.lines.as_slice(), items.as_mut_slice(), cart_scope, rule_scopes.as_slice());
    }
    drop(items);

    // Quantity tiers (MVP 3): each line's candidate, from the sets as shipped.
    let tiers = prepare_tiers(&config.tiers, &cart.lines, &cart.tiers, |i| work[i].excluded.is_none() && work[i].no & 1 == 0, &cart.currency, !cart.locale_en);

    let any_partners = !partners.bits.is_empty();
    let shadows = tier_shadows(&rules, first_tier, &config.tiers.sets);
    let ctx = StackContext { rules: &rules, first_tier, shadows: &shadows, partners: &partners, any_partners, cart: &cart, labels: RefCell::default() };
    plan_products(&mut work, &tiers, &ctx);
    // Margin protection (MVP 2, A1.7): off by default, then the plan is MVP 1's.
    if let Some(margin) = config.margin.as_ref() {
        compute_floors(&mut work, margin, &cart);
        apply_margin_protection(&mut work, &tiers, &ctx);
    }
    let mut order = plan_order_stage(&mut work, &engine, &ctx, config.margin.is_some());
    if config.margin.is_some() {
        if let Some(order) = order.as_mut() {
            order.margin_protected = true;
        }
        mark_tight_lines(&mut work, &cart, order.is_some());
    }
    // Rewards (MVP 4): the base is the non-gift lines before every discount (R1, `cart_scope`).
    let base = cart_scope.subtotal;
    let currency = cart.currency.as_str();
    let rewards = &config.rewards;
    let reward = threshold_in(&rewards.shipping, currency).is_some_and(|t| base >= t);
    let winner = plan_shipping(&work, order.as_ref(), &engine, &ctx, reward);
    drop(ctx);
    let en = cart.locale_en;
    let shipping = winner.map(|w| match w {
        ShipWinner::Rule(i, value) => PlanShipping { rule: i, value, message: rules[i].label.clone() },
        ShipWinner::Reward => {
            let label = if en { "Free shipping" } else { "Doprava zdarma" };
            rules.push(pseudo_rule(SHIPPING_REWARD_ID, label, DiscountClass::Shipping));
            PlanShipping { rule: rules.len() - 1, value: ShippingValue::Percent(100.0), message: Cow::Borrowed(label) }
        }
    });
    // R3: one item of the first valid gift line of each reached tier is free.
    if !rewards.tiers.is_empty() {
        let label = if en { "Free gift" } else { "Dárek zdarma" };
        let mut given = vec![false; rewards.tiers.len()];
        for (w, line) in work.iter_mut().zip(&cart.lines) {
            let Some(t) = line.gift_tier.map(|t| t as usize) else { continue };
            let tier = &rewards.tiers[t];
            if given[t] || !threshold_in(&tier.threshold, currency).is_some_and(|threshold| base >= threshold) {
                continue;
            }
            given[t] = true;
            rules.push(pseudo_rule(&tier.rule_id, label, DiscountClass::Product));
            let owner = rules.len() - 1;
            let amount = line.unit_price;
            w.product = Some(PlanStack {
                components: vec![Component { rule: owner, amount }],
                amount,
                owner,
                value: EmittedValue::FixedTotal(amount),
                message: Cow::Borrowed(label),
            });
        }
    }

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
            margin_capped: w.margin_capped,
            margin_tight: w.margin_tight,
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

#[cfg(test)]
mod search_tests {
    use super::*;

    /// A seeded xorshift (no dependencies in this crate).
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    fn partners(rules: usize, links: &[(usize, usize)]) -> Partners {
        let words = rules.div_ceil(64);
        let mut out = Partners { lists: vec![Vec::new(); rules], bits: vec![0; rules * words], words };
        for &(a, b) in links {
            if a != b && !out.lists[a].contains(&b) {
                out.lists[a].push(b);
                out.lists[b].push(a);
                out.bits[a * words + b / 64] |= 1 << (b % 64);
                out.bits[b * words + a / 64] |= 1 << (a % 64);
            }
        }
        out
    }

    /// plan.ts `pick` as written there: sort every candidate by `by_rank`, keep
    /// the MAX_STACK_CANDIDATES first, greedy from every linked seed in rank order
    /// (a seed already in a set is skipped, a set of one is no set), the largest
    /// capped sum wins (a tie keeps the earlier seed's), then each chosen amount
    /// capped at what is left of `cap`.
    /// With a quantity tier (MVP 3, fix round 2 of plan.ts): the tier takes no
    /// place in the pool — the MAX_STACK_CANDIDATES best-ranked RULE candidates —
    /// and the search starts from the best single candidate, the tier included.
    fn reference_pick(rules: &[Rule], positive: &[Component], tier: Option<Component>, cap: i64, p: &Partners) -> (Vec<Component>, i64) {
        let mut sorted: Vec<Component> = positive.iter().copied().chain(tier).collect();
        sorted.sort_by(|a, b| by_rank(rules, a, b));
        let stackable: Vec<Component> = sorted.iter().copied().filter(|c| tier.is_none_or(|t| t.rule != c.rule)).collect();
        let pool = &stackable[..stackable.len().min(MAX_STACK_CANDIDATES)];
        let mut chosen = vec![sorted[0]];
        let mut best_total = cap.min(sorted[0].amount);
        let mut covered: Vec<usize> = Vec::new();
        for seed in pool {
            if !p.has_any(seed.rule) || covered.contains(&seed.rule) {
                continue;
            }
            let mut set = vec![*seed];
            for c in pool {
                if c.rule != seed.rule && p.stack(seed.rule, c.rule) && set.iter().all(|s| s.rule == seed.rule || p.stack(s.rule, c.rule)) {
                    set.push(*c);
                }
            }
            if set.len() == 1 {
                continue;
            }
            covered.extend(set.iter().map(|c| c.rule));
            set.sort_by(|a, b| by_rank(rules, a, b));
            let total = cap.min(set.iter().map(|c| c.amount).fold(0i64, i64::saturating_add));
            if total > best_total {
                best_total = total;
                chosen = set;
            }
        }
        let mut remaining = cap;
        let mut out = Vec::new();
        for c in chosen {
            let amount = c.amount.min(remaining);
            if amount <= 0 {
                continue;
            }
            out.push(Component { rule: c.rule, amount });
            remaining -= amount;
        }
        (out, cap - remaining)
    }

    #[test]
    fn a_stack_is_searched_among_the_six_best_ranked_candidates_like_plan_ts() {
        // Random partner graphs (none, sparse, pairs, dense, a full mesh) over up to
        // 130 rules (one and more partner words a rule), a target's distinct
        // candidates in any order (up to 24: past the cap), equal and distinct
        // amounts, priorities that tie, and caps below, between and above the sums.
        // Half the cases add a quantity tier (MVP 3) after the rules — its own draws
        // (`trng`), so the rule cases stay the ones before — with the partner bits
        // over the rules only, as the plan builds them: 64 rules + a tier keep the
        // one-word search.
        let ids: Vec<&'static str> = (0..130).map(|k| &*Box::leak(format!("r{k:03}").into_boxed_str())).collect();
        let tier_ids = ["tier:a", "tier:r032", "tier:zz", "r032", "s"];
        let mut rng = Rng(0x5EED_2026_0930);
        let mut trng = Rng(0x7135_2026_1001);
        let cart = super::super::cart::normalize_cart(CartInput::default());
        let (mut stacked, mut past_cap, mut left_out) = (0, 0, 0);
        let (mut tier_wins, mut stack_beats_tier, mut tier_tops_a_full_pool) = (0, 0, 0);
        for case in 0..20_000 {
            let count = [4, 9, 20, 64, 65, 130][case % 6];
            let mut rules: Vec<Rule> = ids[..count].iter().map(|&id| rule(id, [0, 0, 0, 3, 9][rng.below(5) as usize])).collect();
            let with_tier = trng.below(2) == 0;
            if with_tier {
                rules.push(rule(tier_ids[trng.below(5) as usize], 0));
            }
            rank_ids(&mut rules);
            let density = [0, 5, 20, 50, 90, 100][rng.below(6) as usize];
            let mut links = Vec::new();
            for a in 0..count {
                for b in a + 1..count {
                    if rng.below(100) < density {
                        links.push((a, b));
                    }
                }
            }
            let p = partners(count, &links);
            let mut pool: Vec<usize> = (0..count).collect();
            let n = 1 + rng.below(count.min(24) as u64) as usize;
            let positive: Vec<Component> = (0..n)
                .map(|_| {
                    let rule = pool.swap_remove(rng.below(pool.len() as u64) as usize);
                    let amount = if rng.below(4) == 0 { 500 } else { 1 + rng.below(2_000) as i64 };
                    Component { rule, amount }
                })
                .collect();
            let sum: i64 = positive.iter().map(|c| c.amount).sum();
            let cap = [sum / 3, sum / 2, sum, sum * 2, 1, i64::MAX][rng.below(6) as usize].max(1);
            let tier = with_tier.then(|| {
                let amount = match trng.below(4) {
                    0 => positive[trng.below(n as u64) as usize].amount,
                    1 => 500,
                    2 => 1 + trng.below(4_000) as i64,
                    _ => sum / 2 + 1,
                };
                Component { rule: count, amount: amount.max(1) }
            });
            let ctx = StackContext {
                rules: &rules,
                first_tier: count,
                shadows: &[],
                partners: &p,
                any_partners: !links.is_empty(),
                cart: &cart,
                labels: RefCell::default(),
            };
            let mut got = positive.clone();
            let picked = pick(&ctx, &mut got, tier, cap);
            let (expected, total) = reference_pick(&rules, &positive, tier, cap, &p);
            assert_eq!((&picked.components, picked.total), (&expected, total), "case {case}");
            if let Some(t) = tier {
                let won = expected.len() == 1 && expected[0].rule == t.rule;
                tier_wins += usize::from(won);
                stack_beats_tier += usize::from(expected.len() > 1);
                // The tier ranks in the 6 best of the line and the rules still fill the pool.
                let mut all = positive.clone();
                all.push(t);
                all.sort_by(|a, b| by_rank(&rules, a, b));
                tier_tops_a_full_pool += usize::from(
                    expected.len() > 1 && n >= MAX_STACK_CANDIDATES && all[..MAX_STACK_CANDIDATES].iter().any(|c| c.rule == t.rule),
                );
                continue;
            }
            stacked += usize::from(expected.len() > 1);
            past_cap += usize::from(expected.len() > 1 && n > MAX_STACK_CANDIDATES);
            // A partner of every member ranked below the cap: left out only by it.
            let mut sorted = positive.clone();
            sorted.sort_by(|a, b| by_rank(&rules, a, b));
            left_out += usize::from(
                expected.len() > 1
                    && sorted[MAX_STACK_CANDIDATES.min(n)..].iter().any(|c| expected.iter().all(|m| p.stack(m.rule, c.rule))),
            );
            // best_ranked: the sorted prefix, and a permutation of the list.
            let mut list = positive.clone();
            let k = 1 + rng.below(8) as usize;
            let front = best_ranked(&rules, &mut list, k).to_vec();
            assert_eq!(front, sorted[..k.min(n)], "case {case}");
            list.sort_by(|a, b| by_rank(&rules, a, b));
            assert_eq!(list, sorted, "case {case}");
        }
        assert!(stacked > 2_500 && past_cap > 500 && left_out > 250, "stacks {stacked}, past the cap {past_cap}, a partner left out {left_out}");
        assert!(
            tier_wins > 1_000 && stack_beats_tier > 1_000 && tier_tops_a_full_pool > 200,
            "tier wins {tier_wins}, a stack beats the tier {stack_beats_tier}, the tier in the 6 best of a full pool {tier_tops_a_full_pool}"
        );
    }

    fn rule(id: &'static str, priority: i64) -> Rule<'static> {
        Rule {
            id,
            label: Cow::Borrowed(id),
            method_code: false,
            enabled: true,
            cls: DiscountClass::Product,
            value_kind: ValueKind::Percentage,
            percent: 10.0,
            fixed: None,
            priority,
            code_hashes: &[],
            min_subtotal: None,
            min_subtotal_missing: false,
            min_quantity: 0,
            min_entitled: false,
            scheduled: false,
            schedule_invalid: false,
            starts_on: None,
            ends_on: None,
            markets: None,
            segment_targeted: false,
            combines: &[],
            state: None,
            order: 0,
        }
    }

    #[test]
    fn rank_ids_is_the_stable_sort_by_priority_then_id() {
        // The insertion by halving vs core's stable `sort_by` with the same comparator: priorities that tie,
        // ids that repeat (equal rules keep their config order), ids of every script, 0 to 200 rules.
        let names = ["r_", "a", "Z", "é", "", "r_1", "ž"];
        let ids: Vec<&'static str> = (0..200).map(|k| &*Box::leak(format!("{}{}", names[k % 7], k % 23).into_boxed_str())).collect();
        let mut rng = Rng(0x2026_1008_5EED);
        for case in 0..4_000 {
            let n = [0, 1, 2, 3, 17, 64, 200][case % 7];
            let mut rules: Vec<Rule> = (0..n).map(|_| rule(ids[rng.below(200) as usize], [0, 0, 5, -3, 1000][rng.below(5) as usize])).collect();
            let mut expected: Vec<usize> = (0..n).collect();
            expected.sort_by(|&a, &b| rules[b].priority.cmp(&rules[a].priority).then_with(|| js::cmp_str(rules[a].id, rules[b].id)));
            rank_ids(&mut rules);
            let mut got: Vec<usize> = (0..n).collect();
            got.sort_by_key(|&i| rules[i].order);
            assert_eq!(got, expected, "case {case}");
        }
    }

    #[test]
    fn the_rank_sort_is_the_comparator_sort() {
        // The insertion sort vs `sort_by(by_rank)`: amounts that tie (the priority
        // and then the id decide), differ, and are large; lists of every length up to 40.
        let ids: Vec<&'static str> =
            (0..70).map(|k| &*Box::leak(format!("{}{k}", ["r_", "a", "Z", "é", ""][k % 5]).into_boxed_str())).collect();
        let mut rng = Rng(0x0DE5_C0DE_2026);
        let mut rules: Vec<Rule> = ids.iter().map(|&id| rule(id, [0, 0, 5, -3, 1000][rng.below(5) as usize])).collect();
        rank_ids(&mut rules);
        for case in 0..20_000 {
            let n = 1 + rng.below(40) as usize;
            let mut pool: Vec<usize> = (0..rules.len()).collect();
            let list: Vec<Component> = (0..n)
                .map(|_| {
                    let rule = pool.swap_remove(rng.below(pool.len() as u64) as usize);
                    let amount = match rng.below(5) {
                        0 => 100,
                        1 => (1 << 42) - 1,
                        2 if case % 7 == 0 => 1 << 42,
                        _ => 1 + rng.below(300) as i64,
                    };
                    Component { rule, amount }
                })
                .collect();
            let mut expected = list.clone();
            expected.sort_by(|a, b| by_rank(&rules, a, b));
            // `order` is (priority desc, id asc in JS string order).
            let mut by_fields = list.clone();
            by_fields.sort_by(|a, b| {
                let (ra, rb) = (&rules[a.rule], &rules[b.rule]);
                b.amount.cmp(&a.amount).then(rb.priority.cmp(&ra.priority)).then(js::cmp_str(ra.id, rb.id))
            });
            assert_eq!(by_fields, expected, "case {case}");
            let mut got = list.clone();
            sort_by_rank(&rules, &mut got);
            assert_eq!(got, expected, "case {case}");
        }
    }
}
