---
title: Translate toast messages
slug: translate-toast-messages
layer: task
feature: markets
min_plan: free
status: stable
app_version: MVP10
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [translation, language, locale, multilingual, fallback, plural, markets]
summary: Add languages, translate every message type, and set the fallback language shoppers get when a translation is missing.
---

# Translate toast messages

Everything lives on the **Markets** page.

## 1. Pick your languages

**Your languages** lists the languages your Shopify store publishes. Add anything
extra as BCP-47 codes in **Extra language codes** (`pt-pt, sv, da`).

Set **Default (fallback) language** — this is what a shopper gets when their own
language has no translation.

Free plans carry fewer languages than Pro; the limits are in
[reference/plan-limits](../reference/plan-limits.generated.md).

## 2. Translate

Under **Translations**, fill the message for each toast type in each language.
Placeholders (product name, quantity, amount remaining) are filled in by the app
and must stay in the text.

Plural forms are handled for you, including languages with more than two plural
categories such as Czech and Slovak — write the template, not the branching.

## 3. Check the fallback chain

A shopper on `pt-BR` gets: `pt-BR` → `pt` → your default language → English.
A missing translation is never an empty toast.

Related: [markets-languages-currencies](../concepts/markets-languages-currencies).
