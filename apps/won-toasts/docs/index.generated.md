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
summary: Every document in the Won Toasts knowledge base with the metadata the support chatbot filters on.
---

<!-- AUTO-GENERATED from the docs tree — DO NOT EDIT. Run `npm run docs:gen -w won-toasts` to refresh. -->

# Documentation index

34 documents. Chatbot filters: `min_plan` hides Pro-only answers from
Free merchants, `status` keeps `planned`/`beta` material out of answers, `lang`
selects the answer language, `layer` weights concepts over tasks for "how does it
work" questions.

## Concepts

How it works and why — the answers to most support questions. Stable across UI changes.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Accessibility](concepts/accessibility.md) | `accessibility` | core | free | stable | What Won Toasts does for screen readers, keyboard users and motion sensitivity — and why none of it is behind Pro. |
| [Anti-spam and how often toasts appear](concepts/anti-spam-and-frequency.md) | `anti-spam-and-frequency` | design | free | stable | How Won Toasts prevents flooding a shopper — merge, caps, cooldowns and quiet mode — and which parts are Free versus Pro. |
| [Appearance and branding](concepts/appearance-and-branding.md) | `appearance-and-branding` | design | free | stable | What can be styled (light/dark by default, full design studio on Pro) and when the "Powered by Won" badge shows. |
| [Cart toasts and how they trigger](concepts/cart-toasts.md) | `cart-toasts` | cart-toasts | free | stable | How cart toasts detect add/remove/change events, show the quantity delta, and offer Undo on removals. |
| [Grouping, anti-spam and conflicts](concepts/grouping-and-conflicts.md) | `grouping-and-conflicts` | grouping | free | stable | How Won Toasts avoids toast spam by grouping bursts, deduping, rate-limiting, and summarizing multiple milestones. |
| [Insights, holdouts and ROI](concepts/insights-and-roi.md) | `insights-and-roi` | insights | pro | stable | What the Insights page measures, why proving revenue needs a holdout, and why the app refuses to show numbers it cannot stand behind. |
| [Languages, translations and currencies](concepts/markets-languages-currencies.md) | `markets-languages-currencies` | markets | free | stable | How Won Toasts picks a shopper's language, how you translate messages, and why free-shipping thresholds are set per currency. |
| [Milestones (free shipping and free gift)](concepts/milestones.md) | `milestones` | milestones | free | stable | Milestones show progress toward a reward (free shipping, free gift); the app announces progress but does not grant the reward. |
| [Notifications (recipes) beyond the cart](concepts/notifications-and-recipes.md) | `notifications-and-recipes` | notifications | free | stable | Recipes are merchant-configured toasts that fire on page views rather than on the shopper's own cart — countdown, announcement, low stock and cart activity. |
| [Performance and theme compatibility](concepts/performance-and-compatibility.md) | `performance-and-compatibility` | core | free | stable | How much Won Toasts weighs on the storefront, why it cannot clash with your theme's CSS, and which themes it is tested against. |
| [Free vs Pro — the idea](concepts/plans-free-vs-pro.md) | `plans-free-vs-pro` | plans | free | stable | The philosophy behind Free vs Pro — Pro gates scope and reach, never basic quality or usability. |
| [What data Won Toasts stores](concepts/privacy-and-data.md) | `privacy-and-data` | core | free | stable | Which permissions Won Toasts asks for, what it stores, what it deliberately does not store, and what happens on uninstall. |
| [Targeting (where toasts show)](concepts/targeting.md) | `targeting` | targeting | pro | stable | Targeting (a Pro feature) restricts toasts to specific page types, devices, or customer states. |
| [What Won Toasts does](concepts/what-is-won-toasts.md) | `what-is-won-toasts` | core | free | stable | Won Toasts shows lightweight cart notifications ("toasts") and progress toward shipping/gift milestones in your storefront. |
| [Why a toast did or didn't show](concepts/why-a-toast-did-or-didnt-show.md) | `why-a-toast-did-or-didnt-show` | core | free | stable | The exact order of checks a toast passes before it renders, so you can tell which one silenced it. |

## Tasks

Step-by-step: how do I set X up.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Add custom CSS (Pro)](tasks/add-custom-css.md) | `add-custom-css` | design | pro | stable | Style toasts beyond the design studio with your own CSS, and what to know about the shadow root it runs in. |
| [Configure targeting](tasks/configure-targeting.md) | `configure-targeting` | targeting | pro | stable | How to restrict where toasts appear by page, device, or customer state (Pro). |
| [Show your own announcement](tasks/create-an-announcement.md) | `create-an-announcement` | notifications | free | stable | Put your own message on the storefront without touching the theme, optionally split-tested across variants. |
| [Customize toast appearance](tasks/customize-appearance.md) | `customize-appearance` | design | pro | stable | How to change toast colors, animation and layout in the design studio (Pro), with a live preview. |
| [Turn toasts off on specific pages](tasks/exclude-pages-and-urls.md) | `exclude-pages-and-urls` | targeting | free | stable | Keep toasts off checkout, legal pages or a specific campaign landing page using URL exclusions. |
| [Set free-shipping thresholds per currency](tasks/set-thresholds-per-currency.md) | `set-thresholds-per-currency` | markets | free | stable | Give each presentment currency its own free-shipping threshold so the progress bar always matches your real Shopify shipping rate. |
| [Set up a countdown timer](tasks/set-up-a-countdown.md) | `set-up-a-countdown` | notifications | free | stable | Put a real deadline on the storefront — either a fixed end date or an evergreen timer that restarts per visitor. |
| [Set up a free-shipping milestone](tasks/set-up-free-shipping-milestone.md) | `set-up-free-shipping-milestone` | milestones | free | stable | How to configure a free-shipping progress milestone, and the Shopify setting that actually makes shipping free. |
| [Show low stock and cart activity (Pro)](tasks/show-low-stock-and-cart-activity.md) | `show-low-stock-and-cart-activity` | notifications | pro | stable | Turn on the two honest urgency recipes — live inventory and server-counted add-to-cart activity — and understand when they stay silent. |
| [Translate toast messages](tasks/translate-toast-messages.md) | `translate-toast-messages` | markets | free | stable | Add languages, translate every message type, and set the fallback language shoppers get when a translation is missing. |
| [Show fewer toasts (anti-spam tuning)](tasks/tune-anti-spam.md) | `tune-anti-spam` | design | free | stable | The order to work through when toasts feel too frequent — merge first, then caps, then quiet mode. |
| [Turn on Won Toasts (go live)](tasks/turn-on-won-toasts.md) | `turn-on-won-toasts` | core | free | stable | The two switches that put toasts on your storefront — the app toggle and the theme app embed — and how to verify it worked. |
| [Upgrade to Pro, and cancel](tasks/upgrade-to-pro.md) | `upgrade-to-pro` | plans | free | stable | How the Pro subscription is charged through Shopify, how to cancel, and what happens to your settings when you go back to Free. |

## Reference

Exact values, generated from code. Never hand-edited.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Configuration option values](reference/config-options.generated.md) | `config-options` | core | free | stable | Every accepted value for behavior, appearance, language and targeting settings. |
| [Event and milestone types](reference/event-types.generated.md) | `event-types` | cart-toasts | free | stable | The cart event types, semantic toast types, and milestone kinds the engine recognizes. |
| [Notification (recipe) types](reference/notification-types.generated.md) | `notification-types` | notifications | free | stable | Every notification type a merchant can turn on, which plan it needs, where it can render and which page scopes it accepts. |
| [Plans: Free vs Pro](reference/plan-limits.generated.md) | `plan-limits` | plans | free | stable | What the Free plan includes and which features require Pro. |

## Support

Troubleshooting and FAQ.

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
| [Frequently asked questions](support/faq.md) | `faq` | core | free | stable | Short answers to the questions asked most often before and just after installing Won Toasts. |
| [Troubleshooting toasts](support/troubleshooting.md) | `troubleshooting` | core | free | stable | Common Won Toasts issues and their causes — toasts not showing, free shipping not applying, gift toasts, branding. |

