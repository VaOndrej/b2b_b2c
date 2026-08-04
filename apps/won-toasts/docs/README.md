# Won Toasts — support knowledge base

Zdroj pravdy pro **support chatbota** (RAG) a lidský support. Cíl: dokumentace,
u které je **změna levná** — píše se průběžně, ne „až bude appka hotová", a
zároveň se s vývojem nerozjede z reality.

Kanonický princip (platí pro každou Won appku, viz
[`docs/nova-aplikace.md` §9](../../../docs/nova-aplikace.md)): **nepiš „až bude
hotovo" a nepiš „všechno teď".** Rozvrstvi obsah podle _stability_, volatilní
věci **generuj z kódu**, task návody dopisuj **po ustálení každého MVP**.

## Vrstvy (řazeno podle stability, ne podle featur)

| Složka | Co tam patří | Stabilita | Kdo to píše |
|---|---|---|---|
| [`concepts/`](concepts/) | Mentální model: co je toast, milestone, Free vs Pro, targeting. Odpovídá na „jak to funguje / proč to nedělá X". | Vysoká — přežije refaktor UI | **Ručně.** Piš hned. |
| [`tasks/`](tasks/) | Task návody: „jak nastavit free-shipping milestone". | Střední | **Ručně, po ustálení MVP.** |
| [`reference/`](reference/) | Přesné hodnoty: plan limity, event typy, locale, config schéma. | Nízká — mění se s kódem | **Generováno z kódu** (`*.generated.md`). Needituj ručně. |
| [`support/`](support/) | Troubleshooting / FAQ pro chatbota. | Střední | Ručně. |

**Proč tohle rozdělení:** ~80 % supportních dotazů je „jak to funguje / proč to
nejde", ne „na které tlačítko". Koncepty (nejlevnější na údržbu) pokrývají většinu
a přežijí UI změny. Přesné názvy tlačítek, limity a screenshoty (nejdražší na
údržbu) do textu **nepíšeme** — buď generujeme z kódu, nebo držíme na minimu.

## Frontmatter (povinný na každém dokumentu)

RAG má jiné nároky než dokumentace pro člověka: malé samostatné chunky + metadata,
ať chatbot umí odfiltrovat zastaralé a plan-irrelevantní věci.

```yaml
---
title: Free shipping milestone          # lidský název
slug: free-shipping-milestone           # stabilní ID (== název souboru bez .md)
layer: task                             # concept | task | reference | support
feature: milestones                     # cart-toasts | milestones | design | targeting | plans | core
min_plan: free                          # free | pro  → chatbot skryje Pro-only featury Free merchantům
status: stable                          # stable | beta | planned → chatbot neodpovídá na planned/beta
app_version: MVP4                        # od kdy featura platí (MVP fáze nebo semver)
source: hand-written                    # hand-written | generated
generated_from: null                    # cesta ke zdroji; vyplní jen generátor
lang: en                                # jazyk chunku (App Store audience = en; cs/sk možné)
updated: 2026-08-04                      # datum poslední revize → detekce stale
keywords: [free shipping, threshold, progress]
summary: One-line, retrieval-friendly popis, co dokument řeší.
---
```

Pravidla:

- **Jeden dokument = jedno téma / jedna otázka.** Dlouhé kapitoly retrievalu škodí
  — radši víc malých souborů.
- `min_plan` a `status` jsou pro chatbota **filtry**, ne dekorace. `planned`/`beta`
  se do odpovědí nedostane; `min_plan: pro` se neukáže Free merchantovi.
- `updated` + `app_version` = detekce zastaralosti. Když refaktoruješ MVP, víš, co
  je stale.

## Generovaná reference — single source of truth

Co jde odvodit z kódu, **nepíšeme ručně podruhé.** Plan gating, event typy,
template typy, locale a config verze se generují z `@won/core/toasts`:

```bash
npm run docs:gen -w won-toasts      # přepíše reference/*.generated.md z kódu
```

Když se změní kód (např. přibude event typ nebo se zvedne Free limit), generátor
dopíše aktuální hodnoty a chatbot je dostane zadarmo. Ručně do `reference/`
nesahej — přepíše se.

## Drift guard (CI)

`tests/docs-freshness.test.ts` regeneruje referenci do paměti a porovná s
commitnutými `*.generated.md`. **Když se změní enum/plan config a reference se
nesáhla, test spadne** — dokumentace se nemůže tiše rozejít s realitou. Součást
gate (`npm run test:unit -w won-toasts`).

## Přidání dokumentu — checklist

1. Vyber vrstvu (`concepts/` když je to „jak/proč", `tasks/` když „jak nastavím",
   `support/` když troubleshooting). Reference **negeneruješ ručně.**
2. Zkopíruj frontmatter výše, vyplň `min_plan` + `status` + `app_version` pravdivě.
3. Rozpracovanou featuru dej `status: beta` nebo `planned` — chatbot na ni
   nebude odpovídat, dokud ji nepřepneš na `stable`.
4. Krátký, samostatný chunk. Odkazuj mezi dokumenty přes `slug`.
```
