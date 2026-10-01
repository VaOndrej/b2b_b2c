# Won Discounts MVP 4 — Odměny + košík (implementační plán, inline)

> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §0 (princip 4, 6), §2 (`RewardsModule`, `GiftTier`),
> §3 body 2, 5, 6 + `progress`/`warnings`/`gifts`, §4.3, §6, §7, §10 (MVP 4). Rozhodnutí: `rozhodnuti.md` „Dárky vs. další
> slevy“, „Prahy per trh / měna“, Free/Pro tabulka (Free: doprava zdarma + 1 dárkový práh per měna; Pro: žebřík, výběr ze
> 3). Mezery A4 (vyprodaný dárek), A11 (Toasts `_gift_progress`). Stav: [`../won-discounts-build-log.md`](../won-discounts-build-log.md).
> Práce **inline bez subagentů** ([`../won-discounts/prompt-pokracovani-inline.md`](../won-discounts/prompt-pokracovani-inline.md)).

**Goal:** Merchant nastaví dopravu zdarma a dárek od prahu (per měna; Pro žebřík a výběr ze 3). Košík (stránka i drawer,
Horizon + Dawn) ukáže progress k prahům, dárek s „Odmítnout“, pole pro kód s varováním o dárku, „Ušetříš X“ a tip
„přidej 1 ks“. V pokladně je dárek vždy 0 a doprava zdarma podle prahu — obojí počítá funkce (TS = Rust).

**Architecture:** Odměny jsou nový modul enginu (`module: "rewards"`): práh = mezisoučet nedárkových řádků **před**
slevami v měně košíku; doprava zdarma = kandidát doprava 100 % (sčítá se podle A1), dárek = 100 % na 1 ks dárkového
řádku (`_won_gift` = id úrovně, varianta z nabídky úrovně). Funkce emituje obojí z automatického uzlu. Košík v embedu mění
košík **jen** přes `Shopify.actions.updateCart` (téma se samo překreslí — F-R1) a jen jako reakci na akci zákazníka.
Tip „přidej 1 ks“ a „Ušetříš“ počítá server přes app proxy (`/apps/won-discounts/cart-plan`, tentýž `planCart`).

## Global Constraints

- Vše z plánů MVP 0–3 (jen dev store, žádný deploy, povolené cesty, tajné soubory nečíst, dry-run + záloha).
- **Princip 4:** dárek se v pokladně nikdy neplatí, checkout se nikdy neblokuje. Funkce počítá práh vždy před slevami
  (i při `countOtherDiscounts`). Dárek mimo všechny ostatní slevy, prahy i marži (už platí, A1.2).
- **MKT-1 / prahy per měna:** žádný přepočet kurzem; měna bez hodnoty = odměna se v tom trhu nenabízí a admin to řekne.
- **SF-1 (Ondřej):** embed nikdy nemění košík bez akce zákazníka. Přidání dárku = reakce na změnu košíku zákazníkem,
  která práh překročila; odebrání = reakce na změnu, která ho podlezla; nikdy při načtení stránky. Žádný layout shift.
- **SF-2:** všechno storefront JS ≤ 10 240 B gz dohromady, každý soubor ≤ 10 000 B raw; čitelné (bez minifikace) —
  dlouhá próza komentářů se přesune do `extensions/won-discounts-storefront/README.md`.
- **Funkce:** Wasm < 256 000 B s rezervou ≥ 1 000 B; dotaz ≤ 3000 znaků a ≤ 30 bodů; realistické košíky ≤ 90 %,
  běžné fixtures ≤ 70 %, žádný zkonstruovaný tvar ≥ 100 %. Každá změna logiky = TS + Rust + fixtures + parita + replay.
- **BILL-1:** payload, storefront config, app proxy plán i admin data z `gateConfigForPlan` (Free: doprava + 1 práh + 1
  dárek; ořez Pro nikdy nerozšíří odměnu).
- Config funkce ≤ 9 000 B nejhorší případ (odměny započítat do `function-payload` worst case).

---

## Kontrakty (zafixované před implementací)

**R1 — Základ prahu.** `rewardBase(cart)` = Σ `unitPrice × quantity` řádků bez `giftTierId` (minor units měny košíku,
před všemi slevami; výprodejové řádky se počítají — je to cena, kterou zákazník platí, §3 bod 1). Funkce, plán, admin
i storefront používají tento základ. `rewardBaseAfterDiscounts` = základ − produktové a objednávkové slevy těch řádků
(jen pro storefront a varování při `countOtherDiscounts: true`; funkce ho nepoužívá).

**R2 — Doprava zdarma.** `rewards.freeShipping.threshold[cur]` existuje a `rewardBase ≥ threshold` → kandidát dopravy
`{ ruleId: "reward:shipping", module: "rewards", percent: 100 }` (sčítá se s produkty/objednávkou podle A1
`productWithShipping`/`orderWithShipping`; s jiným pravidlem dopravy vyhrává vyšší %, tj. remíza 100 = stabilní pořadí
`priority desc, id asc`, priorita 0). Bez hodnoty v měně = nenabízí se (`progress.freeShipping` chybí, warning
`market_missing_threshold` s `ruleId: "reward:shipping"`).

**R3 — Dárek.** Úrovně `gifts` se vyhodnotí v pořadí configu. Úroveň je **dosažená**, když má práh v měně košíku a
`rewardBase ≥ threshold[cur]`. Dárkový řádek = řádek s `giftTierId = <id úrovně>` a variantou z `choices` nebo
`fallbackVariantId` té úrovně. Pro každou dosaženou úroveň dostane **první** takový řádek (pořadí košíku) produktovou
alokaci `{ ruleId: "gift:<tierId>", module: "rewards", amount = unitPrice }` na **1 ks** (cíl `cartLine {id, quantity: 1}`),
procento 100, zpráva „Dárek zdarma“ / „Free gift“. Další kusy a další dárkové řádky téže úrovně se platí (warning
`gift_extra_paid`), dárkový řádek nedosažené / neznámé úrovně nebo s cizí variantou se platí (warning
`gift_not_earned`). Dárek nedostane žádnou jinou slevu ani marži (beze změny A1.2). Free: jen první úroveň a její první
nabídka (gate už to dělá). `gifts[]` v plánu: jeden záznam na úroveň `{tierId, lineId?, state}` se stavy
`earned` (řádek je zdarma) · `missing` (dosaženo, dárek v košíku není) · `below` (nedosaženo) · `not_offered` (bez
prahu v měně). Stav `declined`/`out_of_stock` určuje storefront (R7), engine ho nezná.

**R4 — Varování a progress (TS; funkce je nepotřebuje).** `progress.freeShipping = {threshold, remaining, reached}`,
`progress.gifts = [{tierId, threshold, remaining, reached}]` (jen úrovně s prahem v měně), obojí z `rewardBase`; při
`countOtherDiscounts: true` navíc `afterDiscounts: {remaining, reached}` z `rewardBaseAfterDiscounts` a warning
`code_loses_gift {tierId}`, když `reached` před slevami ale ne po nich. `tierHint` (MVP 3) se nově vydá jen tehdy, když
plán s přidanými `missing` kusy dá zákazníkovi víc (respektuje výlučný přepínač produkt/objednávka a marži) — počítá se
přeplánováním, ne odhadem.

**R5 — Payload funkce (shop config).** Nový klíč `r` (vynechán, když odměny nic nenabízejí):
```jsonc
"r": {
  "s": { "CZK": 100000, "EUR": 4000 },             // doprava zdarma: práh v minor units per měna (chybí = žádná)
  "g": [ ["gift-1", { "CZK": 150000 }, [48468678902001, 48468679000305]] ]
  //      id úrovně, práh per měna,     numerická id variant (nabídka + záložní), pořadí = pořadí configu
}
```
Velikost: Pro max `CONFIG_LIMITS.giftTiers` (10) × 4 varianty, 2 měny → započítat do worst case 9 000 B; když se nevejde,
admin uložení odmítne (stejně jako jiné části) a strop odměn v payloadu se zapíše do specu.

**R6 — Výstup funkce.** Dárek: `productDiscountsAdd` kandidát s cílem `cartLine { id, quantity: 1 }`, `percentage: 100`,
zpráva R3; jede v tomtéž výstupu jako ostatní produktové kandidáty (na dárkovém řádku nikdy jiný). Doprava: existující
cesta dopravy (100 % na všechny skupiny), zpráva „Doprava zdarma“ / „Free shipping“. Emituje automatický uzel.

**R7 — Storefront config (K5 v1, aditivně).**
```ts
rewards?: {
  ship: Record<string, number> | null;                       // Liquid units (major × 100) per ISO měna
  gifts: { id: string; t: Record<string, number>; c: { v: number; h: string }[]; f?: { v: number; h: string } }[];
  // t = práh v Liquid units per měna, c = nabídka (Free 1, Pro ≤ 3), f = záložní dárek (A4)
  other: boolean;                                             // countOtherDiscounts
};
```
`h` = handle produktu (sync ho dohledá při stavbě configu); Liquid z něj přes `all_products[h]` vykreslí titulek, obrázek
a `available` varianty do JSON embedu (nejvýš 20 handle na stránku → strop `giftTiers × 4` drží ≤ 40 — **ověřit
F-R2**; nad 20 se zbytek doplní z `/products/<h>.js` až při otevření košíku). Vyprodaná nabídka se nenabízí, poctivá věta
„Dárek je vyprodaný“, pak záložní (A4). Odmítnutí: atribut košíku `_won_gift_declined` = id úrovní oddělená čárkou
(attributes se přepisují celé — embed vždy sloučí se stávajícími z `/cart.js`). Toasts (A11): atribut košíku
`_gift_progress` = `"<base>/<threshold>"` nejbližší nedosažené úrovně (jen čtení pro jiné appky, bez závislosti).

**R8 — Košík v embedu (DOM, chování).** Jeden panel `[data-won-discounts-cart]` na dvou místech:
- stránka košíku: app blok `cart_rewards` (cíl `section`, šablona `cart`; Dawn `main-cart-footer`, Horizon `main-cart` mají
  `@app`), Liquid vykreslí výchozí stav serverově (bez CLS);
- drawer: embed vloží panel do drawer kontejneru tématu (Horizon `cart-drawer-component`, Dawn `cart-drawer`,
  jinak nic) po otevření/změně košíku; místo v drawer je rezervované až po prvním vykreslení (drawer je zavřený = žádný
  posun obsahu stránky).
Panel: `data-won-discounts-progress` (pruh + text „Do dopravy zdarma zbývá X“, „Dárek zdarma od Y“), `data-won-discounts-gift`
(dárek, „Odmítnout“, Pro výběr ze 3, vyprodaný), `data-won-discounts-code` (pole + tlačítko, stav kódu z
`discount_codes[].applicable`, varování `code_loses_gift` s volbou „Ponechat kód“ / „Zrušit kód“),
`data-won-discounts-saved` („Ušetříš X“ = `original_total_price − total_price`), `data-won-discounts-hint` (R4 `tierHint` z app
proxy). Změny: jen `Shopify.actions.updateCart` (tempo ≥ 1,5 s mezi zápisy kvůli Cloudflare), čtení `/cart.js`. Signály
změny: `shopify:cart:lines-update`, `shopify:cart:discount-update`, Dawn pubsub `cart-update`. Událost
`won-discounts:cart:update` (`detail: {base, gifts, shipping}`) po každém vykreslení.

**R9 — App proxy plán.** `POST /apps/won-discounts/cart-plan` (podpis app proxy, shop z podpisu, BILL-1 gated config):
vstup `{ currency, country?, lines: [{key, variantId, productId, quantity, unitPrice, gift?}], codes: [] }` (≤ 100 řádků),
server dočte produktové/variantní metafieldy (Admin API, cache 60 s per shop+produkt) a vrátí jen
`{ tierHint?, savedByPlan, warnings[], gifts[], freeShipping? }` — žádné nákupní ceny ani marže. Chyba/timeout → panel bez
tipu (fail closed: nic neslíbí).

**R9b — View modely adminu** v `app/components/model/types.ts`, sekce „MVP 4“ (obrazovka Odměny, karta Přehledu, Vyzkoušet
košík s dárkem).

---

## Úkoly po vrstvách (inline, každá vrstva = commit se zelenými testy vrstvy)

### Task 0: Rozpočet Wasm (měření hotové 2026-10-01)
Dnes 253 170 B / 256 000. CLI pipeline = `cargo build` (opt-level 3) → `wasm-opt -Oz` → trampolína (replikováno 1:1).
Naměřeno (105 fixtures, výstupy shodné): `opt-level s` 221 kB ale +4,3 b. instrukcí (realistické 91,6 % ✗), `z` 188 kB
+13,9 b. ✗, `wasm-opt` navíc 0, size-opt závislostí 0, `inline-threshold=150` −10,2 kB +0,9 b., `=100` −16,9 kB +1,1 b.
Největší jednorázová položka: `core::fmt` převod `f64` na text (~15 kB) v `js::number_to_string`.
**Postup:** odměny v Rustu napsat úsporně a změřit. Když Wasm > 255 000 B: (1) nahradit `f64` Display vlastním převodem
„nejkratší zpětně přesný zápis“ jako JS `String(n)` (u128 rychlá cesta + bignum záloha; test proti JS na ≥ 200 000
náhodných číslech všech řádů + hranicích) — bez dopadu na instrukce; (2) teprve potom `inline-threshold` s přeměřením
všech rozpočtů. Volbu a čísla zapsat do README funkce.

### Task 1: Core (`packages/core/src/discounts/**`)
Testy červené první: R1 základ (dárky ven, výprodej dovnitř, měna), R2 doprava (práh přesně, o 1 pod, měna bez prahu,
s kódem dopravy, A1 přepínače), R3 dárek (dosaženo/nedosaženo, 1 ks z více, dva dárkové řádky, cizí varianta, záložní
varianta, žebřík: nižší i vyšší úroveň zároveň, Free gate), R4 progress + `code_loses_gift` + `tierHint` přeplánováním
(výlučný přepínač, marže), R5 payload + worst case, emise (`emit` auto uzel: dárek s `quantity: 1`, doprava), explain
cs/en („Dárek zdarma od 1 500 Kč“), `describeRewards`, storefront config R7 (`buildStorefrontConfig` + handle mapa vstupem),
sanitizer (práh > 0 celé minor units, ≤ 3 nabídky Pro, záložní ≠ nabídka, issue), `plan-gate` beze změny chování.

### Task 2: Funkce (Rust)
Port R1–R3, R5, R6 1:1; fixtures z TS (dárek, žebřík, měny, doprava, dárek + marže, dárek + výprodej, junk payload `r`);
náhodná parita s odměnami (0 rozdílů) + `replay-logs.mjs`; rozpočet instrukcí na hranici vstupu (dárkový řádek na
každém 10. řádku, 10 úrovní × 4 varianty); dotaz beze změny (atribut `_won_gift` a `merchandise.id` už čte); Task 0.

### Task 3: Sync (`app/lib/sync/**`)
Payload `r` (gated), storefront config `rewards` s handle (Admin `nodes(ids)` variant → `product.handle`, při uložení;
smazaná varianta = vynechat + krok `rewards.variant_missing:<id>`), zpětné čtení, dry-run výpis.

### Task 4: App proxy `cart-plan` (R9)
Routa `won-discounts.cart-plan.tsx` (`authenticate.public.appProxy`), adaptér `/cart.js` → `CartPlanInput`, cache
metafieldů, limit řádků, odpověď bez citlivých dat; integrační testy (podpis, multi-shop SEC-2, gated Free/Pro, chyba).

### Task 5: Storefront (`extensions/won-discounts-storefront/**`)
Próza komentářů do README (rozpočet), `won-discounts.js` → košík R8 (panel, progress, dárek přidat/odebrat/odmítnout,
výběr ze 3, kód + varování, ušetříš, tip), app blok `cart_rewards`, CSS (vzhled dědí z tématu, žádný posun), locales
cs/sk/en, contract testy (rozpočet, markery, tokenizer, SF-1: žádný zápis bez události zákazníka — test s falešnými
hodinami a událostmi), property test „progress JS = `planCart` progress“ (sdílená čistá funkce v `won-discounts.js`).

### Task 6: Admin (`app/components/**`, `app/routes/app.rewards.tsx`, i18n, harness)
Modul Odměny: doprava zdarma (práh per měna trhů), dárek (výběr varianty přes resource picker, práh per měna), Pro
(amber): žebřík, výběr ze 3, záložní dárek; nastavení „Počítat do prahu i ostatní slevy“ s poctivou větou („Kód zadaný až
v pokladně dárek neodebere…“); upozornění na trh bez prahu (jedno tlačítko = doplnit), stav bloku košíku + deep link
`addAppBlockId` (šablona `cart`), karta na Přehledu, Vyzkoušet košík s dárkovým řádkem, harness 390/1440.

### Task 7: Podpůrné docs
concepts/rewards, tasks (nastavit dopravu zdarma, dárek, žebřík), support („dárek se v pokladně platí“, „dárek se
nepřidal“, „kód a dárek“, „doprava zdarma v trhu chybí“), generované limity.

### Task 8: Živé E2E (Horizon + Dawn, bez `--bail`)
Profil `rewards` (Free): doprava CZ 40 Kč / SK 2 €, dárek `won-e2e-spare` od CZ 50 Kč / SK 3 € (katalog 10–22 Kč).
Scénáře (exit kritéria MVP 4): (1) přidání pod práh → progress; přes práh → dárek přidán s `_won_gift`, `/cart.js` dárek
100 % = `planCart`, pokladna Bogus dárek 0 a doprava zdarma = `planCart`; (2) „Odmítnout“ → dárek pryč, atribut, další
přidání ho nevrátí; (3) odebrání pod práh → dárek odebrán; (4) SK práh v EUR; (5) profil `rewards-other`
(`countOtherDiscounts: true`) kód pod práh → varování + volba (ponechat = dárek pryč, zrušit = kód pryč); (6) drawer i stránka
košíku obě témata; (7) žádný zápis do košíku po načtení stránky (SF-1, počítání požadavků). Pro `rewards-pro`: žebřík
2 úrovně, výběr ze 3, záložní při vyprodané nabídce (sledovaný sklad na `won-e2e-*` přes seed katalogu, F-R3).
Evidence `docs/won-discounts/evidence/mvp4/`.

### Task 9: Brána, QA, audit, uzavření
Brána · E2E A (Free) + B (Pro) · vizuální QA košíku (stránka + drawer, 390/1440, obě témata) + admin harness · audit
(findings-first P0–P3, `won-auditor.md`) + drift Rust↔TS (fuzz odměn, rozpočet) → oprava všech nálezů → self-audit,
roadmapa, checkpoint, commit, push.

## Živá fakta k ověření
- **F-R1 ✓ (2026-10-01):** `Shopify.actions.{getCart,updateCart,openCart}` existují na dev storu (živý PDP). Zbývá: překreslí
  `updateCart` drawer Horizon i Dawn na místě (jinak reload)?
- **F-R2:** `all_products[handle]` v app embedu (limit 20 handle/stránku) vrací `available` varianty.
- **F-R3:** dárkový řádek s `quantity: 1` cílem dostane v pokladně 0 a druhý kus se platí.
- **F-R4:** app proxy přijme `POST` s JSON tělem a projde `authenticate.public.appProxy`.
