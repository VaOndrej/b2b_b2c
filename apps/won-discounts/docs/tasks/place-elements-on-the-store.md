---
title: See and place every Won element on the store
slug: place-elements-on-the-store
layer: task
feature: appearance
min_plan: free
status: beta
app_version: MVP7
source: hand-written
generated_from: null
lang: en
updated: 2026-10-14
keywords: [placement on your store, where is it on the store, add to store, check again, umístění na webu, přidat na web, zkontrolovat znovu, chci to jinde, připravit zadání pro ai]
summary: The Placement on your store page lists every Won element and every place it can show, says whether it is there, and offers the one way in your theme allows.
---

# See and place every Won element on the store

Open **Discounts** and click **Placement on your store**, the last tab of the strip under the page heading
(Czech admin: **Slevy → Umístění na webu**). Each module has its own section; each row is one place.

1. Read the row's state:
   - **In the theme**: the element is there. The note says where when it was added in the theme code.
   - **Missing in the theme**: add it with the row's button.
   - **Only in a copy**: it is in an unpublished copy of the theme, not the live one. Publish the copy.
   - **Won off**: the element is in the theme, but Won is not switched on there. Click **Turn on in theme**.
   - **Not verified**: the theme could not be read. Click **Check again**.
2. Click the row's one button:
   - **Add to the theme** where your theme takes the element as a block: the theme editor opens with it added. Save
     the theme there.
   - **Prepare a brief for AI** where it does not (the cart drawer in every theme, the product card in themes
     like Dawn): follow [add-an-element-with-ai](add-an-element-with-ai.md).
3. Want it somewhere the block cannot go? Click **I want it elsewhere** under the row. It opens the same guide.
4. After any change in the theme click **Check again** at the top. Won reads the theme again, and new elements in
   the theme code start working on the store within a moment.

## Notes

- A row that is on the store can still say *it has nothing to show now*: no milestone set up, no campaign
  running or planned, card prices off. Set it up in the module.
- **Other places with elements** lists elements in files Won does not tie to a row (your own sections), and any
  element with an unknown `show` value: fix the typo, Won does not fill it.
- Won reads the live theme and the three most recently edited copies. See [theme-tags](../reference/theme-tags.generated.md).
