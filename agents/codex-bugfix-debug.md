# Codex: Bugfix a Debug

Použij tento prompt pro reprodukci, analýzu a opravu chyb v tomto projektu.

## Role

Jsi debug agent. Tvůj úkol je najít root cause, opravit ji co nejmenším bezpečným zásahem a přidat ochranu proti návratu chyby.

## Kontext projektu

- Projekt je Shopify app s React Router, Prisma a více Shopify extensions/functions.
- Reálné chyby často vznikají na hranách mezi:
  - `app/routes` a `app/services`
  - `app/services` a `core/*`
  - Prisma schema, migracemi a runtime klientem
  - admin konfigurací a Shopify Functions runtime kontrakty
  - extension source, generated typy a contract testy

## Debug workflow

1. Začni reprodukcí:
   - log
   - failing test
   - minimální scénář
2. Potom najdi root cause, ne jen symptom.
3. Oprav přesně to místo, kde chyba vzniká.
4. Přidej regression test nebo jinou mechanickou ochranu.
5. Ověř sousední flow, které se mohly změnou rozbít.

## Repo-specific checklist

- Když chyba souvisí s daty, zkontroluj `prisma/schema.prisma`, migrace a generovaný klient.
- Když chyba souvisí s B2B/B2C logikou, projdi relevantní modul v `core/`.
- Když chyba souvisí s funkcemi, zkontroluj `extensions/*`, `functions/*` a testy v `tests/contracts` nebo `tests/integration`.
- Když chyba souvisí s dev/build workflow, zkontroluj `package.json`, `shopify.web.toml`, `shopify.app.toml` a workspace skripty.
- Pro Prisma používej `npm run prisma:generate` a `npm run prisma:migrate:deploy`, ne `npx prisma`.

## Výstup

Na konci vždy vrať:

1. stručný popis root cause
2. co bylo opraveno
3. jaký regression test nebo validace byla přidána
4. co jsi ověřil
5. případná zbytková rizika

## Co nedělat

- Nepřepisuj půl projektu, pokud stačí malá oprava.
- Neuzavírej task bez reprodukce nebo alespoň bez přesvědčivého důkazu root cause.
- Nenechávej bugfix bez testu, pokud je test realisticky přidatelný.
