# Won Discounts — rozhodnutí z brainstormingu

Pracovní log rozhodnutí (2026-09-28). Podklad pro spec `docs/won-discounts-mvp-plan.md`
a pro prompt orchestrátora. Související: [`mezery.md`](mezery.md), [`prompt-osnova.md`](prompt-osnova.md). Zdroj pravdy je tenhle soubor, dokud nevznikne spec.

## Produkt

- **Jedna appka místo tří:** Won Tiers + Won Rewards + Won Outlet + Won MarginGuard se slučují
  do `won-discounts`. Propaguje se jako jedna appka. Roadmapa (`product-roadmap.html`) se musí
  přepsat: hranice portfolia, karty, build fronta.
- **Pozicování:** nejrobustnější slevová appka na Shopify. Ne počet funkcí, ale jasně oddělené
  moduly, které se navzájem nepoperou. Analýza trhu se nedělá.
- **Proti 30 funkcím:** každý modul odpovídá na jednu otázku merchanta. Plánování, cílení
  a jazyky jsou vlastnosti pravidel, ne moduly.
- **Všechny slevy obchodu jdou přes Won Discounts.** Jen tak engine zná všechno, co se v košíku
  a v pokladně uplatní.
  Platí i pro slevové upsely Won Companion: jdou jako pravidla ve Won Discounts, Companion
  vlastní slevovou funkci nemá (Ondřej, 2026-09-28).
- **Nastavitelnost:** chování v hraničních situacích (dárek vs. kód, znovuotevření výprodeje…)
  si volí merchant v nastavení. Appka mu jasně vysvětlí, co volba udělá.
- **Silný use case:** Black Friday a podobné kampaně.

## Moduly

| Modul | Otázka merchanta |
|---|---|
| Slevy a kódy | „Sleva X % / částka na produkt, kolekci, objednávku, doprava zdarma, kódem nebo automaticky“ (vč. newsletter / uvítací kód) |
| Množstevní slevy (Tiers) | „Kup víc, zaplať míň“ |
| Odměny za košík (Rewards) | „Utrať X, dostaneš Y“ (doprava zdarma, dárek, žebřík prahů) |
| Výprodej (Outlet) | „Doprodat N kusů se slevou, pak zpět na plnou cenu“ |
| Ochrana marže (MarginGuard) | „Nikdy neprodat pod X“ |

Pod nimi **sdílený engine**: kombinování / přednost / vylučování, náhled „co se uplatní
v tomhle košíku a proč“, konzistence košík ↔ pokladna, kontrola, že sleva reálně platí
v checkoutu.

**Vynecháno:** BOGO (pokryjí množstevní slevy), bundly / mix & match / cross-sell (Won Companion),
odpočty a oznámení (Won Toasts), B2B ceníky (b2b-companion), popupy, Mystery dárek (odloženo).

## Dárky vs. další slevy (košík ↔ pokladna)

- **Dárek se nikdy neplatí a checkout se nikdy neblokuje.** Validační funkce na blokaci
  se nepoužívá.
- **V pokladně dárek vždy zůstane zdarma**, pokud ho zákazník měl v košíku. Funkce počítá
  práh z ceny před ostatními slevami.
- **Rozhoduje se v košíku.** Merchant nastaví, jestli se do prahu dárku počítají ostatní slevy.
  Když ano a kód nebo sleva sníží košík pod práh, košík to zákazníkovi řekne předem
  („s tímhle kódem přijdeš o dárek“) a nechá ho vybrat.
- **Kód v košíku** (ne až v pokladně): `/cart/update.js` s parametrem `discount`,
  čtení `discount_codes[].applicable`.
- **Newsletter jako kód:** funguje plně (appka kód zná).
  **Newsletter jako automatická sleva:** u nepřihlášeného se uplatní až v pokladně, dárek zůstane.
  U přihlášeného ji košík ukáže předem.
- V adminu je to napsané přímo u nastavení: kód zadaný až v pokladně dárek neodebere,
  proto nabízíme pole pro kód v košíku.

## Výprodej (Outlet)

- **Žádná kopie produktu** (duplikovala by SKU). Výprodej běží na existující variantě.
- Merchant zadá: varianta, kolik kusů (kvóta), sleva, volitelně datum konce.
- Appka nastaví `price` + `compare_at_price`, z webhooků objednávek počítá prodané kusy,
  po vyčerpání kvóty nebo po datu vrátí plnou cenu. Každý krok jde do historie.
- **Storna a vratky se vrací do kvóty** (varianta B).
- Vratka po skončení výprodeje: chování je **nastavení merchanta**
  (automaticky znovu otevřít / zeptat se / nic). Výchozí: zeptat se.
- Kvůli zpoždění webhooku se může prodat pár kusů navíc. Admin to přizná a ukáže přesný počet.

## Technická omezení (ověřeno v shopify.dev, 2026-09-28)

- Discount funkce běží souběžně a o sobě nevědí; max. **25 aktivních discount funkcí** na store.
  Appka proto musí konsolidovat pravidla do pár uzlů, které čtou config (ověřit prototypem).
- Checkout UI extensions v krocích informace / doprava / platba jen pro **Shopify Plus**.
  Bez Plus nejde v pokladně měnit řádky košíku.
- Cart AJAX API podporuje kódy od 5/2025 (`/cart/update.js` `discount`).

## Kampaně (Black Friday)

- Vrstva nad moduly, ne šestý modul: pojmenované časové okno + sada pravidel napříč moduly.
- Start i konec atomicky pro všechna pravidla, po konci návrat do předchozího stavu.
- Náhled košíku „v době kampaně“ předem, okamžitý kill switch.
- Ochrana marže platí i uvnitř kampaně.
- **Kampaně jsou Pro** (rozhodnuto 2026-09-28).

## Free / Pro (rozhodnuto 2026-09-28)

Free omezuje rozsah, ne kvalitu. Konzistence košík ↔ pokladna, ochrana marže, a11y jsou ve Free plné.

| | Free | Pro |
|---|---|---|
| Slevy a kódy | Všechny typy, neomezeně | + cílení segment / trh |
| Množstevní slevy | 1 globální sada úrovní | Sady per produkt / kolekce, počítání přes košík |
| Odměny | Doprava zdarma + 1 dárkový práh, práh zadaný per trh / měna | Žebřík prahů, výběr ze 3 dárků |
| Výprodej | — | **Celý modul** |
| Ochrana marže | Globální minimum | Per kolekce + přehled zásahů |
| Engine | Kombinace (přepínání po kategoriích), náhled, kód v košíku | + kombinace per sleva |
| Kampaně | — | ✓ |
| Přehledy | Základní čísla | Kolik slevy stály vs. kolik přinesly |

**Cena:** Pro $29 / měsíc flat, bez limitu objednávek („v nejsilnějším měsíci neplatíš víc“).

## Prahy per trh / měna (rozhodnuto 2026-09-28)

- Každý práh má **vlastní hodnotu pro každý trh / měnu**, žádný přepočet kurzem
  (CZ 1000 Kč, SK 60 €). Funkce i storefront berou hodnotu podle měny košíku.
- Je to základ, ne Pro (špatný práh = ztráta důvěry).
- Trh bez zadané hodnoty: odměna se v něm nenabízí a admin na to upozorní. Nikdy
  se neukáže přepočtené nebo cizí číslo.

## Nativní slevy Shopify (rozhodnuto 2026-09-28, vše Free)

- **Detekce vždy:** Přehled ukáže slevy mimo Won („engine s nimi nepočítá“) a konflikty.
- **Import volitelně:** průvodce v onboardingu načte nativní slevy, vytvoří je jako
  pravidla ve Won, originály vypne; jde vrátit zpět.

## b2b-companion (rozhodnuto 2026-09-28)

- Archivovaný projekt, ze kterého monorepo vzniklo. **Jen zdroj kódu** (varianta A).
- Won Discounts převezme a rozšíří `@won/core/discount` a `@won/core/margin`, inspiruje se
  jeho funkcemi (`margin-guard-discount-function`, `margin-guard-cart-validation`).
- Do `apps/b2b-companion` se nesahá. Změny sdíleného core nesmí rozbít `guard:test:core`.

## Dva cíle celé appky (Ondřej, 2026-09-28)

1. **Merchant není svázaný mými rozhodnutími.** Chování, které může být sporné, je volba
   v nastavení, ne natvrdo v kódu.
2. **Merchant není přehlcený při prvním otevření.** Nastavení, aktivace extension a první
   pravidlo musí být naprosto plynulé a dokonale vysvětlené.

Smír mezi nimi: každá volba má fungující výchozí hodnotu; první spuštění ukáže jen minimum,
zbytek je schovaný pod „Další možnosti“ (doctrine §9, A6).

## Storefront (rozhodnuto 2026-09-28)

Theme app extension (app embed + bloky), Horizon i Dawn.

- **Vizuál bloků:** několik předpřipravených vzhledů bloku k výběru (Free).
  **Pro:** kompletně vlastní vizuál + návod pro AI, jak ho postavit (datový kontrakt,
  eventy, CSS proměnné, příklad).
- **PDP:** tabulka množstevních slev + živá cena podle počtu kusů; štítek výprodeje.
- **Výprodej na webu je volba merchanta:** nezobrazovat nic (tichý výprodej, např. doplňky
  s blížící se trvanlivostí) / přeškrtnutá cena / + štítek / + „zbývá X ks“. Výchozí: bez
  „zbývá X ks“.
- **Košík:** progress bar k prahům, dárek s „Odmítnout“, pole pro kód s varováním o dárku,
  souhrn „Ušetříš X“, tip „přidej 1 ks → nižší cena“.
- **Pokladna:** nic vlastního (jen názvy slev z funkce).
- **Ceny podle množství na kartách a ve vyhledávání:** **BETA**, merchant si zapne v adminu.

## Admin UX principy (Ondřej, 2026-09-28)

- **Každá otázka = jedno tlačítko, které akci rovnou provede.** „Máš 4 slevy v Shopify,
  přesunout?“ → Ano → slevy jsou ve Won a nativní vypnuté. Žádné „teď jdi tam a udělej tohle“.
- **Náhled je věrný živému tématu merchanta**, ne vymyšlený vizuál. Co je v náhledu, musí
  na webu vypadat stejně (fonty, barvy, layout tématu).
- **Onboarding:** „Co chceš řešit?“ → výběr cílů určí pořadí a co se zapne, ale **v nastavení
  jsou vždy vidět všechny moduly**.
- Nastavení musí působit intuitivně. Pokročilé volby pod „Další možnosti“.

### Onboarding (cíl: první funkční sleva do 3 minut)

1. „Co chceš řešit?“ (doprava/dárek, množstevní slevy, výprodej, marže, přesun slev).
2. Nalezené nativní slevy → jedno tlačítko „Přesunout“ (jen když nějaké jsou).
3. Aktivace app embedu: tlačítko otevře theme editor na embedu, appka sama pozná, že je
   zapnutý (vzor `embed-status.ts` z Won Toasts).
4. První pravidlo z receptu s předvyplněnými hodnotami a věrným náhledem.
5. Checklist „Hotovo“: co běží, co dál.

### Technická rizika k ověření prototypem

- **Shopify slevy nejde archivovat.** Stavy jsou jen ACTIVE / EXPIRED / SCHEDULED.
  „Vypnout“ = `discountAutomaticDeactivate` / `discountCodeDeactivate` → EXPIRED.
- **Přesun kódu se stejným textem:** ověřit, jestli vypršelý nativní kód drží unikátní
  text kódu. Pokud ano, přesun vyžaduje smazání nativní slevy (se zálohou ve Won pro undo).
- **Historie použití** (limit „1× na zákazníka“, počet použití) se při přesunu neztratí,
  nebo to appka merchantovi předem řekne.
- **Věrný náhled:** ověřit, jestli jde storefront vložit do adminu (iframe + náhledový
  token s neuloženým configem přes app proxy). Záloha: náhled s tokeny tématu v adminu
  + tlačítko „Zobrazit na mém webu“ s náhledovým parametrem.

## Přesun nativních slev (rozhodnuto 2026-09-28)

- Jedno tlačítko: **záloha nativní slevy do Won → vytvoření pravidla ve Won → smazání
  nativní slevy.** Undo = obnova nativní slevy ze zálohy.
- Před kliknutím dialog řekne, co se ztratí (historie použití, limit „1× na zákazníka“),
  pokud to prototyp potvrdí.

## Admin IA (rozhodnuto 2026-09-28)

- **Přehled:** co běží, stav embedu, slevy platí v pokladně, upozornění (sleva mimo Won,
  trh bez prahu, zásah marže), čísla.
- **Moduly** (vždy všech 5, cíle z onboardingu jen řadí): Slevy a kódy · Množstevní slevy ·
  Odměny · Výprodej (Pro) · Ochrana marže.
- **Kampaně** (Pro).
- **Vyzkoušet košík:** produkty + trh + kód → co se uplatní a proč.
- **Vzhled:** předpřipravené vzhledy bloků; Pro vlastní vzhled + návod pro AI.
- **Nastavení** (hraniční chování, trhy, jazyky) · **Tarif**.

## Změny po prvním průchodu (rozhodnuto 2026-10-06)

Mění body výše; kde se liší, platí tohle. Plný plán: [`plan-zmen-2026-10-06.md`](plan-zmen-2026-10-06.md),
obecná pravidla: doktrína §18 (P1–P9).

- **Menu má 5 položek:** Slevy · Ochrana marže · Vzhled · Přehledy · Nastavení. Stránka Slevy má
  podmenu Slevy a kódy · Množstevní slevy · Odměny · Výprodej (Pro) · Kampaně (Pro), pořadí podle
  cílů z onboardingu. Ruší „vždy vidět všechny moduly v menu“.
- **Tarif** je sekce v Nastavení (`/app/plan` zůstává kvůli návratu z billingu).
- **Vyzkoušet košík je Pro** (bylo Free) a je v Nastavení → Nástroje. Slevy se v něm vybírají ze
  seznamu, kód se nepíše.
- **„Další možnosti“ v editoru slevy zanikají:** Podmínky, Jak se uplatní, Kdy platí jsou vždy otevřené.
- **Karta „Slevy mimo Won“** se na Přehledu ukáže jen tehdy, když je co řešit. Detekce běží dál vždy.
- **Segmenty zákazníků** se v editoru neukazují, dokud je pokladna neumí.
- **Pro na Free:** jantarový zamčený vzhled zůstává, s větou, k čemu funkce je, a odkazem na tarif.
  Vymyšlené ukázky se neukazují.
- **Minimum kusů na produkt / kolekci** (Pro): každý produkt hlídá jen své minimum.
- **Dávky kódů:** generátor (Free až 100 náhodných, Pro vzor); dávku pozná pokladna podle předpony.
- **Výchozí vzhled tabulky množstevních slev** pro nové obchody je „Zvýrazněná úroveň“; vzhled jde
  přepnout přímo v Množstevních slevách.
- **Rozhraní vyká.**

## Analytika (rozhodnuto 2026-09-28)

- **Free:** objednávky se slevou, kolik slevy stály, průměrná objednávka.
- **Pro:** cena vs. výnos per pravidlo, rozdané dárky, výprodej prodáno X z Y, zásahy marže.
- Poctivě: žádné „appka ti vydělala X“ bez kontrolní skupiny (doctrine §12).

## Kombinování slev (rozhodnuto 2026-09-28)

- Výchozí: výprodej s ničím; produktové slevy navzájem ne (vyhrává výhodnější); produkt +
  objednávka + doprava ano.
- **Free:** merchant přepíná výchozí pravidla po kategoriích. **Pro:** pravidla per sleva
  (A se nekombinuje s B, ale s C ano).

## Výprodej per trh (rozhodnuto 2026-09-28)

- Výprodej (Pro) umí měnit i pevné ceny v cenících trhů. Merchant zvolí, kterých trhů se týká.

Zbytek mezer (A2–A4, A6–A13) odsouhlasen, viz `mezery.md`.

## Otevřené

Nic. Prompt orchestrátora: [`prompt-orchestrator.md`](prompt-orchestrator.md).
