// The function output (tests/reference-adapter.js toCartLinesResult /
// toDeliveryResult), written through the Wasm API directly instead of the
// generated output types: the generated `Decimal` serializes as a string
// ("10.0") while the TS reference emits a JSON number (10), and the fixtures
// are the parity oracle. Keys are written in the reference's order; every
// object/array length is computed from the same data it writes.

use shopify_function::wasm_api::{write::Error, Context, Serialize};

use crate::engine::emit::NodeEmission;
use crate::engine::js;
use crate::engine::money::from_minor_units;
use crate::engine::plan::{EmittedValue, ShippingValue};

#[derive(Debug, Clone, PartialEq)]
pub enum ProductValue {
    Percentage(f64),
    FixedAmount { amount: String, applies_to_each_item: bool },
}

/// Order and delivery values (no per-item variant).
#[derive(Debug, Clone, PartialEq)]
pub enum TotalValue {
    Percentage(f64),
    FixedAmount(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProductCandidateOut {
    pub message: String,
    /// Cart line ids.
    pub targets: Vec<String>,
    pub value: ProductValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderCandidateOut {
    pub message: String,
    pub excluded_cart_line_ids: Vec<String>,
    pub value: TotalValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryCandidateOut {
    pub message: String,
    /// Delivery group ids.
    pub targets: Vec<String>,
    pub value: TotalValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CartOperation {
    /// `selectionStrategy: ALL`: every candidate targets other lines (≤ 1 product allocation per line).
    ProductDiscountsAdd(Vec<ProductCandidateOut>),
    /// `selectionStrategy: FIRST`.
    OrderDiscountsAdd(Vec<OrderCandidateOut>),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CartLinesResult {
    pub operations: Vec<CartOperation>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DeliveryResult {
    /// One `deliveryDiscountsAdd` (`selectionStrategy: ALL`) when there are candidates.
    pub candidates: Vec<DeliveryCandidateOut>,
}

// --- Emission → output (the reference adapter's mapping) -----------------------------------

/// Product candidates, one per line from the engine; lines with the same rule,
/// message and per-line value (percent / fixed per item) share ONE candidate with
/// several targets (a much smaller output for big carts). A fixed total (Pro
/// stack) stays per line: it is a total for exactly that line.
///
/// The reference groups by the text key `${ruleId}\n${message}\np${percent}` (or
/// `\ne${fixedPerItem}`). While no rule id contains a line break (the sanitizer
/// allows `[A-Za-z0-9_-]` only) that key is equal exactly when (rule id,
/// message, value kind, value) are, which is compared here without building text.
fn product_candidates(emission: &NodeEmission, currency: &str) -> Vec<ProductCandidateOut> {
    let mut out: Vec<ProductCandidateOut> = Vec::new();
    // Per shared candidate: its index in `out` and the emission entry it was made from.
    let mut shared: Vec<(usize, usize)> = Vec::new();
    let text_keys = emission.product.iter().any(|c| c.rule_id.contains('\n'));
    for (ci, c) in emission.product.iter().enumerate() {
        let groupable = !matches!(c.value, EmittedValue::FixedTotal(_));
        if groupable {
            let found = shared.iter().find(|(_, first)| {
                let f = &emission.product[*first];
                if text_keys {
                    group_key(f) == group_key(c)
                } else {
                    f.value == c.value && f.rule_id == c.rule_id && f.message == c.message
                }
            });
            if let Some(&(index, _)) = found {
                out[index].targets.push(c.line_id.to_string());
                continue;
            }
            shared.push((out.len(), ci));
        }
        let value = match c.value {
            EmittedValue::Percent(p) => ProductValue::Percentage(p),
            EmittedValue::FixedPerItem(amount) => {
                ProductValue::FixedAmount { amount: from_minor_units(amount, currency), applies_to_each_item: true }
            }
            EmittedValue::FixedTotal(amount) => {
                ProductValue::FixedAmount { amount: from_minor_units(amount, currency), applies_to_each_item: false }
            }
        };
        out.push(ProductCandidateOut { message: c.message.to_string(), targets: vec![c.line_id.to_string()], value });
    }
    out
}

/// The reference's grouping text key (only used when a rule id contains a line break).
fn group_key(c: &crate::engine::emit::ProductCandidate) -> String {
    match c.value {
        EmittedValue::Percent(p) => format!("{}\n{}\np{}", c.rule_id, c.message, js::number_to_string(p)),
        EmittedValue::FixedPerItem(amount) => format!("{}\n{}\ne{}", c.rule_id, c.message, amount),
        EmittedValue::FixedTotal(_) => String::new(),
    }
}

fn total_value(value: &EmittedValue, currency: &str) -> Option<TotalValue> {
    match value {
        EmittedValue::Percent(p) => Some(TotalValue::Percentage(*p)),
        EmittedValue::FixedTotal(amount) => Some(TotalValue::FixedAmount(from_minor_units(*amount, currency))),
        EmittedValue::FixedPerItem(_) => None,
    }
}

/// `cart.lines.discounts.generate.run` output: only the classes the node has.
pub fn cart_lines_result(emission: &NodeEmission, product: bool, order: bool, currency: &str) -> CartLinesResult {
    let mut operations = Vec::new();
    if product {
        let candidates = product_candidates(emission, currency);
        if !candidates.is_empty() {
            operations.push(CartOperation::ProductDiscountsAdd(candidates));
        }
    }
    if order {
        let candidates: Vec<OrderCandidateOut> = emission
            .order
            .iter()
            .filter_map(|c| {
                Some(OrderCandidateOut {
                    message: c.message.to_string(),
                    excluded_cart_line_ids: c.excluded_line_ids.iter().map(|id| id.to_string()).collect(),
                    value: total_value(&c.value, currency)?,
                })
            })
            .collect();
        if !candidates.is_empty() {
            operations.push(CartOperation::OrderDiscountsAdd(candidates));
        }
    }
    CartLinesResult { operations }
}

/// `cart.delivery-options.discounts.generate.run` output: the shipping winner on every delivery group.
pub fn delivery_result(emission: &NodeEmission, shipping: bool, group_ids: &[String], currency: &str) -> DeliveryResult {
    if !shipping || group_ids.is_empty() {
        return DeliveryResult::default();
    }
    let candidates = emission
        .delivery
        .iter()
        .map(|c| DeliveryCandidateOut {
            message: c.message.to_string(),
            targets: group_ids.to_vec(),
            value: match c.value {
                ShippingValue::Percent(p) => TotalValue::Percentage(p),
                ShippingValue::FixedTotal(amount) => TotalValue::FixedAmount(from_minor_units(amount, currency)),
            },
        })
        .collect();
    DeliveryResult { candidates }
}

// --- Writing -------------------------------------------------------------------------------

/// Where output goes: the Wasm output (Context) or, in tests, JSON text.
pub trait Sink: Sized {
    fn object(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error>;
    fn array(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error>;
    fn key(&mut self, key: &str) -> Result<(), Error>;
    fn string(&mut self, value: &str) -> Result<(), Error>;
    fn number(&mut self, value: f64) -> Result<(), Error>;
    fn boolean(&mut self, value: bool) -> Result<(), Error>;
}

impl Sink for Context {
    fn object(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.write_object(f, len)
    }
    fn array(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.write_array(f, len)
    }
    fn key(&mut self, key: &str) -> Result<(), Error> {
        self.write_utf8_str(key)
    }
    fn string(&mut self, value: &str) -> Result<(), Error> {
        self.write_utf8_str(value)
    }
    /// An integral value as an integer (JSON `10`, as the TS reference), else a float.
    fn number(&mut self, value: f64) -> Result<(), Error> {
        if value.fract() == 0.0 && value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX) {
            self.write_i32(value as i32)
        } else {
            self.write_f64(value)
        }
    }
    fn boolean(&mut self, value: bool) -> Result<(), Error> {
        self.write_bool(value)
    }
}

fn write_ids<S: Sink>(s: &mut S, ids: &[String], wrapper: &str) -> Result<(), Error> {
    s.array(ids.len(), |s| {
        for id in ids {
            s.object(1, |s| {
                s.key(wrapper)?;
                s.object(1, |s| {
                    s.key("id")?;
                    s.string(id)
                })
            })?;
        }
        Ok(())
    })
}

fn write_percentage<S: Sink>(s: &mut S, value: f64) -> Result<(), Error> {
    s.object(1, |s| {
        s.key("percentage")?;
        s.object(1, |s| {
            s.key("value")?;
            s.number(value)
        })
    })
}

fn write_total_value<S: Sink>(s: &mut S, value: &TotalValue) -> Result<(), Error> {
    match value {
        TotalValue::Percentage(p) => write_percentage(s, *p),
        TotalValue::FixedAmount(amount) => s.object(1, |s| {
            s.key("fixedAmount")?;
            s.object(1, |s| {
                s.key("amount")?;
                s.string(amount)
            })
        }),
    }
}

fn write_product_candidate<S: Sink>(s: &mut S, c: &ProductCandidateOut) -> Result<(), Error> {
    s.object(3, |s| {
        s.key("message")?;
        s.string(&c.message)?;
        s.key("targets")?;
        write_ids(s, &c.targets, "cartLine")?;
        s.key("value")?;
        match &c.value {
            ProductValue::Percentage(p) => write_percentage(s, *p),
            ProductValue::FixedAmount { amount, applies_to_each_item } => s.object(1, |s| {
                s.key("fixedAmount")?;
                s.object(2, |s| {
                    s.key("amount")?;
                    s.string(amount)?;
                    s.key("appliesToEachItem")?;
                    s.boolean(*applies_to_each_item)
                })
            }),
        }
    })
}

fn write_order_candidate<S: Sink>(s: &mut S, c: &OrderCandidateOut) -> Result<(), Error> {
    s.object(3, |s| {
        s.key("message")?;
        s.string(&c.message)?;
        s.key("targets")?;
        s.array(1, |s| {
            s.object(1, |s| {
                s.key("orderSubtotal")?;
                s.object(1, |s| {
                    s.key("excludedCartLineIds")?;
                    s.array(c.excluded_cart_line_ids.len(), |s| {
                        for id in &c.excluded_cart_line_ids {
                            s.string(id)?;
                        }
                        Ok(())
                    })
                })
            })
        })?;
        s.key("value")?;
        write_total_value(s, &c.value)
    })
}

fn write_operation<S: Sink, T>(
    s: &mut S,
    name: &str,
    candidates: &[T],
    strategy: &str,
    write: impl Fn(&mut S, &T) -> Result<(), Error>,
) -> Result<(), Error> {
    s.object(1, |s| {
        s.key(name)?;
        s.object(2, |s| {
            s.key("candidates")?;
            s.array(candidates.len(), |s| {
                for c in candidates {
                    write(s, c)?;
                }
                Ok(())
            })?;
            s.key("selectionStrategy")?;
            s.string(strategy)
        })
    })
}

impl CartLinesResult {
    pub fn write<S: Sink>(&self, s: &mut S) -> Result<(), Error> {
        s.object(1, |s| {
            s.key("operations")?;
            s.array(self.operations.len(), |s| {
                for op in &self.operations {
                    match op {
                        CartOperation::ProductDiscountsAdd(c) => {
                            write_operation(s, "productDiscountsAdd", c, "ALL", write_product_candidate)?
                        }
                        CartOperation::OrderDiscountsAdd(c) => {
                            write_operation(s, "orderDiscountsAdd", c, "FIRST", write_order_candidate)?
                        }
                    }
                }
                Ok(())
            })
        })
    }
}

impl DeliveryResult {
    pub fn write<S: Sink>(&self, s: &mut S) -> Result<(), Error> {
        s.object(1, |s| {
            s.key("operations")?;
            let ops = usize::from(!self.candidates.is_empty());
            s.array(ops, |s| {
                if ops == 0 {
                    return Ok(());
                }
                write_operation(s, "deliveryDiscountsAdd", &self.candidates, "ALL", |s, c: &DeliveryCandidateOut| {
                    s.object(3, |s| {
                        s.key("message")?;
                        s.string(&c.message)?;
                        s.key("targets")?;
                        write_ids(s, &c.targets, "deliveryGroup")?;
                        s.key("value")?;
                        write_total_value(s, &c.value)
                    })
                })
            })
        })
    }
}

impl Serialize for CartLinesResult {
    fn serialize(&self, context: &mut Context) -> Result<(), Error> {
        self.write(context)
    }
}

impl Serialize for DeliveryResult {
    fn serialize(&self, context: &mut Context) -> Result<(), Error> {
        self.write(context)
    }
}

// --- JSON text (tests: compare with the fixtures' expected output) --------------------------

/// JSON.stringify-compatible compact text.
#[cfg(test)]
#[derive(Default)]
pub struct JsonText {
    pub out: String,
    /// Per open container: (is object, items written).
    stack: Vec<(bool, usize)>,
}

#[cfg(test)]
impl JsonText {
    fn before_value(&mut self) {
        if let Some((false, count)) = self.stack.last_mut() {
            if *count > 0 {
                self.out.push(',');
            }
            *count += 1;
        }
    }

    fn quote(&mut self, s: &str) {
        self.out.push('"');
        for c in s.chars() {
            match c {
                '"' => self.out.push_str("\\\""),
                '\\' => self.out.push_str("\\\\"),
                '\u{8}' => self.out.push_str("\\b"),
                '\u{C}' => self.out.push_str("\\f"),
                '\n' => self.out.push_str("\\n"),
                '\r' => self.out.push_str("\\r"),
                '\t' => self.out.push_str("\\t"),
                c if (c as u32) < 0x20 => self.out.push_str(&format!("\\u{:04x}", c as u32)),
                c => self.out.push(c),
            }
        }
        self.out.push('"');
    }

    fn container(&mut self, object: bool, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.before_value();
        self.out.push(if object { '{' } else { '[' });
        self.stack.push((object, 0));
        f(self)?;
        self.stack.pop();
        self.out.push(if object { '}' } else { ']' });
        Ok(())
    }
}

#[cfg(test)]
impl Sink for JsonText {
    fn object(&mut self, _len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.container(true, f)
    }
    fn array(&mut self, _len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.container(false, f)
    }
    fn key(&mut self, key: &str) -> Result<(), Error> {
        if let Some((true, count)) = self.stack.last_mut() {
            let first = *count == 0;
            *count += 1;
            if !first {
                self.out.push(',');
            }
        }
        self.quote(key);
        self.out.push(':');
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), Error> {
        self.before_value();
        self.quote(value);
        Ok(())
    }
    fn number(&mut self, value: f64) -> Result<(), Error> {
        self.before_value();
        self.out.push_str(&js::number_to_string(value));
        Ok(())
    }
    fn boolean(&mut self, value: bool) -> Result<(), Error> {
        self.before_value();
        self.out.push_str(if value { "true" } else { "false" });
        Ok(())
    }
}
