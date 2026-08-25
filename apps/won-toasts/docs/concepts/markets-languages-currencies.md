---
title: Languages, translations and currencies
slug: markets-languages-currencies
layer: concept
feature: markets
min_plan: free
status: stable
app_version: MVP10
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [language, locale, translation, currency, market, threshold, multi-currency, fallback]
summary: How Won Toasts picks a shopper's language, how you translate messages, and why free-shipping thresholds are set per currency.
---

# Languages, translations and currencies

The admin **Markets** page holds three things: your languages, the translations
of every message, and per-currency thresholds.

## Languages come from your store

Won Toasts does not ship a fixed language list. It reads the languages your
Shopify store actually publishes, and you can add extra BCP-47 codes by hand
(`pt-pt`, `sv`, `da`). One of them is the **default (fallback) language**.

How a shopper's message is chosen: exact locale (`pt-BR`) → the language
(`pt`) → your default language → English. A shopper never sees an empty toast
because a translation is missing.

Free stores get a small number of languages, Pro many more — exact limits in
[reference/plan-limits](../reference/plan-limits.generated.md).

## Translations

Every message template is editable per language, per toast type, in one matrix.
Placeholders (product name, quantity, remaining amount) stay identical across
languages — the app fills them in, including correct plural forms for languages
that need more than "one / other" (Czech and Slovak among them).

## Currencies: one threshold per currency, not one converted number

A free-shipping milestone is **not** stored as a single amount that gets
converted. Each presentment currency gets its own threshold, edited under
**Markets → Currencies**. The base amount and the on/off switch stay with the
milestone itself on the **Toasts** page.

**Why:** a converted threshold drifts with the exchange rate, so the bar a shopper
sees would not match the shipping rate you configured in Shopify. Setting the
number per currency keeps the promise and the actual rate in sync.

Free stores keep a limited number of per-currency thresholds; the ones kept are
chosen alphabetically by ISO code so the same two survive on every request and the
shopper's progress bar never flickers.

Related: [milestones](milestones), [plans-free-vs-pro](plans-free-vs-pro).
