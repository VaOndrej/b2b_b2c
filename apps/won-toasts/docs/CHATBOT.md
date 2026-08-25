# Support chatbot — how it runs

> Not merchant-facing. This file is deliberately **outside the corpus**
> (`scripts/gen-docs-index.ts` excludes it), so the bot can never answer from it.

## Where it runs: on our hosting, not Shopify's

Shopify hosts nothing here. It has no support-bot product, no RAG service and no
place to upload a knowledge base. Everything below runs in the **same app process
on Fly** as Won Toasts itself (see [`../DEPLOY.md`](../DEPLOY.md)).

What Shopify contributes is only the **entry point**: the "Get support" action it
renders in the app settings page, in App Home and on the App Store listing. By
default that opens a Shopify contact form and relays the message to the support
email on file. An app can override the in-admin one with a
[support link extension](https://shopify.dev/docs/apps/launch/distribution/support-your-customers)
(`shopify app generate extension --template support_link`), which points "Get
support" at one of our own routes instead — that is how the bot gets to be the
first responder inside the admin.

    Merchant clicks "Get support" in the Shopify admin
              │  (support_link extension → our route)
              ▼
    /app/support  — embedded Polaris page, our Fly app
              │
              ▼
    POST /api/support/ask   (session-token authenticated)
              │
              ├─ retrieve: top-k chunks from docs/dist/corpus.jsonl
              │            filtered by min_plan, status, lang
              ├─ answer:   Claude, grounded ONLY in those chunks
              └─ escalate: no confident answer → support email thread

The App Store listing keeps the plain support **email** regardless — it is
required, and it is the fallback when the merchant is not inside the admin.

## The knowledge base

`npm run docs:gen -w won-toasts` produces everything the bot reads:

| File | What it is |
|---|---|
| `docs/dist/corpus.jsonl` | One JSON object per retrieval chunk — what the bot answers from |
| `docs/index.generated.md` | Human-readable manifest of the corpus |
| `docs/reference/*.generated.md` | Exact values, generated from `@won/core/toasts` |

Chunks are cut at `##` headings (long sections split on paragraph boundaries,
never mid-sentence), capped at 1500 characters, and carry the whole document's
metadata plus a `heading_path` for citation.

## Retrieval filters — not decoration

Every chunk carries these, and the bot **must** apply them:

- `min_plan` — never answer a Free merchant with a Pro-only capability as if they
  had it. Retrieve it, but frame it as an upgrade, or drop it.
- `status` — `planned` and `beta` chunks are excluded from answers entirely.
- `lang` — answer in the merchant's language; today the corpus is `en` only.
- `layer` — weight `concept` above `task` for "how does it work / why doesn't it",
  and `task` above `concept` for "how do I".
- `feature` — useful as a facet when a question names one area.

## Store context beats a screenshot

Every request carries the asking store's own state, pulled server-side from the
config it already has — no merchant typing, no image:

- embed enabled? (`@won/core/toasts/embed-status` reads the theme's
  `settings_data.json`)
- app toggle, plan, active recipes
- the state-at-rest summaries from `@won/core/toasts/describe` — the same
  one-line "what is this set to right now" strings the admin renders

This answers the top support case — *"toasts don't show"* — with certainty rather
than inference, and it costs ~150 tokens.

**Images are deliberately not supported in v1.** A screenshot of the theme editor
tells the bot less than the embed status it can already read, and it is the
single most expensive thing a merchant can attach: one full-resolution image
costs up to ~4,800 tokens against a ~1,250-token text request, so a screenshot
roughly quadruples the price of a question. Revisit only if the ticket log shows
merchants actually trying to paste them — and if so, downsample to 1080p before
sending.

## Answering rules

1. **Ground or escalate.** Answer only from retrieved chunks. No confident chunk →
   hand to a human, do not improvise. The docs deliberately describe an app that
   refuses to invent numbers; a bot that invents answers about it is worse than
   no bot.
2. **Cite the `heading_path`** and link the `path`, so the merchant can read the
   source.
3. **Never promise a fix or a date.** Escalate instead.
4. **Escalate anything about billing disputes, data deletion requests or a
   store-specific outage** — those need a person, even when a chunk looks relevant.
5. **Say "I don't know"** in plain language and offer the email.

## Cost controls — not optional

The corpus is ~12k tokens, so a text question costs fractions of a cent (full
model in [`../../../docs/won-toasts-chatbot-naklady.md`](../../../docs/won-toasts-chatbot-naklady.md)).
Normal usage is not the budget risk — an unbounded loop or a bored merchant is.
Four controls, all enforced server-side:

1. **`max_tokens: 400`** on every call, plus a conciseness instruction. Output is
   about half the cost of a question, so this is the strongest single lever.
2. **Rate limit per shop** — 20 questions/hour, 100/day. Over the limit the
   endpoint answers with the support email, not a model call.
3. **Monthly spend cap for the whole app, derived from paying stores**, with an
   alert well before it:

   ```
   cap = $20 + ($0.50 × active Pro stores)
   ```

   The Pro count comes from `ToastAppConfig.plan` (`prisma/schema.prisma:51`),
   which the `app_subscriptions/update` webhook already keeps in sync with
   Shopify — no extra bookkeeping. Recompute it at the start of each month.

   The **$20 floor is load-bearing**: at launch there are zero Pro stores, and a
   purely derived cap would be $0 — the bot would be dead on arrival. The floor
   also covers Free-tier traffic, which generates questions but no revenue.

   $0.50 per Pro store is ~65 Sonnet questions per store per month, against $5 of
   revenue — roughly a tenth of the subscription, and far more than a typical
   merchant asks. At 100 Pro stores the cap is $70 against $500 of revenue.

   Once the cap is reached, `/api/support/ask` stops calling the model entirely
   and replies: *"Our assistant is offline right now — email us at <address> and a
   person will answer."* The bot degrades to the required support channel, which
   is exactly what Shopify mandates anyway.
4. **Log `usage` from every response** — input, output, cache reads — into the
   same store as Insights. Without measurement every number above is an estimate.

The cap and the rate limit share one rule: **the fallback is always the support
email**, never a broken page and never silence.

## Keeping it honest

- `tests/docs/docs-freshness.test.ts` — generated reference matches the code.
- `tests/docs/docs-corpus.test.ts` — frontmatter valid, slugs unique, no dead
  links, index and `corpus.jsonl` not stale, no oversized chunk.

Both run in `npm run test:unit -w won-toasts`, so the gate fails rather than
letting the bot answer from a corpus that no longer matches the app.

## Support hours

There is no 24/7 requirement. Shopify requires one support channel, a valid
support email, and replies "in a timely manner" — no SLA. State the real hours on
the listing; the bot covers the gap outside them.
