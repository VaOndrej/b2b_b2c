# Audit MVP 5 — Výprodej (2026-10-02)

Rozsah: `git log 01bcf12^..HEAD` (plán O1–O11, B0 rozpočet, core, server + scheduler + webhooky, funkce, storefront,
admin, docs, E2E). Způsob: inline podle `.claude/agents/won-auditor.md` (findings-first, P0–P3, důkaz soubor:řádek),
plus samostatná kontrola shody Rust ↔ TS a rozpočtu instrukcí.

## Findings

Žádný P0 ani P1. Nalezeno během stavby (opraveno hned, s testem) a auditním průchodem po bráně.

### Nalezené během stavby

| # | P | Dopad | Důkaz | Oprava |
|---|---|---|---|---|
| S1 | P1 | Seznamy `outlet` v produktovém metafieldu (návrh plánu) by na zkonstruovaných košících přesáhly limit instrukcí (102,38 %) — checkout by uzel s výprodejem neobsloužil | B0, `tests/budget-families/outlet-variants.mjs`, plán „Rozpočet — výprodej“ | příznak na variantě `wonOutlet` (`8a67d72`, `55dcdbb`), rodiny 99,80 / 99,89 % |
| S2 | P2 | Delivery dotaz by s polem `wonOutlet` stál 31 bodů (> 30): Shopify by funkci nenasadil | `tests/query-cost.test.js` | delivery dotaz bez `discountClasses` (Shopify delivery target pro uzel bez SHIPPING nespouští), pojistka zůstává pro vstup, který třídy uvádí; přímý test Wasm = TS (`parity.test.js` „delivery: the classes“) |
| S3 | P2 | Objednávka z doby výprodeje, jejíž webhook dorazí po konci, by se nezapočetla (přeprodej neviditelný) | `outlet.server.ts` `recordOutletWebhook` | počítá se do běhu, který skončil až po zadání objednávky (`oversold`), test |
| S4 | P2 | Objednávka zadaná v okně `starting` (ceny už snížené) se nepočítala; znovuotevření drželo starý `startedAt` | `outlet.server.ts` `applySale`, `reopenOutletRun` | `startedAt` se zapíše se zálohou před prvním zápisem ceny, reopen ho nuluje (`5e72f8f`), 2 testy |
| S5 | P3 | Štítek s přepínáním podle vybrané varianty by potřeboval ~460 B gz JS při rezervě 14 B | `perf-budget.contract.test.ts` | blok bez skriptu, varianty jménem (`eaf15da`) |

### Audit

| # | P | Dopad | Důkaz | Oprava |
|---|---|---|---|---|
| A1 | P2 | Souběžný konec téhož výprodeje (tlačítko v adminu, webhook vyčerpané kvóty, scheduler) — dvojí zápisy cen a zdvojená událost „ended“ v historii | `outlet.server.ts` `endOutletRun`, `settleOutletWebhook`, `scheduler.server.ts` `runOutletDueOnce` | per-běh fronta v procesu (start / konec / znovuotevření téhož běhu za sebou), test souběhu |
| A2 | P3 | Picker vybírá víc produktů, obrazovka vezme tiše první | `OutletScreen.tsx` `pick`, `app-bridge.ts` `pickProducts` (`multiple: true`) | `pickProducts(…, { multiple: false })` pro výprodej |
| A3 | P3 | Změna zobrazení na webu se u běžících výprodejů projeví až s další objednávkou (hodnota pro blok štítku) | `outlet-admin.server.ts` `settings` | po uložení se přepíše hodnota pro storefront u produktů s běžícím výprodejem; docs: přeškrtnutí (compare_at) se mění jen u nových výprodejů |
| A4 | P3 | Po odinstalaci zůstane výprodejová cena (appka ztratí přístup) — „Připravit na odinstalaci“ je až MVP 7 (A7) | `webhooks.app.uninstalled.tsx` | docs concept: před odinstalací výprodeje ukončit; MVP 7 |

## Shoda Rust ↔ TS a rozpočet instrukcí

- **Fixtures** 116 (2 nové pro variantní příznak; rozpočtové long-ids 196 a mesh 198 řádků — 200 řádků s polem
  `wonOutlet` se nevejde do limitu vstupu), **parita** (náhodné košíky všech rodin) 0 rozdílů, přímý test tříd v delivery.
- **Replay** 3 392 zalogovaných běhů: nový Wasm (245 497 B) = MVP 4 Wasm na všech; 194 rozdílů od logu = tatáž
  vysvětlená množina jako v ověření MVP 4.
- **Rozpočet** (stop-pravidla zapsaná předem v plánu): rodiny cap 550 × `wonOutlet` 9 960 běhů max 99,80 %, rodiny
  s odměnami × `wonOutlet` 6 640 běhů max 99,89 %, 0 ≥ 100 %, 0 DIFF. **Riziko R1 (P3, otevřené): rezerva 0,11 bodu**
  — každé další čtení per řádek (MVP 6–7) nejdřív uvolní instrukce. Oba dotazy 30/30 bodů (riziko R2: nové pole jen
  za cenu jiného).
- Wasm 245 497 B < 256 000 B; dotazy 1 800 / 1 891 znaků.

## Open questions / assumptions

- **F-O1 (blokuje živé E2E kvóty):** odběr `orders/create`, `orders/cancelled`, `refunds/create` vyžaduje přístup
  appky k chráněným datům zákazníků (Partner Dashboard). Kód webhooku a scheduleru je hotový a testovaný podepsanými
  payloady; odběr se do `shopify.app.toml` přidá po povolení.
- Variantní metafieldy `$app:won_discounts` v Liquidu: blok množstevních slev je čte už pro `pdp` (MVP 3); `outlet`
  stejně — naživo ověřené jen bez množstevního bloku na výprodejové variantě (E2E profil `outlet` nemá sadu úrovní).

## Overall risk summary

Výprodej mění skutečné ceny, takže rizika jsou v zápisech: záloha je vždy před zápisem, příznak před cenou a cena před
odebráním příznaku, cizí změna ceny se nikdy nepřepíše, selhání se opakuje se stavem v DB. Funkce se změnila jen o
čtení jednoho pole a rozpočet drží, ale s minimální rezervou. Největší otevřené riziko je provozní: bez přístupu
k objednávkám (F-O1) kvóta v produkci neodečítá a výprodej končí jen datem nebo ručně.

## Testing gaps

- Živě neověřené: počítání kvóty z objednávek, storno a vratka (F-O1, F-O4b), znovuotevření po vratce.
- Výprodejová varianta s množstevním blokem na stejné stránce: jen contract test Liquidu.
