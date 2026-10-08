# Won Discounts — jak paralelizovat MVP 1–7

Návrh 2026-09-28. Podklad: [`rozhodnuti.md`](rozhodnuti.md), [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §10, [`prompt-orchestrator.md`](prompt-orchestrator.md).

## Stav

- MVP 0: Task 1–7 hotové, verdikty C1–C5 v build logu. Zbývá Task 8 (brána, QA, audit, commit).
- Necommitnuté: `packages/core/src/discounts/config.ts`, testy configu, evidence C5.
- Žebřík MVP 1–7 je dnes psaný sekvenčně. Paralelně jde jen část.

## Co paralelně nejde

- **Jiné appky.** Build fronta má 1 položku (severka). Companion ani Stepper teď nezakládat.
  Výjimka: nasazení Won Toasts (Fly, secrets, Partner Dashboard, reálný billing) je tvoje práce
  na účtech, ne stavba. Může běžet souběžně.
- **Živé E2E.** Jeden dev store, jedna `shopify app dev`, sdílené Won discount uzly a metafieldy.
  Dva živé běhy najednou si navzájem přepíšou config. Unit a contract testy paralelně, živé E2E
  v jedné frontě.
- **`packages/core`.** Jeden zapisovatel najednou (už pravidlo orchestrátoru).
- **Kampaně (MVP 6).** Přepisují pravidla napříč moduly, potřebují všechny moduly hotové.

## Kritická cesta

Engine v `packages/core/src/discounts/` (`planCart`, kombinování A1, vysvětlení, emise per uzel)
blokuje MVP 1, 2, 3, 4 a 6. Zrychlit ho nejde, jde jen odblokovat ostatní pruhy kontraktem.

## Krok 0: zmrazit kontrakty (jedna session, před rozjezdem pruhů)

1. **Config v1** v `config.ts`: typy všech modulů (codes, tiers, rewards, outlet, margin,
   campaigns), zatím bez logiky. Sanitizer + migrace z v0.
2. **`storefront_config`** (app-data metafield): tvar + fixture soubor. Na něm stojí storefront.
3. **Příznak výprodeje na variantě** (`$app:won_discounts/product`): engine z něj ví
   „výprodej s ničím“. Jediný styk pruhu Výprodej s enginem.
4. **Prisma:** modely pro Výprodej a analytiku (`OutletRun`, `OutletEvent`, `OutletLedger`,
   `OrderDiscountFact`, `NativeDiscountBackup`) jednou migrací. Paralelní migrace z víc větví
   se špatně merguje.
5. **`shopify.app.toml`:** scopes a webhooky přidává jen orchestrátor při merge pruhu
   (API-1 zakazuje scopes „na později“, takže je nejde dát dopředu).

## Pruhy

| Pruh | Obsah | Smí měnit | Čeká na |
|---|---|---|---|
| **A Engine** | MVP 1 engine + Slevy a kódy → MVP 2 marže → logika tiers (3) a rewards (4) | `packages/core/src/discounts/**`, `extensions/won-discounts-engine/**` | Krok 0 |
| **B Admin** | Detekce a přesun nativních slev + undo, onboarding 1–3, stav embedu, později UI Vyzkoušet košík | `app/routes/app.*`, `app/lib/native-*` | Config v1; napojení Vyzkoušet košík až po A |
| **C Storefront** | PDP tabulka + živá cena, košík (progress, dárek s Odmítnout, pole pro kód, Ušetříš X), vzhledy bloků | `extensions/won-discounts-storefront/**` | Fixture `storefront_config` + mock `/cart.js`; živé E2E až po A |
| **D Výprodej** | Kvóta, ledger, webhooky objednávek, `price` / `compare_at_price`, ceníky trhů, historie | `app/lib/outlet/**`, `app/routes/webhooks.orders.*`, `app/routes/app.outlet*` | Příznak varianty (krok 0). Slevu nepočítá, mění cenu. |
| **E Platforma** | Billing + downgrade (vzor Won Toasts), Dockerfile + `fly.toml`, generátor docs, analytika z `OrderDiscountFact` | `app/lib/billing*`, `app/lib/analytics*`, kořen appky | Nic |

Opravdu nezávislé jsou D a E. B a C z části. Reálně tedy 2–3 souběžné pruhy vedle A,
víc ne: review a živé E2E jdou stejně přes jednu frontu.

## Vlny

1. **Teď:** MVP 0 Task 8 → commit → krok 0.
2. **A** (engine + Slevy a kódy) ‖ **B** (přesun slev) ‖ **D** (výprodej) ‖ **E** (billing, Docker).
3. **A** (marže, tiers, rewards) ‖ **C** (storefront proti fixture) ‖ **B** (Vyzkoušet košík na `planCart`).
4. Kampaně, onboarding do 3 minut, BETA ceny na kartách, BFS kontrola.

Exit kritéria MVP ze specu platí dál. Mění se jen pořadí: výprodej (MVP 5) jde souběžně s MVP 1.

## Jak fyzicky

- **Varianta 1 (doporučená):** jeden orchestrátor, subagenti paralelně s disjunktními soubory
  podle tabulky. Už to umí `prompt-orchestrator.md`, stačí mu dát tenhle rozpis pruhů.
  Jeden `node_modules`, jeden `shopify app dev`, žádné merge konflikty.
- **Varianta 2:** git worktree na pruh a každý pruh ve vlastním terminálu. Má smysl jen pro D a E
  (dlouhé, nezávislé). Každý worktree potřebuje vlastní `npm install`; `.shopify` stav je
  per složka; živé E2E pouštět jen z `main`.
- Porty: Toasts 9883/9884, Discounts 9885/9886. Souběžný `shopify theme dev` na stejných portech
  koliduje.
