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

MVP_5_4_9 (HOTOVO – storefront-only, 2026-06-19) – Odstranit binární B2B/B2C segment z PRODUKČNÍHO kódu
 ├─ ROZHODNUTÍ ROZSAHU (uživatel): STOREFRONT-ONLY. Binární segment odstraněn z viditelnostní/projection cesty (projection snapshoty, hidden_handles, liquid embed, loader). CatalogRuleset.segment / CatalogResolutionEntry.segment PONECHÁNY jako interní per-katalog nálepka (NE globální binární přepínač) — čte je conflict detector (admin varování), function-config, pricing/margin cores přes per-katalog adaptér; jejich překlopení = případně samostatné MVP.
 │
 ├─ VÝSLEDEK (co se reálně udělalo):
 │   ├─ Projection (storefront-projection.server.ts): segments.b2b/b2c → catalogSnapshots: Record<catalogId, snapshot> (snapshot pro každý resolvovatelný katalog, default vždy přítomen). schemaVersion 1→2. defaultCatalogId odvozen konzistentně. Test přepsán na catalogSnapshots.
 │   ├─ hidden_handles metafield (margin-guard-config.server.ts): { b2b, b2c, b2bTag } → { catalogs: Record<catalogId, handles[]>, defaultCatalogId, b2bTag }.
 │   ├─ Liquid embed: current_segment_key zrušen; current_catalog_id se resolvuje klientsky (iterace catalogResolution: audience tagy + nativní customer.b2b? na matchCompany katalog, nejvyšší priorita vyhrává, default fallback); čte catalogs[id] + catalogSnapshots[id]. Bootstrap pole "segment" → "catalogId".
 │   ├─ Loader (margin-guard-visibility.loader.server.ts): resolveVisibilitySegment (B2B/B2C derivace) → resolveCustomerAudienceTags (jen sběr tagů). Response: segment → catalogId (přes nový resolveStorefrontCatalogId v catalog-ruleset.server.ts + route wiring), segmentDebug → audienceDebug. Sdílené resolvery (storefront-visibility.server.ts) mají segment param optional; loader ho už nepředává (catalog rules jsou segment-null → vestigiální).
 │   ├─ visibility-script JS: debug pole payload.segment → catalogId (jen logging).
 │
 ├─ RIZIKA (zbylá, dokumentovaná): nutnost re-deploy app-embed + re-projekce shopů (starý metafield tvar po dobu přechodu — liquid je tolerantní: chybějící catalogSnapshots/catalogs → prázdné, default fallback). Anti-flash vizuálně NEověřeno (mimo GATE; je designový požadavek). Market-osa se v liquid anti-flash neřeší (runtime axis, stejně jako dřív).
 │
 ├─ NEUDĚLÁNO (vědomě mimo storefront-only scope): CatalogRuleset.segment/CatalogResolutionEntry.segment, conflict-detector segment labely, core/segment/* (čte ho webhook/pricing-preview/storefront-content), storefront-content segment-keyed pravidla.
 │
 ├─ KONTEXT (původní): MVP_5_4 zbavil legacy JEN e2e harness; produkční kód nesl binární segment jako nosnou vrstvu.
 │
 └─ GATE (upraveno uživatelem 2026-06-19): jen zelené testy MIMO testy pouštěné na živém eshopu → typecheck 0 + guard:test:core zelené. SPLNĚNO: typecheck 0, guard:test:core 271/271 zelené. Storefront e2e proti živému storu a vizuální anti-flash kontrola se zde NEvyžadují.

MVP_5_4_9 (PŮVODNÍ PLÁN – archiv) – Odstranit binární B2B/B2C segment z PRODUKČNÍHO kódu
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
 └─ GATE (upraveno uživatelem 2026-06-19): jen zelené testy MIMO testy pouštěné na živém eshopu → typecheck 0 + guard:test:core zelené. Storefront e2e proti živému storu a vizuální anti-flash kontrola se zde NEvyžadují (anti-flash zůstává designový požadavek, ne GATE).


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

 ──── STAV (implementováno 2026-06-19; theme-agnostic revize téhož dne) ────
 HOTOVO jeden command přes lokální theme-dev origin, BEZ theme argumentu (suite je theme-agnostická):
   POUŽITÍ:
     # terminál 1:  MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev
     # terminál 2:  shopify theme dev --store b2b-b2c-store-development.myshopify.com   (libovolný checkout — Horizon i Dawn)
     # terminál 3:  npm run test:e2e:local                       (theme dev na defaultním :9292)
     #              npm run test:e2e:local -- --port 53142        (theme dev na jiném portu)
     #              npm run test:e2e:local -- --url http://127.0.0.1:53142
   ROZHODNUTÍ (uživatel): testům je jedno, jaký theme běží → odebrán povinný -Dawn/-Horizon flag; který
     theme jede si hlídá uživatel sám (terminál 2). port theme devu není deterministický → přidán --port/--url.
   PÁTEŘ = marker env var SHOPIFY_E2E_THEME_DEV=1 (nastaví wrapper). Vše downstream čte env jako každý SHOPIFY_E2E_*.
   ZMĚNY (1 nový skript + 2 chirurgické edity, runner/runtime/serial NEDOTČENÉ):
     - scripts/test-e2e-local.mjs (NOVÝ): parse volitelného --port/--url (precedence: arg > pre-set env >
       default :9292) → env kontrakt (SHOPIFY_E2E_THEME_DEV=1, base URL, SHOPIFY_E2E_SHOP_DOMAIN, prázdné
       PREVIEW_THEME_ID) → exec stávající runner. Nespouští theme dev (jiný checkout mimo app repo), nesahá na flag.
     - playwright.matrix.config.ts: SHOPIFY_E2E_THEME_DEV set → 2 theme-agnostické projekty (local-base +
       local-catalog); unset (remote) → plná 4-projektová matice (tier1-{horizon,dawn}-{base,catalog}) beze změny.
     - tests/e2e/support/theme.ts: theme-dev mód → theme guard (verifyActiveTheme) je no-op, žádný preview_theme_id.
       Name-check (SHOPIFY_E2E_{DAWN,HORIZON}_THEME_NAME) + preview_theme_id zůstávají JEN pro remote 4-projektovou matici.
     - package.json: test:e2e:local → node ./scripts/test-e2e-local.mjs.
     - tests/e2e/README.md: narovnaná lokální sekce.
   DŮSLEDEK odebrání flagu: name-check v theme-dev modu PADÁ (není proti čemu jméno ověřovat) — vědomé, hlídá uživatel.
   ZJIŠTĚNÍ: Horizon-local fungoval i předtím (starý test:e2e:local); delta byl jeden command + Dawn na theme-dev.
   OVĚŘENO: typecheck 0; --list (remote=4 tier1-*, theme-dev=2 local-base/local-catalog);
     wrapper: bez argu OK, --port 53142 → base URL :53142, neznámý arg / --url+--port zároveň → usage + exit 2.
   NEOVĚŘENO LOKÁLNĚ: skutečný zelený běh — vyžaduje běžící theme dev + app s armed flagem (3 terminály).

 ──── DOPLNĚK (2026-07-10): jeden command na OBA themes, theme dev spouští wrapper ────
 POUŽITÍ (2 terminály místo 3):
   # terminál 1:  MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev
   # terminál 2:  npm run test:e2e:local:all               (Horizon, pak Dawn)
   #              npm run test:e2e:local:all -- --only dawn | --bail | --dry-run | --verbose
 ROZHODNUTÍ (uživatel): wrapper si theme dev spouští sám. Cena = app repo zná cestu k theme
   checkoutům (../b2b_b2c_themes/{Horizon,Dawn}, přepis přes SHOPIFY_E2E_THEME_DIR_*) a
   `shopify` CLI je runtime závislost testů. Původní test-e2e-local.mjs (jeden theme, theme dev
   si řídí uživatel) ZŮSTÁVÁ beze změny — nový skript je vedle, ne místo.
 SEKVENČNĚ, ne paralelně: oba tiery forsují JEDEN sdílený e2e katalog a seriální tier ho mutuje
   per-test → dva paralelní themes by se porvali o katalog i o globalSetup/teardown.
 SYNC TARGET: stejnojmenné remote themes "Horizon" / "Dawn" (--theme), NE efemérní development
   theme. Přepis: SHOPIFY_E2E_THEME_NAME_{HORIZON,DAWN}. OBA MUSÍ ZŮSTAT [unpublished] —
   `theme dev` do cíle pushuje změny v reálném čase. Live je na storu "test-data" (uživatel
   přehodil 2026-07-10; předtím byl live Horizon). CLI živý theme bez --allow-live odmítne a
   skript ten flag nikdy nepředává → špatný cíl selže rychle, ne potichu.
 PORTY: 9781 / 9782 — schválně daleko od :9292/:9293 (drží je theme dev klientských themes).
   Obsazený port → fallback na volný ephemeral + hláška. Přepis: SHOPIFY_E2E_THEME_PORT_*.
 DVA GUARDY (obojí reakce na reálné selhání 2026-07-10):
   - theme-dir guard: adresář musí mít layout/theme.liquid. `shopify theme dev` spuštěný o adresář
     výš se zeptá "not a theme directory, proceed?" a na "yes" nasype prázdný strom do dev theme
     (remote delete errors + GET 404 /). Živý theme se nedotkne, ale běh je k ničemu.
   - app-proxy preflight: GET /apps/margin-guard/visibility-script musí vrátit 200. Bez něj je
     chybějící terminál 1 TICHÝ — Playwright má webServer.url na theme-dev originu,
     reuseExistingServer ho vidí odpovídat, suite jede proti app bez armed override a `catalog`
     projekt padá, jako by šlo o bug v kódu. Vypnout lze --skip-app-check.
 POZN. K HESLU: storefront password Playwright umí vyplnit sám (SHOPIFY_E2E_STOREFRONT_PASSWORD,
   storefront.ts). NIKDY nebyl důvodem pro lokální theme dev — tím je Cloudflare bot-challenge,
   kterou harness neumí odemknout a test místo toho SKIPNE (skipnutý ≠ zelený).
 OVĚŘENO (stub `shopify` binárka na PATH, bez sáhnutí na store): dry-run obou themes; --only;
   --bail (druhý theme se nepustí); exit 2 na neznámý arg / bad --only / bad --timeout; exit 1 na
   selhání; theme-dir guard na rodičovský i neexistující adresář; port fallback při obsazeném 9781;
   správné argumenty spawnu (--path/--theme/--port/--store-password); theme dev umírající při startu
   → fail za 2s (ne 240s) + tail výstupu CLI; žádný orphan proces po doběhnutí ani po SIGTERM.
   typecheck 0, guard:test:core 271/271.
 NEOVĚŘENO: skutečný zelený běh proti storu (vyžaduje běžící app s armed flagem + funkční themes).
   Ověřeno jen, že cílové themes existují a jsou [unpublished] (shopify theme list 2026-07-10).


🔴 NÁLEZ (2026-07-10) – `shopify theme dev` přepisuje content-type proxovaných /apps/* odpovědí
 ├─ SYMPTOM (JEN přes lokální theme dev origin): konzole "Refused to execute script from
 │   '/apps/margin-guard/visibility-script' because its MIME type ('text/html') is not executable".
 │   Script se stáhne (200, správné tělo), prohlížeč ho NESPUSTÍ (storefront posílá nosniff) →
 │   neodejde request na /visibility → všechny storefront e2e testy padají na waitForResponse timeout.
 │
 ├─ PRODUKCE JE V POŘÁDKU. Ověřeno v prohlížeči přímo na https://b2b-b2c-store-development.myshopify.com
 │   /products/the-videographer-snowboard: script se načte s `content-type: text/javascript; charset=utf-8`,
 │   spustí se, 0 chyb v konzoli, /apps/margin-guard/visibility se volá (2 requesty). Shopify app proxy
 │   content-type PROPOUŠTÍ. Uživatel to celou dobu tvrdil správně.
 │
 ├─ MĚŘENÍ přes theme dev origin (co se reálně děje): theme dev přepošle TĚLO ze Shopify, ale sám
 │   přepíše content-type na text/html u všeho, co není application/json:
 │     app posílá text/javascript / application/javascript / text/css / text/plain → theme dev vrací text/html
 │     app posílá application/json                                                  → theme dev vrací application/json
 │   (Podepsaný request přímo na app :59946 i na CLI proxy :59943 vrací korektní JS content-type.)
 │
 ├─ POZOR NA ZÁMĚNU (moje chyba 2026-07-10): odpověď z theme devu nese cf-ray, x-request-id a
 │   set-cookie _shopify_y → svádí k závěru "to posílá Shopify". Dokazuje to jen původ TĚLA, ne hlaviček.
 │   Jediný platný test produkčního chování je request na živý storefront, ne přes theme dev.
 │
 ├─ DOSAH: pouze lokální testovací cesta (test:e2e:local, test:e2e:local:all). Remote matice nedotčena.
 │
 ├─ POZN.: app-proxy preflight v test-e2e-local-all.mjs kontroloval jen status 200 → tenhle blok NECHYTIL.
 │   Nově asertuje TĚLO (obsahuje DEFAULT_PROXY_PREFIX); content-type kontrolovat nelze, theme dev ho přepíše.
 │
 └─ OPRAVA (testy, NE aplikace): tests/e2e/support/theme-dev-mime.ts — page.route vrátí skriptu
    spustitelný content-type. Aktivní JEN při SHOPIFY_E2E_THEME_DEV=1, proti remote se nespustí.
    Nasazen přes nový tests/e2e/support/test-base.ts (jediný vstupní bod pro `test`); fixtures.ts z něj
    dědí, tři seriální specy na něj přepsány. Import `test` z "@playwright/test" ve specu = ztráta shimu.

🔴 KOREKCE (2026-07-10) – tvrzení "lokální theme-dev origin NIKDY neservíruje bot-challenge" je NEPRAVDIVÉ
 ├─ theme dev renderuje stránku přes Shopify (posílá lokální soubory nahoru), takže Cloudflare
 │   interstitial chodí i na 127.0.0.1 originu. POTVRZENO dumpem stránky v okamžiku detekce:
 │   <title>Verifying your connection...</title>, 10× marker `_cf_chl` → skutečná Cloudflare challenge,
 │   ne false positive detektoru.
 │
 ├─ NENÍ to fingerprint prohlížeče. Změřeno na seriálním tieru (7 testů, workers=1):
 │     headless shell   → 3 passed, 1 failed, 3 skipped (challenge na testech 5-7)
 │     plný chromium    → totéž pořadí; v "horkém" běhu hned po předchozím 7/7 skipnuto
 │     headed real Chrome (channel=chrome, PLAYWRIGHT_HEADLESS=0) → 3 passed, 1 failed, 3 skipped
 │   Vždy padnou POZDĚJŠÍ testy → spouštěčem je objem requestů z této IP, ne to, čím se prohlížeč tváří.
 │   channel je proto v obou configech jen OPT-IN (PLAYWRIGHT_CHANNEL), default zůstal nezměněn.
 │
 ├─ OPRAVA (částečná, storefront.ts): je to Cloudflare MANAGED challenge → sama se doresolvuje.
 │   Harness ale skipoval v okamžiku detekce. Nově waitForVerificationChallengeToClear() počká až 25 s
 │   a skipne, jen když challenge přetrvá. Efekt: testy, které dřív skipovaly, doběhnou (test 7 prošel,
 │   test 5 odhalil selhání). Skipy tím klesly, ale nezmizely — běh od běhu se to liší.
 │
 ├─ PACING (storefront.ts, implementováno, NEOVĚŘENO): pace() vloží think-time před každou navigaci.
 │   Default 2500 ms v theme-dev módu (SHOPIFY_E2E_THEME_DEV=1), jinak 0; přepis SHOPIFY_E2E_PACING_MS.
 │   Logika: challenge spouští objem requestů z IP → chovat se víc jako člověk = pomaleji. Ověření
 │   zablokováno throttlingem storu (viz níže).
 │
 ├─ 🔴 STORE THROTTLED (2026-07-10, po mých testech+sondách): POST /password → 503, GET / → 500,
 │   `shopify theme dev` → "store password is invalid" (i se správným leotra — auth chyba převlečená za
 │   rate-limit). Store potřebuje vychladnout (desítky minut). Do té doby NELZE spustit lokální e2e.
 │
 └─ ZBÝVÁ: (1) ověřit pacing až store obživne; (2) pořádné řešení = přenášet cf_clearance cookie mezi
    testy (storageState / persistent context), ať se challenge řeší JEDNOU za běh, ne v každém test
    contextu (Playwright dělá čerstvý context per test → každý startuje bez cookie → může chytit challenge).

✅ VYŘEŠENO (2026-07-11, oba themes ZELENÉ přes test:e2e:local:all, exit 0)
 ├─ NÁLEZ #1 (proč app-proxy 500): běžící `shopify app dev` startoval PŘED opravou prisma/.env, takže jeho
 │   Prisma klient byl navázaný na STAROU prázdnou DB (0 sessions) → appProxy nenašel session → 500, který
 │   Shopify zabalil do storefront „error in the third-party application". Fix: restart app dev. (Prisma čte
 │   DATABASE_URL jen při startu procesu; vite SSR reload klienta nereinicializuje.)
 ├─ NÁLEZ #2 (discount-conflict banner nevznikal): banner řídí REÁLNÉ Shopify automatic slevy, ne katalogová
 │   discount pravidla. Test přepsán věrně featuře (viz FÁZE 2 / test 7 níže + support/automatic-discount-e2e.ts).
 │   Po cestě změřeno: propagace create/delete slevy ke cart-validation funkci ~1,2 s; floor-breaching sleva
 │   blokuje /cart/add 422 (proto add PŘED slevou).
 ├─ CHALLENGE (skutečné řešení, ne storageState): cf_clearance nelze získat proaktivně (vydá se až PO vyřešení
 │   challenge, nízkoobjemový warmup ji nevyvolá). Místo toho: (a) warmStorefrontTunnel počká na vyčištění
 │   AKTIVNÍ challenge před sadou (wait-until-clean, běží v matrix globalSetup i v beforeAll seriálních speců);
 │   (b) wrapper nastaví PLAYWRIGHT_RETRIES=1 → mid-run challenge flake se přeběhne (managed challenge se
 │   vyčistí v sekundách). Fetchy v discount-conflict specu obaleny AbortController (5 s), ať challenge
 │   nezasekne page.evaluate na celý timeout.
 └─ VÝSLEDEK: ✓ Horizon, ✓ Dawn. discount-conflict prochází na OBOU. Zbytkový flake (variant-visibility
    challenge timeout na 1. pokus) pohltí retry → „flaky", ale běh zelený. 0 stray slev (afterEach maže).

🟡 VÝSLEDEK BĚHU (2026-07-10, po opravě DB + MIME shimu, oba themes přes test:e2e:local:all)
 ├─ Horizon: matice 8/8 PASSED. Seriální tier: 3 passed, 1 failed, 3 skipped (bot-challenge).
 ├─ Dawn:    matice 8 skipped (nutno došetřit), seriální: 4 passed, 1 failed, 2 skipped.
 ├─ WRAPPER EXIT=1 (poctivě červené — už nelže, viz oprava matrix.setup + preflightu).
 ├─ 🔴 REÁLNÉ SELHÁNÍ (obě témata, konzistentní): storefront.discount-conflict.spec.ts:119 —
 │   #margin-guard-cart-discount-conflict-notice se na /cart nezobrazí (element not found, 12s).
 │   NENÍ to timeout na waitForResponse → script běží, jen banner nevznikne. Nedošetřeno.
 └─ 🟡 K DOŠETŘENÍ: proč Dawn matice skipla všech 8, když Horizon matice 8/8 prošla (stejné env).

🔴 NÁLEZ (2026-07-10) – prisma/.env mířil absolutní cestou na STAROU lokaci repa
 ├─ DATABASE_URL="file:/Users/ondrej/Development/b2b_b2c/prisma/dev.sqlite" (repo se přesunulo do
 │   WonCommerce/Apps/). Prisma si tam vyrobila PRÁZDNOU DB → app i testy nad ní běžely od přesunu.
 │   Skutečná data (17 CatalogProduct, 26 CatalogVariant, 1 Session) leží v prisma/dev.sqlite v repu.
 ├─ DŮSLEDEK: matice e2e neměla z čeho stavět → .matrix.json prázdný → všech 9 testů SKIPNUTO →
 │   Playwright exit 0 → suite hlásila zelenou, aniž by cokoli asertovala.
 ├─ OPRAVA: prisma/.env → DATABASE_URL="file:dev.sqlite" (relativní vůči schema.prisma). Ověřeno:
 │   app dev startuje s 'SQLite database "dev.sqlite"', matice staví 8 testů místo 2 placeholderů.
 └─ OPRAVA #2: tests/e2e/matrix.setup.ts na prázdné matici HÁZÍ výjimku místo console.warn.
    ZBÝVÁ: seriální tier umí naskipovat všech 7 testů a wrapper to pořád vyhodnotí jako ✓.
    Skutečná pojistka = trvat na tom, že aspoň jeden test PROBĚHL (JSON reporter v run-playwright-e2e.mjs).

═══════════════ REFERENCE: LOKÁLNÍ STOREFRONT E2E — commandy, testy, testovaná data (2026-07-10) ═══════════════
 Tohle je STABILNÍ přehled toho, co se pouští a co se u jakého produktu testuje. Cíl: testovaná data
 se už nesmí měnit (viz VAROVÁNÍ o stabilitě dole).

 ── COMMANDY ──
   # terminál 1 (app + gated override armed):
   MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev
   # terminál 2 (oba themes, wrapper si theme dev spouští i uklízí sám):
   npm run test:e2e:local:all
     přepínače:  -- --only horizon|dawn   -- --bail   -- --dry-run   -- --verbose
     env:        SHOPIFY_E2E_PACING_MS (think-time před navigací; default 2500 v theme-dev módu)
                 PLAYWRIGHT_CHANNEL=chrome + PLAYWRIGHT_HEADLESS=0 (opt-in, na challenge NEPOMÁHÁ)
   Store password (leotra) se bere z .env → SHOPIFY_E2E_STOREFRONT_PASSWORD, wrapper ho předá theme devu.
   Wrapper interně spustí node ./scripts/run-playwright-e2e.mjs → 2 fáze v pořadí:
     1) MATICE  (playwright.matrix.config.ts) — paralelní, read-only
     2) SERIÁL  (playwright.config.ts)        — workers=1, mutace per test

 ── FÁZE 1: MATICE (storefront.matrix.spec.ts via support/matrix-run.ts) ──
   4 archetypy × 2 kontexty (base = default katalog / catalog = vynucený e2e katalog přes mg_e2e_audience).
   Asertuje /apps/margin-guard/visibility PAYLOAD (ne DOM). Pravidla naseeduje jednou globalSetup na
   1 sdílený e2e katalog, každý archetyp na VLASTNÍ produkt (nepřekrývají se). Co se ověřuje:
     HIDDEN             → produkt je v e2e katalogu skrytý (v base viditelný)
     QUANTITY_MOQ_STEP  → minimum order quantity = 6, step = 3
     QUANTITY_MAX       → max order quantity = 3
     VARIANT_HIDDEN     → konkrétní VARIANTA produktu je skrytá (potřebuje produkt s variantami)

 ── FÁZE 2: SERIÁL (3 spec soubory, každý test si naseeduje 1 pravidlo na ČERSTVÝ e2e katalog) ──
   storefront.smoke.spec.ts (5 testů):
     1) HIDDEN produkt na PDP → #margin-guard-visibility-banner obsahuje hlášku o nedostupnosti
     2) MOQ+STEP na PDP → notice "Minimum order quantity: 6." + "sold in multiples of 3.";
        quantity input value=6, min=6, step=3
     3) VARIANT_HIDDEN → banner viditelnosti varianty (u skryté varianty text, u viditelné count=0)
     4) MAX qty + acknowledgment → input vyplněn na 5, add-to-cart, cart notice; dismiss tlačítko
        viditelné s textem "I understand"/"Rozumim"; po kliku notice zmizí
     5) MAX na PDP → quantity input má atribut max=3
   storefront.listing.spec.ts (1 test):
     6) HIDDEN produkt → jeho karta zmizí z /collections/all listingu (count=0)
   storefront.discount-conflict.spec.ts (1 test):
     7) sleva v konfliktu s floor → na /cart se objeví #margin-guard-cart-discount-conflict-notice
        VĚRNĚ FEATUŘE (2026-07-11): banner řídí resolveCartDiscountConflictsByHandle, který jako viníka
        bere REÁLNÉ Shopify _automatic_ slevy (ne katalogová discount pravidla — ta jsou jen stacking
        kontext). Test proto: seeduje 80% floor na e2e katalog, přidá produkt do košíku, PAK vytvoří přes
        Admin API reálnou PRODUCT-scoped 50% automatic slevu na mg-e2e-hidden (50 % < 80 % floor → konflikt),
        ověří banner, a v afterEach slevu smaže. Pořadí (add PŘED slevou) je nutné: cart-validation funkce
        jinak add zablokuje 422 (floor breach); GET /cart už validaci nespouští. Blast radius: 1 sleva na
        e2e produktu po dobu 1 testu. Helper: tests/e2e/support/automatic-discount-e2e.ts.

 ── 🔒 TESTOVANÁ DATA (ZAMČENO 2026-07-10 — dedikované produkty, už se nemění) ──
     HIDDEN            → mg-e2e-hidden           "MG E2E · Hidden Product"   product 9665009811697
     QUANTITY_MOQ_STEP → mg-e2e-moq-step         "MG E2E · MOQ + Step"       (MOQ 6, step 3)  9665009877233
     QUANTITY_MAX      → mg-e2e-max              "MG E2E · Max Quantity"     (max 3)          9665009910001
     VARIANT_HIDDEN    → mg-e2e-variant-hidden   "MG E2E · Variant Hidden"   9665010139377
                          Size S/M/L; testovaná varianta S = gid …/48393748578545
     COLLECTION_MAX    → mg-e2e-collection-member "MG E2E · Collection Member" 9665055129841
                          člen kolekce "MG E2E Collection" (gid …/466006212849, handle mg-e2e-collection);
                          max 3 se seeduje na KOLEKCI, storefront ho aplikuje na člena přes živé
                          Product.collections (členství NENÍ v DB → collection GID je připíchnutý).
   Všech 5 produktů + kolekce: ACTIVE, publikované na Online Store, cena 19.90, sklad NEsledovaný,
   obrázek READY. Vytvořeny přes Admin API dedikovaně pro e2e. Číselné hodnoty (6/3/3) napevno.
   POZN.: collection-scope na storefrontu = JEN quantity max (collection visibility skrývá jen stránku
   kolekce podle handle, ne její produkty). Proto COLLECTION_MAX, ne COLLECTION_HIDDEN.

 ── JAK JE TO ZAMČENÉ (aby "data se nemění" platilo) ──
   PIN = handly v scripts/test-e2e-local-all.mjs (konstanta PINNED_PRODUCT_HANDLES), injektované do env
   jako SHOPIFY_E2E_PRODUCT_HANDLE_{VISIBILITY,STEP,MAX,VARIANT}. Čtou je OBĚ fáze:
     • Seriál: support/runtime.ts (už uměl).
     • Matice: support/matrix.ts — buildPinnedFixtures() (DOPLNĚNO 2026-07-10): když jsou všechny 4 piny
       nastavené, matice vezme PŘESNĚ ty produkty s FIXNÍM archetypem, místo round-robin dle updatedAt.
   Předpoklad: produkty musí být v lokální CatalogProduct (sync). Když app běží, chytne je webhookem;
   jinak sync ručně (otevřít app / syncShopifyProductCatalog). Pin lze přebít pre-set env / .env.
   Admin token pro out-of-band operace: .env → SHOPIFY_ADMIN_API_TOKEN (gitignored). Po dokončení SETUPU
   ho DOPORUČUJI rotovat (byl v plaintextu v chatu).

🔴🐛 NALEZENÝ + OPRAVENÝ BUG (2026-07-10, odhalil property-based test) — cap slev se dal prorazit
 ├─ SYMPTOM: naskládané slevy přesahující 100 % obešly kombinovaný cap. Př.: dvě slevy 90 %+90 %,
 │   cap 80 % → total zůstal 100 % (produkt ZDARMA) místo 80 %. Ještě horší při capu hluboko pod součtem:
 │   slevy 83+73+41=197 %, cap 16 % → total 97 %.
 ├─ PŘÍČINA: core/discount/discount.orchestrator.ts — cap-excess aritmetika používala roundPercent(),
 │   který KLAMPUJE na [0,100]. Takže: (a) runningTotal = roundPercent(součet) usekl součet na 100 dřív,
 │   než se změřil přebytek; (b) remainingExcess = roundPercent(total − cap) usekl i přebytek na 100.
 │   Přebytek k oříznutí tak nikdy nepřesáhl 100 → při součtu > cap+100 se ořízlo málo → cap se prorazil.
 ├─ FIX: zaveden round2() (2 des. místa BEZ klampu) a použit v celém cap bloku (runningTotal, init
 │   remainingExcess, dekrement). roundPercent zůstává na finálním total (kde klamp na 100 patří).
 ├─ OVĚŘENÍ: property test (500 náhodných sad, invariant „total ≤ cap") + 2 explicitní regresní testy
 │   (90+90 cap 80 → 80; 83+73+41 cap 16 → 16). Všech 54 existujících discount+margin testů dál zelených.
 └─ DOPAD: reálný, produkční. Kdokoli naskládal slevy přes cap dostal větší slevu, než měl —
    až po produkt zdarma. Margin floor to u checkoutu částečně chytal, ale orchestrátorův cap byl slepý.

═══════════════ PLÁN POKRYTÍ PRAVIDEL (2026-07-10, podklad od druhé AI + ověření proti kódu) ═══════════════
 KLÍČOVÝ POZNATEK: pokrytí má 4 VRSTVY, produkty potřebuje JEN jedna. Většina navrženého seznamu je
 čistá core logika → jednotkové testy s in-memory fixturami, ŽÁDNÝ Shopify produkt. Ověřeno v kódu:
 všechny engine soubory existují (core/**), scope váhy 500/400/300/200/100, CAP_REDUCED_TO_ZERO,
 UNVERIFIABLE_AGAINST_FLOOR, priorita auto-slev 1000 — sedí. Property-based testy fakt CHYBÍ.

 ── VRSTVA A: CORE UNIT (bez produktů) — sem patří body 1-9 „správnosti" ──
   Testuje core/** s vymyšlenými objekty (dnes 271 zelených node --test). Doplnit:
     1  catalog.resolver   ⚠️ market filtr (nenastaveno=any / přesná shoda / chybějící kontext=no-match),
                              kombinace market×audience (market NE + audience ANO → NEmatch)
     2  catalog.merge      ⚠️ invariant delta≠base (normalizace při persistenci → spíš service test),
                              defaulty (globalMinPricePercent=70, allowZeroFinalPrice=false), per-key merge map
     3  price-list.engine  ⚠️ non-compounding (procenta se neskládají) — explicitní regresní test
     4  discount.orchestr. ❌ PROPERTY-BASED (náhodné množiny slev → invarianty: nikdy pod cap, floor se
                              neprorazí, deterministika při přeházení vstupu) = NEJVYŠŠÍ PŘÍNOS, nejkřehčí část
                           ⚠️ cap min(global,segment)+CAP_REDUCED_TO_ZERO, pořadí appliedCodes = pořadí vstupu
     5  margin.guard       ✅ floor logika; value-based enforcement u checkoutu → VRSTVA B
     6  pricing.pipeline   ⚠️ end-to-end kompozice kroků (ne jen izolované kroky)
     7  quantity.engine    ✅ precedence/validace; customer-specific max ve storefront resolveru → B/E2E
     8  visibility.engine  ✅ módy; per-katalog merge ve storefront loaderu → VRSTVA D / E2E
     9  conflict.detector  ⚠️ store/collection-wide fixed → UNSUPPORTED; auto-sleva priorita 1000

 ── VRSTVA B: FUNCTION INTEGRATION (bez produktů, vymyšlený function input) ──
   Vynucení cen/marží/slev NEBĚŽÍ na storefrontu — dělají Shopify Functions u checkoutu (discount-function,
   cart-validation). Pokrývá tests/cart + tests/discount. Sem patří: bod 5 (floor u checkoutu, value-based),
   bod 6 (pipeline skrz funkci). PRODUKTY NEPOMOHOU — logika jde mimo storefront embed.

 ── VRSTVA C: ROUTE / CONTRACT / WEBHOOK (bez produktů, DB fixtury) ──
   Bod 11: každý zápis do katalogu → republishCatalogRuntime; save-catalog bez id=create+redirect / s id=update;
   system katalogy (default,b2b) nejdou smazat + fixní priorita; webhook orders/create → margin log per line.
   Pokrývá tests/routes + tests/contracts + tests/webhooks.

 ── VRSTVA D: STOREFRONT E2E (JEDINÁ, co potřebuje publikované produkty) ──
   Testuje jen to, co prohlížeč VIDÍ na stránce: /visibility payload + DOM bannery z embed skriptu.
   Body: 8 (viditelnost prod/varianta), 7 (MOQ/step/max notice), 9 (discount-conflict banner), 10 (projekce).
   STÁVAJÍCÍ 4 mg-e2e produkty tuhle sadu POKRÝVAJÍ. Jediná reálná mezera: collection-scope pravidla
   (catalogMembership je prázdné) → chce 1 nový produkt + 1 kolekci.

 ── MINIMÁLNÍ E2E SADA PRODUKTŮ (cíl „testovat vše minimem produktů") — HOTOVO ──
   Minimum diktuje počet věcí, co musí prohlížeč ROZLIŠIT na stránce, NE počet pravidel. NEnacpávat víc
   pravidel na jeden produkt → ztráta izolace, křehké testy závislé na pořadí. Realizovaná sada (5+1):
     mg-e2e-hidden           → viditelnost produktu + projekce/anti-flash + discount-conflict banner
     mg-e2e-variant-hidden   → viditelnost varianty (S/M/L)
     mg-e2e-moq-step         → MOQ + step notice
     mg-e2e-max              → max notice
     mg-e2e-collection-member + kolekce mg-e2e-collection → collection-scope max (COLLECTION_MAX)
   = 5 produktů + 1 kolekce. Víc netřeba; zbytek seznamu je VRSTVA A/B/C.

 ── DOPORUČENÉ POŘADÍ (až se rozhodne dělat) ──
   1) VRSTVA A property-based orchestrace slev (bod 4 ❌) — největší přínos, nula produktů.
   2) Zbylé ⚠️ ve VRSTVĚ A (merge, cap, non-compounding, resolver market).
   3) VRSTVA D: mg-e2e-collection-member + kolekce, zavřít poslední storefront mezeru.
   4) VRSTVA B/C revize kontraktů (bod 11).
   Nezakládat produkty kvůli bodům 1-9 — patří do unit testů, kde produkt nic nepřidá.

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
