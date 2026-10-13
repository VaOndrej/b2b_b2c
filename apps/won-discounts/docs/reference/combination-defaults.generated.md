---
title: Default combination rules
slug: combination-defaults
layer: reference
feature: engine
min_plan: free
status: stable
config_version: 2
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [combine, combination, stack, add up, better wins, adds up with, kombinace, sčítání, sčítá se s]
summary: Which types of Won discounts add up in a new store, how the rule works, plus the stacking cap.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Default combination rules

Every discount has a list, **Adds up with**: the types of discounts it adds up with. There are six types:
**Automatic discounts**, **Discount codes**, **Free shipping**, **Quantity discounts**, **Milestones**, **Sale**.

Two discounts add up only when **each** one's list has the other's type. When they do not, the customer
gets the better of the two.

In a new store:

| Whose list | Adds up with |
|---|---|
| A new discount (automatic or with a code) | Free shipping, Milestones |
| Quantity discounts | Free shipping, Milestones |
| Milestones | Automatic discounts, Discount codes, Free shipping, Quantity discounts, Milestones |
| Sale | nothing |

- A new **free shipping** discount starts with the mirror of the first row, so that the two sides agree.
- Of several **shipping** discounts one applies: a percentage (free shipping = 100 %)
  ranks above a fixed amount, the larger first.
- Two discount steps of **Milestones** never add up: the higher step replaces the lower one.
- **Pro:** an exception lets a discount add up with one chosen discount whose type is not in its list.
  The other discount must allow it too.
- At most **6** discounts add up on one line (or on the order).
