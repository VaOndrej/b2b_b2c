# Won Discounts: audit srozumitelnosti (dlaždice, první nastavení, trhy a měny)

Datum: 6. 10. 2026. Větev `won-discounts-feedback-2026-10-06`, dev náhled na `localhost:49185`.
Pohled: obchodník bez technických znalostí. Nic se neměnilo, jen čtení a screenshoty.

Screenshoty: `~/Development/WonCommerce/Apps/.playwright-mcp/audit-dlazdice/` (292 souborů).
Název = obrazovka, stav, tarif, jazyk, šířka, případně otevřená dlaždice. Soubory `akce-*` jsou stavy po kliknutí.
V tabulkách uvádím jen název souboru.

## 1. Verdikt

1. **Dlaždice:** fungují jako rozcestník a říkají, co je pod nimi i co je nastavené. Na 390 px ale ořez na tři tečky bere právě tu druhou půlku věty a na několika místech dlaždice svítí zeleně, i když uvnitř něco neplatí.
2. **První nastavení do pěti minut:** dopravu zdarma a dárek obchodník nastaví za 3 až 4 minuty, pokud stránku Odměny najde sám. Průvodce ho k ní nevede: cíl „Doprava zdarma nebo dárek“ končí u receptu ve Slevách a kódech, dárek v průvodci není vůbec. Zobrazení na webu a jistota, že to běží, se do pěti minut nevejdou.
3. **Více trhů a měn:** dojem „slabé“ je **oprávněný**. Každá částka se vyplňuje pro každou měnu zvlášť bez jakékoli pomoci, chybějící částka se hlásí jen u slev (ne u dárku a množstevních slev), přehled po trzích neexistuje. A podle kódu aplikace seznam trhů z Shopify vůbec nenačítá, takže v ostrém obchodě se pole pro druhou měnu nejspíš ani neukážou (nález T1).

## 2. Pět věcí, které opravit jako první

Seřazeno podle počtu obchodníků, kteří na tom ztroskotají.

1. **Trhy z Shopify se do aplikace nedostanou (T1).** Týká se každého obchodu s víc než jednou měnou. Bez toho je zbytek práce na trzích vidět jen v dev náhledu.
2. **Průvodce nevede k Odměnám (N1).** Kdo zvolí „Doprava zdarma nebo dárek“, dostane recept slevy v jiném modulu, bez dárku. Týká se každého nového obchodu s tímhle cílem.
3. **Chybějící částka v druhé měně je vidět jen u slev (N2).** Dárek bez částky v EUR má dlaždici „Aktivní“ a na úvodní stránce o něm není ani slovo. Slovenský zákazník dárek nedostane a obchodník to neví.
4. **Zadávání částek: jedna hodnota + návrh ostatních (kapitola 5).** Dnes 6 polí pro dopravu a dárek při třech měnách, po Milnících až 18. Žádné předvyplnění, žádný návrh.
5. **Dlaždice na 390 px ořezávají podstatné (N3).** „Doprava zdarma od 1 000 Kč · Dárek Ponož…“, „6 slev · 3 aktivní · 1 naplánovaná · 1 neaktiv…“. Řádek „co mám nastavené“ je hlavní důvod, proč dlaždice existují.

## 3. Nálezy

Závažnost: **blokuje** (obchodník nedojde k cíli nebo zákazník nedostane, co má), **zdržuje**, **ruší**.

| # | Závažnost | Obrazovka, šířka | Co obchodník vidí | Proč tomu nerozumí | Návrh | Screenshot |
|---|---|---|---|---|---|---|
| T1 | blokuje | Nastavení, všechny formuláře s částkou (z kódu) | V dev náhledu „Měny: CZK (Česko) a EUR (Slovensko)“. V ostrém obchodě podle kódu „Zatím žádné trhy. Slevy používají měnu obchodu.“ | `config.markets` má výchozí hodnotu `[]` a nic kromě vzorových dat ji neplní. `withMarketCountries()` jen doplňuje země do trhů, které už v nastavení jsou. Pole pro EUR se tak neukáže a není kde je zapnout. Porušuje MKT-1. Na živém obchodě neověřeno. | Při otevření aplikace načíst aktivní trhy ze Shopify a zapsat je do nastavení (kód, měna, zapnuto). V Nastavení ukázat seznam trhů se stavem. | `settings-free-cs-1440.png` |
| N1 | blokuje | Průvodce, krok 1 a 4, 1440 | Krok 1: „Doprava zdarma nebo dárek“. Krok 4: „První sleva“ s recepty „% na vše · Částka z objednávky · Doprava zdarma · Uvítací kód“. | Recept „Doprava zdarma“ založí slevu ve Slevách a kódech, ne v modulu Odměny. Dárek v nabídce není. Kdo pak najde Odměny, nastaví dopravu zdarma podruhé. | Když je cíl „Doprava zdarma nebo dárek“, krok 4 otevře stránku Odměny (po Milnících první stupeň) s předvyplněnou částkou. | `onboarding-step4-free-cs-1440.png` |
| N2 | blokuje | Odměny → Dárek zdarma; úvodní stránka, 1440 i 390 | Dlaždice „Dárek zdarma · Aktivní · Ponožky Won — M od 1 500 Kč“. Uvnitř červeně „V měně EUR (Slovensko) není částka, v tomto trhu se odměna nenabízí.“ Úvodní stránka: „Odměny · Aktivní“, v seznamu „Vyžaduje pozornost“ jen dvě slevy. | Zelený štítek říká „běží“, pro Slovensko neběží. Rozhodnutí „admin na to upozorní“ platí jen u pole. `rewardsGiftStatus()` počítá jen práh bez částky v měně obchodu. Stejně Výjimka v Množstevních slevách („od 6 ks −60 Kč za kus (v EUR se nenabízí)“, dlaždice „Aktivní · 1 výjimka“). Porušuje §18c. | Chybějící měnu počítat jako věc k vyřešení u dárku, dopravy i úrovní. Na dlaždici „Slovensko: dárek se nenabízí“, na úvodní stránce řádek s odkazem na pole. | `rewards-free-cs-1440-gift.png`, `overview-modules-free-cs-1440.png`, `tiers-pro-cs-1440-exceptions.png` |
| N3 | zdržuje | Úvodní stránka a stránky modulů, 390 | „Doprava zdarma od 1 000 Kč · Dárek Ponož…“, „6 slev · 3 aktivní · 1 naplánovaná · 1 neaktiv…“, „Min. marže 20 % · bez nákupní ceny sleva…“, popis „Sleva v procentech nebo částkou na produkt, kolekci či celou…“ | Ořez bere konec věty, kde je druhá odměna nebo počet vypnutých slev. Ořezaný je popis (3 řádky) i stav (2 řádky), na 390 px u 7 z 10 dlaždic úvodní stránky. | Na 390 px zkrátit popis na jednu krátkou větu a stav neořezávat (smí zalomit). Stav psát od nejdůležitějšího: „3 aktivní z 6“. | `overview-modules-free-cs-390.png`, `rewards-free-cs-390-gift.png` |
| N4 | zdržuje | Úvodní stránka, 1440 i 390 | Nahoře „Vyžaduje pozornost · 3 upozornění“, na dlaždici Slevy a kódy „1 věc k vyřešení“. | Všechna tři upozornění jsou o slevách, dlaždice říká jedno. Dvě čísla pro totéž. | Jedno počítání. Dlaždice: „3 věci k vyřešení“, klik otevře seznam slev s vyfiltrovanými. | `overview-modules-free-cs-1440.png` |
| N5 | zdržuje | Úvodní stránka, nový obchod, 390 i 1440 | „Stav v obchodě · Aktivní · Slevy platí na webu i v pokladně“ a pod tím všechny dlaždice „Neaktivní“, „Zatím žádná sleva“. | Zelené „Aktivní“ u obchodu bez jediné slevy. Obchodník čte, že je hotovo. | Bez slev psát „Připraveno. Zatím není co ukazovat.“ bez zeleného štítku. | `overview-modules-off-free-cs-390.png` |
| N6 | zdržuje | Odměny → Odměny na webu, 1440 | Dlaždice bez štítku: „Košík ukazuje odměny, dárek a pole pro kód“. Uvnitř dvakrát červeně „Chybí v tématu“. | Dlaždice hlásí jen to, co funguje. Že na stránce produktu nic není, se dozví až po kliknutí. | Dlaždice: „V košíku ano · na stránce produktu ne · na úvodní stránce ne“ a počet chybějících. | `rewards-free-cs-1440-web.png` |
| N7 | zdržuje | Odměny → Odměny na webu, 1440 | „V tématu · Pruh nahoře na celém webu: v nastavení aplikace v šabloně zaškrtněte „Show reward progress at the top of the store“ a zvolte barvy.“ | Zelený štítek a zároveň návod, co udělat. Název volby je anglicky v českém rozhraní. „Nastavení aplikace v šabloně“ laik nenajde. | Když je pruh zapnutý: „Pruh nahoře je zapnutý.“ Když není: „Chybí“ + tlačítko. Volbu přeložit. | `rewards-free-cs-1440-web.png` |
| N8 | zdržuje | Množstevní slevy → Částka za kus, 390 | Po přepnutí z procent: tři úrovně, u každé tři červené věty („Úroveň není úplná…“, „V CZK (Česko) se úroveň od 3 ks nenabízí…“, „V EUR (Slovensko)…“). Dlaždice: „Aktivní · Bez množstevních slev · 3 úrovně nejsou úplné“. | Devět červených řádků dřív, než obchodník cokoli napsal. „Aktivní“ a „Bez množstevních slev“ vedle sebe. | Chybu ukázat až po opuštění pole nebo při uložení. Jedna věta na úroveň. | `akce-tiers-castka-za-kus-free-cs-390.png` |
| N9 | zdržuje | Odměny, nový obchod, 1440 | Po zapnutí přepínače dvě prázdná pole a hned „V měně CZK (Česko) není částka, v tomto trhu se odměna nenabízí.“ a totéž pro EUR. | Chyba za něco, co ještě nestihl vyplnit. Žádná navržená částka. Recept ve Slevách a kódech přitom předvyplní 1 500 Kč / 60 €. | Předvyplnit stejné hodnoty jako recept. Chybu až po uložení. | `akce-rewards-empty-doprava-zapnuta-free-cs-1440.png` |
| N10 | zdržuje | Odměny, po uložení, 1440 | „Uloženo a zapsáno do Shopify“ | Neříká, co dál. Že má ještě přidat blok na stránku produktu, se nedozví. | „Uloženo. Zákazník to uvidí v košíku. Na stránce produktu zatím ne: Přidat.“ | `rewards-result-saved-free-cs-1440.png` |
| N11 | zdržuje | Průvodce krok 5 a úvodní stránka, Free | „Vyzkoušejte košík: uvidíte přesně to, co dá pokladna. [Pro]“ a zamčená stránka. | Jediná nabídnutá cesta, jak ověřit, že slevy běží, je na Free zamčená. | Na Free nabídnout „Otevřít obchod a přidat zboží do košíku“ s odkazem na web. | `onboarding-step5-free-cs-1440.png`, `try-cart-free-cs-1440.png` |
| N12 | zdržuje | Průvodce krok 5 vs. úvodní stránka | „6 slev je aktivních“ × dlaždice „6 slev · 3 aktivní“. | Dvě různá čísla o tomtéž. | Průvodce: „3 slevy jsou aktivní, 3 ne“. | `onboarding-step5-free-cs-1440.png` |
| N13 | zdržuje | Úvodní stránka, selhaný zápis, 1440 | „Kód slevy „VIP10“ už v Shopify používá jiná sleva. Změňte kód, nebo tu slevu přesuň do Won ("VIP10": could not create "VIP10": Code must be unique. Please try a different code.).“ | Anglická systémová hláška v závorce, tykání („přesuň“) v rozhraní, které vyká. Čtyři dlaždice „Vyžaduje pozornost“ bez toho, aby bylo jasné, že jde o jednu příčinu. | Hlášku v závorce pryč, „přesuňte“. Na dlaždicích „Čeká na opravu slevy VIP10“. | `overview-modules-failed-free-cs-1440.png` |
| N14 | zdržuje | Kampaně → úprava, Pro, 1440 | U slevy „Sleva 200 Kč / 8 €“ pole „Sleva v kampani (HUF)“. U slevy „Černý pátek · 300 Kč“ jen pole pro CZK. | Maďarsko je vypnuté, editor slevy HUF schovává, kampaň se na něj ptá. Sleva bez částky v EUR ji nemůže dostat ani v kampani a nic to neříká. | Kampaň ukazuje stejné měny jako editor. U slevy bez EUR věta „Na Slovensku se nenabízí“ s odkazem. | `campaigns-edit-bf-pro-cs-1440-form.png` |
| N15 | zdržuje | Nastavení, 1440 i 390 | „Trhy a měny · Měny: CZK (Česko) a EUR (Slovensko)“ + „Spravovat trhy v Shopify“ | Jedna věta a odkaz ven. Maďarsko (vypnuté) tu není. Nevidí, co v kterém trhu platí. | Tabulka trhů, viz kapitola 5. | `settings-free-cs-1440.png` |
| N16 | ruší | Výprodej → Výprodeje, Pro, 1440 | „3 věci k vyřešení“. V panelu jsou roztroušené ve dvou sekcích: „Prodáno o 1 ks víc…“, „Krok se nepodařil…“, „Po konci se vrátilo 2 ks…“. | Které tři to jsou, musí poskládat sám. První z nich navíc nic nechce. | Nahoře panelu seznam tří řádků s odkazy. Co nejde řešit, nepočítat. | `outlet-pro-cs-1440-sales.png` |
| N17 | ruší | Úvodní stránka, Pro, 390 | Dlaždice Výprodej: „Pro“ + „Vyžaduje pozornost“ + „Aktivní: Mikina Won — L a Kšiltovka Won“. | Červený štítek a hned pod ním slovo „Aktivní“. Štítek „Pro“ u obchodu, který Pro má. | Na Pro štítek „Pro“ nekreslit (§19b). Stav psát „Běží 2 výprodeje“. | `overview-modules-pro-cs-390.png` |
| N18 | ruší | Odměny, stránky modulů, 1440 | Tři různé okraje dlaždic: modrý (vybraná), tmavý (Doprava zdarma, Dárek), šedý (Odměny na webu). | Tmavý okraj vypadá jako druhý druh výběru. V kódu dlaždice jsem pro něj důvod nenašel. | Jen dva stavy: vybraná a ostatní. | `rewards-free-cs-1440-web.png` |
| N19 | ruší | Odměny → Odměny na webu | Pod panelem tlačítko „Uložit“. | V panelu není co ukládat, všechna tlačítka vedou do editoru tématu. | V tomhle panelu „Uložit“ schovat. | `rewards-free-cs-1440-web.png` |
| N20 | ruší | Úvodní stránka, 1440 | Dlaždice Přehledy a Vzhled bez štítku a bez řádku „co mám“. Nastavení: „Tarif Free“. | Tři dlaždice s jinou stavbou než ostatní. U Nastavení je tarif to nejméně užitečné. | Přehledy: „12 objednávek se slevou za 30 dní“. Nastavení: „2 trhy · tarif Free“. | `overview-modules-free-cs-1440.png` |
| N21 | ruší | Odměny, Free, 1440 | Žlutý pruh „Pro funkce není aktivní — v pokladně se neuplatní“ přes celou šířku nad dlaždicemi. | Vypadá jako chyba celé stránky, týká se jednoho uloženého prahu. | Jen řádek u toho prahu (už tam je). | `rewards-free-cs-1440-gift.png` |
| N22 | ruší | Úvodní stránka, bez dat, 1440 | Dlaždice Množstevní slevy, Odměny, Ochrana marže bez štítku, Slevy a kódy „Neaktivní“. | Stejný stav, jiná podoba. | Všude „Neaktivní“ + věta. | `overview-empty-free-cs-1440.png` |

### Odpovědi na otázky k dlaždicím

- **Název a věta:** srozumitelné u Slev a kódů, Množstevních slev, Odměn, Výprodeje, Kampaní, Přehledů. Slabší: „Ochrana marže: Žádná sleva nesrazí cenu pod marži, kterou tu nastavíte“ (slovo marže) a „Min. marže 20 % · bez nákupní ceny sleva nejvýš 40 %“.
- **Co to je × co mám nastavené:** oddělené čarou a tučným písmem, na 1440 px čitelné. Na 390 px se obě části ořezávají (N3).
- **Štítky:** „Aktivní“, „Neaktivní“, „Pro · odemknout“ jasné. „Vyžaduje pozornost“ na dlaždici neříká co. „V tématu“, „Chybí v tématu“, „Neověřeno“ stojí na slově téma, které laik nezná.
- **„3 věci k vyřešení“:** kliknutím se nedozví které (N4, N16).
- **Vybraná dlaždice:** modrý okraj a podklad, poznat to je. Že jde kliknout na nevybranou, naznačuje jen tvar karty.
- **Pořadí:** odpovídá práci. Na stránce Odměny by „Odměny na webu“ měly mít číslo kroku, obchodník je mine.
- **Opakování nadpisu:** ano. Dlaždice „Doprava zdarma · Aktivní · Doprava zdarma od 1 000 Kč / 40 €“ a hned pod ní hlavička panelu se stejnými třemi údaji.
- **Angličtina:** texty sedí. Jen „Free gift Ponožky Won — M from CZK 1,500“ mixuje jazyk produktu a rozhraní, to je v pořádku.

## 4. Cesty A, B, C

Hodnotím cestu a texty, ukládání náhled neumí.

### A. Doprava zdarma od 1 500 Kč a dárek od 2 000 Kč

Přes průvodce (cesta, kterou appka nabízí):

1. Úvodní stránka → „Pokračovat v průvodci“.
2. Krok 1: zaškrtne „Doprava zdarma nebo dárek“, Pokračovat.
3. Krok 2: tři slevy ze Shopify, musí se rozhodnout, jestli přesouvat. Zaváhání: text o odinstalaci a záloze.
4. Krok 3: „Otevřít editor tématu“, tam zapnout a uložit, vrátit se.
5. Krok 4: vybere „Doprava zdarma“. Otevře se editor slevy s 1 500 Kč / 60 €. Uloží.
6. Krok 5: „Hotovo“. Dárek nikde. **Tady končí bez pomoci.**

Přímo (když Odměny najde):

1. Úvodní stránka → dlaždice Odměny.
2. Přepínač „Nabízet dopravu zdarma od částky“. Objeví se 2 pole a 2 červené věty (N9).
3. Vyplní 1500. U EUR zaváhá: kolik? Appka nenapoví.
4. Dlaždice „Dárek zdarma“ → „Přidat dárek“ → 2 pole, „Vybrat dárek“ (výběr produktu).
5. Zaváhání: „Práh dárku“, přepínač „Do prahu dárku počítat i ostatní slevy“ s pěti řádky vysvětlení.
6. „Uložit“. Neví, jestli se uložila i doprava z první dlaždice (ano, ale nic to neříká).

Rozhodnutí: 4 částky, 1 produkt, 1 přepínač. Čas: **3 až 4 minuty přímo**, přes průvodce 5 až 7 minut a bez dárku. Předvyplnit by šlo: obě částky v CZK, částky v EUR jako návrh.

### B. Aby to zákazník viděl v košíku a na stránce produktu

1. Odměny → dlaždice „Odměny na webu“. Nic ho tam po uložení nepošle (N10).
2. Košík: když v průvodci zapnul Won v tématu, je hotovo. Jinak „Zapnout v tématu“ → editor tématu → uložit → zpět.
3. Stránka produktu: „Přidat do tématu“ → editor tématu → uložit → zpět.
4. Úvodní stránka webu: totéž potřetí.
5. Pruh nahoře: hledá anglickou volbu v nastavení aplikace (N7).

Čas: **4 až 6 minut**, tři až čtyři návštěvy editoru tématu. Vzdá to nejspíš u pruhu nahoře. Tabulka množstevních slev na produktu je v jiném modulu, o tom se tady nedozví.

### C. Jistota, že to běží

1. Úvodní stránka: „Stav v obchodě · Aktivní · Slevy platí na webu i v pokladně“. To je dobrá odpověď, ale svítí i u prázdného obchodu (N5).
2. Dlaždice „Aktivní“. Lže u dárku bez EUR (N2).
3. „Vyzkoušet košík“ je na Free zamčené (N11).

Čas: 10 vteřin na pohled, ale jistotu nezíská. Na Free mu nezbývá než jít na web a nakoupit, což mu appka neporadí.

### Co vyřeší plánované Milníky

- **Vyřeší:** dvě dlaždice a dva formuláře se spojí do jednoho žebříčku. Náhled žebříčku nahradí čtení pravidel. Sekce „Kde je to vidět na webu“ se štítky je stejný vzor jako dnes.
- **Nevyřeší:** průvodce dál povede k receptu slevy (N1), pokud se krok 4 nepřepojí. Po uložení dál chybí „co dál“ (N10). Čtyři umístění znamenají čtyři návštěvy editoru tématu. Ověření na Free (N11) zůstává.
- **Zhorší:** počet polí s částkou, viz další kapitola.

## 5. Více trhů a měn

### Co je v kódu

- Částky se ukládají **podle měny**, ne podle trhu (`MoneyByCurrency` v `packages/core/src/discounts/config/types.ts`: sleva, minimum, práh dárku, doprava, částka za kus). Dva trhy se stejnou měnou (Slovensko a Německo v EUR) nemůžou mít různou částku.
- Pole ve formulářích vznikají z `currencyViews()` (`apps/won-discounts/app/components/model/markets.ts`): měny zapnutých trhů z nastavení, jinak měna obchodu.
- Seznam trhů v nastavení nic neplní (T1). Ověření:

```
cd ~/Development/WonCommerce/Apps/b2b_b2c && grep -rn "markets: \[\|sanitizeMarkets\|handle: .*currency" packages/core/src/discounts apps/won-discounts/app --include='*.ts' --include='*.tsx' | grep -v "\.test\."
```

  Vypíše jen výchozí `markets: []`, kontrolu tvaru a vzorová data náhledu.
- Kontrola změny trhů (`marketCountriesChanged`) běží jen u obchodů, které cílí slevu na trh, a porovnává jen země u trhů, které už aplikace zná. Nový trh nepřidá.
- Přepočet kurzem aplikace někde má (ochrana marže přepočítává hranici „kurzem Shopify“). Kde přesně kurz bere, jsem nedohledával.

### Počty polí: obchod se třemi trhy a třemi měnami

| Místo | Polí s částkou | Poznámka |
|---|---|---|
| Odměny, Free (doprava + 1 dárek) | 6 | 2 × 3 |
| Odměny, Pro (doprava + 2 prahy jako ve vzorových datech) | 9 | |
| **Milníky, Free (2 stupně)** | 6 | |
| **Milníky, Pro (6 stupňů)** | **18** | víc než dnes |
| Sleva pevnou částkou s minimální útratou | 6 | na každou slevu |
| Sleva v procentech s minimální útratou | 3 | |
| Množstevní sleva částkou, 3 úrovně | 9 | každá výjimka dalších 9 |
| Kampaň, na každou měněnou slevu částkou | 3 | |
| Výprodej | 1 + zaškrtnutí ceníků | procenta, dobrý vzor |
| Cílení na trhy | zaškrtnutí | |
| Vyzkoušet košík | 1 výběr | |

Obchodník s dopravou, dárkem, jednou slevou částkou a množstevní slevou částkou vyplní 21 polí, z toho 14 je „totéž v jiné měně“.

### Odpovědi po místech

- **Pozná, že mu něco chybí?** U pole ano, vždy červenou větou. Na dlaždici jen u slev („v EUR se nenabízí“ v popisu). Na úvodní stránce jen u slev. U dárku, dopravy a úrovní nikde mimo pole (N2).
- **Co to znamená pro zákazníka:** věta „v tomto trhu se odměna nenabízí“ je správná a poctivá. U slevy „Zákazníci s touto měnou slevu nedostanou“ taky.
- **Jedna hodnota a návrh ostatních:** neexistuje nikde. Jediné předvyplnění je recept dopravy zdarma (1 500 Kč / 60 €, natvrdo v `rule-form.ts`, pro 5 měn).
- **Trh, nebo měna:** míchá se. Pole „Od částky v EUR“, chyba „V měně EUR (Slovensko)… v tomto trhu“, úvodní stránka „se v EUR nenabízí“, editor „Zákazníci s touto měnou“, cílení „Jen ve vybraných trzích: Česko, Slovensko“, výprodej „Ceníky trhů s pevnou cenou: Slovensko (EUR)“, košík „Trh a měna: CZK · Česko“. Obchodník myslí „Slovensko“, appka mu většinou říká „EUR“.
- **Jeden trh:** podle kódu uvidí jedno pole „Od částky v CZK“ a věta o více měnách se neukáže. V náhledu není stav s jedním trhem, neověřeno.
- **Čtvrtý trh přidaný v Shopify:** aplikace se o něm nedozví (T1). I po opravě T1 by se dozvěděl jen u slev, ne u odměn a úrovní (N2).
- **Jedno místo se všemi trhy vedle sebe:** není. Nastavení má jednu větu (N15).
- **Vypnutý trh:** editor slevy to řeší dobře („Uloženo i pro HUF: 3 000 HUF. Trh je vypnutý, hodnota zůstává.“). Kampaň se na HUF ptá (N14).

### Návrhy

| # | Návrh | Rozsah |
|---|---|---|
| 1 | **Načíst trhy ze Shopify.** Při otevření aplikace přečíst aktivní trhy a jejich měny, zapsat do nastavení. Nový trh = upozornění na úvodní stránce: „Přibyl trh Maďarsko (HUF). Doprava zdarma, dárek a 2 slevy v něm zatím neplatí. Doplnit.“ | Zásah do dat: nový zápis do nastavení, čtení trhů při načtení, oprávnění `read_markets` pro všechny, ne jen pro cílení. |
| 2 | **Jedno pole + návrh.** Obchodník vyplní částku v měně obchodu. Pod ní řádek pro každý další trh: „Slovensko: navrhujeme 60 € (kurz 25,1, zaokrouhleno) [Použít] [Zadat jinou]“. Nic se neuloží bez kliknutí, takže rozhodnutí „žádný tichý přepočet“ platí. Zaokrouhlení na hezká čísla (5, 10, 50). | Úprava formuláře. Jedna sdílená součástka pro Odměny, Milníky, editor slevy, úrovně, kampaně. Potřebuje kurz, který aplikace už pro marži používá. |
| 3 | **Popisky podle trhu.** „Slovensko (EUR)“ místo „Od částky v EUR“. Při dvou trzích se stejnou měnou „Slovensko, Německo (EUR)“. Všude stejně, slovo „měna“ jen v závorce. | Úprava textů a popisků. |
| 4 | **Přehled po trzích v Nastavení → Trhy a měny.** Řádek = trh, sloupce = Doprava zdarma, Dárek (po Milnících stupně), Slevy, Množstevní slevy. V buňce částka nebo červeně „chybí“ s odkazem na pole. Vypnuté trhy šedě pod čarou. Na dlaždici Nastavení „3 trhy · v 1 něco chybí“. | Úprava obrazovky, data už aplikace má. Závisí na návrhu 1. |
| 5 | **Chybějící trh jako věc k vyřešení všude.** Dárek, doprava, úrovně a výjimky se počítají stejně jako slevy: číslo na dlaždici, řádek na úvodní stránce, odkaz na pole. | Úprava výpočtu stavu (`module-status.ts`) a seznamu upozornění. Data se nemění. |
| 6 | **Milníky: částky v tabulce.** Řádek = stupeň, sloupec = trh. Vyplní sloupec Česko, tlačítko „Navrhnout ostatní trhy“ doplní zbytek k potvrzení. 18 polí se změní na 6 vyplněných a jedno potvrzení. | Úprava formuláře, součást dávky D. |
| 7 | **Chyby až po pokusu.** Červená věta o chybějící částce až po opuštění pole nebo uložení (N8, N9). | Úprava formuláře. |
| 8 | **Různá částka pro dva trhy se stejnou měnou.** | Zásah do ukládání dat i do pokladní funkce. Nedoporučuju teď, stačí to říct větou u pole. |

Doporučené pořadí: 1, 5, 3, 2 + 6 spolu s Milníky, 4, 7.

## 6. Slovníček žargonu

| Slovo v rozhraní | Kde | Čím nahradit |
|---|---|---|
| téma, „V tématu“, „Chybí v tématu“ | štítky umístění, Odměny, Množstevní slevy | „Na webu“, „Na webu chybí“ |
| editor tématu, šablona, „nastavení aplikace v šabloně“ | průvodce krok 3, Odměny na webu | „úprava vzhledu obchodu v Shopify“ |
| blok | „můžete umístit blokem“, „Blok jde v editoru přesunout“ | „prvek na stránce“ |
| Synchronizace se Shopify, „Synchronizovat znovu“ | Stav v obchodě | „Slevy zapsané v Shopify“, „Zkusit zapsat znovu“ |
| „Uloženo a zapsáno do Shopify“, „Nezapsáno“, „nezapsaná“ | po uložení, editor slevy, dlaždice | „Uloženo, sleva platí“, „Uloženo, zatím neplatí“ |
| práh, „1. práh“, „Počítání prahu“, „žebřík prahů“ | Odměny | „částka“, „1. stupeň“, „Co se počítá do částky“ |
| recept | průvodce, Slevy a kódy | „hotová sleva“, „vzor“ |
| pokladna | všude | ponechat, ale u prvního výskytu „pokladna (poslední krok objednávky)“ |
| cílení, segment | editor slevy, úvodní stránka | „pro koho platí“, „skupina zákazníků“ |
| „Neověřeno“ | Stav v obchodě | „Nepodařilo se zjistit“ |
| ceník trhu s pevnou cenou | Výprodej | „trh s vlastní cenou“ |
| varianta | Výprodej, dárek | „provedení produktu (velikost, barva)“ |
| marže, nákupní cena, strop slevy | Ochrana marže | marže ponechat, „strop slevy“ → „nejvyšší sleva“ |
| „Slevy mimo Won“, „Won s nimi nepočítá“ | úvodní stránka, průvodce | „Slevy vytvořené přímo v Shopify. Won o nich neví.“ |
| „Show reward progress at the top of the store“ | Odměny na webu | přeložit |
| „could not create … Code must be unique“ | selhaný zápis | odstranit |
| product.bundle | Množstevní slevy, Tabulka na webu | „jen u produktů se šablonou Sada“ |
| „Krok se nepodařil. Won ho zkouší znovu sám.“ | Výprodej | „Cenu se nepodařilo vrátit. Zkoušíme to znovu.“ |
| „Pro funkce není aktivní — v pokladně se neuplatní“ | Odměny, editor slevy | „Tohle je v tarifu Pro, zákazník to nedostane“ |

## 7. Co funguje dobře a nemá se měnit

- Dlaždice se dvěma řádky (co to je, co mám nastavené) a jednou sadou štítků napříč appkou.
- Řádek stavu počítaný ze skutečného nastavení: „Od 3 ks −10 %, od 5 ks −15 %, od 10 ks −20 %“.
- Upozornění na úvodní stránce s tlačítkem, které vede přímo na pole („Doplnit hodnotu“).
- Věta u pole, která říká důsledek pro zákazníka: „v tomto trhu se odměna nenabízí“.
- Editor slevy: „Co uvidí zákazník“ po měnách (CZK … / EUR nenabízí se).
- Vypnutý trh v editoru slevy: hodnota zůstává, jde odebrat.
- Výprodej v procentech se zaškrtnutím ceníků trhů: jedno číslo pro všechny trhy.
- Štítky umístění s tlačítkem „Přidat do tématu“ přímo v řádku (až na slovník).
- Zamčené Pro dlaždice: jantar, věta k čemu to je, vedou na stránku.
- Vyzkoušet košík (Pro): důvod u každé slevy, proč se uplatnila nebo ne.
- Žádný vodorovný posuv na 390 px na žádné z obrazovek.

## 8. Co jsem nemohl ověřit

- **T1 naživo.** Že seznam trhů zůstává prázdný, plyne z kódu. V ostrém obchodě se dvěma trhy jsem to neviděl.
- Skutečný Shopify admin, editor tématu a to, co udělají tlačítka „Přidat do tématu“.
- Ukládání: náhled nic neukládá. Stavy po uložení jsem viděl jen jako připravené (`?result=saved`).
- Výběr cíle v průvodci kliknutím (v náhledu se mi zaškrtnutí nepodařilo vyvolat). Krok 4 pro cíl „Doprava zdarma nebo dárek“ jsem ověřil přes `onboarding?step=4` a v kódu (`firstRecipe`).
- Obchod s jedním trhem a obchod se dvěma trhy ve stejné měně: v náhledu takový stav není.
- Výběr produktu pro dárek (okno Shopify).
- Tmavý okraj některých dlaždic (N18): vidím ho na screenshotu, příčinu v kódu jsem nenašel.
- Anglicky jsem prošel jen úvodní stránku a Odměny.
- Časy cest jsou odhad z počtu kroků, ne měření s člověkem.
