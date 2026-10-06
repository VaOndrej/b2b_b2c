# Won Discounts: feedback 6. 10. 2026, návrh plánu

Stav: **návrh, čtyři hlavní rozhodnutí padla (viz konec), nic není implementováno.**
U každého bodu je: jak jsem ho pochopil, co je dnes v kódu, co navrhuju. Otevřené otázky jsou na konci.

## 1. Menu je moc dlouhé

**Pochopení:** 11 položek, Shopify část schovává pod „Zobrazit více“. Chceš krátké menu bez rozbalování.

**Dnes:** `app/components/model/modules.ts` (`navItems`) skládá: Slevy a kódy, Vyzkoušet košík, Množstevní slevy, Odměny, Výprodej, Ochrana marže, Kampaně, Vzhled, Přehledy, Nastavení, Tarif. Rozhodnutí „Admin IA: všechny moduly vždy v menu“ v `rozhodnuti.md` se tímhle mění.

**Rozhodnuto: varianta A, 5 položek:**

| Menu | Co je uvnitř |
|---|---|
| Slevy | záložky nahoře: Slevy a kódy · Množstevní · Odměny · Výprodej (Pro) · Kampaně (Pro) |
| Ochrana marže | beze změny |
| Vzhled | beze změny |
| Přehledy | beze změny |
| Nastavení | + Tarif jako sekce, + Vyzkoušet košík (Pro) jako nástroj |

- Adresy stránek zůstanou (`/app/tiers`, `/app/rewards`…), mění se jen menu a přibude společný pruh záložek. Odkazy z Přehledu a z e-mailů se nerozbijí.
- Pořadí záložek podle cílů z onboardingu (dnes tak řadí menu).
- Kolik položek Shopify ukáže bez „Zobrazit více“, ověřím naživo v adminu, číslo z hlavy netvrdím.

## 2. Karta „Slevy mimo Won“ na Přehledu

**Pochopení:** když je prázdná („Žádné. Engine zná všechny slevy obchodu.“), je k ničemu.

**Dnes:** `OverviewScreen.tsx` ji ukazuje vždy; `NativeDiscounts.tsx` přes ni přesouvá nativní slevy Shopify do Won a umí přesun vrátit.

**Návrh:** kartu skrýt, když není co řešit. Ukáže se jen tehdy, když v obchodě existuje sleva mimo Won, nebo když existuje záloha, kterou jde vrátit. **Předpoklad:** nechceš smazat samotný přesun slev, jen prázdnou kartu. Jestli chceš pryč celou funkci, řekni.

## 3. Když sleva neběží, označit políčko, které to způsobuje

**Dnes:** `rule-status.ts` zná důvody (`no_value`, `no_code`, `no_target`, `market_off`, `pro_off`…) a `describe.ts` (`collectWarnings`) už ke každému zná cílové pole. Editor to ale ukáže jen v hlavičce sekce.

**Návrh:**
- U pole, které chybí, jemná značka: červená tečka u popisku + věta pod polem („Vyplň částku, bez ní sleva neběží“). Stejná barva jako pilulka „Neběží“.
- Věta v hlavičce („Neběží: nemá hodnotu…“) je klikací a skočí na pole.
- Mapování: bez hodnoty → částka / minimum; bez kódu → kódy; bez produktů → výběr produktů; vypnutý trh → trhy; Pro funkce na Free → sekce Pro.
- Stejný vzor na dalších obrazovkách, kde stav říká „neběží“: Množstevní slevy (sada bez úrovní, částka chybí v měně), Odměny (práh bez dárku), Výprodej, Kampaně. Před implementací projdu všechny stavy a doplním seznam.

## 4. Vybrané produkty a kolekce nejsou vidět

**Dnes:** `DiscountSection.tsx` ukazuje jen „1 produkt“ vedle tlačítka. Názvy editor nezná, drží jen ID.

**Návrh:** jedna sdílená komponenta „seznam vybraných“:
- řádek = obrázek, název, křížek pro odebrání,
- nad 8 položek hledání v seznamu a „Zobrazit všech N“,
- tlačítko „Vybrat produkty“ zůstává (otevře Shopify výběr s předvybranými).
- Server musí k uloženým ID dotáhnout názvy a obrázky (dnes to nedělá).

Použít všude, kde se vybírá: editor slevy (produkty, kolekce), Pro sady množstevních slev, dárky v Odměnách, Výprodej, kolekce v Ochraně marže, Vyzkoušet košík.

## 5. Náhled se neaktualizuje

**Zjištění:** řádek s efektem se aktualizoval správně („100 Kč z dopravy“). Zastaralý je **název** „Sleva 10 % na vše“. Ten není počítaný, je to text předvyplněný z receptu a náhled ho ukazuje jako „V pokladně: {název}“.

**Návrh:**
- Název se generuje sám z nastavení („100 Kč z dopravy“), dokud ho obchodník ručně nepřepíše. Po ručním přepsání je jeho a už se nemění. U pole malý odkaz „Vrátit automatický název“.
- Test, který projde všechny kombinace typ × cíl × způsob uplatnění a ověří, že hlavička, náhled i souhrn sekcí odpovídají. Stejný test pro Množstevní slevy, Odměny, Výprodej a Kampaně.

## 6. Generování kódů

**Dnes:** `ApplySection.tsx` má jen textové pole, jeden kód na řádek. Kódy jsou skutečné kódy v Shopify (`discountRedeemCodeBulkAdd`). Limit 1000 kódů na slevu.

**Technický limit, který to ovlivní:** každý kód jde do slevové funkce jako otisk (11 B) a celá konfigurace obchodu má strop 9000 B (`function-config.ts`). Reálně se vejde řádově 500 kódů **na celý obchod**, při víc nastavení méně. Sto kódů projde, pět dávek po stu už ne.

**Návrh:**
- Free: tlačítko „Vygenerovat kódy“, počet (1 až 100), délka. Zcela náhodné, bez zaměnitelných znaků (0/O, 1/I).
- Pro: vzor z částí: předpona, střed, přípona, náhodná část (počet znaků, jen číslice / jen písmena / obojí). Živá ukázka tří kódů.
- Seznam kódů místo textového pole: hledání, kopírovat vše, export CSV, smazat.
- Kolize se stávajícími kódy obchodu se kontroluje před uložením.
- Rozhodnuto: dávka má společnou krátkou předponu (i náhodná ve Free) a funkce ji pozná podle ní, takže počet kódů místo ve funkci neomezuje. Proveditelnost ověřím jako první krok; ručně psané kódy zůstávají po starém.

## 7. „Další možnosti“ nemají být schované

**Návrh:** sekci zrušit jako accordion a rozdělit do vždy otevřených sekcí v tomhle pořadí:

1. Sleva (typ, hodnota, na co platí)
2. **Podmínky** (minimální objednávka, minimální počet kusů, bod 8)
3. Jak se uplatní (automaticky / kódem) + **Limity** (platí jen pro kódy, proto patří sem)
4. **Kdy platí** (od, do)
5. Cílení a kombinace (Pro)

## 8. Minimální počet kusů pro každý produkt / kolekci (Pro)

**Pochopení:** sleva 10 % na produkty A, B, C; u A chci minimum 3 ks, u B 4 ks. U kolekcí totéž po kolekcích.

**Dnes:** jedno minimum pro celé pravidlo (`minimum.quantity` + rozsah „celý košík / jen produkty slevy“).

**Návrh:** v seznamu vybraných (bod 4) má každý řádek pole „Od ks“. Prázdné = platí společné minimum. Vyžaduje změnu konfigurace, enginu, slevové funkce, Pro brány a kontrolu místa ve funkci (každé minimum zabírá bajty).

**Upozornění na překryv:** Pro sady v Množstevních slevách už dnes umí „produkt A od 3 ks −10 %“. Rozdíl je, že pravidlo ve Slevách umí navíc kód, termín a cílení. Rozhodnuto: každý produkt hlídá jen své minimum (3× A a 1× B → A slevu má, B ne).

## 9. Pro sekce „Cílení a kombinace“ působí nedodělaně

**Dnes (`ProSection.tsx`):** „Obchod zatím nemá v Won žádné trhy.“, zašedlé „Segmenty zákazníků, připravujeme“, technická věta o šesti slevách, „Žádná další sleva zatím není.“

**Návrh:**
- Každý blok dostane jednu větu, k čemu je, a prázdný stav s akcí (trhy → odkaz, kde se zapínají; kombinace → odkaz na vytvoření další slevy).
- Segmenty z formuláře pryč, dokud je pokladna neumí. Placená funkce nemá ukazovat „připravujeme“.
- Věta o limitu 6 slev jen tehdy, když se k němu obchod blíží.
- Kombinace: říct, jak se sleva chová ve výchozím stavu, s odkazem na Nastavení.

**Předpoklad:** „chybí tam text“ = tyhle prázdné stavy. Jestli jsi myslel něco jiného, upřesni.

## 10. Vyzkoušet košík jako Pro + výběr slev

**Dnes:** `TryCartScreen.tsx`, Free, kód se píše do textového pole.

**Návrh:**
- Pro funkce. Na Free zamčená jantarová sekce s nabídkou, odkaz „Vyzkoušet v košíku“ v editoru dostane štítek Pro.
- Místo pole „Kód“ seznam běžících slev: automatické jsou vypsané jako „uplatní se samy“, slevy s kódem se zaškrtávají (appka dosadí kód sama).
- V menu zmizí (bod 1), vstup z Nastavení a z editoru slevy.

## 11. Množstevní slevy: nejde nic přepnout ani upravit, chybí hezčí vzhled

**Upřesněno Ondřejem:** v adminu nejde změnit nic kromě výchozích hodnot: úrovně, počítání kusů, typ slevy, přepínač vzhledu, nejde rozbalit ani Pro sekci.

**Je to chyba, ne návrh.** Mimo Shopify admin (`/dev/preview/tiers`) se stránka vykreslí celá, v adminu je mrtvá. Editor slevy přitom používá stejné ovládací prvky a funguje, takže chyba je ve stránce Množstevní slevy, ne v komponentách. Příčinu zatím neznám.

**Postup:**
1. Zreprodukovat v adminu, přečíst chyby v konzoli, najít příčinu, opravit, přidat E2E test, který na stránce opravdu kliká. Zkontrolovat stejnou chybu na Odměnách, Výprodeji, Kampaních, Ochraně marže a Vzhledu.
2. Přepínač vzhledu na téhle stránce vzhled opravdu nastaví a uloží (dnes mění jen náhled, skutečná volba je ve Vzhledu). Free: 4 hotové vzhledy (Tabulka, Zvýrazněná úroveň, Štítky, Dlaždice).
3. Výchozí vzhled pro nové obchody změnit z tabulky na hezčí.
4. Pro: vlastní barvy a CSS přímo tady, s odkazem na Vzhled pro zbytek.

## Navržené pořadí prací

0. Bod 11, krok 1: oprava mrtvé stránky (chyba, jde první).
1. Bod 1 (menu + záložky) a bod 2: kostra, na které stojí zbytek.
2. Editor slevy: body 7, 3, 5, 9 (jen UI a texty).
3. Bod 4 (seznam vybraných) a po něm bod 8 (mění engine a funkci).
4. Bod 6 (kódy): nejdřív ověřit, že funkce umí poznat dávku podle předpony.
5. Bod 10 a zbytek bodu 11.

## Rozhodnuto 6. 10. 2026

- Menu: varianta A, 5 položek (Slevy se záložkami, Ochrana marže, Vzhled, Přehledy, Nastavení).
- Bod 8: každý produkt / kolekce hlídá jen své minimum.
- Bod 6: vygenerovaná dávka kódů má společnou předponu a funkce ji pozná podle ní, i u náhodných kódů ve Free.

- Bod 2: skrýt jen prázdnou kartu, přesun slev zůstává.
- Bod 9: „chybí text“ = prázdné stavy; segmenty z formuláře pryč.

## Obecná pravidla z tohohle feedbacku

Devět pravidel, která platí pro každou obrazovku, ne jen pro tu, kde na ně Ondřej narazil.

| # | Pravidlo | Z bodu | Jak se pozná porušení |
|---|---|---|---|
| P1 | Menu má nejvýš 5 položek, příbuzné věci jsou záložky jedné stránky. | 1 | V menu je „Zobrazit více“. |
| P2 | Co nemá obsah ani akci, se neukazuje. | 2, 9 | Karta nebo blok, kde je jen „Žádné“ bez tlačítka. |
| P3 | Problém je označený tam, kde se opravuje. Každý stav „neběží“ má značku u pole a odkaz, který na něj skočí. | 3 | Důvod je jen v hlavičce nebo jen na Přehledu. |
| P4 | Výběr je vždy vidět jako seznam s názvy, nikdy jen jako počet. | 4 | „3 produkty“ bez seznamu. |
| P5 | Každý text, který popisuje nastavení, se z nastavení počítá a mění se s každou volbou. | 5 | Náhled nebo souhrn, který po změně volby zůstane stejný. |
| P6 | Co appka zná, to obchodník vybírá, nepíše. Co jde vyrobit hromadně, to appka nabídne vyrobit. | 6, 10 | Textové pole pro něco, co je v databázi (kód, název slevy, produkt). |
| P7 | Pod rozbalovačkou je jen to, co se nastavuje výjimečně. Podmínky, termín a limity jsou vidět. | 7 | Accordion, který obchodník otevírá u většiny slev. |
| P8 | Pro funkce je buď hotová, nebo není vidět. Žádné „připravujeme“ uvnitř placené sekce. | 9 | Zašedlý prvek bez data a bez akce. |
| P9 | Ovládací prvek dělá to, co říká, a uloží to. Každá obrazovka má test, který na ni v adminu opravdu kliká. | 11 | Přepínač, který mění jen náhled; stránka bez klikacího testu. |

Bod 8 (minimum na produkt) je nová funkce, obecné pravidlo z něj není.

**Střet s dnešní doktrínou** (`docs/won-app-design-doctrine.md`): P1 ruší „všechny moduly vždy v menu“, P7 zužuje §9 (vzácné volby sbalené), P8 ruší §16a v části „viditelné, aby to šlo chtít“ pro nehotové věci. Doktrína je sdílená pro všechny Won appky, takže se pravidla zapíšou tam, ne jen sem.

**Jak to použít, aby se feedback neopakoval:**
1. Zapsat P1 až P9 do doktríny.
2. Projít všech 11 obrazovek proti P2 až P9 (jen čtení kódu a lokálního náhledu) a sepsat tabulku obrazovka × pravidlo s konkrétními nálezy.
3. Ondřej dostane tabulku, škrtne, co nechce, a při procházení dalších nastavení už hlásí jen to, co pravidla nezachytí.
4. Nálezy se opraví spolu s body 1 až 11 ve stejných dávkách.
