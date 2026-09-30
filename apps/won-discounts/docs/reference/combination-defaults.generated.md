---
title: Default combination rules
slug: combination-defaults
layer: reference
feature: engine
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [combine, combination, stack, add up, better wins, kombinace, sčítání]
summary: Which kinds of Won discounts add up by default and which compete, plus the Pro stacking cap.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Default combination rules

What happens when two Won discounts of these kinds could apply to the same cart:

| Discounts | Combine by default? |
|---|---|
| Clearance item + any other discount (Clearance is a planned module) | No |
| Product discount + another product discount on the same item | No: the better one for the customer wins |
| Product discount + order discount | Yes, they add up |
| Product discount + shipping discount | Yes, they add up |
| Order discount + shipping discount | Yes, they add up |

- Two **order** discounts do not add up either: the better one for the customer wins.
- Of several **shipping** discounts one applies: a percentage (free shipping = 100 %)
  ranks above a fixed amount, the larger first.
- **Pro:** a discount can be set to stack with chosen other discounts of the same
  kind. At most **6** discounts stack on one line (or on the order).
