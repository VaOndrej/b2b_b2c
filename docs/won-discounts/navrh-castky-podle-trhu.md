# Částky podle trhu, ne podle měny — návrh (úkol 6, 7. 10. 2026)

Rozhodnutí Ondřeje 7. 10. 2026: každý trh má vlastní částku, i když má stejnou měnu jako jiný trh
(Slovensko a Německo v eurech už nesdílejí jednu částku). Tento návrh je záznam; staví se podle něj bez čekání na schválení.

## 1. Jak se částky uloží

Mapa částek zůstává jedna (`MoneyByCurrency`), mění se jen to, co smí být klíčem:

| Klíč | Význam |
|---|---|
| `EUR` | částka pro každý trh s měnou EUR, který nemá vlastní klíč |
| `EUR@sk` | částka jen pro trh s handle `sk` (měna trhu je součást klíče) |

Pravidla zápisu (dělá je aplikace při uložení, funkce `encodeMarketAmounts`):

- Mají všechny zapnuté trhy jedné měny stejnou částku → zapíše se jeden klíč měny (`EUR`). Tak vypadají všechna dnešní nastavení.
- Liší se, nebo některý trh částku nemá → každý trh s částkou dostane vlastní klíč (`EUR@sk`, `EUR@de`), klíč měny se nezapíše.
  Trh bez klíče = „v tomto trhu se nenabízí“ (stejně jako dnes chybějící měna).
- Částka trhu, který je vypnutý, se nechává tak, jak je uložená (§14a: vypnuto ≠ smazáno).

Čtení (`moneyFor(mapa, měna, trh)`): nejdřív `měna@trh`, potom `měna`, jinak nic.

Týká se všech částek: sleva pevnou částkou, minimální útrata, částka pro dopravu zdarma a pro dárek, částka za kus v množstevní slevě,
stejné částky v kampaních.

## 2. Co se stane s uloženými nastaveními

Nic se nepřepisuje. Staré nastavení má jen klíče měn a čte se dál beze změny: každý trh dostane částku své měny, tedy přesně to,
co má dnes. Převod je bezztrátový, protože žádný neproběhne; nový tvar vznikne až tehdy, když obchodník dvěma trhům stejné měny
zadá různé částky. Testy: skutečné tvary nastavení (dev obchod, E2E profily) projdou čtením i zápisem beze změny bajtu.

## 3. Jak pokladna a web poznají trh zákazníka

- **Pokladna (funkce):** podle země košíku, stejně jako dnes cílení na trhy. Nastavení pro pokladnu nese `marketCountries`
  (trh → země); nově do něj jdou i trhy, které mají vlastní částku, a příznak `am: true`. Funkce si z měny košíku a trhu země
  složí klíč `EUR@sk` a zkusí ho před klíčem měny. Bez příznaku se nic nového nečte.
- **Web (Liquid):** `localization.market.handle` dává trh přímo; tabulka úrovní a průběh k odměně čtou `mapa[měna@trh]`, jinak `mapa[měna]`.
- **Košík na webu (výpočet na serveru, app proxy):** stejná cesta jako pokladna (země košíku → trh).

**Když se trh nepozná** (země není v žádném trhu, košík bez země): použije se klíč měny. Když ani ten není, částka se nenabídne.
Nikdy se nepoužije částka jiného trhu.

**Přepínač v Nastavení (doplněno 7. 10. 2026, rozhodl Ondřej):** „Zákazník ze země mimo vaše trhy“.
Vypnuto (výchozí): kde se trhy jeho měny liší, nedostane nic. Zapnuto: dostane nejnižší z částek trhů jeho měny.
Funkce pokladny se kvůli tomu nemění: do odesílaného nastavení se doplní klíč měny s nejnižší částkou a trh, kterému
obchodník nechal pole prázdné, dostane pod svým klíčem `-1`, aby na klíč měny nespadl a dál nedostal nic.

**Nejnižší, nebo nejvyšší (doplněno 8. 10. 2026, rozhodl Ondřej):** při zapnutém přepínači si obchodník pro každý druh částky
zvlášť volí, jestli zákazník mimo trhy dostane nejnižší (výchozí), nebo nejvyšší z částek trhů: sleva pevnou částkou, minimální
útrata, množstevní sleva za kus, doprava zdarma, dárek. Ukládá se `engine.unknownMarketHighest` (druhy s nejvyšší).

## 4. Limity — změřeno 7. 10. 2026

Slevová funkce má dva limity blízko hrany (README funkce): velikost Wasm 256 000 B (bylo volných 1 037 B) a instrukce
(rezerva 0,10 bodu u nejtěžší zkonstruované rodiny košíků).

Zkušební sestavení mimo repo (stejný postup jako CLI: `cargo build` → `wasm-opt -Oz` → trampoline; výchozí stav vyšel
přesně na 254 963 B jako v README):

| Varianta | Wasm | Volné | Poznámka |
|---|---|---|---|
| dnes | 254 963 B | 1 037 B | |
| klíč trhu přes `thread_local` | 256 917 B | −917 B | nevejde se |
| vlastní mapa trhů `am: {trh: [země]}` | 256 226 B | −226 B | nevejde se |
| **příznak `am: true` + trh z `marketCountries`** | **255 632 B** | **368 B** | zvoleno |

Instrukce, 150 nejtěžších vstupů ze zkonstruovaných rodin (cap 550), rozdíl proti dnešní funkci:

| Případ | Rozdíl | V bodech limitu |
|---|---|---|
| obchod bez vlastních částek trhů (všechna dnešní nastavení) | +838 až +1 048 instrukcí | +0,010 |
| vlastní částka trhu u každé částky a úrovně | +6 229 až +14 940 | +0,136, z toho +0,098 je jen větší nastavení |

Větší nastavení se v praxi nesčítá: vstupy rodin už jsou na limitu velikosti vstupu, delší nastavení z něj vytlačí jiná data.
Samotné hledání klíče trhu stojí kolem 0,04 bodu. Nejtěžší případ tedy vychází kolem 99,95 % limitu.

Velikost nastavení pro pokladnu (limit 9 000 B, úrovně 550 B):

- trh s vlastní částkou přidá do `marketCountries` zhruba 12 B (jedna země) až 140 B (trh s 26 zeměmi),
- každá vlastní částka trhu přidá asi 15 B (`"EUR@sk":1600,`),
- úrovně: jeden trh navíc u sady s 10 úrovněmi přidá asi 60 B z 550 B. Uložení, které se nevejde, server odmítne jako dnes
  („Místo pro úrovně v pokladně“).

**Závěr: vejde se, ale těsně.** Po změně zbývá 368 B velikosti a zhruba 0,05 bodu instrukcí. Další funkce v pokladně už bude
muset nejdřív uvolnit místo.

## 5. Rozhraní

- Každé pole částky patří jednomu trhu („Slovensko (EUR)“), i když jiný trh má stejnou měnu.
- Věta „Trhy se stejnou měnou mají společnou částku“ v Nastavení mizí.
- Přehled trhů, upozornění na úvodní stránce a počet věcí k vyřešení se počítají po trzích.
- Návrh částky nabízí částku každému trhu zvlášť (z ručního kurzu jeho měny).

## 6. Pořadí stavby

1. Jádro: klíče, čtení `moneyFor(…, trh)`, zápis `encodeMarketAmounts`, sanitizer, popisy. Testy převodu na skutečných tvarech.
2. Jádro: výpočet košíku (referenční TS), nastavení pro pokladnu (`am`, trhy s vlastní částkou), data pro web.
3. Funkce v Rustu podle zkušebního sestavení, parita s TS, přeměření.
4. Web: tabulka úrovní, průběh k odměně.
5. Aplikace: pole po trzích ve všech formulářích, přehled trhů, stav modulů, Nastavení.

## 7. Rizika a co zůstává otevřené

- Rezerva funkce po změně je malá (368 B, asi 0,05 bodu). Kdyby další měření ukázalo překročení, vrací se ukládání po měnách
  a rozhraní zůstane po trzích jen tam, kde se měny liší.
- Změna funkce a rozšíření webu se projeví až po nasazení (`shopify app deploy`), to dělá Ondřej.
