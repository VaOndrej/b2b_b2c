// `cart.delivery-options.discounts.generate.run`: the same plan as the lines
// target (the shipping winner depends on the lines: minimums, product/order
// switches); the node emits its shipping winner on every delivery group. A node
// without the SHIPPING class, an unknown role or a missing/invalid shared
// config emits no operations; nothing here fails.

use crate::engine::emit::emit_for_node;
use crate::engine::plan::plan_cart;
use crate::input::{delivery_group_ids, node, RunInput};
use crate::output::{delivery_result, DeliveryResult, Sink};
use shopify_function::wasm_api::write::Error;
use shopify_function::wasm_api::Value;

/// Plans the cart and writes the node's delivery output to `out` while the input
/// lives; nothing the run built is dropped (src/main.rs).
pub fn cart_delivery_options_discounts_generate_run<S: Sink>(input: Value, out: &mut S) -> Result<(), Error> {
    let (discount, classes) = node(&input);
    if !classes.shipping {
        return DeliveryResult::default().write(out);
    }
    let group_ids = delivery_group_ids(&input);
    let Some(run) = RunInput::read(&input, &discount) else {
        return DeliveryResult::default().write(out);
    };
    let plan = plan_cart(run.cart(), Some(&run.config));
    let emission = emit_for_node(&plan, &run.role, run.triggering_code.as_deref());
    let result = delivery_result(&emission, true, &group_ids, &plan.currency);
    let written = result.write(out);
    std::mem::forget(result);
    std::mem::forget(emission);
    std::mem::forget(plan);
    std::mem::forget(run);
    std::mem::forget(group_ids);
    written
}
