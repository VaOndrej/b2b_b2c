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
 ├─ Collection-level MOQ
 ├─ Collection-level slevy, na všechny produkty xx sleva 10%, minimální cena, atd.. je tohle mid step mezi
 globální cenou a konkrétním produktem.
 ├─ Cart validation rozšíření
 └─ Admin rule builder


MVP_4 – Advanced Discount Orchestration
 Plná kontrola kombinace slev (enterprise diferenciace).
 ├─ Discount priority matrix
 ├─ Stackability rules
 ├─ Blacklist kombinací
 ├─ Max total discount cap
 ├─ Per-segment discount caps
 └─ Pricing simulator (admin preview)

MVP_5_5
├─ Po tomhle nesmí být žádný technický dluh
├─ Vyřešit duplicitní log cart validation

MVP_5 – Segmented Storefront (UX Layer)
 ├─ Segment-based content sections
 ├─ B2B-only collections
 ├─ B2C-only collections
 ├─ Conditional PDP blocks
 └─ Dynamic messaging engine

MVP_6 – Data Import / ERP Light
 ├─ CSV import cen
 ├─ CSV import MOQ
 ├─ Bulk segment import
 ├─ Validation report
 └─ Audit log

MVP_7 – Doprava pro B2B
 ├─ TODO?

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
