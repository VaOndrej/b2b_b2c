// `cart.delivery-options.discounts.generate.run`: the same plan as the lines
// target (the shipping winner depends on the lines: minimums, product/order
// switches); the node emits its shipping winner on every delivery group. A node
// without the SHIPPING class, an unknown role or a missing/invalid shared
// config emits no operations; nothing here fails.

use crate::engine::emit::emit_for_node;
use crate::engine::plan::plan_cart;
use crate::output::{delivery_result, DeliveryResult, Sink};
use crate::schema;
use shopify_function::wasm_api::write::Error;

/// Plans the cart and writes the node's delivery output to `out` while the input
/// lives; nothing the run built is dropped (src/main.rs).
pub fn cart_delivery_options_discounts_generate_run<S: Sink>(
    input: schema::cart_delivery_options_discounts_generate_run::Input,
    out: &mut S,
) -> Result<(), Error> {
    if !input.discount().discount_classes().contains(&schema::DiscountClass::Shipping) {
        return DeliveryResult::default().write(out);
    }
    let group_ids: Vec<String> =
        input.cart().delivery_groups().iter().map(|g| g.id().clone()).filter(|id| !id.is_empty()).collect();
    let Some(adapted) = crate::adapt_input!(&input, cart_delivery_options_discounts_generate_run) else {
        return DeliveryResult::default().write(out);
    };
    let plan = plan_cart(adapted.cart, Some(adapted.config));
    let emission = emit_for_node(&plan, &adapted.role, adapted.triggering_code);
    let result = delivery_result(&emission, true, &group_ids, &plan.currency);
    let written = result.write(out);
    std::mem::forget(result);
    std::mem::forget(emission);
    std::mem::forget(plan);
    std::mem::forget(adapted.role);
    std::mem::forget(input);
    std::mem::forget(group_ids);
    written
}
