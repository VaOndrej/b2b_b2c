---
title: Human-readable title
slug: example-concept                    # == filename without .md; stable ID
layer: concept                          # concept | task | reference | support
feature: core                           # your app's feature area
min_plan: free                          # free | pro → chatbot hides Pro-only from Free merchants
status: stable                          # stable | beta | planned → chatbot ignores planned/beta
app_version: MVP0                        # from which MVP/version this holds
source: hand-written                    # hand-written | generated
generated_from: null                    # source path; only the generator fills this
lang: en                                # chunk language (App Store audience = en; cs/sk possible)
updated: 2026-01-01                      # last revision date → stale detection
keywords: [example, template, frontmatter]
summary: One-line, retrieval-friendly description of what this document answers.
---

# Human-readable title

Delete this example and write real concept docs. Keep each document to **one
topic / one question** — small, self-contained chunks retrieve far better than
long chapters.

Write the **stable mental model** here (what things are, how they work, why),
because that survives UI refactors and covers most support questions. Put exact,
volatile values (limits, enum values, option lists) in generated `reference/`
docs, not in prose.

Link related docs by slug, e.g. [another-concept](another-concept).
