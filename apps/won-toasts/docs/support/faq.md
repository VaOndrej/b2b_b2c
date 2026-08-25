---
title: Frequently asked questions
slug: faq
layer: support
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [faq, questions, does it, can i, speed, theme, price, free, gdpr, data]
summary: Short answers to the questions asked most often before and just after installing Won Toasts.
---

# Frequently asked questions

**Does it change my theme files?**
No. It runs as a theme app extension you enable in the theme editor. Nothing is
written into your theme, and uninstalling leaves no leftovers.

**Will it slow my store down?**
The storefront script is held under an 11 kB gzipped budget enforced by a build
test, does not block rendering and causes no layout shift. See
[performance-and-compatibility](../concepts/performance-and-compatibility).

**Will it clash with my theme's styling?**
It cannot — toasts render inside a Shadow DOM, isolated in both directions.

**Does a "free shipping" toast actually make shipping free?**
No. The app announces progress toward a threshold you configure; the actual free
shipping comes from your Shopify shipping rate. Set both to the same number.

**Can I use it on a brand-new store with no orders?**
Yes. Cart toasts, countdown and announcement need no history. The social-proof
recipes stay silent until there is real activity — deliberately.

**Do you show fake numbers to create urgency?**
No. Low stock reads live inventory, cart activity counts genuine server-side
events, countdowns count to a date you set. When the data isn't there, the app
shows nothing.

**What does it cost?**
There is a free plan. Pro is a recurring subscription billed by Shopify — see
[upgrade-to-pro](../tasks/upgrade-to-pro) and
[reference/plan-limits](../reference/plan-limits.generated.md).

**What data do you collect about my shoppers?**
No names, emails, addresses or IPs. Only aggregate counts per toast type, and
your own configuration. See [privacy-and-data](../concepts/privacy-and-data).

**Is it accessible?**
Screen-reader announcements, reduced-motion support, dark-mode support and touch
targets are on every plan. See [accessibility](../concepts/accessibility).

**Which languages does it support?**
Whichever your store publishes, plus any BCP-47 code you add — with correct plural
forms. See [translate-toast-messages](../tasks/translate-toast-messages).

**Can I turn it off on checkout?**
Yes, with a URL exclusion, on any plan. See
[exclude-pages-and-urls](../tasks/exclude-pages-and-urls).
