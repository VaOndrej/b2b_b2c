# Won Discounts — třetí kolo 9. 10. 2026: jak zadání chápu

Před implementací. Nic z toho ještě není v kódu. U každého bodu: co dnes je, co udělám, co nevím.

## 1. Záložní dárek je špatně vidět

- **Dnes:** „Vybrat záložní dárek“ je terciární tlačítko (holý text bez rámečku), hned vedle „Změnit dárek“, které rámeček má
  (`app/components/screens/MilestonesScreen.tsx:512`).
- **Udělám:** stejné sekundární tlačítko s rámečkem jako „Změnit dárek“, popisek nad ním jako u dárku. Vybraný záložní dárek
  dostane stejný řádek jako dárek (název + Odebrat).

## 2. Text „Jen na vyzkoušení. Posuvník nic neukládá.“ pryč

- **Dnes:** řádek nad posuvníkem v náhledu Milníků (`app/components/rewards/MilestonePreview.tsx:131`).
- **Udělám:** smažu řádek i klíč `milestones.preview.tool` (cs + en) a test, který ho hlídá.

## 3. Vlastní CSS pro lištu Milníků (dárek zdarma, doprava zdarma)

- **Dnes:** pole pro vlastní CSS v kódu je: Milníky → dlaždice „Na webu“ → Vzhled → „Vlastní vzhled“, pro žebříček i pro
  panel v košíku a pruh nahoře (`app/components/looks/LookSection.tsx:110-135`). Je jen na Pro; na Free je zamčené.
  Dev běží bez `WON_DEV_PLAN`, tedy jako Free.
- **Chápu to tak:** buď pole nevidíš (zamčené / schované pod jinou dlaždicí než kroky), nebo vidíš, ale nedosáhne na to,
  co potřebuješ nastylovat (značky stupňů, výplň, text o nejbližší odměně).
- **Udělám:** zjistím naživo, která z těch dvou věcí to je. Když jde o dosah, doplním popsané třídy a proměnné pro každou
  část lišty a ukážu je u pole. Když o dohledatelnost, dám odkaz na vzhled přímo k náhledu u stupňů.

## 4. Pruh nahoře jako blok v editoru, ne zaškrtávátka ve vložení aplikace

- **Dnes:** pruh tiskne vložení aplikace (`won_discounts_embed.liquid:165-200`) a skript ho přesune nahoru. Zapíná se dvěma
  anglickými zaškrtávátky a dvěma barvami. V editoru není vidět jako prvek, nejde posunout ani přidat jen někam.
- **Omezení Shopify:** aplikace neumí vložit položku do announcement baru motivu. Ten si bloky určuje sám a Dawn ani
  Horizon tam bloky aplikací neberou (ověřím na obou před stavbou).
- **Udělám:** nový blok aplikace „Pruh nahoře“ (target `section`). Obchodník ho přidá v editoru do skupiny záhlaví přes
  Přidat sekci → Aplikace, nad nebo pod announcement bar motivu. Je vidět ve stromu editoru, jde přesouvat, skrýt a nastavit.
  Obsah si volí v bloku: průběh odměn, běžící kampaň, výprodej (bod 5). Barvy a vzhled řídí aplikace (vzhled „Košík a pruh
  nahoře“), ne dvě barvy v editoru.
- **Starý způsob:** zaškrtávátka z vložení odstraním. Obchod, který je má zapnutá, o pruh přijde, dokud nepřidá blok.
  Aplikace není nasazená, takže to nikoho nezasáhne — potvrď.
- **Riziko:** jestli Shopify sekci „Aplikace“ ve skupině záhlaví nenabídne, zůstane vložení a přidám aspoň české popisky a
  volbu pořadí. Řeknu to hned po ověření, ne až na konci.

## 5. Oznámení o výprodeji nahoře + výprodej na stránce produktu

- **Chápu „výprodej“ jako modul Výprodej** (ne Kampaně).
- **Nahoře:** třetí obsah bloku z bodu 4. Ukáže se, když běží aspoň jeden výprodej, s odpočtem, když má konec.
- **Stránka produktu:** produkt ve výprodeji ukáže oznámení o výprodeji sám. Dnes existuje jen blok „Sale badge“, který
  musí obchodník ručně přidat do šablony produktu.
- **Nevím:** co má pruh nahoře o výprodeji říkat a kam vést (viz otázky).

## 6. Štítek výprodeje na produktu („Sale 400 g“)

- **Proč vypadá divně:** blok vypíše řádek za každou variantu ve výprodeji: štítek + název varianty
  (`outlet_badge.liquid:44-66`). Dělá to bez skriptu, proto neví, kterou variantu zákazník vybral, a píše je všechny.
  Výsledek „Sale 400 g“ nic neříká. „Sale“ je anglicky, protože web běží v angličtině.
- **Proč je dole:** blok je tam, kam ho editor přidal — na konec informací o produktu. Místo si aplikace nevynutí.
- **Na screenshotu navíc:** cena 566,96 Kč není přeškrtnutá, i když je produkt ve výprodeji. Ověřím proč.
- **Udělám:** štítek jen pro vybranou variantu (přepíná se s výběrem), text s obsahem: „Výprodej · zbývá X ks · končí za …“.
  V aplikaci u Výprodeje napíšu, že blok patří pod cenu, a ověřím, jestli ho tam jde odkazem přidat rovnou.

## 7. Ochrana marže: nastavení podle produktu (pátá dlaždice, engine, E2E)

- **Dnes:** vlastní hranice jen pro kolekce (Pro). Pořadí: kolekce → globální.
- **Udělám:** pátá dlaždice „Nastavení podle produktů“ (Pro, stejné chování na Free jako kolekce). Řádek = produkt, vlastní
  minimální marže a nejvyšší sleva, prázdné pole dědí.
- **Pořadí:** produkt → kolekce → globální. Produkt vyhrává vždy, i když je mírnější než kolekce.
- **Engine:** nastavení produktů do configu, vyhodnocení v Rust funkci v pokladně i v jádru (`resolveMargin`), aby Přehled
  zásahů, editor slevy a Vyzkoušet košík ukazovaly totéž co pokladna. Důvod zásahu „nastavení produktu“.
- **E2E:** seed s produktem, který má vlastní hranici a zároveň je v kolekci s jinou; živý košík na Horizonu i Dawnu ověří,
  že platí produktová. Testy jádra, cargo, vitest, preview.
- **Limit:** počet produktů omezím jako u kolekcí (config má strop velikosti). Číslo navrhnu po změření.
- **Úroveň:** produkt, ne varianta (tak to píšeš).

## 8. Sekce pod dlaždicí nemusí být „v listu“

- **Chápu to tak:** sekce pod dlaždicí je sbalovací (šipka vpravo nahoře, viz „Přehled zásahů“ na screenshotu). Dlaždice
  ale ukazuje vždy právě jednu sekci, takže sbalování nemá smysl a přidává jeden rámeček navíc.
- **Udělám:** u Ochrany marže sekce pod dlaždicemi (Kolekce, Zásahy, nově Produkty) bez sbalování, vždy otevřené.
- **Nejsem si jistý** slovem „list“ — viz otázky.

## 9. Dlaždice „Kde ochrana zasáhne“ neříká, co je

- **Co to je:** které aktivní slevy by ochrana marže v pokladně snížila a u kolika variant. Počítá se z nastavení a
  nákupních cen, ne z objednávek.
- **Co je špatně:** dlaždice se jmenuje jinak než sekce pod ní („Přehled zásahů“), text je dvojitý zápor („Žádná aktivní
  sleva teď pod hranici nejde“) a „přepočítává se“ tam visí.
- **Udělám:** jeden název pro dlaždici i sekci, na dlaždici číslo („Sníženo 0 slev“ / „Sníženo 3 slev u 41 variant“),
  v sekci jedna věta, co číslo znamená. Ověřím, jestli přepočet opravdu doběhne, nebo se stav zasekl.

## 10. Nová kampaň není intuitivní

- **Dnes:** jeden dlouhý formulář: název, začátek, konec, pak seznam všech slev se zaškrtávátky a u každé volba
  Beze změny / Zapnout / Vypnout + nová hodnota. Tlačítko „Naplánovat kampaň“.
- **Co podle mě mate:** kampaň slevu nevytváří, jen na čas mění existující. Formulář to řekne až v nápovědě. Seznam ukazuje
  všechny slevy najednou, i ty, kterých se kampaň netýká.
- **Navrhuju:** tři kroky pod sebou s čísly: 1. Kdy (název, od, do), 2. Co se změní (prázdné, slevy se přidávají tlačítkem
  „Přidat slevu“, ne odškrtávají ze všech), 3. Shrnutí větou („Od 20. 11. do 27. 11. bude Sleva 10 % na vše 20 %, Doprava
  zdarma zapnutá“) a tlačítko. Nahoře jedna věta, co kampaň je.
- **Před stavbou** ti ukážu screenshot návrhu, protože tady hádám nejvíc.

## Jak budu pracovat

- Inline, bez subagentů, na `main` v `b2b_b2c`.
- V pracovním stromu je necommitnuté první a druhé kolo z dneška (čeká na tvoje ověření bodů 3 a 6). Třetí kolo by šlo na ně.
- Pořadí: 1, 2, 8, 9 (malé) → 7 (engine) → 4, 5, 6 (web) → 3 → 10.
- Brána po každé vrstvě, živé E2E Horizon + Dawn, screenshoty 390 a 1440 px.

## Výsledek (po implementaci)

- **Bod 4 jinak, než jsem sliboval.** Dawn blok aplikace v záhlaví dovolí (`sections/apps.liquid` bez omezení). Horizon
  ne: jediná jeho obecná sekce s bloky aplikací (`sections/section.liquid`) má `disabled_on: header` a sekci „Aplikace“
  nemá. Proto vznikl blok „Top bar“ pro editor **a** přepínače ve vložení aplikace zůstaly jako záložní cesta. Když je na
  stránce blok, záložní pruh se neukáže podruhé. Popisky v editoru jsou anglicky jako u ostatních bloků (klíče `t:`
  dřív v českém adminu ukazovaly „missing translation“).
- **Bod 5** zrušen (výprodej do pruhu nepatří).
- **Bod 7:** limit 50 produktů. Prázdné pole produktu dědí z kolekce, a když žádná není, z obchodu.
- **Bod 10:** jen úvodní věta, tři číslované kroky a jasnější popisky. Výběr slev tlačítkem „Přidat slevu“ místo
  zaškrtávání jsem nedělal, měnilo by to formulář i jeho ukládání — rozhodni podle screenshotu.
- **Naživo neověřeno:** blok v editoru šablony, štítek výprodeje na webu, pokladna s produktovou hranicí.
  Důkazy z náhledu: `evidence/kolo3-2026-10-09/`.
