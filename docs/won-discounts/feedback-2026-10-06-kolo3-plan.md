# Won Discounts: feedback 6. 10. 2026, třetí kolo (16 bodů), návrh plánu

Stav: **návrh s osmi rozhodnutími z 6. 10., nic není implementováno.** Vychází ze čtení kódu, naživo jsem nic neklikal.
U každého bodu: jak jsem ho pochopil, co je dnes v kódu, co navrhuju. Otázky jsou na konci.

Cesty jsou relativní k `apps/won-discounts/`.

## Přehled bodů

| # | Bod | Druh | Dávka |
|---|---|---|---|
| 1 | Štítek „Aktivní“ u všeho, co běží | oprava UI | A |
| 2 | Úvodní stránka jako rozcestník, vše proklikávací | UI | A |
| 3 | Úvodní stránka jako dlaždice | UI | A |
| 4 | Tabulka na produktu nezohledňuje košík | chyba na webu | B |
| 5 | Tabulka v tématu: zelený / červený štítek + tlačítko na přidání | UI | A |
| 6 | Výjimky: jantar na jantaru | UI | A |
| 7 | Výjimky: zjednodušit zadávání | návrh UX | C |
| 8 | Odměny a doprava zdarma bez štítku „Aktivní“ | oprava UI | A |
| 9 | Dárek a doprava zdarma jako Milníky se stupni | nová funkce | D |
| 10 | Milníky na webu: pruh nahoře, produkt, boční košík, stránka košíku | nová funkce | D |
| 11 | Vlastní texty pro vícejazyčné obchody | nová funkce | E |
| 12 | Záložka Vzhled → Překlady | přestavba | E |
| 13 | Nastavení vzhledu přesunout k jednotlivým slevám | přestavba | E |
| 14 | Free 2 jazyky, Pro neomezeně, výběr jazyka, export a import | nová funkce | E |
| 15 | Co je „Prázdná sleva“ | text | A |
| 16 | Vyzkoušet košík samo hlídá kombinace slev | nová funkce | F |

---

## 1 a 8. Štítek „Aktivní“

**Pochopení:** cokoli je zapnuté a opravdu běží, má zelený štítek „Aktivní“ (v angličtině „Active“). Všude stejně: na úvodní stránce i na stránce modulu.

**Dnes:**
- Množstevní slevy na úvodní stránce štítek nemají vůbec, když jsou nastavené (`app/components/tiers/TiersOverviewCard.tsx:35`, chybí `on`).
- Odměny: sekce „Doprava zdarma“ a „Dárek“ zelený štítek schválně nekreslí, jen šedý „vypnuto“ (`app/components/screens/RewardsScreen.tsx:216` a `:230`, `on={shipOn ? undefined : false}`).
- Ochrana marže `on` posílá (`app/components/margin/MarginOverviewCard.tsx:45`), proč není vidět, ověřím v běžící appce.
- Každá karta si stav počítá sama, proto se rozcházejí.

**Návrh:**
- Jedna funkce „stav modulu“ pro všech šest modulů (Slevy a kódy, Množstevní, Odměny / Milníky, Výprodej, Kampaně, Ochrana marže). Vrací: Aktivní / Neaktivní / Vyžaduje pozornost / Pro (zamčeno).
- „Aktivní“ znamená: uložené, propsané do Shopify a tarif to spouští. Neuložený přepínač štítek nemění.
- Stejnou funkci čte dlaždice na úvodní stránce, hlavička stránky modulu i sekce uvnitř.
- Text jde přes překlady adminu (`app/i18n/cs.ts`, `en.ts`), anglicky „Active“.
- Test: pro každý modul stav zapnuto / vypnuto / na Free → očekávaný štítek na obou místech.

## 2 a 3. Úvodní stránka: rozcestník z dlaždic

**Pochopení:** žádné nové bloky. Dnešní karty se změní na dlaždice, každá celá proklikne na svou stránku. Když přibudou moduly, stránka neroste do délky.

**Dnes:** `app/components/screens/OverviewScreen.tsx:222-369` skládá pod sebe plnoširoké sekce s řádky a tlačítky. Proklik je jen přes tlačítko „Upravit“ uvnitř.

**Návrh:**
- Mřížka dlaždic: 3 sloupce na 1440 px, 2 sloupce na tabletu i na 390 px (rozhodnuto). Na 390 px je dlaždice úzká: název, štítek a věta na nejvýš dva řádky.
- Dlaždice = ikona, název, štítek stavu (bod 1), jedna věta se skutečným nastavením („Od 3 ks −3 Kč, od 5 ks −4 Kč“), případně počet věcí k řešení. Celá je odkaz.
- Dlaždice: Slevy a kódy · Množstevní slevy · Milníky · Výprodej (Pro) · Kampaně (Pro) · Ochrana marže · Přehledy · Překlady · Vyzkoušet košík (Pro) · Nastavení.
- Detailní řádky z dnešních karet (seznam slev, tabulka v tématu, zásahy marže) se přesunou na stránky modulů. Na úvodní stránce nezůstanou.
- Co není modul, zůstane nad mřížkou jako úzký pruh a jen když je co řešit: průvodce nastavením, „Vyžaduje pozornost“ (každý řádek s odkazem na pole), stav v obchodě (Won zapnutý v šabloně, synchronizace), slevy mimo Won.
- Dlaždice Pro na Free je jantarová a vede na stránku modulu se zamčeným formulářem (jako dnes).

## 4. Tabulka na produktu nezohledňuje košík

**Pochopení:** mám produkt v košíku, tabulka na stránce produktu dál ukazuje „1 ks“ a „Ještě 2 ks“. Má ukazovat úroveň, která platí s kusy v košíku, a kolik chybí do další.

**Dnes (příčina z kódu):**
- Kusy v košíku se počítají jen při vykreslení stránky na serveru (`extensions/won-discounts-storefront/blocks/quantity_tiers.liquid:150-200`).
- Skript košík nikdy nečte. Když téma ohlásí změnu košíku, skript počty z košíku **vynuluje** (`assets/won-discounts-tiers.js:136-146`, funkce `zero`). Po přidání do košíku bez načtení stránky tedy tabulka počítá jen s číslem v poli Počet.
- Bylo to vědomé rozhodnutí (skript nečte košík, kvůli rychlosti). Tímhle bodem ho měníme.

**Návrh:**
1. Nejdřív zopakovat naživo na Horizonu i Dawnu: po načtení stránky s plným košíkem, po přidání z produktu, po změně v bočním košíku. Odliším chybu při prvním vykreslení od chyby po změně košíku.
2. Po každé změně košíku si blok vyžádá čerstvá data: znovu vykreslí vlastní sekci přes Shopify (stejný Liquid, jeden zdroj pravdy) a přepíše jen svá data. Při načtení stránky žádný dotaz navíc.
3. Zvýrazněná úroveň, řádek „X ks za Y“ a „Ještě N ks“ se počítají z košíku + pole Počet. Platí pro všechny tři způsoby počítání (řádek, varianty dohromady, celý košík) i pro výjimky.
4. E2E test: přidat 2 ks, tabulka říká „Ještě 1 ks“; přidat třetí, aktivní je úroveň „Od 3 ks“.

**Omezení:** skript stránky produktu má 10 226 B z interního limitu 10 240 B. Změna se nevejde, limit se zvedá na 12 kB (rozhodnuto).

## 5. Tabulka v tématu: štítek a tlačítko

**Dnes:** sekce „Tabulka na stránce produktu“ stav říká jen větou (`app/components/tiers/TiersBlockSection.tsx:38`). Tlačítko „Přidat tabulku na stránku produktu“ už existuje, ale jen jako řádek uvnitř.

**Návrh:**
- Je v tématu → zelený štítek „V tématu“.
- Není → červený štítek „Chybí v tématu“ a hlavní tlačítko „Přidat do tématu“ hned v hlavičce sekce (otevře editor šablony s blokem připraveným k uložení).
- Nejde zjistit (chybí oprávnění) → šedý štítek „Neověřeno“ + „Zkontrolovat znovu“.
- Červená varianta štítku dnes v `WonSection` není, přidám ji.
- Stejný vzor dostanou všechna umístění na webu: Won v šabloně, blok milníků, pruh nahoře, banner kampaně, štítek výprodeje.

## 6. Výjimky: jantar na jantaru

**Dnes:** jantarová sekce Pro obsahuje jantarový rámeček a v něm jantarový blok „Výjimka 1“ se štítkem Pro (`app/components/tiers/ProTierSets.tsx:126`, styl `app/components/shell/WonSection.tsx:461`).

**Návrh:**
- Jantar a štítek Pro jen jednou, na hlavičce sekce. Vnořené bloky jsou bílé s šedou linkou, bez štítku Pro.
- Na tarifu Pro zmizí i štítek Pro u volby „Celý košík“ uvnitř výjimky (už ji má).
- Pravidlo do sdílené doktríny: Pro se značí jednou za sekci.
- Projdu stejnou chybu v editoru slevy, Výprodeji a Kampaních.

## 7. Výjimky: jednodušší zadávání

**Pochopení:** formulář výjimky ukazuje naráz pět rozhodnutí (pro co, co platí, jak se počítají kusy, typ slevy, úrovně). Možnosti mají zůstat, ale obchodník má vidět jen to, co potřebuje.

**Návrh:**
- **Seznam výjimek jako řádky:** „Kreatin & aminokyseliny · bez množstevní slevy“ + Upravit / Odebrat. Rozbalená je jen ta, kterou právě upravuju.
- **Přidání ve dvou krocích:** „Přidat výjimku“ rovnou otevře výběr produktů a kolekcí. Potom jedna otázka se dvěma velkými volbami: „Jiné úrovně“ / „Bez množstevní slevy“.
- **„Bez množstevní slevy“** = hotovo, nic dalšího se neukáže.
- **„Jiné úrovně“** = předvyplní se úrovně pro celý obchod, obchodník přepíše čísla. Počítání kusů a typ slevy se převezmou z nastavení pro celý obchod a jsou schované pod odkazem „Počítat jinak než zbytek obchodu“ (nastavuje se výjimečně, pravidlo P7).
- **Věta nahoře se počítá:** „Kreatin & aminokyseliny: od 3 ks −5 %, od 5 ks −10 %. Zbytek obchodu beze změny.“
- Vysvětlení, která výjimka vyhrává, se ukáže až od druhé výjimky.
- Hotové úrovně (3 / 5 / 10 ks…) zůstanou jako jeden řádek odkazů.

Před implementací ukážu nákres obou stavů (seznam, úprava) ke schválení.

## 9. Milníky místo „Odměny a doprava zdarma“

**Pochopení:** jeden žebříček stupňů podle hodnoty košíku. Ke každému stupni si obchodník vybere odměnu: dárek (konkrétní varianta), doprava zdarma, sleva na celou objednávku… cokoli, co pokladna už umí.

**Dnes:** `modules.rewards` má jednu dopravu zdarma s prahem a seznam dárkových prahů (`packages/core/src/discounts/rewards.ts`). Sleva z objednávky od určité hodnoty existuje jako běžná sleva ve „Slevy a kódy“.

**Návrh:**
- Stránka **Milníky** (nahradí Odměny, adresa `/app/rewards` zůstane). Seznam stupňů seřazený podle částky. Stupeň = částka (pro každou měnu, jako dnes) + typ odměny + její nastavení.
- Typy odměn v první verzi: **Dárek zdarma** (výběr varianty, víc variant na výběr zákazníkovi), **Doprava zdarma**, **Sleva na celou objednávku** (procenta nebo částka).
- Nahoře náhled žebříčku tak, jak ho uvidí zákazník. Mění se s každou úpravou.
- „Co se počítá do hodnoty košíku“ (před slevami / po slevách) zůstává jedno nastavení pro celý žebříček.
- Uložené odměny se převedou na stupně automaticky, nic se neztratí. Převod má test a jde vrátit.

**Technicky (rozhoduje o rozsahu):**
- Dárek a doprava: pokladna to umí, mění se jen tvar nastavení.
- Sleva z objednávky jako stupeň: sestavím ji z toho, co pokladna umí dnes (automatická sleva z objednávky s minimální hodnotou), aby se slevová funkce nemusela zvětšovat. Má do limitu velikosti jen 1 037 B a výkonovou rezervu 0,10 bodu.
- Musím ověřit: dva stupně se slevou (5 % od 1 000, 10 % od 2 000) → platí jen vyšší; práh slevy se počítá stejně jako práh dárku; chování se slevovým kódem a s ochranou marže.
- Víc stupňů „doprava zdarma“ nedává smysl, typ jde vybrat jednou.

## 10. Milníky na webu

**Pochopení:** žebříček musí být vidět: pruh nahoře na webu, blok na stránce produktu, blok v bočním košíku, blok na stránce košíku. Hezky na mobilu i desktopu.

**Dnes:** z druhého kola existuje blok „Rewards progress“ a pruh nahoře, v košíku blok `cart_rewards`. Ukazují dopravu a dárek, naživo v editoru šablony nejsou ověřené.

**Návrh:**
- Jedna komponenta žebříčku ve třech velikostech:
  - **pruh** (jedna věta + tenký ukazatel): pruh nahoře na webu,
  - **kompaktní** (ukazatel se značkami stupňů + věta o nejbližším): stránka produktu, boční košík,
  - **plná** (všechny stupně s ikonou a názvem odměny, splněné odškrtnuté): stránka košíku.
- Aktualizuje se po každé změně košíku bez načtení stránky.
- Boční košík: kde téma dovolí blok aplikace, je to blok. Kde ne (Dawn), vloží ho zapnutý Won v šabloně. Ověřím na Horizonu i Dawnu.
- Na stránce Milníky sekce „Kde je to vidět na webu“: čtyři umístění, každé se štítkem a tlačítkem (vzor z bodu 5).
- Vzhled (styl ukazatele, ikony) se nastavuje na stránce Milníky (bod 13).
- Důkaz: screenshoty 390 a 1440 px ze všech čtyř umístění na Horizonu i Dawnu, E2E průchod stupni.

## 11, 12 a 14. Překlady

**Pochopení:** záložka Vzhled zmizí, místo ní Překlady. Tam všechny texty, které vidí zákazník, pro každý jazyk obchodu. Free 2 jazyky, Pro neomezeně. Jazyk se přidá z rozbalovacího seznamu a přibude tabulka. K tomu hromadný export a import.

**Dnes:** texty jsou ve Vzhledu, natvrdo cs / sk / en (`app/components/model/appearance.ts:33`). Výchozí texty jsou v rozšíření (`extensions/won-discounts-storefront/locales/`), změny obchodníka v nastavení pro web. Délka textu nejvýš 500 znaků.

**Návrh:**
- Menu: **Slevy · Ochrana marže · Překlady · Přehledy · Nastavení**. Adresa `/app/appearance` přesměruje na `/app/translations`.
- **Výchozí jazyk** obchodu je první tabulka. Další jazyk: rozbalovací seznam „Přidat jazyk“ → nová tabulka.
- **Tabulka:** řádek = jeden text. Sloupce: kde se text ukazuje (lidsky, ne klíč), výchozí text šedě, pole pro vlastní. Seskupené podle místa: Množstevní tabulka, Milníky, Košík, Výprodej, Kampaně, Ceny na kartách. Části ve složených závorkách (`{amount}`) se kontrolují.
- **Milníky (bod 11):** texty podle typu odměny („Do dopravy zdarma zbývá {amount}“), a u stupně se slevou vlastní název odměny, který jde přeložit. Název dárku se bere z produktu, překládá ho Shopify.
- **Limit:** Free 2 jazyky (výchozí + 1), Pro neomezeně. Po přechodu z Pro na Free zůstanou další jazyky uložené, na webu se použije výchozí text; appka to řekne.
- **Export a import:** export CSV (klíč, místo, výchozí text, sloupec na jazyk). Import nejdřív ukáže, co se změní a co odmítá (neznámý klíč, chybějící `{amount}`, moc dlouhý text), uloží až po potvrzení.
- **Technicky:** neomezené jazyky se nevejdou do jednoho nastavení pro web. Každý jazyk dostane vlastní úložiště a web načte jen ten, ve kterém je stránka.

## 13. Kam se přesune Vzhled

| Co je dnes ve Vzhledu | Kam |
|---|---|
| Styl množstevní tabulky (Tabulka, Zvýrazněná úroveň, Štítky, Dlaždice) | Množstevní slevy, sekce „Vzhled tabulky“ (přepínač tam už je) |
| Ceny na kartách produktů · BETA | Množstevní slevy |
| Tabulka v tématu (stav + přidání) | Množstevní slevy (bod 5) |
| Vzhled žebříčku milníků | Milníky |
| Štítek výprodeje | Výprodej |
| Banner kampaně | Kampaně |
| Texty na webu | Překlady |
| Vlastní barvy a CSS (Pro), zadání pro AI | ke každému modulu zvlášť (rozhodnuto) |

**Rozhodnuto 6. 10.: vzhled se mezi moduly nesdílí.** Každý prvek na webu má vlastní vzhled, protože jde o jiné věci:

| Prvek | Kde se nastavuje | Free: hotové vzhledy | Pro |
|---|---|---|---|
| Množstevní tabulka | Množstevní slevy | Tabulka, Zvýrazněná úroveň, Štítky, Dlaždice | vlastní barvy + CSS |
| Milníky | Milníky | návrh: Odškrtávací seznam, Ukazatel se značkami, Jedna věta | vlastní barvy + CSS |
| Výprodej (štítek, odpočet do konce) | Výprodej | návrh: Štítek, Štítek s odpočtem, Pruh | vlastní barvy + CSS |
| Kampaň (banner, odpočet) | Kampaně | návrh: Pruh, Banner s odpočtem, Karta | vlastní barvy + CSS |

- Milníky podle Ondřeje: text s fajfkami u splněných stupňů, bez fajfky u nesplněných, zvýraznění barvou při dosažení stupně, volitelně krátký efekt (bliknutí) v okamžiku dosažení. Efekt respektuje nastavení „omezit pohyb“ v zařízení.
- Výprodej a kampaň: odpočet do konce je součást vzhledu.
- Vlastní CSS každého prvku platí jen uvnitř něj (dnes je jedno CSS pod společným kořenem všech bloků, `packages/core/src/discounts/custom-look.ts`). Nastavení se rozdělí na čtyři samostatná, dnešní společné se při převodu zkopíruje k tabulce (jediné místo, kde se dnes reálně používá) a ověřím, že se na webu nic nezmění.
- Náhled u každého vzhledu je živý a ukazuje i vlastní CSS.
- „Zadání pro AI“ se generuje zvlášť pro každý prvek (jeho třídy a proměnné).
- Dopad: čtyři sady CSS se musí vejít do nastavení pro web. Změřím před implementací; když ne, každý prvek dostane vlastní úložiště (stejně jako jazyky v bodě 14).

## 15. Co je „Prázdná sleva“

Je to karta v nabídce receptů ve „Slevy a kódy“ (`app/i18n/cs.ts:335`). Recepty jsou předvyplněné slevy; „Prázdná sleva“ otevře formulář bez předvyplnění. V obchodě nic nevytvoří, dokud ji neuložíte. Předpokládám, že jste ji viděl tady; jestli jinde (v seznamu Slevy přímo v Shopify), pošlete screenshot.

**Návrh:** přejmenovat na „Vlastní sleva“ s větou „Začnete s čistým formulářem a nastavíte vše sami.“ Vizuálně odlišit od receptů.

## 16. Vyzkoušet košík samo hlídá kombinace

**Pochopení:** appka zná aktivní slevy a jejich typy, umí tedy sama sestavit běžné kombinace, spočítat je a upozornit předem. Hlavně na střet s ochranou marže.

**Dnes:** Vyzkoušet košík je ruční (Pro). Výpočet běží na serveru stejným výpočtem jako pokladna a umí říct, kde zasáhla ochrana marže (`app/lib/integration/try-cart-plan.ts:369-410`).

**Můj názor:** ano, a patří to i na úvodní stránku, jako dlaždice s počtem upozornění, ne jako nový blok.

**Návrh:**
- **Automatické scénáře** z aktivních typů slev: množstevní sleva sama; + sleva s kódem; + sleva z objednávky; + doprava zdarma; + dárek z milníku; výprodej + cokoli z toho; kampaň v den startu. Jen kombinace, které nastavení dovoluje. Nejvýš zhruba 12.
- **Produkty do scénáře vybere appka:** produkt s nejnižší marží, produkt z výjimky, varianta ve výprodeji, nejprodávanější (z přehledů, když jsou).
- **Co hlásí:**
  - ochrana marže slevu snížila nebo zrušila (zákazník dostane míň, než slibuje tabulka),
  - součet slev překročí nastavený strop,
  - sleva se neuplatní, protože se nekombinuje s jinou,
  - kód zruší nárok na dárek,
  - pokladna slevy zkrátí (moc slev na jeden košík).
- **Kde:** ve Vyzkoušet košík nahoře seznam „Časté kombinace“ se stavem V pořádku / Upozornění; klik scénář otevře v ručním formuláři. Na úvodní stránce dlaždice „Kontrola kombinací: 6 v pořádku, 1 upozornění“. U upozornění odkaz na nastavení, které ho způsobuje.
- **Kdy se počítá:** po uložení jakékoli slevy a jednou denně, z cen a nákupních cen, které appka už má uložené. Bez dalších dotazů do Shopify při otevření stránky.
- **Poctivě:** je to výpočet, ne ostrá objednávka. Text to říká.

---

## Pořadí

| Dávka | Body | Co | Závisí na |
|---|---|---|---|
| A | 1, 2, 3, 5, 6, 8, 15 | Štítky, dlaždice, drobné UI | nic |
| B | 4 | Tabulka a košík na webu | nic |
| C | 7 | Výjimky | schválený nákres |
| D | 9, 10 | Milníky + web | nic |
| E | 11, 12, 13, 14 | Překlady, přesun Vzhledu, vzhled po modulech | D (texty a vzhled milníků) |
| F | 16 | Kontrola kombinací | D (dárek a doprava ve scénářích) |

A, B a C jsou na sobě nezávislé. D mění nastavení i web, proto před E a F.

**Před začátkem:** v repu je 243 necommitnutých souborů z prvních dvou kol. Navrhuju je nejdřív commitnout jako výchozí bod.

**Důkazy u každé dávky:** screenshoty 390 a 1440 px, výstup testů, u webu Horizon i Dawn.

## Rozhodnuto 6. 10. 2026

1. **Milníky, typy odměn:** dárek, doprava zdarma, sleva na celou objednávku (% nebo částka). Sleva na produkty / kolekci v první verzi není.
2. **Vzhled:** nesdílí se. Každý prvek má vlastní; Free vybírá z hotových vzhledů, Pro má vlastní CSS (detail v bodě 13).
3. **Seznam jazyků:** jazyky zapnuté v Shopify. Přibude oprávnění ke čtení jazyků obchodu, obchodník ho jednou potvrdí; přesný název oprávnění ověřím v dokumentaci Shopify.
4. **Kontrola kombinací:** počet upozornění vidí i Free, detail (které a proč) je Pro.

5. **Milníky, limity:** Free 2 stupně, Pro 6.
6. **Export a import překladů:** jen Pro.
7. **Název:** Milníky / Milestones.
8. **Limit skriptu na stránce produktu:** zvednout z 10 240 B na 12 kB. Před a po změřím rychlost stránky a přiložím čísla.

9. **Úvodní stránka na mobilu (appka v Shopify adminu na telefonu):** dva sloupce dlaždic.
10. **Bod 15:** „Prázdná sleva“ byla ve Won. Je v sekci „Recepty“ na stránce Slevy a kódy, která je ve výchozím stavu sbalená (`app/components/screens/DiscountsScreen.tsx:218`, `app/components/RecipeGrid.tsx:51`); proto nešla znovu najít. Přejmenování na „Vlastní sleva“ platí.
11. **Výchozí bod:** stav po prvních dvou kolech commitnutý na větvi `won-discounts-feedback-2026-10-06`.

Otevřené otázky nejsou. Další krok: nákres bodu 7 a rozpis dávky A.

---

## Rozpis dávky A (body 1, 2, 3, 5, 6, 8, 15)

Cesty relativní k `apps/won-discounts/`. Nastavení, data pro pokladnu ani data pro web se v dávce A nemění; mění se jen admin a jedno čtení tématu.

**Stav modulu (body 1 a 8)**
- Nový `app/components/model/module-status.ts`: `moduleState()` vrací `active` / `inactive` / `attention` / `locked` a počet věcí k řešení. Vstupem jsou fakta, která už appka má (uložené nastavení po tarifu, stav zápisu do Shopify, tarif). Jedna sada funkcí pro Slevy a kódy, Množstevní slevy, Odměny (zvlášť doprava a dárek), Výprodej, Kampaně, Ochranu marže.
- `WonSection` dostane `state` (štítek podle stavu modulu). Úvodní stránka i stránky modulů volají stejnou funkci nad uloženým stavem, takže neuložený přepínač štítek nemění.
- Stránky modulů potřebují stav zápisu do Shopify: loadery Odměn, Výprodeje, Kampaní a Ochrany marže ho nově čtou (`loadSyncView`, bez dotazu do Shopify navíc; čte se z databáze appky).
- Texty: „Aktivní“ / „Active“ (anglicky dnes „Live“), „Neaktivní“ / „Inactive“, „Vyžaduje pozornost“ / „Needs attention“.
- Testy: `tests/ui/module-status.test.ts` (každý modul zapnuto / vypnuto / na Free / selhaný zápis → stav), `harness-screens` (stejný štítek na úvodní stránce i na stránce modulu).

**Úvodní stránka (body 2 a 3)**
- Nový `app/components/shell/ModuleTile.tsx` (dlaždice = jeden odkaz) a mřížka: 2 sloupce, od 900 px šířky stránky 3.
- `OverviewScreen.tsx`: nad mřížkou jen pruhy, které mají co říct (průvodce, „Vyžaduje pozornost“, stav v obchodě, slevy mimo Won). Karty modulů (`*OverviewCard.tsx`) zanikají, jejich řádky už na stránkách modulů jsou.
- Dlaždice: Slevy a kódy · Množstevní slevy · Odměny · Výprodej · Kampaně · Ochrana marže · Přehledy · Vzhled · Vyzkoušet košík · Nastavení. „Odměny“ se přejmenují na Milníky v dávce D, „Vzhled“ na Překlady v dávce E.
- Testy: `harness-screens` (dlaždice jsou odkazy, žádné tlačítko „Upravit“, věta se skutečným nastavením), `overview-model`.

**Umístění na webu (bod 5)**
- `WonSection` dostane `placement` (zelený „V tématu“ / červený „Chybí v tématu“ / šedý „Neověřeno“) a `action` (tlačítko v hlavičce).
- Čtení tématu (`app/lib/integration/themes.server.ts`) nově pozná i blok průběhu odměn, banner kampaně, štítek výprodeje, blok v košíku a pruh nahoře (nastavení Won v šabloně). Stejné oprávnění jako dnes (`read_themes`), jeden dotaz, o tři soubory šablon víc.
- Použití: tabulka (Množstevní slevy), Won v šabloně, košík a „Odměny jinde na webu“ (Odměny), „Kampaň na webu“ (Kampaně), štítek výprodeje (Výprodej).
- Testy: `tests/integration` čtení tématu (blok je / není / bez oprávnění), `harness-screens` (štítek a tlačítko v hlavičce pro každý stav).

**Pro jen jednou (bod 6)**
- `WonSection pro` předá dolů, že sekce už Pro značí. `WonBlock`, `ProFrame`, `PlanBadge` a `SegmentedChoice` uvnitř jsou pak neutrální (bílá, šedá linka, bez štítku). Zamčený formulář na Free zůstává zašedlý, jantar nese hlavička a věta s odkazem na tarif.
- Projít: výjimky, editor slevy (Cílení a kombinace), Výprodej, Kampaně, Ochrana marže (kolekce, zásahy), Přehledy, Tarif, Vyzkoušet košík.
- Test: `harness-screens` (v sekci Pro je štítek Pro právě jednou a žádný jantarový rámeček uvnitř).

**Vlastní sleva (bod 15)**
- `app/i18n/cs.ts`, `en.ts`, `RecipeGrid.tsx`: karta „Vlastní sleva“ s větou, čárkovaný okraj, odlišená od receptů.

**Pravidla pro všechny Won appky:** doktrína §19 (štítky stavu, Pro jednou za sekci, umístění na webu) + `docs/nova-aplikace.md`. Šablona `apps/_template` nemá vlastní komponenty adminu, pravidla tam jdou do README.

## Stav implementace

Zapisuje se po bodech během práce.

| Bod | Stav | Poznámka |
|---|---|---|
| 1, 8 | hotovo, naživo neověřeno | `app/components/model/module-status.ts`; štítek na dlaždici i na stránce modulu z jedné funkce. Odměny: „Doprava zdarma“ i „Dárek“ mají štítek. Anglicky „Active“. |
| 2, 3 | hotovo, naživo neověřeno | `OverviewScreen.tsx`, `shell/ModuleTile.tsx`; 10 dlaždic, 2 sloupce do 900 px šířky stránky, pak 3. Šest karet modulů zrušeno. |
| 5 | hotovo, naživo neověřeno | `WonSection placement / action`, `themePlacementsIn()`; tabulka, Won v šabloně, blok v košíku, průběh odměn, pruh nahoře, banner kampaně, štítek výprodeje. |
| 6 | hotovo | `shell/pro-marked.ts`; Pro značí hlavička sekce, uvnitř nic jantarového. Platí pro všechny sekce Pro najednou. |
| 15 | hotovo | „Vlastní sleva“ / „Custom discount“ s větou, čárkovaná karta. |
| 4 | v kódu, brána zelená, **chybí E2E na Horizonu a Dawnu** (čeká na „go“) | `extensions/won-discounts-storefront/assets/won-discounts-tiers.js` (`refresh`); na živém tématu dev obchodu ověřeno. |
| 4, vzhled na webu (dotažení, úkol 1) | příčina nalezena 7. 10., oprava mimo kód | Blok na živém webu byl bez stylů, protože obchod ukazuje dev preview a jeho soubory vrací 404. Kód, uložené nastavení i značka sedí. Kontrola: `scripts/check-storefront-assets.mjs`, `assertExtensionAssetsLoaded`. Podrobnosti v build logu. |
| návrh částky v kampaních (dotažení, úkol 3) | v kódu, test zelený, screenshoty chybí | `CampaignsScreen.tsx` + `AmountSuggestions`; `/dev/preview/campaigns?plan=pro&state=suggest&edit=bf`. |
| 7 | v kódu, testy zelené, klikání naživo neověřeno | `tiers/ProTierSets.tsx`, `TierSetEditor.tsx` (`inherit`), `TiersScreen.tsx` (`addSet`); testy `tests/ui/kolo3-c.test.ts`; rozhodnutí v build logu. |
| 9, 10 | nezačato | dávka D |
| 11, 12, 13, 14 | nezačato | dávka E |
| 16 | nezačato | dávka F |

**Zjištěno při čtení kódu (liší se od návrhu):**
- Bod 1, Ochrana marže: karta štítek posílá jen tehdy, když je zápis do Shopify v pořádku **a** nákupní ceny už byly jednou celé načtené (`MarginOverviewCard.tsx:41`). Jinak neposílá nic, proto štítek chybí. Stránka modulu štítek „Aktivní“ neposílá nikdy (`MarginScreen.tsx:231`). Nově: zapnutá ochrana se zápisem v Shopify je „Aktivní“ (strop slevy platí hned); nenačtené nákupní ceny jsou věc k řešení s vlastní větou, štítek neschovávají. Naživo neověřeno.
- Anglický štítek je dnes „Live“, ne „Active“.

**Rozhodl jsem sám (drobnosti, dávka A):**
- Uloženo, ale ještě nezapsáno do Shopify = „Neaktivní“ (ne červený štítek); selhaný zápis = „Vyžaduje pozornost“.
- Věci k řešení se na dlaždici píšou jako počet pod větou („3 věci k vyřešení“) a zelený štítek neberou, dokud modul běží.
- „Stav v obchodě“ je na úvodní stránce jeden sbalený řádek, dokud je vše v pořádku; s problémem se otevře sám.
- „Slevy mimo Won“ zůstávají nad dlaždicemi celé (ne sbalené), protože mají vlastní tlačítka na přesun.
- Štítek výprodeje má vlastní sekci „Štítek výprodeje na stránce produktu“ a ukazuje se jen u zobrazení se štítkem.
- U nepřístupného tématu se sekce tabulky nově ukáže se štítkem „Neověřeno“ (dřív se skryla); mění to pravidlo z prvního kola.
- Sekce bez oprávnění k tématu a pruh nahoře: tlačítko vede do nastavení Won v šabloně, blok tam nejde přidat odkazem.
- V češtině byl od druhého kola překlep „aktivnící“ u počtu kampaní, opraveno.

**Brána dávky A a důkazy:** viz build log `docs/won-discounts-build-log.md`, sekce „Třetí kolo feedbacku“. Screenshoty před / po: `Apps/.playwright-mcp/kolo3/a/before` a `…/after` (390 a 1440 px).

**Neověřeno naživo (dávka A):** nic jsem neklikal v Shopify adminu ani nečetl skutečné téma. Čtení šablon `templates/index.json` a `templates/cart.json` a nastavení pruhu nahoře je ověřené jen testem na vzorových souborech.

## Rozpis a stav dávky B (bod 4)

**Zopakováno naživo 6. 10.** (dev obchod, živé téma „test-data“, produkt `won-e2e-simple-a`, úrovně od 3 ks −3 Kč, od 5 ks −4 Kč; jen čtení a košík prohlížeče, žádný zápis do obchodu):

| Krok | Před opravou | Po opravě |
|---|---|---|
| Prázdný košík, načtená stránka | „1 ks za 10,00 Kč“, „Ještě 2 ks“ | stejně |
| Přidán 1 ks z produktu, bez načtení stránky | „Ještě 2 ks“ (**chyba**) | „Počítáme i 1 ks v košíku“, „Ještě 1 ks“ |
| Po načtení stránky | „Počítáme i 1 ks v košíku“, „Ještě 1 ks“ | stejně |

Závěr: první vykreslení bylo správně, chyba byla jen po změně košíku. Příčina z plánu platí (skript po změně košíku počty vynuloval).

**Co se změnilo**
- Skript po signálu tématu o změně košíku načte čerstvé vykreslení **vlastní sekce** (`?section_id=…`, stejný Liquid jako při načtení stránky) a vezme z něj jen svá data. Při načtení stránky žádný dotaz navíc. Nikdy nevolá košík.
- Počká na dokončení požadavku tématu, staré počty nechá do odpovědi, starší odpověď zahodí. Když sekci přečíst nejde, počty vynuluje jako dřív (nikdy neslíbí víc než pokladna).
- Data pro web, nastavení ani data pro pokladnu se nemění.
- Limit skriptů stránky produktu: 10 240 B → 12 288 B (rozhodnutí 8). **Váha: 10 226 B před, 10 800 B po** (po kompresi, všechny čtyři skripty stránky produktu).

**Testy:** `tests/contracts/storefront-tiers.contract.test.ts` (+5: nové počty po změně košíku, po kusech, čekání a pořadí odpovědí, selhání, Dawn), `perf-budget.contract.test.ts`, E2E `tests/e2e/storefront.tiers.spec.ts` („bod 4“, kliká na tlačítko tématu; **zatím neběžel**).

**Neověřeno**
- Horizon a Dawn naživo: náhled nepublikovaných témat mi obchod odmítl (HTTP 429, ochrana proti robotům). Potřebuje běh E2E přes `shopify theme dev`, který přepisuje nastavení dev obchodu, proto čeká na „go“.
- Rychlost stránky před a po není změřená (stejný důvod). Při načtení stránky se nic nepřidalo kromě 574 B skriptu.
- Počítání „celý košík“ a výjimky naživo (v testech ano).
- Rozšíření se měnilo za běhu `shopify app dev`; do dev obchodu se propsalo samo. Podle runbooku může být potřeba `shopify app dev` restartovat.

## Doplnění 6. 10. večer (Ondřej po prohlédnutí dávky A)

| Co | Stav |
|---|---|
| Dlaždice úvodní stránky říkají, co se pod nimi skrývá, a pod čarou, co je aktivní | hotovo (`shell/ModuleTile.tsx`, `OverviewScreen.tsx`) |
| Výprodej: tři dlaždice (Výprodeje / Nový výprodej / Jak výprodej funguje), běžící první, skončené poslední, po založení se ukáže seznam | hotovo (`OutletScreen.tsx`) |
| Stejný dlaždicový pohled na dalších stránkách | hotovo: Množstevní slevy, Odměny, Kampaně, Ochrana marže (`shell/views.tsx`). Beze změny: Slevy a kódy, Přehledy, Nastavení (krátké stránky), Vzhled (v dávce E zaniká), Vyzkoušet košík (dávka F). |
| Předpřipravené scénáře ve Vyzkoušet košík | **nezačato**, je to bod 16 (dávka F). Ondřej potvrdil, že je chce jako hlavní cestu, ruční košík až jako druhou možnost. |

Pravidlo je v doktríně §19e. Naživo v Shopify adminu neklikáno; testy `tests/ui/kolo3-a.test.ts`, screenshoty `Apps/.playwright-mcp/kolo3/a2`.

## Doplnění 6. 10. večer: štítek výprodeje jde skrýt u jednotlivé varianty

Hotovo, naživo neověřeno. U nového výprodeje zaškrtávátko „Na webu u této varianty štítek výprodeje neukazovat“, u běžícího tlačítko „Skrýt štítek“ / „Ukázat štítek“. Sleva, kusy k doprodeji ani cena se nemění; appka jen variantu vynechá z údaje, který blok štítku čte, takže se téma ani blok měnit nemusí.

- Nový sloupec `OutletRun.showBadge` (výchozí ano), migrace `20261006180000_outlet_show_badge` (SQLite) a `0002_outlet_show_badge` (Postgres). V lokální dev databázi je aplikovaná, záloha před ní `scratchpad/dev.sqlite.before-show-badge`.
- Testy: `tests/integration/outlet-admin.test.ts` (+2). Postgres test (`npm run test:postgres -w won-discounts`, potřebuje Docker) neběžel.
- Platí pro celou variantu ve výprodeji, ne pro jednotlivé trhy.
