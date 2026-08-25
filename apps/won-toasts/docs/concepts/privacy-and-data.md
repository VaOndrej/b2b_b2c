---
title: What data Won Toasts stores
slug: privacy-and-data
layer: concept
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [privacy, gdpr, data, personal data, scopes, permissions, uninstall, deletion, protected customer data]
summary: Which permissions Won Toasts asks for, what it stores, what it deliberately does not store, and what happens on uninstall.
---

# What data Won Toasts stores

## Permissions it asks for

At install the app requests a deliberately small set of scopes: read access to
themes, locales and shipping. That is what it needs to place the app embed, offer
your store's languages, and reason about shipping thresholds.

It does **not** request order or customer scopes. Order-driven features
(order summary, recent sales) stay switched off until Shopify's **Protected
customer data** approval is granted — see
[reference/notification-types](../reference/notification-types.generated.md).

## What it stores

- Your **configuration** — appearance, behaviour, messages, milestones, targeting.
- A **version history** of that configuration, so a change can be rolled back.
- **Aggregate counters** for Insights — per day, per toast type.

## What it does not store

No shopper names, emails, addresses or IP addresses. Analytics events pass
through a scrubbing gate that keeps only a fixed whitelist of typed fields and
drops everything else, including anything unexpected an integration might attach.

On the storefront, per-shopper state (which milestone was already celebrated,
which toast was dismissed, session counters) lives in the browser's
`sessionStorage` and disappears when the session ends. It is never sent to the app.

## Uninstall and deletion requests

Uninstalling triggers a webhook that deletes the store's data. The app also
implements Shopify's mandatory privacy webhooks — customer data request, customer
redaction and shop redaction — and answers them for the data it holds.

Related: [insights-and-roi](insights-and-roi).
