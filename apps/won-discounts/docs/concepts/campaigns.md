---
title: Campaigns
slug: campaigns
layer: concept
feature: campaigns
min_plan: pro
status: beta
app_version: MVP6
source: hand-written
generated_from: null
lang: en
updated: 2026-10-04
keywords: [campaign, quantity discounts in a campaign, tier table during a campaign, black friday, cyber monday, time window, start and end, kill switch, overlap, schedule discounts, kampaň, kampaně, černý pátek]
summary: A named time window that changes your discounts, codes and quantity discounts for a while; it starts and ends by itself, at the exact minute, for every discount at once.
---

# Campaigns

A **campaign** (Pro) changes your discounts for a while — a Black Friday weekend,
a one-day flash sale. It has a **name**, a **window** (a start and an end, to the
minute, in your store's time zone) and a list of **changes**: for each discount
you pick, switch it on or off during the campaign and/or give it another value
(another percent or amount).

## How it starts and ends

The checkout itself knows the window: at the start minute every changed discount
applies at once, at the end minute the usual ones apply again. No job has to run
at that moment and nothing waits for the app, so a campaign starts on time even
with nobody in the admin. After the end your discounts are exactly as before —
nothing to undo.

A discount that should only exist during the campaign: create it switched **off**
and let the campaign switch it **on**.

## What a campaign changes

A campaign changes **discounts and codes** (Discounts & codes: percent and amount
discounts, free shipping, codes) and **quantity discounts**: for a set of quantity
breaks you tick, the campaign has its own breaks. **Gifts run unchanged** during a
campaign. Margin protection applies inside a campaign too.

### Quantity discounts in a campaign

A campaign can only **improve** a set's breaks: for every quantity the campaign
gives the same or a higher discount than the set usually does, in the same kind
(a percent stays a percent, an amount per item stays an amount, in every currency
the set has). The admin refuses anything less and says from which quantity. If
you later raise the usual breaks above the campaign's, the campaign's breaks stop
applying and its card says so.

Checkout gives the campaign's breaks from the first second of the campaign to its
end. **The table on the product page** switches to them **a minute after the
start** and goes back to the usual breaks **7 minutes before the end**. In those
minutes the page shows the usual (lower) breaks while checkout already or still
gives the campaign's, so the page never promises more than checkout gives. A
campaign shorter than 8 minutes does not switch the table at all.

## Rules

- **No overlap.** Two campaigns cannot run at the same time; the admin refuses a
  window that overlaps another and names it.
- A campaign lasts at most 92 days and ends at least 5 minutes after you save it.
- **End now** (the kill switch) stops a running campaign at once: the usual
  discounts apply again within seconds. It works on any plan.
- A running campaign can be edited. Changing its start or end makes the discounts
  go back to the usual ones for a few seconds while the change reaches every
  discount, then the campaign applies again.
- A running campaign cannot be deleted; end it first.

## Try it before it starts

Every campaign has **Try a cart during the campaign**: it opens
[Try a cart](../tasks/try-a-cart.md) at the campaign's start, so you see the
exact prices the checkout will give then. Steps: [create-a-campaign](../tasks/create-a-campaign.md).

## Free plan

Campaigns are part of Pro. On Free nothing new can be scheduled; a campaign that
was **already running** when the store moved to Free finishes (until its end),
then the usual discounts apply. See [plans-free-vs-pro](plans-free-vs-pro).
