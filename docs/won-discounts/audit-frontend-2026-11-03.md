# Won Discounts — audit frontendu (UX, DX, AX) · fáze 1

Datum: 2026-11-03 · větev `won-discounts-frontend-audit` · jen analýza, produkční kód beze změny.
Měřítko: Linear a Apple Notes (jasnost, konzistence, zdrženlivost, předvídatelnost).

Důkazy: [`evidence/frontend-audit-2026-11-03/`](evidence/frontend-audit-2026-11-03/) (screenshoty 1440 a 390 px,
`metrics.json`, skripty `capture.mjs` a `keyboard.mjs`, spustitelné proti běžícímu harnessu).

## 0. Jak audit vznikl a co platí jako dané

**Metoda.** Všech 22 stavů obrazovek z dev harnessu (`/dev/preview/<obrazovka>`, skutečné komponenty
nad fixtures, bez Shopify) projetých Playwrightem v 1440 a 390 px. Na každé obrazovce se změřil počet slov,
tlačítek, polí, inline stylů, výška a vodorovný přetok. Na čtyřech obrazovkách proběhl průchod tabulátorem.
Kód je čtený vedle screenshotů. Baseline testů je níž v oddílu 6.

**Rozhodnutí, která audit nepřebíjí** (Ondřej, 2026-10-07 až 10-31):

- Domovská stránka: karty ve skupinách Slevy, Akce, Kontrola, Nastavení, název v modrém štítku, stav vpravo nahoře.
- Dlaždice ukazují „Aktivní“, dlaždice Pro částí ukazují „Pro“ i na tarifu Pro.
- Slevy a Milníky: věta, Nová sleva jako seznam, pod ním tabulka se záložkami, hledáním, filtrem a řazením.
- PageGuide (věta, tři kroky, ukázka, jde skrýt) zůstává na 9 obrazovkách. Zadání auditu chce škrtat vysvětlující
  texty. Tady má přednost Ondřejovo rozhodnutí, audit proto škrtá jen **duplikáty pod PageGuide**, ne PageGuide samotný.
- Umístění na webu: varianta X („Jiné místo“ + hlavní akce).
- Klidný vzhled Shopify adminu: žádné barevné plochy, vlastní písma ani velká typografie jako efekt.
- Každá stránka jde proklikat z menu, postranní menu má nejvýš 5 položek.

**Co se ověřit nedalo:** Save Bar App Bridge (v harnessu bez Shopify se nezobrazuje, chyba
`missing required configuration fields: shop` je omezení harnessu), skutečná data obchodu, billing naživo,
čtečka obrazovky, měření kontrastu. Kde nález stojí na neověřeném chování, je to u něj napsané.

---

## A. Celkové hodnocení

| Osa | Stav | Jedna věta |
|---|---|---|
| UX | Funkčně bohaté, místy přeplněné | Jednotlivé obrazovky fungují, ale tentýž stav, tentýž upsell a tentýž výklad se na jedné obrazovce opakují 2–4×. |
| DX | Dobrá kostra, rozbitá povrchová vrstva | Tenké routy a čisté modelové funkce s testy jsou vzorové; styly a ovládací prvky ale obcházejí vlastní shell. |
| AX | Dohledatelné, ale drahé na orientaci | Vrstvy jsou předvídatelné, jenže pojmy mají tři jména a komentáře a testy odkazují na kola feedbacku místo na pravidla. |

**Tři systémové slabiny**

1. **Stav nemá jednoho vlastníka na obrazovce.** Dlaždice, hlavička sekce, řádek i banner si každý vykreslí stav
   sám. Výsledek: „3 věci k vyřešení“ třikrát na přehledu, „Aktivní“ třikrát u množstevní slevy. Doktrína §6/§11d
   říká „ukaž stav jednou“, ale nic to v kódu nevynucuje.
2. **Na stránce je víc formulářů a víc „Uložit“.** Save Bar, `PageSave` a samostatný formulář „Sčítá se s“
   (`ModuleCombine` → `/app/combine`) vedle sebe. Obchodník nevidí, co které tlačítko uloží. Dokumentace si
   navíc odporuje (oddíl C, F3).
3. **Vzhled žije v obrazovkách, ne v shellu.** 643× `style={{…}}`, 121 barev natvrdo mimo `tokens.ts`,
   ~110 surových `<button>/<input>`, tři různé implementace štítku. Každá úprava vzhledu se proto dělá po
   obrazovkách a obrazovky se rozjíždějí.

**Silné stránky, které se nesmí rozbít**

- Routy `app.*` mají 20–64 řádků: loader/action, autentizace a předání do `lib/integration/*.server.ts`.
- `components/model/*` jsou čisté funkce (stav slevy, popisy, formuláře) s unit testy.
- Harness pokrývá všechny obrazovky a jejich stavy a 48 E2E testů nad ním je zelených.
- Žádná z 22 obrazovek nemá vodorovný přetok na 390 px.
- Všechno klikací je dosažitelné tabulátorem a má viditelný fokus (ověřeno na Přehledu, Slevách,
  Množstevních slevách a Výprodeji).

---

## B. Inventura frontendu

**Stack:** React Router 7 (`@react-router/fs-routes`), Polaris web komponenty (`s-*`), App Bridge
(`@shopify/app-bridge-react`), vlastní i18n (cs/en, 2 527 klíčů v jednom souboru na jazyk), bez CSS frameworku.

**Vrstvy**

| Vrstva | Kde | Co dělá |
|---|---|---|
| Routy | `app/routes/app.*.tsx` | loader/action, `authenticate.admin`, předá do integrace. `app.looks` a `app.combine` jsou jen akce, `app.appearance` jen přesměruje. |
| Integrace (hranice backendu) | `app/lib/integration/*.server.ts` (39 souborů) | čtení a zápisy do Shopify a DB. **Mimo rozsah úprav.** |
| Obrazovky | `app/components/screens/*Screen.tsx` | rozvržení stránky, props z `build*Props`. |
| Části obrazovek | `rule-editor/`, `tiers/`, `margin/`, `looks/`, `rewards/`, `try-cart/` | sekce. Výprodej, Kampaně a Milníky vlastní složku nemají. |
| Shell | `app/components/shell/` (30 souborů) | `WonSection`, `ModuleTile`, `SubNav`, `PageGuide`, `PageSave`, `tokens.ts`… |
| Model | `app/components/model/` | čisté funkce: stavy, popisy, formuláře, plán. |
| Harness | `app/routes/dev.preview.$.tsx` (706 ř.) + fixtures | všechny obrazovky bez Shopify. |

**Navigace:** postranní menu (Přehled + nejvýš 5 položek, `@won/app-kit/admin-nav`) a pod „Slevy“ pruh šesti
záložek: Slevy a kódy, Množstevní slevy, Milníky, Výprodej, Kampaně, Umístění na webu.

**Obrazovky a hlavní úkoly**

| Obrazovka | Úkol obchodníka | Slov | Tlačítek | Polí | Inline stylů | Výška 1440 / 390 |
|---|---|---|---|---|---|---|
| Přehled | Co hoří, kam dál | 425 | 13 | 0 | 120 | 2 028 / 3 117 |
| Onboarding | První nastavení v 5 krocích | 66 | 16 | 1 | 91 | 900 / 900 |
| Slevy a kódy | Najít slevu, založit novou | 242 | 0* | 0 | 128 | 1 201 / 1 393 |
| Editor slevy | Upravit jednu slevu | 359 | 12 | 26 | 158 | 2 608 / 3 389 |
| Množstevní slevy | Úrovně, tabulka na webu | 374 | 19 | 18 | 318 | 1 611 / 2 507 |
| Milníky | Stupně košíku | 370 | 32 | 26 | 667 | 1 956 / 2 312 |
| Výprodej | Doprodat kusy | 333 | 20 | 12 | 461 | 1 803 / 2 528 |
| Kampaně | Časová akce | 230 | 22 | 14 | 240 | 1 367 / 1 756 |
| Ochrana marže | Hranice marže | 236 | 14 | 3 | 237 | 1 000 / 1 848 |
| Vyzkoušet košík | Ověřit kombinace | 143 | 2 | 1 | 75 | 962 / 1 245 |
| Přehledy | Výsledky slev | 141 | 1 | 0 | 105 | 900 / 1 243 |
| Překlady | Texty na webu | 510 | 5 | 76 | 410 | 3 175 / 5 237 |
| Umístění na webu | Kde se prvky ukazují | 207 | 19 | 0 | 191 | 1 510 / 2 204 |
| Nastavení | Kombinování, trhy, tarif | 621 | 19 | 12 | 170 | 3 242 / 4 220 |

\* řádky seznamu jsou `s-clickable`, ne tlačítka. Plná data v `metrics.json`.

**Sdílené vzory:** `WonSection` (sekce se stavem), `ModuleTile`/`ViewTile` (dlaždice přepínající pohled),
`PageGuide`, `PickList`, `SegmentedChoice`, `StatusPill`, `ProSell`/`ProFrame`/`PlanBadge`/`GateNotes`
(33 souborů je používá), `CombineTypes`/`ModuleCombine` („Sčítá se s“ na 5 místech).

---

## C. Nálezy

Řazení: dopad na obchodníka × četnost × závažnost. Složitost S/M/L. Riziko regrese N/S/V.

### P1 — opravit jako první

**F1 · Náhled „Váš obchod“ v Nastavení lže** · potvrzeno

- **Kde:** Nastavení, PageGuide vpravo nahoře. `app/i18n/cs.ts:2592-2597`, `app/components/shell/PageGuide.tsx:124`.
- **Teď:** ukazuje „Tarif Pro · 2 trhy · Kombinování Nastaveno“ natvrdo v překladech. Obchod na Free vidí
  nahoře „Pro“ a o 1 500 px níž „Máte tarif Free“ (`settings-1440.png`).
- **Kořen:** ukázka PageGuide je u Nastavení jediná, která vypadá jako fakt o obchodě, a přitom je statická.
  Porušuje §5 a §12 („nic, co vypadá jako fakt, nesmí být vymyšlené“).
- **Návrh:** předat do PageGuide skutečné hodnoty ze `SettingsScreen` (tarif, počet trhů, stav kombinování),
  nebo nadpis ukázky změnit tak, aby nevypadal jako stav obchodu.
- **Zlepšení:** UX pravdivý stav · DX jeden zdroj hodnot · AX žádná past „hodnota v překladech“.
- **Dopad V · složitost S · riziko N.**
- **Ověření:** unit test PageGuide s `plan: "free"` neobsahuje „Pro“. Screenshot `settings?plan=free` a `?plan=pro`.

**F2 · Tentýž stav 2–4× na jedné obrazovce** · potvrzeno

- **Kde:**
  - Přehled: karta „Vyžaduje pozornost“ (2 velké karty + „A ještě 1 věc“), dlaždice Slevy a kódy
    s „3 věci k vyřešení“ a červeným rámečkem.
  - Slevy a kódy: „3 slevy vyžadují pozornost“ v hlavičce, záložka „Vyžaduje pozornost 3“, červená věta v řádku.
  - Množstevní slevy: dlaždice „Pro celý obchod · Aktivní“, nadpis sekce a řádek „Množstevní sleva pro celý obchod
    · Aktivní“ (3× stejný text a stav).
  - Výprodej: štítek „Vyžaduje pozornost“ na dlaždici, sekce „K vyřešení“, červený rámeček karty, červená věta
    v kartě. Stejná chyba „Cenu se nepodařilo změnit“ je tam dvakrát.
  - Ochrana marže: dlaždice „Hranice“, nadpis sekce „Ochrana marže“ a podnadpis opakující větu PageGuide.
- **Proč vadí:** obchodník čte stejnou informaci znovu a hledá, jestli jde o jinou věc. U Přehledu je navíc
  stejná věta „nemá hodnotu pro Slovensko“ ve dvou velkých kartách místo jednoho řádku „2 slevy nemají částku pro Slovensko“.
- **Kořen:** každá komponenta (dlaždice, `WonSection` summary, řádek, banner) skládá stav sama. Pravidlo
  „stav jednou“ (§6/§11d) není zakódované, jen popsané.
- **Návrh:** pro každou obrazovku jeden vlastník stavu.
  - Přehled: „Vyžaduje pozornost“ jako seznam řádků se seskupením stejné příčiny („2 slevy nemají částku pro
    Slovensko · Doplnit“). Dlaždice ukazuje jen štítek stavu, počet je v seznamu.
  - Slevy: počet jen v záložce, věta v hlavičce pryč.
  - Moduly s dlaždicí: když dlaždice nese stav, sekce pod ní ho neopakuje, nadpis sekce neopakuje název dlaždice.
  - Seskupení stejných příčin patří do `model/` (čistá funkce + test), ne do obrazovky.
- **Zlepšení:** UX kratší a jasnější · DX jedna funkce místo čtyř skládání · AX pravidlo v kódu, ne v próze.
- **Dopad V · složitost M · riziko S** (texty hlídají E2E testy, budou se upravovat).
- **Ověření:** na každé obrazovce harnessu se text stavu („Aktivní“, „Vyžaduje pozornost“, „N věci k vyřešení“)
  pro tutéž věc objeví nejvýš jednou (Playwright počítá výskyty). Výška Přehledu na 390 px klesne pod 2 600 px.

**F3 · Víc „Uložit“ na stránce a nejasné, co které uloží** · potvrzeno v kódu, chování Save Baru neověřeno

- **Kde:** Množstevní slevy, Milníky, Výprodej (dva „Uložit“: jeden pro stránku, jeden pro „Sčítá se s“),
  Nastavení („Uložit“ uprostřed stránky mezi sekcemi, Trhy a Tarif pod ním jím ukládané nejsou), Editor, Marže,
  Překlady (`PageSave` pod obsahem).
- **Proč vadí:** obchodník změní úroveň i „Sčítá se s“ a klikne na jedno tlačítko. Neví, jestli se uložilo obojí.
  Neověřeno: jestli odeslání jednoho formuláře zahodí neuložené změny druhého (revalidace loaderu).
- **Kořen:**
  - `ModuleCombine` je samostatný `<Form>` s akcí `/app/combine`, nezávislý na formuláři stránky.
  - `PageSave` (`shell/PageSave.tsx`) přidává inline „Uložit“ vedle `data-save-bar`.
  - Dokumentace si odporuje: `ADMIN-UX-PRINCIPLES.md` §2 „Inline Save tlačítko se nepoužívá“ proti doktríně
    §18i („one form and one Save“) a kódu, který má obojí.
- **Návrh (doporučení):**
  1. Jeden formulář na stránku = Save Bar. Inline `PageSave` jen tam, kde Save Bar prokazatelně nestačí, a to zapsat jako výjimku.
  2. „Sčítá se s“ na stránkách modulů jako řádek „Sčítá se s · automatické slevy, kódy… · Upravit“ s modalem
     a vlastním uložením. Stejný vzor už má Milníky → Nastavení („Kde se milníky ukazují · Upravit“). Endpoint
     `/app/combine` zůstává beze změny.
  3. Sjednotit `ADMIN-UX-PRINCIPLES.md` §2 s výsledkem.
- **Zlepšení:** UX jedno uložení = jeden zřetelný okamžik · DX méně formulářů · AX jeden vzor místo tří.
- **Dopad V · složitost M · riziko S** (Save Bar a uncontrolled formuláře jsou citlivé, viz doktrína ř. 313–318).
- **Ověření:** na každé stránce nejvýš jeden viditelný submit mimo modal. E2E: změna úrovně + otevření a uložení
  „Sčítá se s“ v modalu nezahodí neuloženou úroveň. Ověřit ve skutečném adminu přes `shopify app dev` (Save Bar).
- **Potřebuje rozhodnutí** (oddíl 7).

**F4 · Upsell Pro opakovaný v jedné sekci** · potvrzeno

- **Kde:**
  - Editor slevy, sekce Kombinace a trhy: štítek „Pro · odemknout“ pod kolekcemi, žlutý box „S Pro povolíte…“,
    šedý zakázaný seznam „Výjimky“ se všemi slevami obchodu, „Jen ve vybraných trzích · Pro · odemknout“
    se zakázanými zaškrtávátky. To je 4× Pro v jedné sekci (`rule-edit-1440.png`).
  - Množstevní slevy a Milníky: výrazný žlutý banner „Tohle je v tarifu Pro, zákazník to nedostane“ přes celou šířku.
  - Výprodej: štítek Pro ve větě PageGuide, dlaždice „Nový výprodej · Pro · odemknout“ s větou „Výprodej je
    v tarifu Pro“ a věta „Tarif Free: běžící výprodeje doběhnou…“.
- **Kořen:** gating se skládá v každé sekci zvlášť (33 souborů s `ProSell`/`ProFrame`/`PlanBadge`/`GateNotes`),
  žádné pravidlo „jedna Pro zmínka na sekci“. §18h přitom říká: zamčená Pro funkce má jednu větu a odkaz.
- **Návrh:** jedna Pro poznámka na sekci (věta + odkaz na tarif). Zamčené ovládací prvky Pro funkcí na Free
  se nevykreslují, v poznámce je jen to, co Pro přidá. Banner „uložené Pro nastavení neplatí“ ponechat, ale
  jako běžný `s-banner tone="warning"`, ne plnou žlutou plochu. Dlaždice na Přehledu se štítkem Pro **zůstávají**
  (rozhodnutí 2026-10-07).
- **Dopad S · složitost M · riziko S.**
- **Ověření:** na `rule-editor?rule=dev-f2-collection` (Free) je v sekci Kombinace a trhy nejvýš jeden text
  „Pro“. Na Pro (`&plan=pro`) žádný zamčený prvek.

**F5 · Výklad pod PageGuide se opakuje nebo si odporuje** · potvrzeno

- **Kde:**
  - Ochrana marže: PageGuide ukazuje 1 000 Kč / nákup 500 / −60 % → 500 Kč, sekce pod ním „Příklad“
    1 000 Kč / nákup 600 / −50 % a obě pole mají třířádkovou nápovědu s dalším příkladem. Tři různé příklady
    na jedné obrazovce (`margin-1440.png`).
  - Překlady: věta PageGuide a hned pod ní odstavec, který říká totéž znovu.
  - Množstevní slevy: pod formulářem tři odstavce mechaniky (sčítání, marže, výprodej).
  - Editor slevy: kombinace vysvětlené odstavcem nad i pod zaškrtávátky.
- **Kořen:** PageGuide přibyl 2026-10-30 nad obrazovky, které už měly vlastní úvodní texty. Ty se neodstranily.
- **Návrh:** kde je PageGuide, pod ním žádný úvodní odstavec. Jeden příklad na obrazovku (u Marže ten živý
  v sekci, ukázka PageGuide přebere stejná čísla). Mechanika (sčítání, marže) jako jedna řádka s odkazem tam,
  kde se nastavuje.
- **Dopad S · složitost S · riziko N** (texty v E2E zkontrolovat).
- **Ověření:** počet slov na obrazovce (`metrics.json`) klesne u Marže, Překladů a Množstevních slev aspoň o 20 %.
  Žádná obrazovka nemá dvě různé číselné ukázky.

### P2 — konzistence a mobil

**F6 · Nápověda u polí jako odstavce** · potvrzeno

- **Kde:** Nastavení, „Zákazník ze země mimo vaše trhy“: přepínač se třířádkovou nápovědou a 5 selectů,
  každý s vlastní větou, i když přepínač je vypnutý a „teď se vás to netýká“ (věta úplně dole). Marže: pole
  s nápovědou na 3 řádky.
- **Kořen:** nápověda nahrazuje progresivní odhalení. Volby, které se netýkají, jsou vidět.
- **Návrh:** když se sekce obchodu netýká, sbalit ji na stavovou větu (§17) a volby ukázat až po rozbalení.
  U selectů nechat vysvětlení v textu voleb („Nejnižší z trhů (menší sleva)“), ne pod polem.
- **Dopad S · složitost S · riziko N.** · **Ověření:** výška Nastavení na 390 px klesne pod 3 500 px. Sbalená
  pole dál postují (§17d, hidden ne unmount), hlídá to existující test Save.

**F7 · Překlady: surový `<input type=file>` v angličtině** · potvrzeno

- **Kde:** Překlady → Export a import (`translations-1440.png`): „Choose File · No file chosen“, šedé tlačítko
  „Stáhnout CSV“ bez stylu Polaris.
- **Kořen:** porušení invariantu §1 („jen `s-*`“) a A5 (lokalizace).
- **Návrh:** `s-drop-zone` (nebo `s-button` + skrytý input) s českým popiskem, „Stáhnout CSV“ jako `s-button`.
- **Dopad S · složitost S · riziko N** (E2E „the CSV downloads, an upload is planned first“ musí zůstat zelený).

**F8 · Mobil: pruh záložek pod Slevy schová polovinu položek** · potvrzeno

- **Kde:** všech 6 stránek pod Slevy na 390 px (`discounts-390.png`). Vidět jsou 3 záložky, Výprodej, Kampaně
  a Umístění jsou za okrajem, posun nic nenaznačuje. V hlavičce „Vaše slevy“ se text dotýká okraje.
- **Návrh:** na úzké šířce pruh s jemným přechodem u okraje a aktivní záložkou posunutou do pohledu, nebo
  `s-select` „Slevy a kódy ▾“. Počet „vyžadují pozornost“ na mobilu zalomit pod nadpis.
- **Dopad S · složitost S · riziko N.** · **Ověření:** na 390 px je aktivní záložka vždy celá vidět a existuje
  viditelný náznak dalších položek. Screenshot 390 všech 6 stránek.

**F9 · Výprodej: položky jednoho seznamu ve dvou rozvrženích** · potvrzeno

- **Kde:** „Aktivní výprodeje“: Mikina jako řádek tabulky (Produkt, Cena, Zbývá, Konec, Na webu teď),
  Kšiltovka pod ní jako karta s červeným rámečkem a jiným uspořádáním údajů. Skončené výprodeje znovu jako karty.
- **Kořen:** jiná komponenta podle stavu položky. `OutletScreen.tsx` má 1 167 řádků a 8 formulářů.
- **Návrh:** jeden řádek výprodeje (stejné sloupce pro všechny stavy) s rozbalením detailu a historie.
  Problém = štítek stavu + věta v rozbalení, ne jiné rozvržení.
- **Dopad S · složitost M · riziko S.**

**F10 · Editor slevy: kroky „KROK x / 4“ u pěti sekcí** · potvrzeno vizuálně

- **Kde:** Editor (`rule-edit-1440.png`): Sleva 1/4, Podmínky 2/4, Jak se uplatní 3/4, Kdy platí 4/4,
  pak pátá sekce Kombinace a trhy bez čísla. U existující slevy je číslování kroků navíc zbytečné, nic se neprochází postupně.
- **Návrh:** číslovat jen u nové slevy, a pak všechny sekce. U úpravy jen názvy sekcí (boční „Na této stránce“ už navigaci řeší).
- **Neověřeno:** placeholder „YYYY-MM-DD“ u dat. Dává ho `s-date-field`, v harnessu chybí locale adminu. Ověřit ve skutečném adminu.
- **Dopad N · složitost S · riziko N.**

**F11 · „Neaktivní“ (červené) vs „Vypnuto“ (šedé)** · potvrzeno, potřebuje rozhodnutí

- **Kde:** Slevy a kódy, tabulka. „Neaktivní“ znamená „sleva je zapnutá, ale v pokladně se neuplatní“
  (červená), „Vypnuto“ znamená „obchodník ji vypnul“ (šedá). Česky to zní jako synonyma.
- **Omezení:** slovník dlaždic (Aktivní / vyžaduje pozornost / neaktivní) je rozhodnutý (2026-10-09). Tohle se týká řádků tabulky.
- **Návrh:** v tabulce „Neuplatní se“ místo „Neaktivní“, nebo sloučit do „Vyžaduje pozornost“ s větou v řádku.
- **Dopad S · složitost S · riziko S** (`rule-status.ts` a jeho testy, dokumentace `reference/` se generuje).

### P3 — vývoj a orientace (DX, AX)

**D1 · Vzhled obchází shell**

- **Měřeno:**
  - 643× `style={{…}}` v komponentách.
  - 121 hex barev v `.tsx` mimo `tokens.ts` (nejvíc `OutletScreen` 12, `SubCard` 9, `ModuleTile` 9).
  - Tři implementace štítku (`StatusPill`, `CardPill`, `Pill` ve `WonSection`), nikde `s-badge`.
- **Kořen:** `tokens.ts` exportuje barvy, ale obrazovky si skládají vlastní styly. Žádné pravidlo nehlídá, kde styl smí vzniknout.
- **Návrh:** styly jen v `shell/`. Obrazovky skládají shell komponenty, inline styl jen pro rozvržení (gap, grid).
  Jedna komponenta štítku `StatusBadge` (tón z `tokens.ts`). ESLint `no-restricted-syntax` na hex literál v
  `screens/` (nejdřív jako varování, ať se dá přecházet postupně).
- **Zlepšení:** DX změna vzhledu na jednom místě · AX jasné, kam styl patří.
- **Dopad (vývoj) V · složitost L · riziko S** (vizuální regrese → porovnání screenshotů před a po).
- **Ověření:** počet hex mimo `shell/` = 0. Počet `style={{` v `screens/` klesne aspoň na polovinu.
  Screenshoty harnessu před a po se liší jen tam, kde to bylo záměrem.

**D2 · Surové HTML ovládací prvky** · ~110 výskytů (`<button>`, `<input>`, `<select>`) navzdory invariantu §1

- Klávesnice a fokus fungují (ověřeno), takže nejde o přístupnost. Jde o konzistenci a „Built for Shopify“.
- **Návrh:** sepsat povolené výjimky (dlaždice přepínající pohled, segmentová volba, pokud Polaris ekvivalent
  nemá) a ty dát do shellu. Zbytek převést na `s-*`.
- **Dopad S · složitost M · riziko S.**

**D3 · Velké obrazovky bez vlastní složky**

- `OutletScreen` 1 167 ř., `CampaignsScreen` 811, `MilestonesScreen` 796, `TryCartScreen` 794. Mají stejný
  vzor jako editor slevy (sekce), jen bez rozdělení.
- **Návrh:** `screens/outlet/`, `screens/campaigns/`, `screens/milestones/` se sekcemi podle `rule-editor/`.
  Dělit až při skutečné úpravě dané obrazovky, ne naprázdno.
- **Dopad N (uživatel) · složitost M · riziko S.**

**X1 · Jeden pojem, tři jména**

- Milníky = `rewards` (route, složka) = `milestones` (obrazovka, model). Výprodej = `outlet`.
  Množstevní slevy = `tiers`. „Sčítá se s“ = `combine` / `combination` / `CombineTypes` / `ModuleCombine`.
  Vzhled = `looks` / `appearance`.
- **Návrh:** jeden glosář (CZ název → kódové jméno → route → obrazovka → model → testy), krátká tabulka
  v README appky. README má teď nadpis „App template“ a frontend vůbec nepopisuje. Přejmenovávat soubory
  jen tam, kde se stejně sahá (jinak zbytečné riziko).
- **Ověření:** agent podle README najde k libovolné položce menu všechny soubory bez hledání.

**X2 · Komentáře a testy pojmenované podle historie**

- 145 komentářů v `app/` odkazuje na kola feedbacku („bod 13“, „nález 7“, „7th round“). Testy
  `kolo3-a.test.ts`, `kolo3-c.test.ts`, `feedback-2026-10-12.test.ts`, `audit-2026-10-06.test.ts`,
  `pred-review.test.ts`, `admin.feedback-2026-10-09.spec.ts`, `admin.pred-review.spec.ts`.
- **Proč vadí:** agent ani nový vývojář z názvu nepozná, jakou funkci test chrání, a odkaz „nález 7“ nevede nikam.
- **Návrh:** testy přejmenovat a přeskupit podle funkce (`outlet.test.ts`, `rule-editor.spec.ts`…).
  Komentář říká pravidlo a odkaz na § doktríny, historie patří do gitu.
- **Dopad N · složitost S–M · riziko N** (jen přesuny, obsah testů stejný. Ověří se stejným počtem testů před a po).

**X3 · Dva zdroje pravidel si odporují**

- `ADMIN-UX-PRINCIPLES.md` §2 proti kódu a doktríně (F3). §1 „nikdy surové HTML“ proti D2.
- **Návrh:** po rozhodnutí F3 a D2 opravit dokument, ať popisuje skutečnost.

---

## D. Cílová architektura frontendu

Zachovat vrstvy, zpřísnit hranice. Nic nového nepřidávat.

```
routes/app.*.tsx            loader/action, ≤ ~70 ř., beze změny kontraktu
lib/integration/*.server.ts hranice backendu, NEMĚNIT
components/
  screens/<feature>/        <Feature>Screen.tsx + sekce; jen skládání shellu, žádné barvy
  shell/                    JEDINÉ místo se styly: WonSection, Row, Tile, StatusBadge, ProNote,
                            PageGuide, SubNav, tokens.ts
  model/                    čisté funkce: stav, popis, seskupení problémů, formuláře (+ unit testy)
i18n/                       cs.ts, en.ts (beze změny struktury)
routes/dev.preview.$.tsx    harness, každá obrazovka a stav
```

**Pravidla struktury**

1. Stav položky počítá `model/` a obrazovka ho vykreslí jednou (F2).
2. Jedna stránka = jeden formulář = Save Bar. Další zápisy přes modal s vlastním uložením (F3).
3. Styl vzniká jen v `shell/` z `tokens.ts` (D1).
4. Ovládací prvky jsou `s-*`. Výjimky jsou komponenty v `shell/` se zdůvodněním (D2).
5. Složka obrazovky se jmenuje kódovým jménem z glosáře (X1).
6. Testy se jmenují podle funkce (X2).

**Design systém** = Polaris web komponenty + `shell/` + `tokens.ts`. Žádná nová knihovna ani CSS framework.

---

## E. Zásady UX a designu (vynutitelné)

| # | Zásada | Jak se kontroluje |
|---|---|---|
| E1 | Stav jedné věci se na obrazovce objeví jednou. | Playwright počítá výskyty textu stavu na harnessu. |
| E2 | Jeden viditelný submit na stránku (mimo modal). | Playwright: `[type=submit]:visible` mimo `s-modal` ≤ 1. |
| E3 | Nejvýš jedna zmínka Pro na sekci. Dlaždice Přehledu jsou výjimka. | Playwright na Free i Pro stavech. |
| E4 | Pod PageGuide není další úvodní odstavec, na obrazovce je jedna číselná ukázka. | Review + test PageGuide. |
| E5 | Nic, co vypadá jako fakt o obchodě, není natvrdo v překladech. | Unit test: ukázky PageGuide bez stavových hodnot. |
| E6 | Volby, které se obchodu netýkají, jsou sbalené za stavovou větou. | Review, výška stránky v `metrics.json`. |
| E7 | Pořadí obrazovky: co se tu dělá → co mám → nové → nastavení. | Review (platí rozhodnutí Slevy/Milníky). |
| E8 | Barva = význam (modrá vybráno, zelená běží, červená pozornost, jantar Pro, oranžová naplánováno), nic dekorativního. | Lint hex mimo `shell/`. |
| E9 | 390 px: žádný vodorovný přetok, aktivní záložka vidět, dotykové cíle ≥ 44 px. | `sideways` v `metrics.json` = 0, test pruhu. |
| E10 | Klávesnice: všechno klikací je dosažitelné a má viditelný fokus. | `keyboard.mjs` (dnes zelené). |
| E11 | Zpětná vazba: uložení, chyba i načítání mají stav, nikdy nekonečné načítání (REL-1). | Existující výsledky `?result=` v harnessu. |

---

## F. Plán implementace (fáze 2, po schválení)

Každá etapa je samostatný commit nebo PR, má vlastní důkaz a nezačíná, dokud předchozí není zelená.

| Etapa | Obsah | Nálezy | Závislost | Důkaz |
|---|---|---|---|---|
| 0 · Pojistky | `capture.mjs` jako baseline před a po. Glosář a mapa frontendu v README. Přejmenování testů podle funkce. Lint hex jako varování. | X1, X2, D1 (lint) | — | stejný počet testů před a po, baseline screenshoty |
| 1 · Pravdivost a rozbité kusy | Skutečné hodnoty v náhledu Nastavení, Polaris upload v Překladech, pruh záložek na mobilu, kroky v editoru. | F1, F7, F8, F10 | 0 | unit test F1, E2E Překladů, screenshoty 390 |
| 2 · Stav jednou | Seskupení problémů v `model/`, Přehled, Slevy, Množstevní slevy, Výprodej, Marže. | F2 | 0 | E1 test, výšky stránek |
| 3 · Model ukládání | Po rozhodnutí: „Sčítá se s“ do modalu, `PageSave` jen jako výjimka, oprava `ADMIN-UX-PRINCIPLES.md`. | F3, X3 | rozhodnutí | E2 test, ruční ověření Save Baru v `shopify app dev` |
| 4 · Pro a výklad | Jedna Pro poznámka na sekci, škrty pod PageGuide, sbalené volby. | F4, F5, F6 | 2 | E3 a E4 testy, `metrics.json` slova −20 % |
| 5 · Konzistence | Jeden řádek výprodeje, `StatusBadge`, slovník stavu v tabulce slev. | F9, F11, D1 (štítky) | 2, rozhodnutí F11 | screenshoty, `rule-status` testy |
| 6 · Vzhled do shellu | Styly z obrazovek do `shell/`, výjimky pro surové HTML, rozdělení velkých obrazovek při dotyku. | D1, D2, D3 | 5 | hex mimo shell = 0, vizuální porovnání |

**Brána po každé etapě:** `npm run test:unit -w won-discounts`, `typecheck`, `lint`,
`WON_PREVIEW_BASE_URL=… npm run test:e2e:preview -w won-discounts`, `capture.mjs` 390 + 1440 a porovnání
s baseline, `docs/product-roadmap.html` podle AGENTS.md. Storefront se v žádné etapě nemění.

**Rizika:** Save Bar a uncontrolled formuláře (etapa 3). Texty, na které se odkazují E2E testy a generovaná
support dokumentace (`docs:gen`, drift test). Vizuální regrese bez porovnání screenshotů (etapa 6).

---

## 6. Baseline (stav 2026-11-03, větev odbočená z `main` 0ec065ee)

| Kontrola | Výsledek |
|---|---|
| `npm run test:unit -w won-discounts` | zelená (node testy exit 0, engine 720/720) |
| `test:e2e:preview` proti harnessu | 48/48 zelených (2,2 min) |
| 22 stavů obrazovek × 2 šířky | vše HTTP 200, vodorovný přetok 0 na všech |
| Tabulátor (4 obrazovky) | vše dosažitelné, fokus viditelný |
| `typecheck`, `lint`, `build` | nespuštěno v rámci auditu |

**Chování, které musí zůstat:** výběr typu nové slevy předvyplní editor. Tabulka slev filtruje, řadí a hledá.
Přesun nativních slev a „Vrátit zpět“. Jazyky v Překladech a CSV export/import s potvrzením. Výběr vzhledu
a barvy prvku jde jedním uložením. „Sčítá se s“ na modulech zapisuje přes `/app/combine`. Uložení
nesmí poslat skrytá pole jinak než dnes (§17d).

**Netestované chování:** Save Bar a hlídání odchodu ze stránky (jen ve skutečném adminu), souběh dvou formulářů
na jedné stránce, billing tok, čtečka obrazovky, kontrast.

---

## 7. K rozhodnutí před fází 2

1. **Model ukládání (F3):** souhlas s „jeden formulář = Save Bar, Sčítá se s v modalu“?
2. **„Neaktivní“ v tabulce slev (F11):** přejmenovat na „Neuplatní se“, nebo sloučit do „Vyžaduje pozornost“?
3. **Surové HTML (D2):** povolit dlaždice a segmentovou volbu jako výjimky v shellu, zbytek převést?
4. **Pořadí etap:** začít etapou 0 + 1 (bez vizuálních změn kromě oprav), nebo rovnou 2 (Přehled)?
