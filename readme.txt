Aplikace která integruje do jednoho storefrontu b2b i b2c zákazníky.

Hlavní funkce:
 - b2b vidí aktualizované ceny + vlastní sekci produktů
 - b2b vidí vlastní obsah UX sekcí
 - b2b má vlastní minimální objednávku, počty kusů do košíku jdou například po kartonu
 - b2b a b2c každý má vlastní slevové kupóny
 - b2b a b2c je možné nastavit minimální cenu k produktu pod kterou nelze jít za použití kupónů a věrnostních slev

┌──────────────────────────────────────────────────────────┐
│                     1) ZÁKAZNÍK                          │
│              (B2C nebo přihlášený B2B)                   │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│                2) SHOPIFY STOREFRONT                     │
│  Produkty • Zákazníci • Nativní slevy • Objednávky       │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│              3) THEME APP EXTENSION (UI)                 │
│  - Zobrazení cen dle segmentu                            │
│  - Segmentovaný obsah                                    │
│  - MOQ / step quantity selektor                          │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│                4) APP BACKEND (ENGINE)                   │
│                                                          │
│  ├─ Segment Engine                                       │ -> Určuje, zda je zákazník B2B nebo B2C, mapuje segment na pricing pravidla, řídí oprávnění ke kupónům, poskytuje segment do všech dalších modulů
│                                                          │
│  ├─ Pricing Engine                                       │ -> Přepisuje základní cenu dle segmentu, aplikuje tier pricing a volume pricing, počítá effective base price před slevami, poskytuje cenu dalším modulům
│                                                          │
│  ├─ Discount Orchestrator                                │ -> Řeší kombinace slev, určuje priority, kontroluje stackability, validuje segmentová omezení kupónů, počítá finální cenu po aplikaci slev
│                                                          │
│  ├─ Margin Protection                                    │ -> Hlídá minimální cenu produktu (globální i per-product/per-segment), porovnává effective price s floor hodnotou, rozhoduje o ořezu slevy nebo blokaci checkoutu
│                                                          │
│  ├─ Product Visibility                                   │ -> Řídí viditelnost produktů a kolekcí podle segmentu, umožňuje B2B-only nebo B2C-only katalog, kontroluje dostupnost produktů
│                                                          │
│  └─ Quantity Rules Engine                                │ -> Nastavuje MOQ dle segmentu, definuje step quantity (např. karton 12 ks), validuje množství před checkoutem
│                                                          │
│  └─ Data Import Layer (Shopify /CSV / ERP)               │ -> Slouží k importu dat z různých zdrojů
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│              5) SHOPIFY FUNCTIONS (ENFORCEMENT)          │ -> shopify functions fungují na všech plánek, pokud je aplikace distribuována jako public skrze shopify app store
│  - Discount Function                                     │
│  - Cart Validation Function                              │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
                        ✔ CHECKOUT POVOLEN
                        ✖ CHECKOUT ZABLOKOVÁN


------------------------------------------------------------------------------------ MVP -------------------------------------------------------------------------

MVP_1 – MARGIN GUARD (Core Governance Foundation)
 ├─ Segment detection (basic B2B/B2C tag only)
 ├─ Global minimum price % (např. 70 %)
 ├─ Per-product minimum price %
 ├─ Basic discount stacking validation
 ├─ Discount Function enforcement
 ├─ Cart Validation (block checkout if below floor)
 └─ Admin: Floor configuration + log porušení

MVP_1.5 – MARGIN GUARD 2.0 (Core Governance Foundation)
 ├─ Lepší UI při kontrole slev. Aktuálně to píše text, který rozhodně není pro produkci.
 ├─ Tag na označení b2b zákazníka, nemusí být b2b, přidat do admina možnost si tohle změnit na jakýkoliv text
    ├─ V kódu dynamicky vyčítat tenhle b2b označení

Z MPV_1 se neimplementoval webhooks pro kompletní logování když se překročí maximální sleva, je na to potřeba přístup do Protected Customer Data. Nechá se na později.

MVP_2 – B2B Pricing Lite
 Přidat skutečnou B2B diferenciaci bez UX komplikací.
 ├─ Advanced Segment Engine (B2B/B2C role)
 ├─ B2B price override (per product)
 ├─ Tier pricing (quantity-based)
 ├─ Segment-based coupon validation
 └─ Basic product visibility (B2B-only flag)
   └─ Nový app extension na product visibility


MVP_3 – Quantity & Operational Rules
 ├─ MOQ per segment
 ├─ Step quantity (kartonové násobky)
 ├─ Per produkt maximum quantity limitation + hláška o tom problému
 ├─ Per collection maximum quantity limitation
 ├─ Collection-level MOQ
 ├─ Cart validation rozšíření
 └─ Admin rule builder

MVP_3_5 Quantity rules per collection
 ├─ Produkt/Collection/Customer picker z menu a search funkcionalitou
 ├─ Zobrazit a schovat variantu produktu. Tedy varianta A je kusovka. Varianta B je kartón.
 ├─ Když vyskočí nějaká hláška o porušení například maximum quantity, nebo překročení slevy, tak musí vyskočit hláška (to už se děje), ale navíc k tomu přidat tlačítko "rozumím", kterým to uživatel musí potvrdit a pak se teprve ta hláška zmizí. Takhle mizí moc rychle

MVP_3_9 All previous MVP testing all features must be working
 ├─ Všechny předchozí MVPs musí fungovat, být otestované jak v kódu tak i v rámci eshopu
 ├─ Vytvořit databázi s produkty, vypsat jak je jaký produkt limitovaný a to vše otestovat v rámci eshopu


MVP_4 – Advanced Discount Orchestration
 Plná kontrola kombinace slev
 ├─ Discount priority matrix
 ├─ Collection-level slevy, na všechny produkty xx sleva 10%, minimální cena, atd.. je tohle mid step mezi
 globální cenou a konkrétním produktem.
 ├─ Stackability rules
 ├─ Blacklist kombinací
 ├─ Max total discount cap
 ├─ Per-segment discount caps

MVP_4_5:
 Hezké UI
 Rozdělení v cestě: Settings -> tady potom bude víc možností jako Globální Nastavení, Produktové nastavení, Kolekce, Slevové kupóny, atd.. A po zakliku tady v tom menu se mi už objeví relevantní pole.
 Všechna funkcionalita musí zůstat tak jak je, pouze chci změnit jak se mi to mění v admin UI.
 Automatický import produktů z shopify kategorie produkty - tohle přidat do globálního nastavení. 
    Po téhle změně se musí taky upravit úplně všechny výběry produktu. Už nikde nechci mít že můžu dát celé to gid://shopify.... atd.. 
        chci si tam vybírat z těch produktů co mám načtené z shopify produktů/ tady to rovnou připravit i na MVP6, tedy budoucí načítání z ERP, CSV, atd..
    Jakmile mám nastavené nějaké pravidlo pro produkt, tak chci aby se mi lépe zobrazovala ta informace o tom produktu. Chci tam mít jeho název, a pak co jsem si nastavil, tedy například snowboard, visibility only for bold(B2B)
Aktuálně se nějak nastavené parametry k produktům zobrazují vždy pod daným pravidlem, chci tohle přesunout na začátek toho pravého sloupce dané kategorie,
    a chci tam mít tím pádem kompletní a hezky UI zpracovaný seznam produktů na které jsou tahle aktuální pravidla aplikovaná. Implementuj to zobrazování modulárně, protože to samé budu později chtít i do samotné složky, kde se mají zobrazovat všechny produkty co mám tahle nastavené.



MVP_5 – Segmented Storefront (UX Layer)
 ├─ Segment-based content sections
 ├─ B2B-only collections
 ├─ B2C-only collections
 ├─ Conditional PDP blocks
 └─ Dynamic messaging engine

MVP_5_0_1:
    Nefunguje správné schovváání produktů, je tam krátky flash po otevření stránky.

MVP_5_0_2:
    Produkt z carouselu zmizí správně tak jak má, pokud mám nastavené visibility pravidlo, ale 
    Globální metafields pro všechno co jde, aby nedocházelo nikde k problikávání
    Konkrétně: projektovat segmentově bezpečná storefront pravidla do shop metafieldu margin_guard.storefront_projection,
    aby je Liquid embed mohl použít hned při renderu theme. Do metafieldu patří B2B/B2C product visibility,
    collection visibility, product quantity pravidla, variant visibility, B2B tag a bootstrap metadata.
    Runtime-only zůstává všechno, co je customer-specific nebo potřebuje kontext, který nejde bezpečně předpočítat.
    Technický dluh a zbývající ověření: viz MVP_5_0_2_TECHNICAL_DEBT.md

MVP_5_0_3: HOTOVO
    Když vím, že nějaký produkt má automatickou slevu na něco, a vím, že v margin guardu má taky slevu, a v checkoutu by to spolu neprošlo, tak na to rovnou upozornit už v adminovi
    Přeci jenom, pokud si takový produkt přidám do košíku a sleva je aktivní, tak to chci v tom košíku znázornit
    Implementace:
      - core/discount/conflict.detector.ts — čistá detekce (automatická sleva + margin-guard pravidla vs floor), cenově nezávislá (procenta)
      - app/services/automatic-discounts.server.ts — čte aktivní automatické Shopify slevy (discountNodes, status:active method:automatic)
      - app/services/discount-conflict.server.ts — admin report (buildDiscountConflictReport) + živý cart resolver (resolveCartDiscountConflictsByHandle)
      - Admin warning banner v sekci Discounts (app.settings.tsx, jen při otevřené discount sekci)
      - Cart UI: /visibility loader vrací discountConflictsByHandle, visibility-script renderuje persistentní cart banner
      - Testy dle TESTING_POLICY (všechny vrstvy):
          unit: conflict-detector
          contract: automatic-discounts-normalize, visibility-script.contract (cart banner), loader response shape
          runtime integration: discount-conflict-resolver.integration (resolver s fake adminem)
          storefront e2e: storefront.discount-conflict.spec.ts (cart banner, graceful-skip bez živého shopu)
        (node testy jsou v guard:test:core; e2e v playwright.config testMatch)
      - Pozn.: e2e na živém shopu vyžaduje aktivní GLOBAL automatickou slevu + běžící app/tunnel; jinak se skipne (skip != fail)

---- ROZPRACOVANO ------

MVP_5_1: HOTOVO (dekompozice dokončena 2026-06-17)
 ├─Search hledání nefunguje - pokud nemám naimportované žádné kolekce nebo produkty - přidat warning, pokud tohle není udělané.
 ├─ Návrh jak rozdělit aplikaci do jednotlivých shippable produktů.
 ├─ A rozdělení aplikace do logických co nejvíc odizolovaných celků
 ├─ V hlavním menu aplikace budu chtít mít:
    ├─ Globální nastavení
        ├─ Nastavuje segment b2b zákazníka, discount stacking, atd.. a hlavně import dat produktů + kolekci
    ├─ <Vymysli jméno> záložky, která bude groupovat nastavení okolo produktů, tedy MOQ, step quantity, visibility, atd..
    ├─ Storefront UX, to už existuje
    ├─ Případně nějaké další, tak aby to dávalo smysl z pohledu co nejlepšího rozdělení aplikace do více izolovaných celků + pohled pro zákazníka, aby to bylo co nejintiutivnější

    Stav / rozhodnutí (potvrzeno uživatelem):
      - HOTOVO Search warning: catalog picker ukáže jasné "import first" varování (čte 409 catalogImportRequired) místo "Search error";
        Dashboard má top-level catalog-import banner; Catalog Rules měl banner už dřív.
      - HOTOVO Návrh shippable modulů (1 platforma "Foundation" + 4 prodejné: Margin Guard / B2B Pricing /
        Quantity Rules / Segmented Storefront + budoucí Data Import/ERP). Hranice = core/ engines + MVP roadmapa.
      - Menu = HYBRID: nav = 1 záložka na modul + cross-cutting "Products" panel (vše o jednom produktu pohromadě, navazuje na MVP_4_5).
        Záložka pro per-produkt pravidla zůstává pojmenovaná "Catalog Rules".
      - HOTOVO 1. reálná extrakce (vzor): Global Settings je samostatná route (app.settings.global.tsx: vlastní loader/action/component,
        už nere-exportuje monolit). Test app-settings-global-route.contract.test.ts.
      - HOTOVO Discounts: standalone route + sdílené discount-settings-view.tsx + discount-settings.server.ts (move-not-copy).
      - HOTOVO Catalog Rules (Stage 3): sdílený components/catalog-rules-view.tsx (per-produkt floor/tier/MOQ/step/max/customer +
        product/variant/collection visibility + collection-max + "Products affected" souhrn + sub-nav), standalone route
        app.settings.catalog-rules.tsx (vlastní loader/action, sdílí handler catalog-rules-settings.server). Test contract.
      - HOTOVO de-duplikace strangleru: sdílený components/global-settings-view.tsx; monolit app.settings.tsx je teď ČISTÝ
        AGREGÁTOR (renderuje 3 sdílené view + Functions panel + workspace chrome, deleguje všechny zápisy). /app/settings ("all")
        už není v menu (jen přímou URL); Functions runtime status žije jen tam.
      - HOTOVO cross-cutting Product Rules view (hybrid menu): components/product-rules-panel.tsx + read-only route
        /app/product-rules (vyber produkt → všechna jeho pravidla napříč moduly). Nová nav záložka "Product Rules".
      - STAV: guard:test:core = 256 zelená, tsc --noEmit = 0 chyb. MVP_5_1 dekompozice HOTOVA.
        Zbytkový tech-dluh (monolitní workspace chrome + Functions bez vlastní standalone route) → MVP_5_5.


MVP_5_2 – Věrnostní slevy + dokončení governance nad slevami

 Produktová filozofie (potvrzeno uživatelem 2026-06-17):
  Slevy si merchant tvoří NATIVNĚ v Shopify adminu. Naše appka je nestaví znovu — dělá
  dvě věci, které native (zvlášť na non-Plus) neumí:
   (1) GOVERNANCE nad nativními i vlastními slevami: margin floor, stacking/blacklist,
       capy, segment-gating kupónů, conflict detection.
   (2) TVORBA jen těch slev, co jsou segmentově/množstevně/věrnostně diferencované
       (B2B/B2C, tier/volume, loyalty) a vázané na floor.
  NON-GOAL: appka netvoří nativně dostupné typy (fixed amount na objednávku, BXGY,
  bundle, free shipping creation, usage limity, min-purchase podmínky, scheduling).
  To je native; my to jen GOVERNUJEME.
  Klíčový fakt (ověřeno v kódu): enforcement backstop (cart-validation funkce) je
  VALUE-BASED a SOURCE-AGNOSTIC — porovnává finalUnitPrice (= cost.amountPerQuantity,
  cena po VŠECH slevách, nativních i našich) vs floor → pod floor je checkout blokovaný
  už dnes, bez ohledu na původ slevy. Díra je jen v PROAKTIVNÍM varování (viz níže).

 ├─ Slevy pro věrné zákazníky (loyalty) — věrnost ovlivňuje JEN slevy, ne ceny/viditelnost/množství
 │   A) SPOTŘEBA (patří do 5_2, levné): věrnostní tier = tag (např. loyalty-gold).
 │      Engine matchuje rule podle tagu, funkce vynutí přes customer.hasAnyTag, floor +
 │      capy platí automaticky (je to běžná rule). Jede po stejné koleji jako segment.
 │   B) PŘIŘAZENÍ tieru z obratu (MIMO 5_2): "10k ročně → 10%" potřebuje akumulaci obratu
 │      (webhook orders/paid), klouzavé 12měsíční okno + tagovací job a naráží na
 │      Protected Customer Data gate (viz pozn. u MVP_1). V 5_2 přiřazení tagu ruční /
 │      přes Shopify Flow / nativní customer segment (POZOR: native = lifetime obrat, ne
 │      klouzavý roční). Auto spend-based přiřazení až ~MVP_6 (stavová data / ERP).
 │
 ├─ Audit úplnosti typů slev — co aktuálně CHYBÍ:
 │   Vlastní engine (DiscountRule + funkce):
 │     - Jen procenta (percentOff). Chybí pevná částka / fixní cena.
 │     - Žádná časová osa (startsAt/endsAt) → žádné naplánované akce/kampaně.
 │     - Žádný práh hodnoty košíku ("utrať X → Y") — data ve funkci jsou, logika ne.
 │     - Žádné limity čerpání (počet / per-zákazník / rozpočet).
 │     - Chybí VARIANT scope; BXGY, bundle, free shipping (delivery funkce je STUB) → vědomě native.
 │     - Tier/volume sleva existuje JEN jako tier pricing (pricing engine + ProductTierPriceRule)
 │       → revize existujícího, ne nová stavba.
 │   Governance (conflict detector) — PRIORITA:
 │     - Conflict detector je PERCENT-ONLY → nevidí nativní fixed-amount/BXGY slevy.
 │       Merchant je tak dostane zablokované až u pokladny místo varování v adminovi.
 │       Zhodnotit na VALUE-AWARE = priorita č. 1 (celá filozofie stojí na důvěře k native).
 │
 ├─ Doporučený reálný scope 5_2:
 │   1) Věrnostní tier jako eligibilita slevy (tag-driven, část A výše).
 │   2) Conflict detector value-aware (proaktivně vidí nativní fixed-amount/BXGY vs floor).
 │   Kandidáti dle kapacity: pevná částka ve vlastních slevách, scheduling, práh košíku.
 │   Loyalty = součást modulu B2B Pricing (segment-tvorba), NE nový modul.

 ──── STAV (implementováno 2026-06-17) ────
 HOTOVO Deliverable 1 — Loyalty tier jako eligibilita slevy (tag-driven):
   - core: ConfiguredDiscountRule.requiredCustomerTag + DiscountResolutionContext.customerTags;
     matchesRule() gatuje rule na tag (case-insensitive), nezávisle na binárním segmentu
     (Segment NEROZŠÍŘEN). buildDiscountRuleLookupKey přidá |TAG:<tag> jen když je tag set
     (zpětně kompatibilní canonicalKey).
   - prisma: DiscountRule.requiredCustomerTag (nullable) + migrace mvp_5_2_loyalty_discount_tag.
   - config (function-config.ts): DiscountRuleInput.requiredCustomerTag → discountRules payload;
     nový top-level loyaltyTags[] (distinct) → naplní input query variable $loyaltyTags.
   - extensions (OBĚ funkce): GraphQL přidává $loyaltyTags + customer.hasTags(tags:$loyaltyTags){tag hasTag}.
     Discount funkce portuje loyalty větev matchesRule (set z hasTags). Cart-validation: floor je
     value-based/source-agnostic → loyalty nemění floor; přidána jen GraphQL symetrie.
   - services: margin-guard-config (upsert/buildDiscountRuleset/canonicalKey) + discount-settings action.
   - admin UI: pole "Loyalty customer tag" v discount rule formuláři + výpis v seznamu.
   - Přiřazení tagu = ruční / Shopify Flow / customer segment (auto spend-based = MVP_6, mimo scope).
 HOTOVO Deliverable 2 — Conflict detector value-aware:
   - core conflict.detector: AutomaticDiscount má valueType (PERCENTAGE|FIXED_AMOUNT|UNSUPPORTED),
     amount, amountScope (PER_UNIT|PER_ORDER), unsupportedKind. Per-unit fixed-amount → efektivní
     cena vs floor; per-order fixed-amount a BXGY/ostatní → reason UNVERIFIABLE_AGAINST_FLOOR
     (DETEKUJ a označ, ne tiše ignoruj).
   - services: automatic-discounts.server normalizuje percentage + fixed-amount (DiscountAmount,
     appliesOnEachItem) + BXGY→UNSUPPORTED; discount-conflict.server dotahuje reálné ceny produktů
     (priceRangeV2.minVariantPrice) pro fixed-amount, store/collection-wide fixed-amount downgraduje
     na UNSUPPORTED (nelze ověřit proti nominální ceně). Report + cart notice nesou valueType/amount/
     unsupportedKind/UNVERIFIABLE. Cart banner i admin banner přidávají hlášku "zkontrolujte ručně".
 Testy: guard:test:core = 267 zelená, tsc --noEmit = 0 chyb. Pokryto: conflict-detector
   (fixed-amount/per-order/BXGY), orchestrator matchesRule loyalty, automatic-discounts-normalize,
   shopify-function-config-contract (+loyaltyTags), discount-conflict-resolver.integration (fixed-amount),
   discount-function-enforcement (loyalty hasTags gating).
 POZN. (deploy): změny v Shopify Functions (GraphQL input + JS) se v živém shopu projeví až po
   `shopify app deploy` (rebuild wasm + regen generated/api.ts). Live e2e pro loyalty/fixed-amount
   enforcement proto vyžaduje deploy — node testy běží proti JS přímo a jsou zelené.
 ODLOŽENO (mimo 5_2): auto spend-based přiřazení loyalty tieru (webhook+okno+Protected Customer Data) → ~MVP_6;
   tvorba nativně dostupných typů slev (fixed-amount/BXGY/bundle/free-shipping/scheduling/limity) zůstává native.

MVP_5_3: HOTOVO (simulované cenové katalogy — dokončeno 2026-06-18)
 ├─ ZADÁNÍ: Simulovat shopify native katalogy (od dubna 2026 i non-plus plány max 3); v aplikaci jich podpořit "nekonečně"; připravené na import dle MVP_6.
 │
 ├─ VÝSLEDEK: binární segment B2B/B2C byl zobecněn na N datově řízených "cenových katalogů". Katalog = audience(tagy/priorita) + membership + cenová listina + floor + slevy + množstevní pravidla + volitelný market filtr. Katalog je univerzální scoping klíč pro vše, co bylo dřív per-segment nebo globální. Default (base) katalog = globální baseline / anonymní B2C fallback; ostatní katalogy dědí a override-ují deltou.
 │
 ├─ CO PŘIBYLO (architektura):
 │   ├─ core/catalog/: catalog.types + catalog.resolver (audience+priorita+market, default fallback) + catalog.merge (merge(base,delta) = hustá efektivní vrstva) + catalog.ruleset (per-katalog adapter: 1× FloorRuleset+DiscountRules na katalog).
 │   ├─ core/config/function-config.ts → buildCatalogConfigFromCatalogs(shop, catalogs): config se skládá VÝHRADNĚ z katalogových tabulek (default=base, b2b/custom dědí). MarginGuardConfig přispívá jen shop-wide skaláry.
 │   ├─ Prisma: PriceCatalog + děti (audience/market/membership/price/tier/floor/quantity/discount/variant-visibility/visibility/coupon/cap/blacklist/customer-quantity). Cenová listina: full native parity (katalog% + per-collection% + per-product/variant FIXED|% + tier), precedence most-specific-wins.
 │   ├─ Admin: /app/catalogs (seznam) + /app/catalogs/:id editor (taby per facet) + AdminCatalogPicker pro výběr produktů/kolekcí; slim Global Settings (jen skaláry + import).
 │   ├─ Shopify Functions (cart-validation + discount): obě resolvují katalog z customer tagů (+ purchasing company + market), merge(default, catalog), aplikují cenovou listinu + floor + catalogId-scoped slevy/coupony/cap/blacklist. Cena zůstává runtime (žádný metafield bloat), delta-encoding šetří velikost.
 │   ├─ Storefront: projection metafield nese catalogResolution + per-katalog visibility; b2b/b2c anti-flash snapshoty se REGENERUJÍ z katalogů (tvar payloadu zachován → BEZ editu liquidu/scriptu). hidden_handles metafield taky z katalogové product visibility.
 │
 ├─ DEMOLICE LEGACY (#2.3 — staženo na čistý štít):
 │   ├─ Smazány legacy admin routes/views/handlers (per-segment Global/Catalog Rules/Discounts/Product Rules) + jejich testy + nav.
 │   ├─ Smazány legacy buildery (*B2C/*B2B, buildCart/DiscountFunctionConfig, buildCatalog*, buildPublished*) — function-config.ts exportuje jen buildCatalogConfigFromCatalogs.
 │   ├─ Migrace analytiky/enforcementu na katalogy (děti MarginGuardConfig NEBYLY mrtvé): conflict detector (cart varování), webhook violation logging, pricing preview/admin endpoint, dashboard, storefront projekce + visibility loader — vše čte z katalogových tabulek přes per-katalog ruleset adapter (segment-tvarové jádro běží 1× per katalog).
 │   ├─ NEVRATNÉ: migrace 20260618130000 shodila 11 legacy tabulek (Product/Collection floor/tier/quantity/visibility/customer-qty + Coupon/Discount/Blacklist/Cap segment pravidla). margin-guard-config.server.ts přepsán na skaláry + violations + buildFloorRuleset + canonical-key helpery + katalogový syncVisibilityHandlesMetafield. PONECHÁNO: CollectionVisibilityRule + StorefrontContentRule (samostatná aktivní storefront-content funkce).
 │
 ├─ GATE: typecheck 0, guard:test:core 271 zelených, npm run build 0, shopify app deploy OK (b2bcommerce-6). Theme-check: vyřešen ParserBlockingScript (defer) + RemoteAsset (záměrné — dynamický app-proxy URL, dokumentovaně potlačeno).
 │
 ├─ OTEVŘENÉ FOLLOW-UPY (nejsou blokující):
 │   ├─ catalog%/collection%/variant% cena v shadow-výpočtu webhooku/preview (zatím floor%+tier+FIXED override = na/nad úrovní legacy parity).
 │   ├─ cart-validation HARD-BLOCK na katalogem skryté produkty (zatím jen storefront-hide přes loader/projection).
 │   ├─ cross-cutting by-facet lens (read-only agregace přes katalogy).
 │   └─ CUSTOMER_ONLY product/variant visibility nemá katalogový ekvivalent (katalogy scope-ují dle audience, ne dle jednotlivého zákazníka) — v e2e seedu zatím přeskočeno.
 │
 └─ K OVĚŘENÍ UŽIVATELEM: e2e matice (npm run test:e2e:matrix) proti dev storu (seed + storefront chování nešlo ověřit lokálně); rozhodnout o CUSTOMER_ONLY mapování.

MVP_5_4: HOTOVO (catalog-native e2e harness — legacy segment shim odstraněn, 2026-06-18)
 ├─ ZADÁNÍ: zbavit se legacy v e2e test harnessu a jet jen novou cestou skrze katalogy, co nejbezpečněji. Scope = JEN e2e harness (produkční segment řeší MVP_5_6). Vrstva = jen app-proxy.
 │
 ├─ VÝSLEDEK: e2e harness byl v MVP_5_3 dočasně přemostěn shimem (tests/e2e/support/legacy-config-compat.ts), který přemapovával staré per-segment upserty na katalogy a SEEDOVAL na systémové katalogy default/b2b → destruktivní (clearSystemCatalogRules mazal uživatelova pravidla) a vyžadoval publication scopes (manufakturoval produkty). Teď je harness plně catalog-native.
 │
 ├─ KLÍČOVÝ DESIGN (bezpečnost = nulový blast radius):
 │   ├─ Dedikovaný odhoditelný e2e katalog (tests/e2e/support/catalog-e2e.ts, audience tag "mg-e2e-catalog", ACTIVE/INHERIT_ALL/priority 999). Všechna e2e pravidla žijí na něm; úklid = deletePriceCatalog (cascade). Žádný reálný zákazník ten tag nenese → default/b2b se nikdy nedotkne. Seed na EXISTUJÍCÍ publikované produkty → bez read_publications/write_publications.
 │   ├─ Override zobecněn z "segment" na "audience tagy": mg_e2e_segment → mg_e2e_audience; storefront-segment-override.server.ts → storefront-catalog-override.server.ts (vrací string[] tagů). Loader/route/storefront-content injektují tagy do matchedTags → katalogová resoluce vybere e2e katalog. Stejná tvrdá prod-safety gate (MARGIN_GUARD_E2E_OVERRIDE=1 + non-production no-op). Jediný e2e-gated produkční soubor.
 │   ├─ Matice tema × KONTEXT: base (bez override → default → neomezeno) vs catalog (mg_e2e_audience=mg-e2e-catalog → seeded pravidlo platí). 4 projekty tier1-{horizon,dawn}-{base,catalog}, read-only, plně paralelní.
 │
 ├─ SMAZÁNO / ZMĚNĚNO: legacy-config-compat.ts (shim), scripts/seed-e2e-catalog.ts (manufakturující provisioner + e2e:seed-catalog script), storefront.cart-enforcement.spec.ts (reálné Shopify Functions u checkoutu = mimo app-proxy scope, kryto integration/contract), seed.ts osekáno (snapshot/reset/seed*Scenario pryč; zůstal offline-admin client + projection resync), matrix.ts (catalog archetypy HIDDEN/VARIANT_HIDDEN/QUANTITY_*, manifest×legacy duál pryč), serial specy (smoke/listing/discount-conflict) přepojeny na čerstvý e2e katalog + forced audience.
 │
 ├─ GATE: typecheck 0, guard:test:core 271 zelených. Ověřeno proti reálné dev DB: e2e katalog create→seed→resolve→delete funguje, resolveStorefrontCatalogProductVisibility(["mg-e2e-catalog"]) vrací HIDDEN produkt (catalog kontext) vs [] (base), a default/b2b rule counts BEFORE==AFTER (nulový blast radius).
 │
 ├─ ZBYTKOVÉ GAPY (dokumentované): collection visibility je projection/Liquid (segment b2b/b2c snapshot), override ji do custom katalogu nevynutí → kryto projection unit + embed contract testy. Reálný checkout-level Functions enforcement → integration/contract/runtime testy.
 │
 └─ K OVĚŘENÍ UŽIVATELEM: plný browser run (npm run test:e2e) potřebuje dev app spuštěnou s MARGIN_GUARD_E2E_OVERRIDE=1 (jinak je override inertní a catalog kontext nevynutí katalog). Tj. restart `MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev`, pak npm run test:e2e.

MVP_5_4_9 (PLÁN) – Odstranit binární B2B/B2C segment z PRODUKČNÍHO kódu
 ├─ KONTEXT: MVP_5_4 zbavil legacy JEN e2e harness; produkční kód pořád nese binární segment B2B/B2C jako nosnou vrstvu (storefront na něm stojí). Tohle MVP ho doplatí, aby celá aplikace jela jen na katalozích.
 │
 ├─ PROČ ZBYLO: segment je v produkci pořád load-bearing na třech místech, která nejdou vypnout bez náhrady:
 │   ├─ Storefront projection metafield nese b2b/b2c anti-flash snapshoty (segments.b2b / segments.b2c) — REGENERUJÍ se z katalogů, ale tvar je pořád segmentový (MVP_5_3 ho schválně zachoval, aby se needitoval liquid).
 │   ├─ Liquid app-embed (extensions/margin-guard-storefront/blocks/margin_guard_visibility_embed.liquid) čte current_segment_key (b2b/b2c) z customer.b2b? + tagu a vybírá segments.b2b/b2c snapshot + hidden_handles.b2b/b2c.
 │   ├─ Loader/segment engine (resolveVisibilitySegment, core/segment/*) + CatalogRuleset.segment + storefront-content (segment-keyed pravidla) pořád derivují B2B/B2C.
 │
 ├─ ROZSAH (návrh, ne hotovo):
 │   ├─ Projection: nahradit segments.b2b/b2c per-katalogovými snapshoty klíčovanými catalogId (catalogResolution už v projection je) → schema migrace metafieldu (verzovat schemaVersion).
 │   ├─ Liquid embed: místo current_segment_key resolvovat catalogId klientsky z customer tagů + catalogResolution (mapování tag→katalog už je v projection) a číst per-katalog snapshot; nativní Shopify B2B (customer.b2b?) namapovat na "b2b" katalog (zachovat zpětnou kompatibilitu pro shopy bez custom katalogů).
 │   ├─ Override: zrušit segment derivaci v loaderu (segment už jen informativní) — payload pole "segment" nahradit catalogId; storefront-catalog-override.server.ts už vrací tagy, takže gate beze změny.
 │   ├─ storefront-content: rozhodnout, jestli zůstane segment-keyed (samostatná funkce) nebo se taky překlopí na katalogy (větší zásah, možná samostatné MVP).
 │   ├─ Smazat: CatalogRuleset.segment, resolveVisibilitySegment B2B/B2C větve, core/segment/* pokud už nic nečte.
 │
 ├─ RIZIKA: přepis liquid embed vrstvy (anti-flash first-paint nesmí blikat), mapování nativního Shopify B2B na katalog, migrace projection schématu (starý vs nový tvar po dobu přechodu), nutnost re-deploy + re-projekce všech shopů. Vyšší riziko než MVP_5_4 → vlastní MVP, ne součást harness cleanupu.
 │
 └─ GATE (až se to bude dělat): typecheck 0, guard:test:core zelené, storefront e2e (catalog-native matice z MVP_5_4) zelená na obou tématech, anti-flash bez bliknutí.


MVP_5_5
 ├─ Fixnout pouštění testů skrze lokální theme
 2) Deterministicky zelené — shopify theme dev lokální origin (DOPORUČENO)
Lokální origin (http://127.0.0.1:9292) vůbec neprochází Cloudflare bot-challenge — browser mluví jen s localhostem, app-proxy /apps/* se forwarduje na store. Harness tohle už podporuje (runtime.ts počítá s theme dev originem + SHOPIFY_E2E_SHOP_DOMAIN). Postup:
    # terminál 1: app + tunnel + override armed (běží)
    MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev
    # terminál 2:
    shopify theme dev --store b2b-b2c-store-development.myshopify.com
    # terminál 3:
    SHOPIFY_E2E_STOREFRONT_BASE_URL=http://127.0.0.1:9292 \
    SHOPIFY_E2E_SHOP_DOMAIN=b2b-b2c-store-development.myshopify.com \
    npm run test:e2e
    Omezení: theme dev servíruje jeden theme → Dawn preview_theme_id projekty se musí vypnout
    (unset SHOPIFY_E2E_PREVIEW_THEME_ID → Dawn projekty se skipnou samy, jinak spadnou na theme-mismatch guardu). Dual-theme je „nice to have";
    katalogová logika je theme-independent (asertuje se app-proxy payload). Pokud chceš i Dawn, druhý běh s theme dev na Dawn.
Stejně tak mít na to jeden command kterému dám vždy jenom argument -Dawn nebo -Horizon.


MVP_5_5_1
├─ Po tomhle nesmí být žádný technický dluh
├─ Udělat kompletní validaci že stále vše sedí a funguje, tedy pustit testy, projít repo jak je vše implementované a že nedošlo k odchýlení celé myšlenky aplikace
├─ Otestovat funkčnost jednotlivých komponent tak aby je šlo shippovat samostatně
├─ Vyřešit duplicitní log cart validation
├─ Všechna pole v UX které dávají smysl tak mít automatické vybírání. Například shopify cdn na obrázky nebudu dávat ten přímý link, tohle platí všude kde mám gid.
├─ Tohle je takové optimalizační MVP, musí se tady vyřešit vše, aby aplikace běžela s naprosto minimálním overheadem


MVP_6 – Data Import / ERP Light
 ├─ CSV import cen
 ├─ CSV import MOQ
 ├─ Bulk segment import
 ├─ Validation report
 └─ Audit log

MVP_7 – Doprava pro B2B
 ├─ TODO?

MVP_8 – TODO?
 ├─ TODO?
 └─ TECH DEBT: `npm run graphql-codegen` selhává na duplicitě operace "ProductHandlesByIds"
    – stejný název query je definovaný ve dvou souborech:
    app/services/margin-guard-config.server.ts a app/services/storefront-projection.server.ts.
    Admin codegen projekt proto failuje (function api.ts se i tak vygeneruje).
    Fix: přejmenovat jednu z operací (např. ProductHandlesByIdsForProjection) nebo
    sdílet jeden dotaz. (Objeveno při MVP_5_3, kdy jsem regeneroval funkční api.ts.)

------------------------------------------------------------------------------------ STRUKTURA REPOZITÁŘE -------------------------------------------------------------------------

/shopify-app/
│
├── app/                         
│   # Remix aplikace (Admin UI + API endpoints)
│   # Tenká vrstva nad core logikou.
│   # Neobsahuje business pravidla, pouze orchestrace.
│
│   ├── routes/                  
│   │   # Admin stránky + API endpoints
│   │   # Např. /settings, /pricing, /discount-rules
│   │
│   ├── components/              
│   │   # UI komponenty (Polaris, formuláře, tabulky)
│   │
│   ├── services/                
│   │   # Orchestrace mezi Shopify API ↔ core engine
│   │   # Nikdy zde neimplementovat business pravidla
│   │
│   ├── loaders/                 
│   │   # Remix data loaders
│   │
│   └── utils/                   
│       # Pomocné utility (formatování, validace vstupů)
│
├── core/                        
│   # 💡 Čistá doménová logika (tvé IP)
│   # Nezávislé na Shopify, Remix ani DB
│   # 100% testovatelné jednotkovými testy
│
│   ├── segment/
│   │   ├── segment.engine.ts    
│   │   │   # Určuje segment zákazníka (B2B/B2C)
│   │   │   # Mapuje segment na pravidla
│   │   └── segment.types.ts     
│   │       # Typy pro segmenty
│   │
│   ├── pricing/
│   │   ├── pricing.engine.ts    
│   │   │   # Přepis ceny dle segmentu
│   │   │   # Tier pricing
│   │   │   # Výpočet effective base price
│   │   │
│   │   ├── pricing.pipeline.ts  
│   │   │   # Hlavní price computation flow
│   │   │   # Base → Override → Discounts → Margin → Final
│   │   │
│   │   └── pricing.types.ts     
│   │       # Typy pro pricing model
│   │
│   ├── discount/
│   │   ├── discount.orchestrator.ts
│   │   │   # Řeší kombinace slev
│   │   │   # Priority, stackability, caps
│   │   │
│   │   └── discount.rules.ts    
│   │       # Datové modely pro slevová pravidla
│   │
│   ├── margin/
│   │   ├── margin.guard.ts      
│   │   │   # Hlídá minimální cenu (floor)
│   │   │   # Rozhoduje o blokaci / ořezu
│   │   │
│   │   └── floor.rules.ts       
│   │       # Definice globálních / produktových floor pravidel
│   │
│   ├── quantity/
│   │   ├── quantity.engine.ts   
│   │   │   # MOQ, step quantity, collection rules
│   │   │
│   │   └── quantity.rules.ts    
│   │       # Datové modely pro množstevní pravidla
│   │
│   └── visibility/
│       └── visibility.engine.ts 
│           # Řídí B2B/B2C viditelnost produktů a kolekcí
│
├── functions/                   
│   # Shopify Functions (WASM)
│   # Enforcement vrstva – minimum logiky
│   # Pouze validace a final price override
│
│   ├── discount-function/
│   │   ├── src/
│   │   │   # Volá pricing pipeline
│   │   │   # Vrací finální cenu
│   │   └── shopify.extension.toml
│   │
│   └── cart-validation/
│       ├── src/
│       │   # Validuje MOQ, step, floor
│       └── shopify.extension.toml
│
├── integrations/
│   # Adaptéry na externí svět
│   # Nikdy zde nepsat core logiku
│
│   ├── shopify/
│   │   ├── shopify.client.ts    
│   │   │   # Inicializace Shopify API klienta
│   │   │
│   │   ├── metafields.ts        
│   │   │   # Čtení / zápis metafieldů
│   │   │
│   │   └── webhooks.ts          
│   │       # Reakce na změny produktů / zákazníků
│   │
│   └── csv/
│       └── importer.ts          
│           # CSV import cen, MOQ, segmentů
│
├── database/
│   # Persistence vrstva (Prisma / SQL)
│
│   ├── schema.prisma            
│   │   # Definice modelů:
│   │   # Segment, PricingRule, MarginRule, DiscountRule
│   │
│   ├── migrations/              
│   │   # Migrace DB
│   │
│   └── seed.ts                  
│       # Seed data pro testování
│
├── tests/
│   # Jednotkové testy pouze pro core/
│
│   ├── pricing/
│   ├── discount/
│   └── margin/
│
├── types/
│   └── global.types.ts          
│       # Sdílené typy mezi vrstvami
│
├── config/
    └── feature-flags.ts         
        # Aktivace MVP fází (např. enableMVP3 = false)
