Aplikace která integruje do jednoho storefrontu b2b i b2c zákazníky.

Hlavní funkce:
 - b2b vidí aktualizované ceny + vlastní sekci produktů
 - b2b vidí vlastní obsah UX sekcí
 - b2b má vlastní minimální objednávku, počty kusů do košíku jdou například po kartonu
 - b2b a b2c každý má vlastní slevové kupóny
 - b2b a b2c je možné nastavit minimální cenu k produktu

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
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│              5) SHOPIFY FUNCTIONS (ENFORCEMENT)          │
│  - Discount Function                                     │
│  - Cart Validation Function                              │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
                        ✔ CHECKOUT POVOLEN
                        ✖ CHECKOUT ZABLOKOVÁN




