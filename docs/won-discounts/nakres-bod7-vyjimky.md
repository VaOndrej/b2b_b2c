# Bod 7: výjimky z množstevní slevy, nákres ke schválení

Dva stavy stránky Množstevní slevy, sekce „Výjimky pro produkty a kolekce“. Nic z toho zatím není v kódu.

## Stav 1: seznam výjimek

Každá výjimka je jeden řádek. Rozbalená je jen ta, kterou právě upravujete.

```
┌ Výjimky pro produkty a kolekce   [Pro] [Aktivní] ────────────────────┐
│ 2 výjimky                                                             │
│                                                                       │
│ Kreatin & aminokyseliny                                               │
│ Od 3 ks −5 %, od 5 ks −10 %                      [Upravit] [Odebrat]  │
│ ───────────────────────────────────────────────────────────────────── │
│ Dárkové poukazy, Vzorky zdarma                                        │
│ Bez množstevní slevy                             [Upravit] [Odebrat]  │
│ ───────────────────────────────────────────────────────────────────── │
│ Když produkt patří do víc výjimek, platí první v seznamu.             │
│                                                                       │
│ [Přidat výjimku]                                                      │
└───────────────────────────────────────────────────────────────────────┘
```

- Název řádku jsou vybrané produkty a kolekce (první dva názvy, pak „a další 3“).
- Věta o tom, která výjimka vyhrává, se ukáže až od druhé výjimky.

## Stav 2: přidání a úprava výjimky

„Přidat výjimku“ rovnou otevře výběr produktů a kolekcí. Po výběru se řádek rozbalí:

```
┌ Kreatin & aminokyseliny ──────────────────────────────────────────────┐
│ Kreatin & aminokyseliny: od 3 ks −5 %, od 5 ks −10 %.                 │
│ Zbytek obchodu beze změny.                                            │
│                                                                       │
│ Pro co platí                                                          │
│ [Kreatin & aminokyseliny ×]  [Změnit výběr]                           │
│                                                                       │
│ Co pro ně platí                                                       │
│ ┌───────────────────────────┐ ┌───────────────────────────┐          │
│ │ ● Jiné úrovně             │ │ ○ Bez množstevní slevy    │          │
│ │ Vlastní počty a slevy     │ │ Tyhle produkty slevu      │          │
│ │                           │ │ za množství nedostanou    │          │
│ └───────────────────────────┘ └───────────────────────────┘          │
│                                                                       │
│ Od (ks)   Sleva v %                                                   │
│ [ 3 ]     [ 5  ]   Odebrat                                            │
│ [ 5 ]     [ 10 ]   Odebrat                                            │
│ [Přidat úroveň]   Hotové úrovně: 3 / 5 / 10 ks                        │
│                                                                       │
│ Počítat jinak než zbytek obchodu ▸                                    │
│                                                                       │
│ [Hotovo]                                              Odebrat výjimku │
└───────────────────────────────────────────────────────────────────────┘
```

- **„Bez množstevní slevy“** = hotovo. Úrovně ani nic dalšího se neukáže.
- **„Jiné úrovně“** = předvyplní se úrovně pro celý obchod, přepíšete jen čísla.
- **Počítání kusů a typ slevy** (procenta / částka za kus) se převezmou z nastavení pro celý obchod. Jsou schované pod „Počítat jinak než zbytek obchodu“ a otevřou se samy, když je výjimka má jiné.
- Věta nahoře se přepočítá s každou změnou.
- „Hotovo“ řádek jen sbalí. Ukládá se jako dnes, jedním „Uložit“ pro celou stránku.

## Co se nemění

- Co pokladna umí a jak se výjimky ukládají. Mění se jen formulář.
- Limit výjimek a hlídání místa pro úrovně v pokladně.
- Na Free zůstávají uložené výjimky vidět jako řádky bez úprav, s možností odebrat.

## K rozhodnutí

1. Souhlasí oba stavy?
2. Výchozí volba po výběru produktů: navrhuju „Jiné úrovně“ (častější případ).
