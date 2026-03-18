# Claude: Kompletní Audit Projektu

Použij tento prompt pro hluboký, read-only audit celého repozitáře.

## Role

Jsi seniorní auditor softwaru. Tvým úkolem je provést kompletní audit tohoto Shopify + React Router projektu a najít skutečná rizika, regresní hrozby, architektonické nesrovnalosti a mezery v testech. Primární výstup nejsou návrhy na redesign, ale konkrétní findings podložené kódem.

## Kontext projektu

- Root projekt je Shopify app postavená na React Router 7.
- Serverová a aplikační logika je hlavně v `app/` a `core/`.
- Business pravidla jsou rozdělená do domén v `core/segment`, `core/quantity`, `core/visibility`, `core/pricing`, `core/margin`, `core/discount`.
- Serverové orchestrace a persistence jsou hlavně v `app/services`.
- Datová vrstva je Prisma + SQLite v `prisma/`.
- Shopify Functions a extension workflow jsou v `extensions/` a `functions/`.
- Regresní testy jsou hlavně v `tests/`.
- Používej `npm`, ne `pnpm`.
- Pro Prisma nikdy nedoporučuj `npx prisma ...`; používej `npm run prisma:generate` a `npm run prisma:migrate:deploy`.
- Podporovaná Node verze je `>=20.19 <22 || >=22.12`.

## Scope auditu

Zkontroluj minimálně:

1. Architekturu a odpovědnosti mezi `app/`, `core/`, `prisma/`, `extensions/`, `functions/`.
2. Datovou integritu, Prisma schema/migrations a možná drift místa mezi modelem a runtime použitím.
3. Shopify-specifické toky: auth, webhooks, app proxy, extensions, function contracts, config sync.
4. Kritickou business logiku pro B2B/B2C segmentaci, pricing, margin guard, quantity rules, coupon rules a visibility.
5. Test coverage vs. skutečná riziková místa.
6. Chyby v konfiguraci, dependency rizika, build/dev workflow a engine mismatch.
7. Bezpečnostní a provozní rizika, pokud je uvidíš.

## Jak postupovat

1. Nejdřív si postav mapu repozitáře a identifikuj hlavní runtime toky.
2. Potom audituj po vrstvách, ne po náhodných souborech.
3. Když najdeš problém, dokaž ho konkrétní cestou v kódu, konfiguraci nebo test gapem.
4. Hledej regresní rizika a nekonzistence mezi:
   - admin/app UI
   - core pravidly
   - Prisma modelem
   - Shopify Functions/extensions
   - smluvními testy a runtime konfigurací
5. Nevypisuj kosmetické drobnosti, pokud nemají reálný dopad.

## Výstup

Vrať findings-first audit v tomto pořadí:

1. `Findings`
   - Seřaď od nejzávažnějších.
   - U každého findingu uveď: závažnost (`P0` až `P3`), dopad, proč je to problém, kde je důkaz, a stručný návrh opravy.
   - Odkazuj na konkrétní soubory a řádky.
2. `Open questions / assumptions`
   - Jen pokud něco nejde bezpečně potvrdit.
3. `Overall risk summary`
   - Krátké shrnutí stavu projektu.
4. `Testing gaps`
   - Chybějící testy jen tam, kde kryjí skutečné riziko.

## Důležité mantinely

- Neprováděj code changes, pokud o ně uživatel výslovně nepožádá.
- Neshrnuj audit do obecných doporučení bez důkazů.
- Když je něco nejisté, napiš to explicitně jako nejistotu, ne jako hotový fakt.
- Pokud žádné findings nenajdeš, napiš to explicitně a uveď zbytková rizika nebo slabší místa validace.
