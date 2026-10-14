---
title: Tags for placing Won elements in the theme code
slug: theme-tags
layer: reference
feature: appearance
min_plan: free
status: stable
config_version: 2
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [won-discounts tag, theme code, cart drawer, product card, manual placement, značka, ruční vložení, zásuvka košíku, karta produktu, umístění na webu]
summary: The optional tag for the theme code where an app block cannot go (cart drawer, product card, custom announcement bar) — what each show value does, its attributes, and how to check and undo it.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Tags for placing Won elements in the theme code

The normal way to put a Won element on the store is its **app block** in the theme editor. Where the theme takes no
app block — the cart drawer, inside a product card, a custom announcement bar, an older theme — you can paste one
tag into the theme code instead. It is optional: use it only where the block cannot go.

There is one tag for everything, `<won-discounts>`, and the `show` attribute says which element. The tag holds
no logic: Won fills it, so it always shows what checkout gives and follows your settings in the app.

## Before you start

- **Won must be on** in the theme: Theme settings → App embeds → Won Discounts. Without it every tag stays empty.
- Work on a **copy of the theme** and publish it when it looks right.
- After pasting, open Won Discounts and click **Check again** at the place: Won reads the theme and from then on
  fills the tag. Until then a milestones, campaign or card tag stays empty on the store and says so in the theme
  editor (a cart tag works at once: the cart panel finds it by itself).

## Which tag

| `show` | Instead of the block | Where it shows something |
|---|---|---|
| `cart` | “Milestones and code” | The cart drawer or the cart page: the Milestones ladder, the gift and the discount code field. |
| `card-tier` | “Quantity price (card)” | A product card on a collection or search page: the first quantity break, e.g. “From 3 items −10%”. |
| `milestones` | “Milestones”, “Announcement: Milestones” | Anywhere: the ladder of steps by cart value (free shipping, gifts, order discounts). |
| `campaign` | “Campaign banner”, “Announcement: Campaign” | Anywhere: the name of the campaign running now and the time left. |

## The tags

### `show="cart"`

The cart drawer or the cart page: the Milestones ladder, the gift and the discount code field.

```liquid
<won-discounts show="cart"></won-discounts>
```

- `size`: `compact` (a drawer) or `full` (every step, for the cart page). Missing or unknown: `compact`.

### `show="card-tier"`

A product card on a collection or search page: the first quantity break, e.g. “From 3 items −10%”.

```liquid
<won-discounts show="card-tier" product="{{ product.handle }}"></won-discounts>
```

- `product`: The card's product handle, from the card's own Liquid: `{{ product.handle }}` (Dawn's card snippet: `{{ card_product.handle }}`).

### `show="milestones"`

Anywhere: the ladder of steps by cart value (free shipping, gifts, order discounts).

```liquid
<won-discounts show="milestones" size="bar"></won-discounts>
```

- `size`: `bar` (one sentence and a thin track), `compact` (a mark per step) or `full` (every step with its reward). Missing or unknown: `compact`.
- `align`: `start` or `center`. Missing or unknown: `start`.

### `show="campaign"`

Anywhere: the name of the campaign running now and the time left.

```liquid
<won-discounts show="campaign"></won-discounts>
```

- `text`: The line, with `{name}` for the campaign's name. Missing or unknown: `{name}`.
- `align`: `start` or `center`. Missing or unknown: `start`.

## Check it

- In the theme editor every tag shows a labelled sample of its element, at its real size, with the reason when the
  customer would see nothing there (no milestone set, the product has no quantity discount, …).
- On the store an empty tag takes no room.

## Undo it

Delete the line you pasted. When Won is uninstalled the tags stay in the code but show nothing and break nothing.
