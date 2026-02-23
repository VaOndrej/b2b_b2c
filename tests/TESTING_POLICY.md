## Test Policy (Mandatory)

For every change in pricing or Shopify Function behavior, include all layers:

1. Unit test
- Pure rule logic (discount, margin, segment, floor).

2. Contract test
- Input query shape and generated config payload must stay compatible.
- Required query variables must have a guaranteed value path.

3. Runtime integration test
- Builder output must be consumable by the target runtime function.

If one layer is missing, the change is incomplete.
