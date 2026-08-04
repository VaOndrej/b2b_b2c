# Support knowledge base (template skeleton)

Zdroj pravdy pro **support chatbota** (RAG) a lidský support téhle appky. Píše se
**průběžně, ne „až bude appka hotová"** — obsah je rozvrstvený podle _stability_,
volatilní věci se **generují z kódu** a drift hlídá test. Kanonický princip a
postup: [`docs/nova-aplikace.md` §9](../../../docs/nova-aplikace.md). Živý vzor:
[`apps/won-toasts/docs/`](../../won-toasts/docs/).

## Vrstvy (řazeno podle stability, ne podle featur)

| Složka | Co tam patří | Stabilita | Kdo/kdy |
|---|---|---|---|
| `concepts/` | Mentální model: „jak to funguje / proč X". ~80 % dotazů, přežije UI refaktor. | Vysoká | **Ručně, hned.** |
| `tasks/` | „Jak nastavím Y." | Střední | **Ručně, po ustálení MVP.** |
| `reference/` | Přesné hodnoty (plan limity, enumy, config volby). `*.generated.md`. | Nízká | **Generováno z kódu — needituj ručně.** |
| `support/` | Troubleshooting / FAQ. | Střední | Ručně. |

## Frontmatter (povinný na každém dokumentu)

Zkopíruj z [`concepts/_example.md`](concepts/_example.md). Klíčová metadata pro RAG:
`layer`, `feature`, `min_plan` (chatbot skryje Pro-only Free merchantovi),
`status` (skryje `planned`/`beta`, dokud featuru nepřepneš na `stable`), `source`,
`lang`, `summary`, `keywords`. **Jeden dokument = jedno téma**, krátký samostatný
chunk.

## Generovaná reference + drift guard (nastav při stavbě)

1. Enumy své domény drž jako **exportované runtime konstanty** v `@won/core/<doména>`
   (`readonly [...] as const satisfies …`), ne jen `type`.
2. Přidej `apps/<appka>/scripts/gen-docs.ts` s čistou `buildDocs()` a npm skript
   `docs:gen`. Zkopíruj z won-toasts a přemapuj importy.
3. Přidej `tests/docs/docs-freshness.test.ts` — je součástí `test:unit`, takže i
   gate každého MVP. Když se změní enum a `reference/` se neregenerovala, spadne.

```bash
npm run docs:gen -w <appka>     # přepíše reference/*.generated.md z kódu
```
