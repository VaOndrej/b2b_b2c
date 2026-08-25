---
title: Insights, holdouts and ROI
slug: insights-and-roi
layer: concept
feature: insights
min_plan: pro
status: stable
app_version: MVP13
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [insights, analytics, impressions, interactions, holdout, roi, ab test, experiment, metrics]
summary: What the Insights page measures, why proving revenue needs a holdout, and why the app refuses to show numbers it cannot stand behind.
---

# Insights, holdouts and ROI

**Insights** (Pro) is the admin's Reach + ROI page.

## What is measured

- **Reach** — impressions and interactions, per toast type.
- **Most shown** — which toast dominates a shopper's session.
- **What we noticed** — plain-language diagnoses, each linking to the setting
  that would act on it.

Events are counted per day, per toast type, and are **scrubbed before storage**:
only a whitelist of typed fields survives, everything else — including anything
that could carry personal data — is dropped at the gate. See
[privacy-and-data](privacy-and-data).

## Why some numbers say "needs holdout"

Order value and progression are shown as **"needs holdout"** until you turn one
on. Without a holdout group, "revenue after installing the app" is a correlation,
not a result — seasonality, traffic and campaigns all move it.

A **holdout** keeps a slice of shoppers toast-free, so the two groups differ only
in whether they saw a toast. **Monthly ROI** is only labelled *holdout-proven*
when that comparison actually exists.

## Honest cold start

A store with no traffic gets "No toasts shown yet", not a zero-filled dashboard.
An aggregate below a credible sample size renders nothing at all. The same
principle as [notifications-and-recipes](notifications-and-recipes): silence
beats a number the app cannot stand behind.

## A/B variants

An announcement can carry several variants (one per line); shoppers are split
evenly and the split is deterministic per shopper, so nobody sees a message
change mid-visit.

Related: [plans-free-vs-pro](plans-free-vs-pro), [privacy-and-data](privacy-and-data).
