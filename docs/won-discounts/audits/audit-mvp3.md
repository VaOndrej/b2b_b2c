# Audit MVP 3: Won Discounts, Množstevní slevy + PDP blok (`8bf6e15..173fe47`)

Role: won-auditor (read-only). Zapsán jen tento soubor. Nečetl jsem `shpat.md`, `.env*`, `.auth/` ani `prisma/dev.sqlite`.
Rozsah: 21 commitů na `main`, jen commitnutý stav. Rozpracované E2E (necommitnuté `tests/e2e/**`, `scripts/e2e/**`, e2e config,
úpravy `packages/testing`) nehodnotím. Zdroje: `rozhodnuti.md`, spec §2, §3, §4.2, §6, §7, §10, plán MVP 3 (K1–K9, Global
Constraints), build log, ledger `progress.md` (rulingy, odložené minory), task reporty, doctrine (SEC-1/2, BILL-1, SF-1/2).
Shodu Rust ↔ TS a rozpočet instrukcí do hloubky nechávám paralelnímu drift auditu. Tady jen kontrakt vstup/výstup a rozpočty.
Známé a řešené body (stop rule rozpočtu + byte cap úrovní, šíření Pro bitsetu v Rustu, odložené minory v `progress.md`)
neopakuji. Horší, než jsou popsané, jsem je nenašel.

## Souhrn

| Závažnost | Počet |
|---|---|
| P0 | 0 |
| P1 | 1 |
| P2 | 4 |
| P3 | 8 |

Celkové riziko: **střední**. Jádro je pečlivé:
- K1 (jedna sada na produkt) a Free inertní sady drží v enginu, syncu, storefrontu i adminu;
- BILL-1 prochází payloadem, storefront configem, `tierRef`, `pdp` i Přehledem;
- nové uložení jde jednou cestou (zámek, F12 na sekci, parsování na serveru, shop ze session).

Rizika jsou v hlavním slibu MVP 3, **„PDP ukazuje hodnotu, kterou pokladna dá“**:
- strop marže na PDP se počítá z ceny v měně obchodu, takže v trhu s vlastní cenou slíbí víc (P1-1);
- zaokrouhlení stropu na řádek slíbí o pár haléřů víc (P2-1);
- přechodová okna syncu umí dát nebo ukázat víc než starý i nový config (P2-2, P2-4);
- velká kolekce Pro sady tiše přepne produkty na globální sadu (P2-3).

Nic z toho neblokuje pokladnu ani nepustí cenu pod hranici marže. Engine je ve všech případech přísnější než PDP.

---

## Findings

### P1-1 · PDP bere strop marže (`pdp.max`) z ceny v měně obchodu; v trhu s vlastní cenou (ceník) slíbí víc, než pokladna dá
- **Důkaz**
  - `packages/core/src/discounts/storefront-config.ts:201-227`: `pdpMaxDiscountPercent` počítá `(cena − floor) / cena` z ceny a nákupní ceny **v měně obchodu**.
  - `app/lib/sync/costs.ts:526-549` (`desiredPdps`): `unitPrice = toMinorUnits(s.price, shopCurrency)` (`:538`), tedy základní cena varianty. Ceny trhů se nečtou.
  - `blocks/quantity_tiers.liquid:90-97`: varianta s `pdp` bere `m = pdp.max`. Pak `:149-150` a `:163`, `:189-195`: strop se aplikuje na `variant.price`, tedy cenu v **měně košíku** (prezentační cena trhu).
  - Stejně v JS: `assets/won-discounts-tiers-core.js:28-41` (`discount`, `lineDiscount`) s `v.m` z Liquidu (`quantity_tiers.liquid:298-305`).
  - Pokladna počítá floor v měně košíku z nákupní ceny přepočtené `presentmentCurrencyRate` a z ceny řádku v téže měně: `plan-margin.ts:23-46` + `margin.ts:269-309`.
  - Poměr floor / cena je tedy na PDP a v pokladně stejný jen tehdy, když cena trhu = cena obchodu × kurz. Pevná cena v ceníku trhu tuhle rovnost ruší. Výprodej (MVP 5) s ceníky trhů výslovně počítá, jsou tedy podporovaný případ.
- **Reprodukce** (core `planCart` proti `WonDiscountsTiersCore.lineDiscount`, skript mimo repo):
  - Obchod CZK, cena 1 000 Kč, nákupní cena 600 Kč, min. marže 20 % → `pdp.max` = 25 %. Úroveň od 3 ks −20 %, 3 ks, trh SK (kurz 0,0415531865 z F-M1).
  - Automatický převod 41,55 €: pokladna 24,93 €, PDP 24,93 € (shoda).
  - Ceník 39,90 €: shoda.
  - **Ceník 35,00 €: pokladna 11,49 €, PDP 21,00 €.** PDP slíbí o 9,51 € víc.
- **Co tvrdí produkt**
  - Admin `cs.ts:800` „Tabulka na webu i pokladna ukážou sníženou hodnotu.“
  - Docs `support/tier-lowered-by-margin-protection.md:39` „the storefront and checkout use the same cap“ a `support/cart-discount-differs-from-the-product-page.md:36`.
  - Global Constraint plánu: „PDP ukazuje hodnotu, kterou pokladna dá“.
- **Dopad**
  - Zákazník v trhu s vlastní cenou vidí nižší cenu, než zaplatí. Platí jen u produktů s nákupní cenou, kde marže úroveň ořízne.
  - Marže sama drží, peníze merchant neztratí. Rozbitý je ale hlavní slib MVP 3 („konzistence košík ↔ pokladna“ je Free základ) a v EU je to riziko klamavé ceny.
  - Žádný test ani E2E nekryje marži v jiné měně než měně obchodu.
- **Oprava**
  - Krátkodobě fail closed: když `cart.currency` ≠ měna obchodu a varianta má `pdp`, PDP nesmí slíbit oříznutou hodnotu. Buď skrýt řádky, které strop ořízne, nebo pro takovou variantu ukázat tabulku bez živé ceny a s poctivou větou.
  - Dlouhodobě: `pdp` per měna trhu z kontextové ceny (`contextualPricing`), s rezervou na pohyb kurzu, protože pokladna bere denní `presentmentCurrencyRate`.
  - Opravit copy `tiers.honest.margin` a obě support stránky.
  - Test: PDP ≤ `planCart` v EUR s cenou z ceníku. Živé E2E SK s pevnou cenou.

### P2-1 · Zaokrouhlení stropu marže na řádek (varianta bez nákupní ceny): PDP slíbí až o (počet kusů − 1) minor units víc
- **Důkaz**
  - Pokladna: `plan-margin.ts:91-97` dává headroom = `subtotal − floorUnit × q`, kde `floorUnit = ceilTol(cena × (1 − max/100))` (`margin.ts:305-308`). Na kus je to `floor(cena × max / 100)`, celkem q × tolik.
  - PDP: `won-discounts-tiers-core.js:37-41` stropuje řádek `floor(cena × q × max / 100)`. Liquid stejně (`quantity_tiers.liquid:193-194`). To je až o q − 1 víc.
  - Na cestě s `pdp.max` (s nákupní cenou) to nehrozí: `pdp.max` je zaokrouhlené dolů (`storefront-config.ts:223-226`).
- **Reprodukce** (stejný skript, marže zapnutá, bez nákupní ceny):

  | Cena | Max. sleva | Úroveň | Ks | Pokladna | PDP |
  |---|---|---|---|---|---|
  | 9,99 | 15 % | 20 % | 3 | 4,47 | **4,49** |
  | 12,35 | 10 % | 10 % | 3 | 3,69 | **3,70** |
  | 9,99 | 15 % | 14,95 % | 3 | 4,47 | **4,48** |
  | 19,99 | 12,5 % | 30 % | 7 | 17,43 | **17,49** |

- **Proč to prošlo:** komentáře tvrdí „never shows more than checkout“ (`won-discounts-tiers-core.js:25-27`, `quantity_tiers.liquid:11-12`). Testy ale srovnávají náhled s JS (`tests/ui/tiers-preview-parity.test.ts`) a JS sám se sebou (`storefront-tiers.contract.test.ts:645-662`), nikdy JS s `planCart`.
- **Dopad:** haléře až centy na řádek, systematicky u každé úrovně, kterou strop ořízne. Porušený invariant, na kterém stojí P1-1 i E2E rovnost „PDP = košík“.
- **Oprava**
  - Strop řádku `q × floor(cena × max / 100)` v JS i Liquidu. Je bezpečný pro obě cesty.
  - Property test: `lineDiscount ≤ planCart` přes náhodnou cenu, počet kusů, % a max, bez nákupní ceny i s ní.

### P2-2 · `tierRef` v AFTER lane: když se ve stejném uložení změní i hodnoty sad, produkt dostane v okně víc než podle starého i nového configu
- **Důkaz**
  - `app/lib/sync/products.ts:21-35` (hlavička) a `:890-901` (`setBefore`): každá změna `tierRef` se zapíše až po flipu shop configu. BEFORE zápis nese **současný** `tierRef`, finální hodnota jde do `tierWrites` (`:1449`).
  - Shop config i storefront config s **novými** hodnotami sad jsou v tu chvíli už venku (`sync.server.ts:727-732`).
  - Ruling T3 přijal, že produkt v okně „keeps the global set — more OR less than its own“. Počítal se starým stavem produktu. Hodnoty sady, kterou produkt v okně používá, ale mohou být už nové.
- **Scénář** (jedno uložení na jedné obrazovce, přirozený postup)
  - Merchant zvýší globální sadu z −10 % na −20 % a zároveň přidá Pro sadu „Nízká marže“ (kolekce X) s −5 %, aby X ze zvýšení vyjmul.
  - Produkty z X do zápisu `tierRef` (AFTER lane, u velké kolekce v pozadí minuty) dostanou **−20 %**. Starý config dával 10 %, nový dává 5 %.
  - Totéž obráceně: produkt opouští sadu S, které se současně zvýšily hodnoty → v okně má novou, vyšší S.
  - PDP ukazuje totéž okno, protože storefront config jde před AFTER lane.
  - Selhaný zápis `products.tiers` okno prodlouží do další synchronizace. Retry spouští jen Přehled (viz P2-4).
- **Oprava (fail closed, levná)**
  - V BEFORE lane dát každému produktu, jehož `tierRef` se mění, zástupný ref, který není id žádné sady (neprázdný, mimo `[A-Za-z0-9_-]`, např. `"~"`). Engine, Rust i Liquid ho čtou jako „žádná úroveň“ (`plan-tiers.ts:14-20`, `quantity_tiers.liquid:31-38`). Finální `tierRef` pak v AFTER lane.
  - Okno pak dá méně, nikdy víc. Odpovídá to K1 („fail closed: zákazník dostane méně, nikdy víc“).
  - Pozor: `""` nestačí. Liquid ho čte jako `blank` → globální sada (P3-8).
  - Test: během okna nedostane žádný produkt víc než max(starý config, nový config).

### P2-3 · Kolekce Pro sady nad limit čtení: produkty tiše spadnou do globální sady (fail open), i ty, které svou sadu už měly
- **Důkaz**
  - `products.ts:438` počítá kolekce sad úrovní po kolekcích marže a před kolekcemi pravidel.
  - Kolekce nad `MAX_COLLECTION_PRODUCTS` (10 000, `:124`) se ze sady vyřadí (`:505`) a krok je `tiers.too_large:<setId>` (`:524`).
  - Produkty této kolekce se nečtou, takže chtěná hodnota nemá `tierRef`. Produkty, které ho dosud měly, ho po flipu ztratí přes `tierWrites` (clear). Dostanou globální sadu.
  - Copy to přiznává (`cs.ts` `sync.problem.tiersTooLarge`) a ruling T3 to přijal („global set + failed step“).
- **Proč to přesto hlásím**
  - Je to přesně vzor P1-1 z auditu MVP 2: limit čtení tiše oslabí Pro nastavení, které je **přísnější** než globální (K1 říká, že sada s rozsahem je často nižší).
  - U marže se to opravilo fail closed. Tady zůstalo fail open a K1 samo říká „ořez nikdy nerozšíří slevu“.
  - Stačí, aby kolekce v Shopify narostla (nebo jiná kolekce marže spotřebovala limit). Fungující nastavení se pak při příští synchronizaci rozšíří bez zásahu merchanta.
- **Oprava**
  - Při uložení v adminu ověřit velikost kolekcí (`productsCount`) a nepustit sadu, jejíž kolekce se nevejdou (SEC-3 „dangerous state is unsavable“). Nebo to aspoň jasně říct u sady.
  - V syncu u kolekce `too_large` **nemazat** existující `tierRef` produktů, které ho na tu sadu mají (drží starý, přísnější stav).
  - Ruling potvrdit s Ondřejem (Open question 6).

### P2-4 · PDP okna bez časové meze: selhaný storefront config a zastaralé `pdp.max` po zpřísnění marže; retry jen z Přehledu
- **Důkaz**
  - Storefront config se píše až po shop configu (`sync.server.ts:732`). Při selhání zůstane na webu **předchozí** config (`storefront.ts:82`).
  - Když merchant úrovně snížil, PDP dál slibuje staré, vyšší, a pokladna dává nové. Retry je `resyncIfPending` s prodlevou 5 min (`save-and-sync.server.ts:337-348`, prodleva `:65`). Volá ho jen načtení Přehledu (`ui-actions.server.ts:213`). Bez návštěvy adminu PDP lže neomezeně dlouho.
  - `pdp.max` po změně min. marže přepočítá až plný průchod zrcadla (`sync.server.ts:299-325`, `:383`), u velkého katalogu minuty.
    - Selhaný průchod se opakuje jen při Přehledu nebo v hodinovém reconcile, a ten potřebuje offline session (audit MVP 2, OQ 4).
    - Mezitím PDP bere starý, volnější strop, pokladna nový. Kód to přiznává jen v komentáři („checkout is authoritative“, `sync.server.ts:313`).
  - Copy: `cs.ts:913` „Pokladny se to netýká, slevy platí dál“. Neříká, že web může slibovat víc, než pokladna dá. `tiers.storefront.failed` (`cs.ts:813`) říká jen „ukazuje předchozí nastavení“.
- **Oprava**
  - Retry storefront configu i plného průchodu `pdp` v pozadí (job jako `cost-reconcile`), ne jen z Přehledu.
  - Verzovat `pdp`: `{max, k}`, kde `k` = hash marže, a `k` dát i do `margin` ve storefront configu. Liquid nebo JS při nesouladu nepromítne `pdp.max` do slibu (skryje oříznuté řádky nebo živou cenu).
  - Poctivá copy u selhání: „Web může do opravy ukazovat starší (i vyšší) úrovně, pokladna platí nové.“

### P3-1 · Docs proti chování
- `docs/support/tiers-table-not-showing-on-the-product.md:50-53` (§5): „a product it was meant for shows no table **unless the global set also covers it**“. Podle K1 produkt v inertní sadě nedostane globální sadu nikdy. Odporuje to `product-did-not-get-the-global-tiers.md` i `plan-gate.ts:38-44`.
- `cs.ts:773` „Každá varianta zvlášť“ / `tiers.count.line.details`: režim `line` počítá **řádek košíku**. Stejná varianta rozdělená na víc řádků (vlastnosti, předplatné) se nesčítá. Merchant to z textu nepozná.
- Tvrzení „same cap“ viz P1-1.
- **Oprava:** přepsat §5 podle K1, u `line` říct „každý řádek košíku zvlášť (stejná varianta s jinými vlastnostmi se nesčítá)“.

### P3-2 · Spící „další globální sada“ se tiše probudí, když merchant vyprázdní první
- **Důkaz**
  - `tiers.server.ts:173`: uložení vyhodí **každou** globální sadu bez úrovní.
  - Pro obrazovka další globální sadu nese jako skrytá pole s větou „Tahle se neuplatní“ (`ProTierSets.tsx:93`, `:100`, `cs.ts:827`).
  - Když merchant smaže všechny úrovně první globální sady, uloží se bez ní. Druhá globální sada se stane globální sadou K1 a platí pro celý obchod, ve Free i v Pro (`plan-gate.ts:168`).
  - Další globální sadu UI nevytvoří. Vzniká z importu, seedu nebo obnovy verze, případně ze sanitizeru: neplatný `scope` se bez issue změní na `"global"` (`config/tiers.ts:106-117`).
- **Oprava:** prázdnou první globální sadu ukládat jako globální sadu bez úrovní, ne ji vyhazovat (nebo vyhodit i spící globální). Sanitizer: neplatný `scope` → inertní sada s rozsahem + issue, ne globální.

### P3-3 · Copy, která si protiřečí nebo zamlčuje následek
- Nastavení: `cs.ts:884` „Množstevní sleva se nesčítá **nikdy**“ stojí ve stejné sekci jako `cs.ts:899` „Obě se sčítají… i po množstevních“ a „sleva na produkt (i množstevní)“. Úroveň se sčítá s objednávkou i dopravou. „Nikdy“ platí jen pro jinou slevu na stejný produkt.
- `cs.ts:830` „Uloženo, ve Free neplatí. Můžeš ji odebrat.“ neříká, že po odebrání inertní sady její produkty dostanou globální sadu, tedy často víc.
- `cs.ts:913` viz P2-4.
- **Oprava:** „Se slevou na stejný produkt se nesčítá nikdy“ a u odebrání: „Produkty z ní pak dostanou sadu pro celý obchod.“

### P3-4 · Free: skryté Pro sady neprojdou zpět parserem formuláře a stránka nejde uložit
- **Důkaz**
  - Ve Free jdou Pro sady zpět jako skrytá pole (`TierSetEditor.tsx:222-250`, `ProTierSets.tsx:128`) a parsuje je `readTiersForm` se striktní gramatikou:
    - procento > 0 a nejvýš 2 desetinná místa (`model/tiers.ts:64`, `:99-103`);
    - id jen jako `gid://shopify/Product/…` (`:127-130`);
    - neprázdný rozsah (`:133-135`).
  - Sanitizer ale uloží i 0 %, 12,345 % nebo libovolné řetězce id (`config/tiers.ts:82`, `:110-113`).
  - Takovou sadu z importu, seedu nebo obnovy pak Free merchant nemůže uložit: dostane „Zkontroluj zvýrazněná pole“ (`cs.ts:203`), ale chyba visí na skrytém poli. Nemůže uložit ani globální sadu.
- **Oprava:** skryté sady neparsovat z formuláře. Server je vezme ze stored configu podle id (§14a). Nebo chyby skrytých polí zobrazit u sady.

### P3-5 · Snížení limitu kolekcí marže 100 → 50: přebytek se zahodí (fail open), nesloží se do globálu
- **Důkaz**
  - `config/limits.ts:48` `marginOverrides: 50`. `config/margin.ts:116-125` přebytek ořízne (`slice`) s issue.
  - Produkty zahozených, přísnějších kolekcí dostanou globální floor. Uložený config s 51–100 kolekcemi (existuje jen na dev storu, nic není nasazené) se tak při čtení tiše uvolní.
  - Free gate dělá opak: skládá, nejpřísnější vyhrává (`plan-gate.ts:198-222`).
- **Oprava:** přebytek složit do globálu (min p, max m) jako `gateConfigForPlan` a admin to řekne. Dnes latentní, před prvním nasazením to stojí za opravu.

### P3-6 · Inertní sady (Free) spotřebují limit čtení kolekcí, i když nemají žádný účinek
- **Důkaz:** `tierScopes` (`products.ts:172-181`) čte členství všech dosažitelných sad s rozsahem, inertní i bez úrovní, i když config nemá globální sadu. Bez globální sady je inertní sada bez účinku, protože produkt nedostane nic tak jako tak.
- **Dopad:** kolekce sad se počítají **před** kolekcemi pravidel (`:438`). Velká inertní sada po downgradu tak může vytlačit kolekci Free pravidla. Pravidlo pak na ty produkty neplatí (fail closed, ale rozbitá Free funkce kvůli Pro zbytku).
- **Oprava:** sady s rozsahem bez úrovní číst jen tehdy, když existuje globální sada s úrovněmi.

### P3-7 · a11y
- Storefront: aktivní úroveň je jen `data-active` + tučné písmo nebo okraj (`won-discounts-tiers.css:68-70`, `:97-100`). Pro čtečku chybí `aria-current="true"` nebo vizuálně skrytý text. Živá cena je `aria-live` (ok).
- Náhled v adminu: tlačítka počtu kusů mají `aria-label="−"` / `"+"` (`TiersPreview.tsx:237`, `:243`). Čtečka přečte „minus“ / „plus“ bez kontextu. Nejsou ani přeložená.
- **Oprava:** `aria-current` na aktivním řádku (Liquid, JS, náhled), popisky „Ubrat kus“ / „Přidat kus“ v i18n.

### P3-8 · Drobné rozdíly PDP ↔ engine a stav bloku v adminu
- `tierRef: ""`: engine dá „žádná úroveň“ (`cart.ts:294`, `plan-tiers.ts:14-20`), Liquid `blank` → globální sada (`quantity_tiers.liquid:31-34`, `:125`). Sync `""` nepíše, jde jen o nevalidní data. Důležité ale pro opravu P2-2 (sentinel nesmí být `""`).
- `tiersBlockIn` (`themes.server.ts:250-265`) hlásí „Tabulka je na stránce produktu“, i když je blok jen v alternativní šabloně (`templates/product.xyz.json`). Většina produktů ho nevidí.
- **Oprava:** Liquid `tierRef` porovnávat na `nil`, ne `blank`. Stav bloku vázat na `templates/product.json` a alternativní šablony vyjmenovat.

---

## Ověřeno a v pořádku
- **K1 a Free inertní sady:** `plan-gate.ts:165-180` (rozsah zůstává, `breaks: []`), `targeting.ts` (`tierRef` se nikdy nezahodí přes rozpočet), `products.ts` `tierScopes` (inertní sady dál drží produkty), Liquid (inertní sada → `offered == 0` → skrytý blok), náhled a Vzhled z gated configu (`appearance.server.ts:36`), Přehled z gated (`tiers.server.ts:205-213`). Free přes `cart → product` nikdy nedá víc: sady jednoho druhu s neklesajícími hodnotami (`config/tiers.ts:126-161`) + výběr nejvyšší nabízené úrovně.
- **BILL-1:** payload, storefront config (`payloadConfig`), `pdp` (marže gated + folded, `cost-lane.server.ts:152-158`), počty produktů v Pro sadách jen pro Pro (`tiers.server.ts:151`), worst case payloadu i ve Free variantě (`function-payload.ts`).
- **SEC-1/SEC-2/F12:** Množstevní slevy, Vzhled, Nastavení a marže jdou přes `saveConfigSection` (`settings.server.ts:73-105`): zámek, F12 jen na editovanou sekci, guard nečitelného configu, formulář parsovaný na serveru, shop ze session (routy `app.tiers/appearance/settings`). Dotazy v `storefront.ts` a `settings.server.ts` jsou filtrované `shop`.
- **Pořadí syncu:** storefront config až za zapsaným shop configem, zpětné čtení, nikdy fatální. Retry s prodlevou a bez smyčky (`storefront === "none"` nastane jen u běhů před MVP 3).
- **Tokenizer Liquidu:** žádný `}` uvnitř `{{ … }}` v bloku. `{{ vc }}}` a `{{ t_next | json }}}}` tokenizuje Shopify regex `}}?` správně. Kontraktní test z `a417119` hlídá vzor.
- **SF-1/SF-2:** blok nemění ani nečte košík, idempotentní init (`WonDiscountsTiersCore`, `__wonTiersBoot`), prázdný stav server-side `hidden` (bez CLS). JS ≤ 10 kB gz všech tří souborů dohromady + každý ≤ 10 000 B raw (`perf-budget.contract.test.ts`).
- **Kontrakt funkce (vysoká úroveň):** dotaz 27 / 28 z 30, `product { id }` jen pro počítání `product`. Wasm 251 546 B < 256 000 (těsné). Rozpočet řeší známý stop rule.
- **Testy (spuštěno 2026-10-01 na HEAD; `packages/core` je ve working tree čistý):**
  - `npm test -w @won/core`: 764/764.
  - Cílený výběr won-discounts (storefront-tiers + theme-extension contract, integration tiers/pdp/storefront-sync/settings/appearance/themes, sync tier-refs/costs/cost-lane): 169/169.
  - Celé `test:unit` jsem nespouštěl: working tree obsahuje necommitnuté E2E změny.

## Open questions / assumptions
1. **`shop.money_format` v cizí měně.** JS přeformátuje ceny šablonou `shop.money_format` (`quantity_tiers.liquid:295`). Když v trhu SK vrací formát CZK, první render (Liquid `money`) a JS re-render se rozejdou („1,05 Kč“ místo „1,05 €“). Shopify docs to jednoznačně neříkají. T4 to předalo T7 k živému ověření na SK PDP.
2. **F-T1 pro `tierRef` a `marginRefs` v Liquidu.** Pokud `product.metafields['$app:won_discounts'].product.value` v bloku nejde přečíst, Liquid spadne do globální sady a globálního stropu, tedy fail open na PDP (engine zůstane správně). Fáze Free tuto cestu neprověří, ověří ji až Pro fáze E2E (sada na kolekci). Potvrdit, že ji pokrývá.
3. **Pevné ceny v ceníku trhu**: jsou u cílových merchantů běžné (CZ/SK s ručními € cenami)? Určuje to reálný dopad P1-1.
4. **Délka AFTER lane** u velké kolekce (zápis `tierRef` v pozadí): není změřená, a od ní se odvíjí okno P2-2.
5. **Spouští zápis app-owned `tierRef` webhook `products/update`?** (Analogie OQ 3 z MVP 2.) Refresh produktů pak čte a nic nepíše. Omezené, ale dvojí práce u velkých sad.
6. **Ruling T3 „too-large tier collection → global set“:** potvrdit s Ondřejem proti K1 „ořez nikdy nerozšíří slevu“ (P2-3).

## Overall risk summary
Engine a sync jsou na MVP 3 v dobrém stavu:
- K1, Free inertní sady a BILL-1 drží všude, kam jsem se podíval;
- uložení z nových obrazovek jsou bezpečná;
- storefront je izolovaný, v rozpočtu a odolný vůči Liquid tokenizeru.

Slabé místo je **věrnost PDP vůči pokladně** tam, kde do hry vstupuje marže nebo přechod configu:
- strop z měny obchodu v cizí ceně (P1-1, desítky procent rozdílu);
- zaokrouhlení na řádek (P2-1, haléře);
- okna syncu, kde PDP i pokladna dají víc než starý i nový config (P2-2), nebo kde PDP slibuje staré vyšší hodnoty bez časové meze (P2-4);
- velká kolekce Pro sady, kvůli které produkty tiše dostanou širší globální sadu (P2-3).

Pokladna nikdy nepodleze marži. Hlavní slib MVP 3 („PDP ukazuje, co pokladna dá“) ale bez P1-1 a P2-1 pravdivý není. Doporučuji obojí opravit před uzavřením MVP 3. P2-2 a P2-3 jsou levné, fail-closed opravy ve stylu MVP 2.

## Testing gaps (jen se skutečným rizikem)
- **PDP ≤ pokladna jako property test:** `lineDiscount` / `compute` z `won-discounts-tiers-core.js` proti `planCart` přes náhodnou cenu, počet kusů, % a max, bez nákupní ceny i s `pdp.max` (P2-1). Dnes se srovnává jen náhled ↔ JS.
- **Marže v jiné měně než měně obchodu:** unit (pevná cena v ceníku, kurz SK) + živé E2E SK (P1-1).
- **Okno AFTER lane:** sync test, že během zápisu `tierRef` žádný produkt nedostane víc než max(starý, nový config) při současné změně hodnot sad (P2-2).
- **Kolekce sady nad limit:** existující `tierRef` se nesmaže, nebo admin uložení odmítne (P2-3).
- **Selhaný storefront config po snížení úrovní:** stav admina a retry bez návštěvy Přehledu (P2-4).
- **Free round trip skrytých Pro sad** s hodnotami mimo gramatiku formuláře (0 %, 3 desetinná místa, nečíselné id) (P3-4).
- **Liquid cesty, které kontraktní test hlídá jen regexem:** `tierRef` (Pro), `marginRefs > 4`, počítání `cart`, `pdp.max`. Kryje je jen živé E2E Pro fáze (rozpracované).
- **Downgrade Pro → Free na živém storu:** PDP produktu v inertní sadě = žádná tabulka, pokladna = žádná úroveň.
