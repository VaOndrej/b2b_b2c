# Won Discounts — kontrola Built for Shopify (2026-10-04)

Statická kontrola proti požadavkům Built for Shopify a App Store + co šlo změřit lokálně. Appka **není nasazená**
ani v App Storu, takže část kritérií (data z reálných obchodů) ověřit nejde — je to u nich napsané.
Zdroj požadavků: shopify.dev „App quality“, „About performance optimization“, „Storefront performance“
(dotaz přes Shopify dev MCP 2026-10-04).

Legenda: ✅ splněno s důkazem · 🟡 připraveno, ověří se až po nasazení · ❌ nesplněno.

## 1. Výkon

| Požadavek | Stav | Důkaz / co chybí |
|---|---|---|
| Storefront: Lighthouse skóre neklesne o víc než 10 bodů (vážený průměr: home 17 %, produkt 40 %, kolekce 43 %) | 🟡 | Lighthouse před / po se měří na čistém tématu bez dalších appek — na sdíleném dev storu neproveditelné poctivě. Lokálně změřená váha níž. |
| JS na stránku ≤ 10 kB gz (interní SF-2) | ✅ | `tests/contracts/perf-budget.contract.test.ts` (měří `gzipSync`): stránka produktu **10 226 B z 10 240 B** (rezerva 14 B — další JS na PDP se nevejde), košík 5 635 B, kolekce / vyhledávání 6 734 B; každý soubor ≤ 10 000 B raw (Theme Check). |
| Skripty `defer`, žádný blokující | ✅ | `theme-extension.contract.test.ts` (schema `javascript` + 2 × `<script … defer>`). |
| Embed nemění košík bez akce zákazníka, žádné globální styly | ✅ | SF-1 contract testy; vlastní CSS vždy pod kořenem bloků (`scope-css.test.ts`). |
| Posun layoutu (CLS) na storefrontu | 🟡 | Tabulka na PDP, panel košíku a blok karty jsou v HTML ze serveru. **Řádek na kartách přes embed (BETA) se vkládá skriptem po načtení → posune kartu.** Bez posunu je blok do karty (Horizon). |
| Admin: LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms (75. percentil, měří Shopify z reálných obchodů) | 🟡 | Měří se až po nasazení (Web Vitals v Partner Dashboardu). Lokálně: stránky adminu se renderují na serveru, loader Přehledu čte paralelně s limity (`NATIVE_DETECTION_DEADLINE_MS` 4 s, `ACTION_SYNC_DEADLINE_MS`). |
| Pokladna: žádné rozšíření UI; funkce v limitu instrukcí | ✅ | Jen Discount Function: realistické košíky ≤ 90 %, žádný zkonstruovaný tvar ≥ 100 % (README funkce; B0 6.1 max 99,90 %). |

Váha souborů rozšíření (raw / `gzip -9` z příkazové řádky; test měří `gzipSync`, vychází o ~20 B na soubor méně):

| Soubor | raw | gz | Kde se načítá |
|---|---|---|---|
| `won-discounts.js` | 7 068 | 2 579 | každá stránka (embed) |
| `won-discounts-cart.js` | 8 333 | 3 093 | každá stránka, jen s odměnami |
| `won-discounts-tiers.js` | 6 918 | 2 416 | stránka produktu |
| `won-discounts-tiers-core.js` | 5 802 | 2 224 | stránka produktu |
| `won-discounts-cards.js` | 2 264 | 1 122 | kolekce / vyhledávání, jen se zapnutými kartami |

## 2. Integrace se Shopify

| Požadavek | Stav | Důkaz |
|---|---|---|
| Embedded appka, App Bridge, session token | ✅ | `shopify.app.toml` `embedded = true`; `authenticate.admin` v každé routě; navigace `@won/app-kit/admin-nav`. |
| Slevy přes Discount Function (ne Scripts, ne draft orders) | ✅ | `extensions/won-discounts-engine` (API 2026-04), slevy jsou vidět v Shopify adminu jako slevy appky. |
| Storefront jen přes theme app extension (žádný zásah do kódu tématu, žádný ScriptTag) | ✅ | `extensions/won-discounts-storefront` (embed + 4 bloky), deep linky do editoru tématu; scope `write_themes` appka nemá. |
| Minimum scopes | ✅ | `write_discounts, read_products, write_products, read_themes` + volitelný `read_markets`; `read_orders` až po schválení (`scripts/activate-orders.mjs`). |
| Billing přes Shopify Billing API | ✅ | `app/lib/billing.server.ts` (`appSubscriptionCreate`, 29 USD, 14 dní zkouška), plán jen z ověřeného předplatného; **živě čeká na schválení testovacího předplatného Ondřejem**. |
| Povinné compliance webhooky (customers/data_request, customers/redact, shop/redact) | ✅ | `tests/compliance-webhooks.test.ts`; `shop/redact` maže i plán a fakta objednávek (`webhooks.billing.test.ts`). |
| Webhooky ověřené HMAC, idempotentní | ✅ | `authenticate.webhook`; testy rout s podepsanými požadavky (outlet, billing, targeting, costs). |
| Odinstalace nezanechá škodu | ✅ | „Připravit na odinstalaci“ (ceny výprodejů zpět, nativní slevy obnovené); data se mažou až `shop/redact`. |

## 3. Design a použitelnost

| Požadavek | Stav | Důkaz |
|---|---|---|
| Polaris web components, vzhled jako součást adminu | ✅ | Obrazovky z `s-*` komponent; screenshoty 390 / 1440 v `evidence/mvp*/admin/`. |
| Mobil (Shopify mobile) | ✅ | Harness 390 px bez vodorovného přetečení (`overflowX=0` u všech 12 obrazovek MVP 7). |
| Onboarding, který dovede k první hodnotě | ✅ | 5 kroků, kroky 4–5 se otevírají samy podle stavu obchodu. |
| Jazyk adminu podle Shopify (cs / en) | ✅ | `tests/ui/i18n.test.ts` (stejné klíče a zástupné znaky). |
| Poctivá čísla, žádné „appka vydělala X“ | ✅ | Přehledy: cena vs. tržby, bez tvrzení o přínosu. |
| Přístupnost | 🟡 | Nativní prvky a popisky; graf má `role="img"` + popisek. Audit čtečkou obrazovky neproběhl. |

## 4. App Store a provoz (nejde ověřit před nasazením)

| Požadavek | Stav |
|---|---|
| Minimální počet instalací, recenzí a hodnocení pro odznak | 🟡 po listingu |
| Listing, ochrana osobních údajů, podpora | 🟡 texty pro podporu jsou v `apps/won-discounts/docs/` (247 úryvků pro chatbota) |
| Dostupnost a chybovost v produkci | 🟡 `DEPLOY.md`: jedna instance, health `/healthz`, migrace v `release_command` |

## Co udělat po nasazení (pořadí)

1. Lighthouse před / po na čistém Horizonu (home, produkt, kolekce) — cíl pokles ≤ 10 bodů.
2. Web Vitals adminu z Partner Dashboardu po prvních 100 otevřeních.
3. Rozhodnout, jestli řádek na kartách přes embed (CLS) nechat jako BETA, nebo doporučovat jen blok do karty.
