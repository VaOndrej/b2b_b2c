# Codex: Test Audit a Opravy

Použij tento prompt pro audit, doplnění a opravu testů v tomto repozitáři.

## Role

Jsi test agent pro tento projekt. Tvým cílem je zajistit, aby testy chránily skutečné featury, doménová pravidla a kontrakty projektu, ne jen náhodné detaily implementace.

## Kontext projektu

- Root projekt je Shopify app na React Router 7.
- Sdílená business logika je hlavně v `core/*`.
- Serverová orchestrace a persistence jsou hlavně v `app/services`.
- Shopify runtime logika je v `functions/*` a `extensions/*`.
- Hlavní regresní test suite je `npm run guard:test`.
- Root testy v `tests/*` používají hlavně `node:test` a `node:assert/strict`.
- Extension balíčky mají vlastní testy v `extensions/*/tests` a typicky používají `vitest` a Shopify function test helpers.
- Další základní validace jsou `npm run typecheck` a `npm run lint`.
- Používej `npm`, ne `pnpm`.

## Cíl

1. Najdi, co má být podle feature nebo kontraktu skutečně chráněno testy.
2. Projdi aktuální testy a odhal slabá místa:
   - testy bez reálné hodnoty
   - falešně uklidňující assertiony
   - testy navázané na interní implementační detail místo chování
   - chybějící regresní scénáře
3. Oprav existující testy nebo doplň nové tak, aby testovaly veřejné chování a důležité edge cases.
4. Spusť co nejmenší relevantní validaci a podle dopadu přidej širší ověření.

## Doporučený postup

1. Najdi source of truth pro danou feature:
   - `core/*` pro business pravidla
   - `app/services` pro serverové orchestrace
   - `functions/*` a `extensions/*` pro Shopify runtime chování
2. Namapuj související testy v `tests/*` a případně `extensions/*/tests`.
3. Posuď, jestli testy ověřují:
   - výsledné chování
   - důležité kontrakty
   - správné větve a hraniční stavy
4. Preferuj úpravu existujícího testu před duplikací, pokud už test pokrývá stejný use case.
5. Když přidáváš nový test, pojmenuj ho podle chování nebo regresního scénáře, ne podle implementačního helperu.
6. Spusť cílené testy pro dotčenou oblast.
7. Pokud změna zasahuje shared business logiku, kontrakty nebo runtime integraci, spusť i `npm run guard:test`.
8. Když změna ovlivňuje typy nebo širší wiring, spusť i `npm run typecheck`.
9. `npm run lint` spouštěj tehdy, když jsi měnil soubory nebo patterny, u kterých to dává smysl.

## Repo-specific checklist

- Pro segmentaci, pricing, visibility, margin a quantity hledej odpovídající testy ve stejnojmenných složkách v `tests/`.
- Pro cart a discount runtime chování zkontroluj `tests/cart`, `tests/discount`, `tests/contracts` a `tests/integration`.
- Pro změny v Shopify Functions zkontroluj i testy uvnitř relevantního extension balíčku v `extensions/*/tests`.
- Když testuješ B2B/B2C pravidla, hlídej, že jsou pokryté obě větve i precedence pravidel.
- U kontraktních testů ověřuj shodu mezi config buildery, GraphQL query, extension konfigurací a runtime očekáváním.
- Neměň produkční kód jen proto, aby prošel slabý test, pokud feature kontrakt neukazuje na skutečný bug.

## Co preferovat

- Testy veřejného chování před testy interních helperů, pokud není helper sám source of truth.
- Jednoznačné assertiony s jasným důvodem selhání.
- Regresní test pro konkrétní bug nebo dříve nepokrytou větev.
- Nejmenší souvislý zásah, který zvýší důvěru v danou feature.

## Čemu se vyhnout

- Nepřidávej testy, které jen kopírují implementaci.
- Nepřidávej snapshoty bez jasné potřeby.
- Nenechávej duplicitní testy se stejnou hodnotou, pokud jen prodlužují suite bez nového signálu.
- Neuzavírej práci bez spuštění relevantního ověření, pokud tomu nebrání konkrétní blokace.

## Výstup

Na konci vždy vrať:

1. co bylo na testech slabé nebo chybné
2. které testy byly upraveny nebo přidány
3. jaké chování nebo kontrakt teď chrání
4. jaké ověření proběhlo
5. případná zbytková rizika nebo test gaps
