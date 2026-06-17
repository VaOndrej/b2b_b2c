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

## ZÁVAZNÁ PODMÍNKA: úplné pokrytí všech větví a use cases

Testy musí pokrývat **každou feature, každou větev a každý smysluplný use case aplikace** — ne reprezentativní vzorek. Tohle je tvrdý požadavek, ne doporučení.

**Source of truth pro matici:** `prisma/schema.prisma` (15 tabulek pod `MarginGuardConfig`). IGNORUJ `database/schema.prisma` — je to zastaralý prototyp (SegmentRule/MarginRule), neodpovídá realitě.

**Co musí být pokryté (minimálně jeden asertující test na každou položku a větev):**

- Globální přepínače (`MarginGuardConfig` singleton): `marginGuardEnabled` (true/false – kill switch), `b2bTag`, `globalMinPricePercent` vs `b2bGlobalMinPricePercent` (B2C vs B2B floor), `allowStacking` (true/false), `maxCombinedPercentOff`, `allowZeroFinalPrice` (true/false), `allowRemoveAtMinimumOrderQuantity` (true/false).
- Per-product/kolekce pravidla: `ProductFloorRule` (vč. `b2bOverridePrice` set/unset a `allowZeroFinalPrice` override), `ProductTierPriceRule` (víc tierů), `ProductQuantityRule` (MOQ/step/max ve všech kombinacích), `CollectionQuantityRule`, `ProductVisibilityRule` / `ProductVariantVisibilityRule` / `CollectionVisibilityRule` (každý platný `visibilityMode`), `StorefrontContentRule` (každý `action`, `targetType`+`targetPosition`, `pageType`, `value`+`valueCsLocale`, `priority` řazení, `active` true/false).
- Slevy: `CouponSegmentRule`, `DiscountRule` (každý `scope`, každý `stackMode`, `priority` řazení, `minPricePercentOfBasePrice`, s code i automatická), `DiscountCombinationBlacklistRule`, `DiscountSegmentCap`.
- `MarginViolationLog`: NESEEDUJ — asertuj, že se zapisuje při porušení floor.

**Dimenze větvení, na které nesmí zapomenout:**
- `segment`: pokrý `null` (vše), `B2C` i `B2B` u všech pravidel, která segment mají.
- Enum hodnoty (`visibilityMode`, `stackMode`, `scope`, `action`, `targetType`, `targetPosition`, `pageType`, `segment`) NEHÁDEJ — vytáhni je z app validátorů/TS typů (zod apod.) a pokrij každou platnou hodnotu.
- Boolean toggles vždy v obou stavech; pravidla s `priority` ověř i na precedenci/řazení.

**Omezení prostředí (určují tier pokrytí):**
- Tier-1 storefront testy běží proti **oběma tématům** — Horizon (live) i Dawn (přes `preview_theme_id`).
- Dev store je na nových (passwordless) zákaznických účtech (login jen Shop/Google/Facebook, žádné heslo) → reálný B2B login do prohlížeče **nejde automatizovat**. B2B se proto pokrývá ve dvou rovinách:
  - **B2B EFEKTY** (visibility / varianty / quantity) se renderují na storefrontu přes **gated per-request override** `mg_e2e_segment`, který vynutí segment bez loginu — Tier-1 matice běží jako **téma × segment** (Horizon+Dawn × B2C+B2B), stejné specy asertují hodnoty odpovídající segmentu projektu.
  - **B2B TRIGGER** (zákazník s tagem `b2b` → segment) se pokrývá **integračně**: čistý engine (`tests/segment/segment-detection.test.ts`) + app-proxy visibility loader s mocknutým Admin tag lookupem (`tests/visibility/margin-guard-visibility.loader.test.ts`).
- Override testuje **EFEKTY, ne trigger.** Zbytkový gap: override záměrně **obchází reálné app-proxy customer plumbing** (`logged_in_customer_id` → fetch tagů zákazníka přes Admin API), takže reálné rozpoznání segmentu z přihlášeného zákazníka pokrývá **integrační test triggeru**, ne storefront E2E. Druhý gap: **server-rendered Liquid vrstva** (`segment-default-hide` CSS + projection bootstrap) renderuje DOM hiding (product visibility banner/karta + collection karty) z reálného (anonymního→B2C) zákazníka a `mg_e2e_segment` ji nevynutí — proto se pod B2B projektem product visibility asertuje na úrovni **`/visibility` payloadu** (vrstva, kterou override řídí; quantity + variant visibility jsou taky payload-driven, takže pod B2B fungují plně) a DOM banner/karta + collection hiding se asertují jen na B2C. DOM hiding pro přihlášeného B2B zůstává na projection unit + embed contract testech.
- Override flag `MARGIN_GUARD_E2E_OVERRIDE=1` **vlastní test runner** (Playwright `webServer.env` + `scripts/run-playwright-e2e.mjs`), **NE `.env`/git** — injektuje se jen pro dobu testů a v produkčním buildu je tvrdě vypnutý (`NODE_ENV === "production"` → no-op), takže bez flagu nemá `mg_e2e_segment` žádný efekt.
- "Pusť všechny testy" = `npm run test:e2e` → projede matici téma × segment v pořadí **B2C → B2B** (oba B2B projekty mají `dependencies` na oba B2C → všechny B2C doběhnou první), a teprve pak **sériový shop-level tier** (checkout + globální toggles, běží jednou).
- Per-customer větve (`ProductCustomerQuantityRule`, visibility s `customerId`) vyžadují konkrétního přihlášeného zákazníka → pokrývej je na **integračním tieru** se simulovaným kontextem, ne přes prohlížeč (override nese jen segment, ne `customerId`).
- Seed je **idempotentní a aditivní**, jedna rule-set na jeden dedikovaný produkt/kolekci (žádné překrývání při storefront resolution), žádný globální reset. Shop-level zápisy (singleton config, checkout/function metafield) jsou sériové.

**Definition of done:** každá tabulka i větev výše má aspoň jeden test s jednoznačnou assertion; `npm run guard:test:core` (203) a `npm run typecheck` zelené; e2e Tier-1 prochází na Horizonu i Dawn. Zbytkové gapy (co nejde pokrýt a proč) explicitně vyjmenuj ve výstupu.

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
- Nezapomeň ještě na Playwright, když jde nějaký test pokrýt i playwright, tak to chceme mít všechno pokryté

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
