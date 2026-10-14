---
title: A Won element added in the theme code does not show
slug: element-not-showing-on-the-store
layer: support
feature: appearance
min_plan: free
status: beta
app_version: MVP7
source: hand-written
generated_from: null
lang: en
updated: 2026-10-14
keywords: [tag not showing, element empty, won-discounts tag, only in a copy, won off, nothing to show, theme code, značka se nezobrazuje, jen v kopii, won vypnutý, nemá co ukázat]
summary: Why a won-discounts tag pasted into the theme code shows nothing, in the order to check, as the Placement on your store page says it.
---

# A Won element added in the theme code does not show

Open **Placement on your store** and click **Check again** first: the row then says the cause. In this order:

## 1. Won has not seen it yet

Won fills a milestones, campaign, card, table or badge element only once it has read it in the live theme. Click
**Check again** after every theme change. In the theme editor such an element shows a sample saying so.

## 2. It is only in a copy of the theme

The row says **Only in a copy**: publish the copy, or add the element to the live theme too.

## 3. Won is off in the theme

The row says **Won off**: click **Turn on in theme** (Theme settings → App embeds → Won Discounts). Without it every
element stays empty.

## 4. There is nothing to show now

The row says *it has nothing to show now*: no milestone set up, no campaign running or planned, no quantity
discount, no product on clearance, or card prices switched off in **Quantity discounts**.

## 5. The element is on the wrong page or misspelt

- The tiers table and the sale badge work only on a product page. Elsewhere they stay empty.
- **Other places with elements** lists an element with an unknown `show` value: fix the typo.
- A card element needs the card's own product: `product="{{ product.handle }}"` (Dawn: `card_product`).

See [add-an-element-with-ai](../tasks/add-an-element-with-ai.md) and [theme-tags](../reference/theme-tags.generated.md).
