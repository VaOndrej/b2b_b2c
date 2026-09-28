# Won Discounts — mezery před spuštěním orchestrátora

Kritická revize `rozhodnuti.md` + `prompt-osnova.md` (2026-09-28). Cíl: orchestrátor musí
běžet **úplně autonomně**, takže každé místo, kde by se musel zeptat, musí mít odpověď předem.

## Hlavní princip pro autonomii

**Každé technické riziko má předem schválený fallback.** Když prototyp v MVP 0 selže,
orchestrátor nepřestane pracovat, ale přepne na fallback a zapíše to do build logu.
Zastaví se jen tehdy, když selže i fallback.

---

## A. Produktová rozhodnutí, která chybí (návrh výchozí hodnoty)

| # | Mezera | Návrh |
|---|---|---|
| A1 | Výchozí kombinování slev | **Rozhodnuto:** výchozí = výprodej se nekombinuje s ničím; produktové slevy se navzájem nesčítají (vyhrává výhodnější pro zákazníka); produkt + objednávka + doprava se sčítají. **Free:** merchant tyhle výchozí pravidla přepíná po kategoriích. **Pro:** pravidla per sleva (sleva A se nekombinuje s B, ale s C ano). |
| A2 | Ochrana marže bez nákupních cen | Produkty bez `unitCost` hlídá pravidlo „max. sleva X % z ceny“. Admin ukáže, kolik produktů cenu nemá. Při překročení se sleva **sníží na hranici**, nikdy neblokuje. |
| A3 | Pevné částky (−100 Kč) v cizím trhu | Stejně jako prahy: hodnota per trh, trh bez hodnoty sleva nedostane. |
| A4 | Dárek je vyprodaný | Dárek se nenabízí, lišta to poctivě řekne. Volitelně záložní dárek. |
| A5 | Výprodej × trhy s pevnými ceníky (Markets) | **Rozhodnuto:** výprodej (Pro) umí i per trh: mění základní cenu i pevné ceny v cenících trhů (price lists). Merchant zvolí, kterých trhů se výprodej týká. |
| A6 | Downgrade Pro → Free | Běžící výprodeje a kampaně doběhnou do konce (ceny nezůstanou viset), nové nejdou založit. |
| A7 | Odinstalace | Po odinstalaci appka ztratí přístup a nic nevrátí. Proto tlačítko „Připravit na odinstalaci“: ukončí výprodeje (vrátí ceny) a obnoví nativní slevy ze zálohy. Admin ho nabídne i v Tarifu. |
| A8 | Dvě kampaně ve stejném čase | V1 nepovoleno, admin nedovolí uložit překryv. Kampaň přepisuje pravidla jen po dobu trvání, po konci se přepis sám zruší. Časová zóna obchodu. |
| A9 | Billing detail | $29 / měsíc, USD, 14denní trial, bez ročního tarifu. |
| A10 | Jazyk adminu | Čeština + angličtina podle jazyka Shopify adminu. Texty na storefrontu cs/sk/en, editovatelné. |
| A11 | Won Toasts | Napojení přes existující konvence (`_gift_progress`, sdílený milestone), bez tvrdé závislosti. |
| A12 | Nativní integrace do generic theme | Mimo v1. Jen theme app extension. |
| A13 | Nasazení | Připravit `Dockerfile` + `fly.toml` jako u Toasts, **nenasazovat**. |

A2–A4 a A6–A13: **odsouhlaseno** (2026-09-28).

## B. Předpoklady na dev storu (udělá Ondřej, nebo orchestrátor ověří)

### Zjištěný stav `b2b-b2c-store-development` (read-only dotaz, 2026-09-28)

| Oblast | Stav | Pro Won Discounts |
|---|---|---|
| Plán | Advanced App Development (partner dev store), ne Plus | OK. Checkout UI mimo thank-you nepůjde, s tím počítáme |
| Měna / čas | Základ USD, časová zóna America/New_York | OK; kampaně testovat v zóně obchodu |
| Trhy | `cesko` (CZK), `slovensko` (EUR), oba aktivní | OK pro prahy per trh |
| Ceníky trhů | `česko` má price list, 0 pevných cen; `slovensko` bez price listu | Pro výprodej per trh je potřeba seedovat aspoň 1 pevnou cenu |
| Jazyky | en (primární), cs publikovaný, **sk nepublikovaný** | Texty v sk nejde na storefrontu otestovat |
| Témata | `test-data` (MAIN), Horizon + Dawn + won-theme-generic (unpublished) | OK, sdílená E2E témata existují |
| Existující slevy | **`Test_Code_discount` (app SMART Functions) AKTIVNÍ**, 2 další vypršelé | Cizí aktivní sleva bude zasahovat do E2E. Zároveň dobrý reálný test detekce a přesunu |
| E2E produkty | 5× `won-e2e-*`, ceny 9–22 USD, **bez nákupní ceny, sklad se nesleduje** | Ochrana marže a vyprodaný dárek se nedají testovat bez úpravy seedu |
| Objednávky | **Žádná objednávka v historii** | Testovací platební brána neověřena |
| Token `shpat.md` | Custom app FullApiAccess, má `write_discounts`, `write_products`, `write_markets`, `write_orders` | Stačí na seed i úklid |


| # | Co | Proč |
|---|---|---|
| B1 | ~~Trhy CZ a SK~~ | **Hotovo**, existují |
| B2 | ~~Testovací platební brána~~ | **Hotovo:** Bogus Gateway je aktivní (Ondřej). Heslo ke storefrontu předá prompt, patří jen do gitignorovaného `apps/won-discounts/.env` jako `SHOPIFY_E2E_STOREFRONT_PASSWORD` |
| B3 | Nákupní ceny + sledovaný sklad na testovacích produktech | **Orchestrátor si nastaví sám** přes seed (`e2e-products.js`, idempotentní). Dev store, volná ruka |
| B6 | ~~Vypnout `Test_Code_discount`~~ | **Hotovo 2026-09-28:** stav EXPIRED |
| B7 | ~~Publikovat sk~~ | **Hotovo 2026-09-28** |
| B8 | ~~Pevná cena v ceníku trhu~~ | **Hotovo 2026-09-28:** `won-e2e-spare` = 199 CZK v ceníku `česko` |
| B4 | Jednorázové přihlášení Playwrightu do Shopify adminu (uložený `storageState`) | **Nepřihlašovat hlavním účtem** (2026-09-28): session `admin.shopify.com` by dala Playwrightu přístup ke všem storům účtu, včetně klientských. Admin se ověřuje přes dev-only harness (D2). Případně později samostatný Shopify účet jen s přístupem k dev storu. Bez toho orchestrátor nevidí admin uvnitř Shopify. U Toasts to zůstalo neověřené (SB task `won-toasts-visual-check-section-pattern`) |
| B5 | ~~Worktree~~ | **Rozhodnuto:** práce přímo na `main`, rozpracované změny pushnuté Ondřejem 2026-09-28 (`c7212ef`) |

Skript a zálohy: `tmp/won-discounts-setup/` (`setup-devstore.mjs`, výchozí dry-run, undo v hlavičce).

## C. Technická rizika navíc (ověřeno v shopify.dev 2026-09-28)

| # | Riziko | Dopad | Plán / fallback |
|---|---|---|---|
| C1 | **Network access pro discount funkce je jen pro Shopify for enterprise.** | Jeden „mozek“, který přijme libovolný kód, nejde. Každý kód je vlastní discount uzel a běží souběžně s ostatními. | **Architektura „jeden mozek, víc rukou“:** každý Won uzel čte celý config, deterministicky spočítá celý plán slev pro košík (včetně zadaných Won kódů) a vydá jen svůj díl. Marže a kombinace jsou pak konzistentní. Prototyp: ověřit, že vstup funkce vidí všechny zadané kódy. Fallback: `combinesWith` + konzervativní strop marže v každém uzlu zvlášť. |
| C2 | **Limit 25 aktivních discount funkcí na store** vs. hodně kódů (newsletter, BF, influenceři…) | Při jeden kód = jeden uzel dojde místo. | Jeden kódový uzel s více kódy (redeem codes), funkce pozná, který kód se použil. Fallback: limit kódů v adminu, poctivě vysvětlený. |
| C3 | **Funkce nedostane metafield větší než 10 000 bajtů** (dostane `null`) | Velký config = sleva tiše přestane fungovat. | Config rozdělit: globální pravidla na uzlu, data per produkt v produktových metafieldech. Contract test, který hlídá velikost a spadne před překročením. Admin nedovolí uložit config, který by se nevešel (doctrine DATA-2). |
| C4 | Čas ve funkci | Kampaně a plánování by jinak závisely na cronu serveru. | Vstup funkcí má `shop.localTime`, takže začátek a konec může hlídat funkce sama. Prototyp ověří dostupnost v Discount API. Fallback: nativní `startsAt` / `endsAt` na discount uzlech. |
| C5 | Věrný náhled (iframe storefrontu v adminu) | Viz `rozhodnuti.md`. | Fallback: náhled s tokeny tématu + „Zobrazit na mém webu“. |
| C6 | Unikátnost textu kódu při přesunu | Viz `rozhodnuti.md`. | Rozhodnuto: záloha + smazání nativní slevy. |

## D. Mezery v procesu orchestrátora

| # | Mezera | Návrh |
|---|---|---|
| D1 | Autonomie | Úplná. Bez checkpointu po MVP 0, protože rizika mají fallbacky (viz výše). |
| D2 | Admin vizuálně bez přihlášení | Dev-only routa s mock session (nikdy v produkčním buildu) pro screenshoty adminu + smoke přes `storageState` (B4). |
| D3 | Testovací objednávky | E2E pro výprodej a analytiku projde checkout na Bogus bráně a počká na webhook. |
| D4 | Paralelní subagenti a sdílené soubory | Každý subagent dostane seznam souborů, které smí měnit. Sdílené `packages/core` mění vždy jen jeden subagent najednou. |
| D5 | Kontext orchestrátora | Build log jako jediný stav; orchestrátor nečte celé výstupy subagentů, jen jejich shrnutí + důkaz. |
| D6 | Support / chatbot docs | Průběžně po každém MVP (`nova-aplikace.md` §9), drift test součástí brány. |
