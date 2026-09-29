// `cart.delivery-options.discounts.generate.run`: the same plan as the lines
// target (the shipping winner depends on the lines: minimums, product/order
// switches); the node emits its shipping winner on every delivery group. A node
// without the SHIPPING class, an unknown role or a missing/invalid shared
// config emits no operations; nothing here fails.

use crate::engine::emit::emit_for_node;
use crate::engine::plan::plan_cart;
use crate::output::{delivery_result, DeliveryResult};
use crate::schema;
use shopify_function::Result;

pub fn cart_delivery_options_discounts_generate_run(
    input: schema::cart_delivery_options_discounts_generate_run::Input,
) -> Result<DeliveryResult> {
    if !input.discount().discount_classes().contains(&schema::DiscountClass::Shipping) {
        return Ok(DeliveryResult::default());
    }
    let group_ids: Vec<String> =
        input.cart().delivery_groups().iter().map(|g| g.id().clone()).filter(|id| !id.is_empty()).collect();
    let Some(adapted) = crate::adapt_input!(&input, cart_delivery_options_discounts_generate_run) else {
        return Ok(DeliveryResult::default());
    };
    let plan = plan_cart(adapted.cart, Some(adapted.config));
    let emission = emit_for_node(&plan, &adapted.role, adapted.triggering_code);
    let result = delivery_result(&emission, true, &group_ids, &plan.currency);
    // Never dropped: the run's memory is thrown away after it (src/main.rs run_export).
    std::mem::forget(emission);
    std::mem::forget(plan);
    std::mem::forget(adapted.role);
    std::mem::forget(group_ids);
    std::mem::forget(input);
    Ok(result)
}
