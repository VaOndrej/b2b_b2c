---
title: Documentation index
slug: index
layer: reference
feature: core
min_plan: free
status: stable
source: generated
generated_from: 'docs/**/*.md'
lang: en
keywords: [index, contents, corpus, manifest, all documents]
summary: Every document in the Won Discounts knowledge base with the metadata the support chatbot filters on.
---

<!-- AUTO-GENERATED from the docs tree — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Documentation index

67 documents. Chatbot filters: `min_plan` hides Pro-only answers from
Free merchants, `status` keeps `planned`/`beta` material out of answers, `lang`
selects the answer language, `layer` weights concepts over tasks for "how does it
work" questions.

## Concepts

How it works and why — the answers to most support questions. Stable across UI changes.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Billing, the trial and going back to Free](concepts/billing-and-downgrade.md) | `billing-and-downgrade` | plans | free | beta | Pro is billed by Shopify at 29 USD a month after a 14-day trial; cancelling makes the store Free at once, running campaigns and sales finish, and Pro settings stay saved. |
| [Campaigns](concepts/campaigns.md) | `campaigns` | campaigns | pro | beta | A named time window that changes your discounts, codes and quantity discounts for a while; it starts and ends by itself, at the exact minute, for every discount at once. |
| [Prices by quantity on product cards (BETA)](concepts/card-prices.md) | `card-prices` | tiers | free | beta | With card prices on, product cards in collections and search show the first quantity break; a card shows nothing where checkout might give less, so it never over-promises. |
| [Milestones](concepts/cart-rewards.md) | `cart-rewards` | rewards | free | beta | One ladder of steps by cart value. Each step has an amount per market and one reward - a free gift, free shipping or a discount off the whole order. The store shows the ladder; checkout gives the rewards. |
| [Clearance](concepts/clearance.md) | `clearance` | outlet | pro | beta | Sell a number of pieces of an existing variant at a discount; the price comes back by itself when the quota is sold, at the end date or by hand. |
| [Codes vs automatic discounts](concepts/codes-vs-automatic-discounts.md) | `codes-vs-automatic-discounts` | discounts | free | stable | Automatic discounts apply by themselves; code discounts apply when a customer enters one of their codes. How codes behave and why active code discounts are limited. |
| [How Won discounts combine](concepts/combining-discounts.md) | `combining-discounts` | engine | free | stable | The default combining rules. Product discounts on the same item compete (the better one wins); product, order and shipping discounts add up. |
| [Cost prices in margin protection](concepts/cost-prices.md) | `cost-prices` | margin | free | stable | Where margin protection gets cost prices, the percentage ceiling for products without one (also used while costs load), and how other currencies are handled. |
| [A custom look of the storefront blocks](concepts/custom-look.md) | `custom-look` | appearance | pro | beta | On Pro you can set colours, the corner radius and your own CSS for the Won blocks; the app confines every rule to the blocks, so the rest of the theme never changes. |
| [Discounts outside Won](concepts/discounts-outside-won.md) | `discounts-outside-won` | native-discounts | free | stable | Discounts created in Shopify or by other apps run outside Won's engine. Why that matters, what the Overview shows, and which of them can be moved into Won. |
| [How Won decides which discounts apply](concepts/how-won-plans-discounts.md) | `how-won-plans-discounts` | engine | free | stable | One engine plans the discounts for a cart; Try a cart, the editor preview and checkout all run it, so checkout takes off what the admin shows. |
| [Margin settings per collection (Pro)](concepts/margin-per-collection.md) | `margin-per-collection` | margin | pro | stable | With Pro, chosen collections get their own minimum margin or ceiling; the strictest value wins. Where protection steps in shows which discounts it lowers and by how much. |
| [Margin protection](concepts/margin-protection.md) | `margin-protection` | margin | free | stable | Margin protection lowers a Won discount so no item goes below a price floor. Margin is Shopify's product margin from the price the customer pays; it never blocks checkout. |
| [Markets and currencies](concepts/markets-and-currencies.md) | `markets-and-currencies` | markets | free | stable | Fixed amounts and minimums have their own value in each currency and are never converted by exchange rate. A currency without a value means the discount is not offered there. |
| [Moving Shopify discounts into Won](concepts/moving-native-discounts.md) | `moving-native-discounts` | native-discounts | free | stable | What happens when a Shopify discount is moved into Won, what is lost (usage count, once-per-customer history), what Undo restores and why to undo before uninstalling. |
| [Free vs Pro, the idea](concepts/plans-free-vs-pro.md) | `plans-free-vs-pro` | plans | free | stable | Free limits scope, never quality. What Pro adds today, and what happens to Pro settings on a Free shop (kept, but not applied at checkout). |
| [Combinations per discount (Pro)](concepts/pro-combinations.md) | `pro-combinations` | engine | pro | stable | With Pro a discount can stack with chosen other discounts of the same kind. How the stack is chosen, the cap of 6 per line, and how it shows at checkout. |
| [Quantity discounts](concepts/quantity-tiers.md) | `quantity-tiers` | tiers | free | stable | Quantity discounts give a lower price per item from a chosen quantity up. One tier set applies per product; the better of a tier and a product discount wins. |
| [Reports and what discounts cost](concepts/reports.md) | `reports` | analytics | free | beta | Reports count the orders of the last 30 days, namely orders with a discount, what discounts cost and the average order on Free; cost and revenue per discount, gifts and sale items on Pro. No personal data is stored. |
| [Saving and syncing with Shopify](concepts/saving-and-syncing.md) | `saving-and-syncing` | sync | free | stable | Saving stores a discount in Won and writes it to Shopify in the background. Until that finishes checkout runs the previous state; collection changes reach checkout within minutes. |
| [What Won Discounts is](concepts/what-is-won-discounts.md) | `what-is-won-discounts` | core | free | stable | Won Discounts runs a store's discounts through one engine so the merchant knows what applies at checkout and why. What is available today and what is not built yet. |

## Tasks

Step-by-step: how do I set X up.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Show Milestones in the cart](tasks/add-the-cart-panel-to-the-cart-page.md) | `add-the-cart-panel-to-the-cart-page` | rewards | free | beta | The app embed shows the Milestones ladder in the cart drawer by itself; on the cart page you place it with the Milestones and code block. |
| [Add the sale badge to the product page](tasks/add-the-sale-badge.md) | `add-the-sale-badge` | outlet | pro | beta | Add the Sale badge app block to the product page so the badge and Only X left show for a variant on sale. |
| [Add the quantity-tiers table to the product page](tasks/add-tiers-to-the-product-page.md) | `add-tiers-to-the-product-page` | tiers | free | stable | One click adds the quantity-tiers block to the active theme's product page; the admin shows whether the block is already there. |
| [Change the texts on the storefront](tasks/change-storefront-texts.md) | `change-storefront-texts` | appearance | free | beta | Open Look, expand Storefront texts, type your own wording per language and save; an empty field keeps the default, and the parts in curly braces must stay. |
| [Choose an appearance for the quantity-tiers block](tasks/choose-an-appearance.md) | `choose-an-appearance` | tiers | free | stable | Pick one of four ready-made looks for the quantity-tiers block; colors and fonts follow the theme automatically. |
| [Schedule a campaign](tasks/create-a-campaign.md) | `create-a-campaign` | campaigns | pro | beta | Name the campaign, set its start and end in the store's time, tick the discounts and quantity sets it changes and how, then schedule it and try a cart at its start. |
| [Create a discount code](tasks/create-a-discount-code.md) | `create-a-discount-code` | discounts | free | stable | Set up a discount that applies only with a code, add several codes to it, and set usage limits. |
| [Create an automatic discount](tasks/create-an-automatic-discount.md) | `create-an-automatic-discount` | discounts | free | stable | Set up a discount that applies by itself (a sale, an amount off the order, free shipping above an amount), from a recipe or blank. |
| [End or reopen a clearance sale](tasks/end-or-reopen-a-sale.md) | `end-or-reopen-a-sale` | outlet | pro | beta | End a running sale by hand, or decide what happens with pieces returned after a sale ended. |
| [Move Shopify discounts into Won](tasks/move-native-discounts.md) | `move-native-discounts` | native-discounts | free | stable | Move discounts created in Shopify into Won in one click, so the engine counts them and margin protection guards them. |
| [Prepare for uninstalling](tasks/prepare-for-uninstalling.md) | `prepare-for-uninstalling` | plans | free | beta | Before uninstalling, click Prepare for uninstalling in Settings, under Plan. It ends running sales (prices back) and restores the Shopify discounts you moved into Won. |
| [Set up a free gift from an amount](tasks/set-up-a-free-gift.md) | `set-up-a-free-gift` | rewards | free | beta | Pick a product variant as the gift and the order amount per currency; on Pro add more thresholds, a choice of up to 3 gifts and a fallback. |
| [Set up free shipping from an amount](tasks/set-up-free-shipping.md) | `set-up-free-shipping` | rewards | free | beta | Add a free-shipping step in Milestones and enter the cart value for each of your markets. |
| [Set up quantity discounts](tasks/set-up-quantity-tiers.md) | `set-up-quantity-tiers` | tiers | free | stable | Add quantity breaks to the tier set, choose a percentage or a fixed amount per currency, and pick how quantity is counted. |
| [Start a clearance sale](tasks/start-a-clearance-sale.md) | `start-a-clearance-sale` | outlet | pro | beta | Pick a variant, enter the pieces to sell and the percent, optionally an end date and price lists, and start the sale. |
| [Start the Pro trial](tasks/start-the-pro-trial.md) | `start-the-pro-trial` | plans | free | beta | Open Settings, scroll to Plan, click Try Pro free for 14 days, approve the subscription on Shopify's page, and you are back in the app on Pro. |
| [Switch combination categories in Settings](tasks/switch-combination-categories.md) | `switch-combination-categories` | engine | free | stable | Settings lets you switch, by category, whether Won's discounts add up or compete, instead of the fixed defaults. |
| [Try a cart](tasks/try-a-cart.md) | `try-a-cart` | try-cart | pro | stable | (Pro) Build a test cart with products, a market, discounts with a code and a day, and see which Won discounts apply at checkout and why. Nothing is ordered. |
| [Turn on margin protection](tasks/turn-on-margin-protection.md) | `turn-on-margin-protection` | margin | free | stable | Switch margin protection on, set the minimum margin and the ceiling for products without a cost price, and check where it lowers discounts. |
| [Undo a move](tasks/undo-a-move.md) | `undo-a-move` | native-discounts | free | stable | Put a moved discount back into Shopify from Won's backup, and why to do it before uninstalling the app. |

## Reference

Exact values, generated from code. Never hand-edited.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Default combination rules](reference/combination-defaults.generated.md) | `combination-defaults` | engine | free | stable | Which kinds of Won discounts add up by default and which compete, plus the Pro stacking cap. |
| [Discount options](reference/discount-options.generated.md) | `discount-options` | discounts | free | stable | Every discount type, target, way of applying and minimum option in Discounts & codes, plus what each recipe pre-fills. |
| [Discount statuses](reference/discount-statuses.generated.md) | `discount-statuses` | discounts | free | stable | Every status a Won discount can show in the admin (English and Czech label) and what it means. |
| [Limits](reference/limits.generated.md) | `limits` | core | free | stable | Exact limits of Won Discounts — discounts per shop, active code discounts, codes, stacking, margin collections and settings size. |
| [Margin protection settings](reference/margin-settings.generated.md) | `margin-settings` | margin | free | stable | Margin protection defaults, accepted values, the floor formula and a worked example computed by the engine. |
| [Free vs Pro plans](reference/plan-limits.generated.md) | `plan-limits` | plans | free | stable | What the Free plan includes, which Won Discounts features need Pro, and what happens to Pro settings on Free. |
| [Storefront contract for a custom look](reference/storefront-contract.generated.md) | `storefront-contract` | appearance | pro | stable | What the Won storefront blocks render and expose (roots, classes, data markers, CSS variables, events), for writing a custom look by hand or with an AI. |

## Support

Troubleshooting and FAQ.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [The campaign did not start (or the discount is not the campaign's)](support/campaign-did-not-start.md) | `campaign-did-not-start` | campaigns | pro | beta | Check the store's time zone, that the discount is ticked with a change, that the campaign is not ended or cancelled, the plan, and try a cart at that time. |
| [The discount in the cart is different from the product page](support/cart-discount-differs-from-the-product-page.md) | `cart-discount-differs-from-the-product-page` | tiers | free | stable | Why the tier discount shown on the product page differs from the cart, usually the count mode, quantity already in the cart, margin protection, or a market in its own currency. |
| [The discount at checkout differs from what I expected](support/checkout-discount-differs.md) | `checkout-discount-differs` | engine | free | stable | Why checkout gives a different discount than expected, in the order to check, and how to reproduce it in Try a cart. |
| [A price did not come back after a clearance sale](support/clearance-price-not-restored.md) | `clearance-price-not-restored` | outlet | pro | beta | Won restores only prices that still hold the sale value; a price you changed during the sale is kept, and the sale's history says so. |
| [The clearance quota is not counting sold pieces](support/clearance-quota-not-counting.md) | `clearance-quota-not-counting` | outlet | pro | beta | Until Shopify approves the app's access to orders, the clearance quota is not counted; the sale ends by its end date or by hand. |
| [More pieces sold than the clearance quota](support/clearance-sold-past-quota.md) | `clearance-sold-past-quota` | outlet | pro | beta | An order can reach Won a moment after checkout; pieces sold in that moment count past the quota and the sale shows the exact number. |
| [A discount code did not apply to a clearance item](support/code-not-applied-to-clearance.md) | `code-not-applied-to-clearance` | outlet | pro | beta | A clearance item takes no other discount by default; switch Clearance with other discounts on in Settings to allow it. |
| [A discount code did not apply](support/code-not-applied.md) | `code-not-applied` | discounts | free | stable | The reasons a Won discount code gives nothing or is shown as not applicable, and how to find which one applies to a given cart. |
| [A discount code and the gift](support/discount-code-and-the-gift.md) | `discount-code-and-the-gift` | rewards | free | beta | What happens to the gift when a discount code takes the order below the threshold, with and without counting other discounts. |
| [The discount is lower because of margin protection](support/discount-lowered-by-margin-protection.md) | `discount-lowered-by-margin-protection` | margin | free | stable | How to tell that margin protection lowered a discount, why it did, and what to change if the result is not what you want. |
| [The discount is not offered in EUR (or another currency)](support/discount-not-offered-in-a-currency.md) | `discount-not-offered-in-a-currency` | markets | free | stable | Why a Won discount works in one currency but not in another (a missing value, never converted), and how to fix it. |
| [A discount outside Won](support/discount-outside-won.md) | `discount-outside-won` | native-discounts | free | stable | What the "discounts outside Won" warning means, why it matters for checkout and margin protection, and what to do with each such discount. |
| [Free shipping or the gift is missing in a market](support/free-shipping-missing-in-a-market.md) | `free-shipping-missing-in-a-market` | rewards | free | beta | A reward is offered only in currencies that have their own amount; the admin names the market without one. |
| [The gift is charged at checkout](support/gift-charged-at-checkout.md) | `gift-charged-at-checkout` | rewards | free | beta | Why a gift line is paid at checkout, in the order to check, from the order being below the threshold to a second item of the gift. |
| [The gift is not added to the cart](support/gift-not-added-to-the-cart.md) | `gift-not-added-to-the-cart` | rewards | free | beta | Why the cart does not add the gift, in the order to check, from the app embed being off to the customer having declined it. |
| [A product did not get the global quantity tiers](support/product-did-not-get-the-global-tiers.md) | `product-did-not-get-the-global-tiers` | tiers | free | stable | A product with no quantity tiers is covered by a scoped Pro set that excludes it; only one tier set ever applies per product, scoped sets before the global one. |
| [Products without a cost price](support/products-without-cost-price.md) | `products-without-cost-price` | margin | free | stable | What margin protection does with products that have no cost price in Shopify, where to find them, and how to add the cost so Won picks it up. |
| [The quantity-tier discount is lower because of margin protection](support/tier-lowered-by-margin-protection.md) | `tier-lowered-by-margin-protection` | tiers | free | stable | A quantity tier is a product discount, so margin protection caps it, never below the price floor. The product page never promises more than checkout; it can promise less while it catches up. |
| [The quantity-tiers table does not show on the product](support/tiers-table-not-showing-on-the-product.md) | `tiers-table-not-showing-on-the-product` | tiers | free | stable | Why the quantity-tiers block is missing from a product page, in the order to check, from the block not being added to the product having no tiers. |

