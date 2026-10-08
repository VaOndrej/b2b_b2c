# Slevová funkce v pokladně: kde se dá uvolnit místo (analýza, 8. 10. 2026)

Jen měření. V repu se nic nezměnilo; všechna zkušební sestavení vznikla v kopii zdrojáků mimo repo
(stejný postup jako Shopify CLI: `cargo build` → `wasm-opt -Oz` → trampoline; výchozí stav vyšel přesně na 255 677 B).

## Výchozí stav

| Limit | Dnes | Volné |
|---|---|---|
| Velikost souboru | 255 677 B z 256 000 B | 323 B |
| Výpočet na košík (instrukce) | nejtěžší zkonstruovaný košík kolem 99,95 % | asi 0,05 bodu |

Oba limity jsou na hraně najednou. Úspora velikosti, která stojí výpočet, je proto použitelná jen spolu s něčím, co výpočet vrátí.

## Kam bajty jdou

| Část | Velikost | Podíl |
|---|---|---|
| Výpočet slev (`plan.rs`) | 64,9 kB | 27 % |
| Čtení košíku (`input.rs`) | 42,9 kB | 18 % |
| Texty a tabulky (názvy polí, velká písmena, hlášky) | 21,6 kB | 9 % |
| Knihovní řazení (tři různé varianty) | 18,9 kB | 8 % |
| Čtení nastavení (`config.rs`) | 15,5 kB | 6 % |
| Obálka, kterou přidává Shopify (trampoline) | 13,9 kB | 5 % |
| Práce s textem jako v JavaScriptu (`js.rs`) | 12,8 kB | 5 % |
| Vstupní funkce (do ní vložený kód) | 11,9 kB | 5 % |
| Zápis výsledku (`output.rs`) | 11,2 kB | 5 % |
| Knihovní formátování textu a hlášení pádů | 10,7 kB | 4 % |
| Zbytek (peníze, hledání slevy z objednávky, úrovně, …) | asi 31 kB | 12 % |

## Změřené možnosti

Výpočet = změna na 144 nejtěžších uložených košících, v bodech limitu (1 bod = 110 000 instrukcí). Záporné číslo = funkce počítá méně.
Výstup všech variant je na těch košících shodný s referenčním výpočtem.

| # | Co | Velikost | Uvolní | Výpočet | Zásah |
|---|---|---|---|---|---|
| 1 | Optimalizátor s předpokladem, že funkce nepoužívá nejnižší 1 kB paměti (`wasm-opt --low-memory-unused`) | 251 430 B | 4,2 kB | **−1,0 až −1,1** | krok navíc v sestavení, zdroják beze změny |
| 2 | Optimalizátor pustit dvakrát | 255 244 B | 0,4 kB | −0,007 | krok navíc v sestavení (je součástí č. 1) |
| 3 | Bez hlášení pádů do logu (`init_panic_handler`) | 254 753 B | 0,9 kB | 0 | 1 řádek; pád funkce by v logu Shopify neměl text |
| 4 | Řazení seznamu variant vlastním malým řazením | 251 431 B | 4,2 kB | 0 | 2 místa |
| 5 | K tomu i řazení pravidel podle priority | 242 612 B | 13,1 kB | +0,09 až +0,16 | 3 místa |
| 6 | K tomu i řazení v hledání slevy z objednávky | 236 480 B | 19,2 kB | +0,73 až +0,80 | nevyplatí se |
| 7 | Méně vkládání kódu, práh 200 | 255 535 B | 0,1 kB | −0,03 až −0,05 | jedno nastavení překladu |
| 8 | Práh 175 | 250 753 B | 4,9 kB | +0,60 až +0,63 | jedno nastavení překladu |
| 9 | Práh 150 | 244 850 B | 10,8 kB | +1,00 až +1,04 | jedno nastavení překladu |

Kombinace:

| Kombinace | Velikost | Volné | Výpočet |
|---|---|---|---|
| **A:** č. 1 | 251 430 B | 4,6 kB | −1,0 až −1,1 |
| **B:** č. 1 + č. 5 | 239 134 B | 16,9 kB | −0,9 až −1,06 |
| **C:** č. 1 + práh 150 | 240 820 B | 15,2 kB | −0,09 až +0,03 |
| **D:** č. 1 + č. 5 + práh 150 | 228 103 B | 27,9 kB | 0,00 až +0,17 |

## Co z toho plyne

- Místo uvolnit jde. Nejlepší je č. 1: jako jediné šetří velikost i výpočet zároveň a nesahá do zdrojového kódu.
- Varianta B dá 16,9 kB místa a přibližně 1 bod výpočtu. Pro srovnání: celý úkol 6 (částky podle trhu) stál 714 B a 0,04 bodu.
- Varianta D dá nejvíc místa (27,9 kB), ale získaný výpočet spotřebuje.

## Co není změřeno a co je potřeba ověřit před použitím

- Měřeno na 144 nejtěžších košících cíle „řádky košíku“. Celá sada (3 320 košíků a jejich varianty s kampaněmi, odměnami a výprodejem) ani cíl „doprava“ neproběhly.
- Na zkušebních sestaveních neběžely testy funkce (140 fixtures, parita 651), jen porovnání s referenčním výpočtem na těch 144 košících.
- Č. 1 stojí na předpokladu o paměti. Na sestaveném souboru ověřeno: zásobník začíná na adrese 1 048 576 a plní se směrem dolů, data leží nad ním. Do nejnižšího 1 kB by se funkce dostala jen při přeplnění celého 1 MB zásobníku.
- Č. 1 potřebuje vlastní krok v sestavení: Shopify CLI pouští optimalizátor s pevnými přepínači, takže náš průchod musí proběhnout před ním (ověřeno: úspora po průchodu CLI zůstane). Optimalizátor by se bral z balíčku `binaryen`, ne z vnitřku CLI.
- Vlastní řazení v č. 4 a 5 byl rychlý prototyp (heapsort). Lepší malé řazení může cenu č. 5 srazit k nule.
- Uložené košíky jsou ze staršího tvaru dotazu, proto u nich absolutní procenta nesedí s dnešními 99,95 %. Použité jsou jen rozdíly proti dnešnímu sestavení.

## Neměřené nápady

- Knihovní formátování textu (asi 10 kB): produkční kód ho používá na pár místech (`money.rs`, `describe.rs`). Jeho odstranění pomůže jen zčásti, protože stejné formátování potřebuje i hlášení pádů.
- Obálku od Shopify (13,9 kB) ovlivnit nejde.
- Cesty ke zdrojákům v hláškách pádů: asi 2 kB, většinu z nich přepínačem překladače zkrátit nejde.
