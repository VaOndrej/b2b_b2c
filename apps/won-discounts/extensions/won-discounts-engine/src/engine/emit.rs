// emitForNode (emit.ts): every Won node computes the SAME plan and emits only
// the stacks it owns — the automatic node the stacks owned by automatic rules,
// a code node the stacks owned by its rule, and only when the triggering code
// is one of that rule's entered codes.

use super::hash::normalize_code;
use super::plan::{CartPlan, EmittedValue, ShippingValue};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeRole {
    Automatic,
    Code(String),
}

/// Candidates borrow from the plan (and through it from the function input).
#[derive(Debug, Clone, PartialEq)]
pub struct ProductCandidate<'p> {
    /// Index of the candidate's line in `CartPlan::lines`.
    pub line: usize,
    pub line_id: &'p str,
    pub rule_id: &'p str,
    pub message: &'p str,
    pub amount: i64,
    pub value: EmittedValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderCandidate<'p> {
    pub rule_id: &'p str,
    pub message: &'p str,
    pub amount: i64,
    /// Outlet and gift lines: the candidate's `orderSubtotal.excludedCartLineIds`.
    pub excluded_line_ids: &'p [&'p str],
    pub value: EmittedValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryCandidate<'p> {
    pub rule_id: &'p str,
    pub message: &'p str,
    pub value: ShippingValue,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct NodeEmission<'p> {
    pub product: Vec<ProductCandidate<'p>>,
    pub order: Vec<OrderCandidate<'p>>,
    pub delivery: Vec<DeliveryCandidate<'p>>,
}

pub fn emit_for_node<'p>(plan: &'p CartPlan<'_>, role: &NodeRole, triggering_code: Option<&str>) -> NodeEmission<'p> {
    let mut out = NodeEmission::default();
    if plan.reason.is_some() {
        return out;
    }
    let rules = &plan.rules;
    let owned_by: Option<usize> = match role {
        NodeRole::Automatic => None,
        NodeRole::Code(rule_id) => {
            let trigger = triggering_code.map(normalize_code).unwrap_or_default();
            let Some(i) = plan.rule_index(rule_id) else { return out };
            if trigger.is_empty() || !rules[i].method_code || !plan.rule_has_code(i, &trigger) {
                return out;
            }
            Some(i)
        }
    };
    // Automatic: stacks whose owner is an automatic rule; code: stacks owned by this rule.
    let owns = |owner: usize| match owned_by {
        None => !rules[owner].method_code,
        Some(i) => owner == i,
    };

    for (index, line) in plan.lines.iter().enumerate() {
        let Some(stack) = line.product.as_ref().filter(|s| owns(s.owner)) else { continue };
        out.product.push(ProductCandidate {
            line: index,
            line_id: line.line_id,
            rule_id: rules[stack.owner].id,
            message: &stack.message,
            amount: stack.amount,
            value: stack.value.clone(),
        });
    }
    if let Some(order) = plan.order.as_ref().filter(|o| owns(o.stack.owner)) {
        out.order.push(OrderCandidate {
            rule_id: rules[order.stack.owner].id,
            message: &order.stack.message,
            amount: order.stack.amount,
            excluded_line_ids: &order.excluded_line_ids,
            value: order.stack.value.clone(),
        });
    }
    if let Some(shipping) = plan.shipping.as_ref().filter(|s| owns(s.rule)) {
        out.delivery.push(DeliveryCandidate {
            rule_id: rules[shipping.rule].id,
            message: &shipping.message,
            value: shipping.value.clone(),
        });
    }
    out
}
