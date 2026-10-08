# Won Discounts: vizuální audit navigace uvnitř stránek

Stav k 8. 10. 2026. Jen analýza, nic z toho není implementované.
Měřeno v náhledu `/dev/preview/*` na 1440 × 900 px, screenshoty v `Apps/.playwright-mcp/audit-*-1440.png`.

## Co se dnes v aplikaci používá

Aplikace má čtyři různé způsoby, jak se dostat k části stránky:

| Způsob | Kde je | Co dělá |
|---|---|---|
| Vodorovný pruh | 5 stránek pod „Slevy“ | přepne na jinou stránku |
| Řada dlaždic | Množstevní slevy, Milníky, Výprodej, Kampaně, Ochrana marže | přepne pohled, ostatní sekce schová |
| Sbalovací sekce | Vzhled, Přehled, Slevy a kódy, editor slevy (část Pro) | rozbalí sekci na místě |
| Sloupec vlevo | Nastavení (nové) | sjede na sekci, všechno zůstává vidět |

Nastavení působí jasně ze dvou důvodů: mapa stránky je pořád na očích a nic se neschovává.

## Stránky podle délky

| Stránka | Délka (obrazovek) | Sekcí vidět naráz | Navigace dnes |
|---|---|---|---|
| Nastavení | 3,4 | 7 | sloupec |
| Milníky | 2,9 | 3 | pruh + 2 dlaždice |
| Výprodej | 2,0 | 3 | pruh + 3 dlaždice |
| Přehled (úvod) | 1,9 | 3 + 10 dlaždic modulů | žádná |
| Editor slevy | 1,7 | 5 | žádná |
| Vzhled | 1,6 | 5 (3 sbalené) | sbalování |
| Množstevní slevy | 1,5 | 1 | pruh + 3 dlaždice |
| Kampaně | 1,5 | 1 | pruh + 3 dlaždice |
| Vyzkoušet košík | 1,3 | 2 | žádná |
| Slevy a kódy | 1,0 | 2 | pruh |
| Ochrana marže | 1,0 | 1 | 4 dlaždice |
| Přehledy | 1,0 | 2 | žádná |

## Nálezy

### 1. Dlaždice opakují to, co hned pod nimi říká hlavička sekce

Na Množstevních slevách stojí v dlaždici „Pro celý obchod · Aktivní · Od 3 ks −10 %, od 5 ks −15 %, od 10 ks −20 %“.
Hned pod ní má sekce hlavičku „Množstevní sleva pro celý obchod · Aktivní · Od 3 ks −10 %, od 5 ks −15 %, od 10 ks −20 %“.
Stejně je to na Ochraně marže (Hranice / Ochrana marže) a na Kampaních (Kampaně / Kampaně).

### 2. Na stránkách pod „Slevy“ leží dvě navigace nad sebou

Pruh a pod ním dlaždice. Obsah začíná zhruba 310 px od horního okraje, na Výprodeji s upozorněním až kolem 435 px.
Na obrazovce 900 px vysoké je to třetina až polovina výšky bez obsahu.

### 3. Editor slevy je dlouhý formulář bez mapy

Pět sekcí (Sleva, Podmínky, Jak se uplatní, Kdy platí, Pro koho platí a kombinace), 1,7 obrazovky, Uložit až dole.
Chyba „V EUR chybí částka“ je vidět jen v první sekci. Kdo je sjetý níž, o ní neví.

### 4. Milníky jsou druhá nejdelší stránka a většinu tvoří jedna sekce

Sekce „Stupně a odměny“ má 1 628 px. Mapa po sekcích by tu nepomohla, protože by měla tři položky a jedna z nich by byla skoro celá stránka.
Orientační body jsou tady jednotlivé stupně (1., 2., 3. stupeň).

### 5. Na Přehledu je mapa modulů až dole

Deset dlaždic modulů začíná kolem 1 030 px, pod seznamem „Slevy vytvořené přímo v Shopify“ (467 px).
Dlaždice jsou hlavní rozcestník aplikace a na první obrazovce nejsou vidět.

## Doporučení

### Vodorovný pruh pod „Slevy“ nechat

Sloupec vlevo by tu znamenal „jiná stránka“, v Nastavení znamená „místo na této stránce“. Stejný vzhled se dvěma významy.
Pět krátkých položek se vodorovně vejde i se štítky Pro a na mobilu by ze sloupce stejně byl řádek.
Hned vlevo je navíc svislé menu Shopify, dvě svislá menu vedle sebe pro přechod mezi stránkami se pletou.

### Sloupec místo dlaždic (největší změna, potřebuje rozhodnutí)

Na pěti stránkách s dlaždicemi dát pohledy do sloupce vlevo: název, tečka stavu, počet věcí k vyřešení.
Souhrn zůstane jen v hlavičce sekce, kde už je.

- Zmizí opakování z nálezu 1.
- Obsah se posune o 170–190 px výš (nález 2).
- Všechny stránky modulů budou vypadat jako Nastavení.

Cena:

- Sloupec by tu přepínal pohled, v Nastavení sjíždí. Uživatel rozdíl nejspíš nepozná, ale je to rozhodnutí.
- Stránky s náhledem vpravo (Množstevní slevy, Ochrana marže) přijdou o 208 px šířky. Formulář a náhled se vedle sebe vejdou jen těsně, nebo je potřeba stránku rozšířit.
- Z dlaždice zmizí věta souhrnu u pohledů, které právě nejsou otevřené (dnes je vidět „8 produktů nemá nákupní cenu“ bez kliknutí).

Levnější varianta: dlaždice nechat a zmenšit je na jeden řádek (název, stav, počet věcí k vyřešení), bez popisu a souhrnu.

### Pořadí, jak bych postupoval

1. **Editor slevy: sloupec jako v Nastavení.** Nejpoužívanější formulář, pět sekcí, žádný pohled se neschovává, takže se chová úplně stejně jako Nastavení. U sekce s chybějící hodnotou červená tečka. Pozor na šířku: první sekce má vpravo „Co uvidí zákazník“.
2. **Milníky: sloupec se stupni.** Náhled žebříčku, Od jaké hodnoty košíku, 1. stupeň, 2. stupeň, 3. stupeň, Co se počítá do částky.
3. **Přehled: dlaždice modulů nad „Slevy vytvořené přímo v Shopify“.** Bez sloupce, jen pořadí.
4. **Dlaždice na sloupec, nebo zmenšit.** Až po rozhodnutí výše.

### Kde nic neměnit

- Slevy a kódy, Přehledy, Vyzkoušet košík: vejdou se na jednu obrazovku, mapa by byla navíc.
- Vzhled: sbalené sekce jsou samy mapou stránky.

### Pravidlo pro příště

Sloupec dává smysl, když má stránka víc než 1,5 obrazovky a aspoň čtyři části, které jsou vidět naráz.

## Úprava po zpětné vazbě (8. 10. 2026): dlaždice zůstávají

Ondřej: dlaždice jsou cenné tím, že po otevření sekce je hned vidět, co je a co není aktivní. To se nesmí ztratit.
Varianta „sloupec místo dlaždic“ tím padá. Návrh, který drží stav na očích a zároveň řeší nálezy 1 a 2:

### Dlaždice jako stavová lišta

- Dlaždice zůstane, ale jen s tím, co se mění: název, štítek stavu (Aktivní / Neaktivní / Vyžaduje pozornost), jedna věta souhrnu, počet věcí k vyřešení.
- Pryč jde stálý popis („Úrovně slevy podle počtu kusů, které platí pro všechny produkty…“). Ten se nemění a je to nejvyšší část dlaždice.
- Výška klesne zhruba ze 170–190 px na 80–90 px, obsah se posune o 90–100 px výš.
- Hlavička sekce pod dlaždicí přestane opakovat štítek a souhrn. Zůstane jí název a vysvětlující věta, tedy to, co z dlaždice odešlo.

Výsledek: stav je vidět jednou a nahoře, vysvětlení jednou a u obsahu.

### Stejný princip i tam, kde dlaždice nejsou

- **Vodorovný pruh pod „Slevy“:** u každé stránky tečka stavu (zelená aktivní, červená vyžaduje pozornost, šedá neaktivní). Stav všech pěti modulů je pak vidět z kterékoli stránky, ne jen z Přehledu.
- **Sloupec v Nastavení a v editoru slevy:** stejná tečka u položky. V editoru červená u sekce, kde chybí hodnota.

### Co zůstává z původního pořadí

1. Editor slevy: sloupec jako v Nastavení, s tečkami. Dlaždice tam nejsou, nic se nebije.
2. Milníky: dlaždice nahoře zůstanou. Místo sloupce řádek s čísly stupňů v hlavičce sekce „Stupně a odměny“ (1 · 2 · 3), klik sjede na stupeň. Sloupec by tu byl už třetí navigace nad sebou.
3. Přehled: dlaždice modulů nad „Slevy vytvořené přímo v Shopify“.
4. Zmenšení dlaždic a úprava hlaviček na pěti stránkách.
5. Tečky stavu ve vodorovném pruhu.

### Kde se použije co

| Prvek | Význam | Kde |
|---|---|---|
| Vodorovný pruh s tečkami | jiná stránka + její stav | 5 stránek pod „Slevy“ |
| Dlaždice (nízké) | pohledy této stránky + jejich stav | Množstevní slevy, Milníky, Výprodej, Kampaně, Ochrana marže |
| Sloupec vlevo s tečkami | místa na dlouhé stránce, kde je vše vidět naráz | Nastavení, editor slevy |
