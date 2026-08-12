# Admin UX standard pro Won appky

Interní inženýrská pravidla pro admin (embedded Polaris) **každé** Won appky.
Vznikla z reálných review Won Toasts. Když stavíš novou appku z templatu, projdi
si to jako checklist; každé pravidlo je závazné, dokud nemáš dobrý důvod se
odchýlit.

## Meta-princip: merchant-in, ne engineer-out

Nestav admin tak, že každé pole z konfiguračního schématu dostane svůj control.
To je pohodlné pro implementátora, ale merchant nechce vidět schéma — chce vidět
**výsledek**. Ptej se „jaký úkol tu merchant plní?", ne „jaká pole má ten model?".

**Reálné failure mody, které jsme si takhle vyrobili (a nesmí se opakovat):**
- 8 položek v levém menu u *notification appky*. → princip 7 (mělká IA).
- Pole `Ends at (ISO 8601, e.g. 2026-12-31T23:59:59Z)`, `Surface: banner`,
  `Evergreen window (hours)`, `durationMs`. → princip 4 (mluv výsledkem).
- Stránka s ~8 controly bez náhledu — „nevidím kde to bude ani jak to vypadá".
  → princip 3 (preview-first).
- Dvě status karty na overview, co říkají totéž („All done" + „Enabled"), a
  tlačítko nalepené bez odsazení. → princip 6 (jedna obrazovka, jedna akce).
- Zadrátované `cs/sk/en` jako jazyky produktu. → princip 5 (lokalizace = data).

Jednoduchost je feature. Když se nechce nastavení projít **tobě**, nemůžeš to
chtít po klientovi.

---

## 3. Preview-first — náhled je hrdina, ne příloha

Žádná obrazovka, která ovlivňuje storefront, nesmí existovat bez **živého
náhledu**, který ukazuje _kde_ to bude a _jak_ to vypadá. Náhled je vizuální
těžiště stránky; controly ho obsluhují.

- Layout: **preview nahoře/vedle** (sticky na širokém viewportu), pod ním/vedle
  ovládání. Ne preview schované na jiné stránce.
- Preview se aktualizuje **živě** z `new FormData(formRef.current)` na
  `onInput` (viz princip 2) — merchant vidí důsledek každé změny okamžitě.
- Preview a storefront sdílí **stejné render tokeny / stejnou logiku** z
  `@won/core` (jeden zdroj pravdy). Náhled, který lže, je horší než žádný.
- U prostorových voleb (pozice, umístění) je „preview" **klikací dummy obrazovka**
  s cílovými zónami, ne dropdown „top-right".
- Preview ukazuje **reprezentativní vzorek**, ne ovládací panel scénářů. Žádné
  přepínače „Add 1× / Remove / Mixed" nad náhledem — merchant chce vidět výsledek,
  ne řídit demo. Ukaž jednu bohatou scénu.
- Preview musí pokrýt **každou editovatelnou dimenzi**. Když merchant edituje 6
  akcentů (added/removed/increased/decreased/gift/shipping), náhled musí ukázat
  **všech 6** — nic editovatelného nesmí být v náhledu neviditelné, jinak ladí
  naslepo.

## 3c. Preview je samostatný sloupec vpravo a reflektuje VŠECHNO

- Preview žije v **dedikovaném pravém sloupci** (3sloupcový layout: picker |
  config | preview), je **sticky** a **pořád viditelný** při scrollu.
- **Každé** nastavení, které mění vizuál na storefrontu, se musí v preview
  projevit — pozice, surface (toast/banner/inline), barvy, density, text, obojí.
  Když merchant přepne surface z toast na banner a preview se nehne, je to **bug**,
  ne detail. „Co nemá živý preview, jako by nešlo nastavit."
- Když jedna stránka nastavuje víc věcí (recepty), pravý preview ukazuje **právě
  vybranou** věc s jejími živými hodnotami.

## 3d. Každé nastavení má vysvětlení — „vysvětluj jako pro hlupáka"

Merchant nesmí u pole hádat, co dělá. Každé nastavení má **jednořádkový helper**
(menším, subdued písmem **pod labelem**) nebo **`?` tooltip** u labelu.
- Předpokládej **nulovou znalost produktu**: merchant neví, co je „burst window",
  „stack order", „surface", „quiet mode". Napiš to lidsky a řekni i **proč/kdy** to
  chce zapnout a **co se stane**, ideálně s příkladem. Ne „Merge rapid changes",
  ale „Když nakupující rychle přidá víc věcí, sloučí se do jednoho toastu místo
  pěti — méně spamu.".
- Radši helper navíc než chybějící. I „zjevné" pole (Message, Threshold) dostane
  krátkou větu — co ho merchant sám musel domýšlet, to je chybějící vysvětlivka.
- Merchant nasnímal appku a napsal „vysvětli to jako pro hlupáky" → tohle je ten
  standard, ne výjimka.

## 3e. Preview animuje, když jde o čas/stacking

Když nastavení ovlivňuje **chování v čase** (jak dlouho je toast vidět,
auto-dismiss, stacking, grouping), preview to má **animovaně** ukázat ve smyčce —
toasty naběhnou, po `durationMs` zmizí, respektují stack order a max visible.
Statický obrázek nestačí, když merchant ladí právě timing.

## 3f. Metriky = grafy s barvou, ne holá tabulka

Analytics/Insights stránka musí být **vizuální**: barevné bar charty / sparkliny /
progress bary, ne černobílá tabulka čísel. Za holou tabulku merchant platit nechce.
Barva nese význam (dobré/špatné trendy), čísla mají doprovodný graf.

## 3g. Pro featury mají konzistentní vizuální rámeček

Pro-gated blok se pozná na první pohled — ne jen textovým badgem, ale **jednotným
rámečkem** (jemný barevný okraj + tint). Won používá **jantarový** akcent (brand =
premium) konzistentně napříč všemi stránkami a appkami. Merchant tak vidí „tohle
odemkne Pro" bez čtení.

## 3h. Neúzký config sloupec — když je těsno, picker nahoru

Prostřední sloupec s nastavením nesmí být zmáčknutý. Když 3sloupcový layout
(picker | config | preview) udělá config moc úzký, přesuň **picker nahoru jako
vodorovnou lištu** a nech dole 2 sloupce (široký config | sticky preview).

## 3i. Žádné extrémně dlouhé scrolly — přehodnoť každý blok

Dlouhý svislý scroll = špatný návrh. U **každého** bloku se ptej „nedělá tohle
zbytečně dlouhý scroll?" a pokud ano, přepracuj ho:
- N stejných karet pod sebou → **grid** (`repeat(auto-fill, minmax(…, 1fr))`),
  ať tečou do sloupců.
- Dlouhý formulář → **skupiny + Advanced collapse** (§8) / **picker** (§8).
- Related pole → **vedle sebe** (inline/2 sloupce), ne každé na svém řádku.
Cílem je, aby merchant viděl podstatu bez nekonečného rolování.

## 3g-bis. Konzistence napříč CELOU appkou

Když zavedeš vizuální vzor (Pro amber rámeček, preview vpravo, picker, grafy),
musí platit **na všech stránkách stejně**. Po každé změně projdi celou appku a
srovnej ji s těmito pravidly — jedna stránka „hezčí" než druhá = nekonzistence,
kterou merchant vnímá jako nedodělek.

**Verifikace je řádek po řádku, ne „na co ukázal merchant".** Nestačí opravit
sekci ze screenshotu — každé pravidlo je invariant přes CELÝ admin. Po zásahu
projdi **každou** route + komponentu a ověř proti **každému** pravidlu (grep na
konkrétní anti-patterny: `\((ms|px|hours)\)`, `\{[a-z]+\}` v labelu,
`.toUpperCase()`/`.replace(/_/`, emoji, `<input|select|strong|em>`, `label={p}`).
Jedno vynechané pole = fail. Merchant, který najde jednu neopravenou „Advanced"
sekci, přestane věřit, že jsi prošel zbytek. Dělej i **druhý** průchod: po opravách
znovu ověř, protože oprava mohla odkrýt/rozbít další.

## 3j. Žádné emoji v adminu ani v defaultním obsahu

Do admin UI (nadpisy, labely, badge, hlášky) **nedávej emoji** — působí to
nedodělaně/hračkářsky. Ani defaultní storefront copy (default messages) nemá
emoji. Emoji smí do storefrontu jedině tehdy, když si je merchant **sám** napíše
do své zprávy. Žádné `✅`, `🚫`, `🎉`, `🎁` v našich textech.

## 3k. Custom CSS jako Pro escape hatch pro „vyblbnutí"

Pokročilý merchant musí mít jak si vzhled dotáhnout do extrému (duhový border,
maskot, animace). Nabídni **Custom CSS pole (Pro)** injektované do shadow rootu
komponenty, s **dokumentovanými stabilními hooky** (`[data-won-*]`, `--won-*`) a
příkladem. Nesmí uniknout mimo vlastní plochu appky. (Viz i §9.)

## 4. Mluv výsledkem, ne schématem

Label a control popisuje **co merchant chce**, ne jak to ukládáme.

- **Zakázáno:** ISO stringy, enum názvy (`banner`/`toast`), jednotky implementace
  (`ms`, `px` bez kontextu), interní klíče. Když label potřebuje `(formát… e.g. …)`
  v závorce, je to špatně navržený control.
- **Místo toho:** date/time picker (ne ISO text), vizuální picker pozic (ne enum),
  „Automaticky zmizí za [3 s]" slider (ne `durationMs`), lidské volby ve větách
  („Odpočítává do → pevného data / plovoucího okna na návštěvníka").
- **Čas zadává merchant v lidských jednotkách** (sekundy/minuty/hodiny), ne v `ms`.
  Když engine ukládá `ms`, **převeď na hranici akce** (`secToMs`/`minToMs`), UI
  nikdy neukáže `ms`. Nikdy „(ms)"/„(px bez kontextu)" v labelu — jednotka patří do
  helperu (§3d) nebo je implicitní z control typu.
- **Peníze = `s-money-field`**, ne `s-number-field` s labelem „(in your currency,
  e.g. 1500)". Měnu řeší money-field, ne text v závorce.
- Tokeny v copy (`{countdown}`, `{name}`) dělej jako **klikací chip** (tap vloží
  token do pole + dispatch `input` pro živý preview), ne text v labelu ani text co
  merchant píše ručně. Label pole je čistě „Message"; tokeny jsou chipy pod ním.

## 4c. Interní enum klíč se NIKDY nesmí objevit jako label

Toto je nejčastější recidiva §4 a musí se hlídat zvlášť. Když iteruješ přes model
(`EVENT_TYPES.map(t => <label>{t}</label>)`), sype se do UI `added`, `removed`,
`increased`, `banner`, `order.created` — syrové klíče datového modelu. Merchant
netuší, že „increased" je „zvýšení množství v košíku".

- **Každý** klíč, který jde do labelu/nadpisu/legendy, projde přes **explicitní
  human-label mapu** (`EVENT_META`, `RULE_LABELS`, `PAGE_LABELS`) — jeden zdroj
  pravdy pro celou appku. Nikdy `key.toUpperCase()` ani `startCase(key)` jako
  náhrada za skutečný lidský název.
- Label je **lidská fráze pojmenovaná momentem nakupujícího**, ne stav modelu:
  `added → „Item added"`, `increased → „Quantity increased"`,
  `order.created → „Recent sales"`. Ideálně doplněná **konkrétním příkladem**
  (`e.g. „Added to cart"`).
- To platí i pro debug-ish plochy (Insights „by rule", legendy grafů): i tam jde
  lidský název, ne `cart.activity`.
- Platí **všude, kde klíč vyleze na povrch**: nejen viditelný label, ale i
  `aria-label`, text `<option>`, legenda grafu, „readout" pod pickerem
  (`{value}`), placeholder. `aria-label={position}` = „top-right" pro čtečku je
  stejná chyba jako viditelný label. Fallback nikdy nesmí být syrový klíč
  (`?? key` / `?? action`) — fallback je bezpečná lidská fráze.
- **Fixni to u zdroje, jednou:** human-label mapa v `lib/labels.*`; komponenty ji
  jen konzumují. Ne `label={p}` na jedné stránce a `label={pageLabel(p)}` na druhé.

## 4b. Perzistence a verzování je app-side, ne přes JSON

Merchant nikdy nesahá na surový JSON. Když chce uložit/načíst/zálohovat nastavení
(look, konfiguraci), řeš to **pojmenovanými savy v DB appky**:

- „Save this look" → uloží aktuální config jako pojmenovaný snapshot do DB.
- Seznam savů + „Load" na jeden klik obnoví snapshot. Volitelně „Duplicate",
  „Delete", „Set as default".
- **Zakázáno:** export/import přes copy-paste JSON textarea jako primární cesta.
  (Raw JSON smí existovat leda jako skrytý „Advanced" escape hatch pro migraci,
  nikdy jako běžný merchant flow.)

## 5. Lokalizace je data, ne kód

Storefront copy (co vidí nakupující) je **per-locale data řízená merchantem**, ne
jazyky zadrátované do produktu.

- Appka veze **jeden default jazyk** (EN) jako fallback. Nic víc není „vestavěné".
- Merchant si v jedné sekci **„Languages"** zapne libovolné locale (ideálně
  auto-detekce z publikovaných jazyků storu / Shopify Markets).
- Každé message pole je locale-aware: přepínač jazyků nad polem, prázdné padají na
  default. Storefront řeší podle jazyka návštěvníka
  (`resolveMessage(messages, shopperLocale, defaultLocale)`), fallback na default.
- **Tiering:** default „2 jazyky free, víc Pro" (sanitize dropne přebytek na Free,
  UI zablokuje přidání). Nikdy nezvýhodňuj konkrétní jazyk v jádru produktu.
- Pluralizaci/ICU si píše merchant per-locale; core jen resolvuje + skládá.

## 5b. Peníze na multi-měnovém obchodě = per-měna data, a nesmí lhát

Stejný princip jako §5, ale pro měnu. Store na Shopify Markets zobrazuje ceny ve
víc **presentment měnách**; košík na storefrontu je v měně nakupujícího. **Jedno**
uložené číslo (`thresholdCents`) porovnávané proti tomu součtu je bug (CZK práh vs
EUR košík).

- Práh modeluj jako **per-měna data** (měna → částka), prefill z aktivních
  presentment měn (Markets), ideálně **čtené z reálného pravidla merchanta** (např.
  skutečný free-shipping shipping rate per market), ať hodnota nedrift-uje od reality.
- Storefront vybere řádek podle měny nakupujícího; když pro měnu práh není →
  oznámení **skryj** (čestné), nezobrazuj.
- **Nikdy neauto-přepočítávej kurzem** jedno základní číslo v runtime. Reálné
  per-market prahy jsou pevné částky + zaokrouhlení, takže přepočet lže vůči tomu,
  co reálně spustí. Toast/oznámení co lže je horší než žádné.

## 6. Jedna obrazovka = jeden úkol = jedna hlavní akce

- Zvlášť **first-run**: jeden sebevědomý hero (stav + živý náhled) + **jedno**
  primární CTA. Žádné dvě karty říkající totéž (status „live" ukaž **jednou**).
- Odsazení a hierarchie jsou součást návrhu — tlačítko nesmí „viset" nalepené na
  cizí sekci. Skupina = jasný blok oddělený mezerou (viz princip 8).
- Sekundární akce (Manage embed, dokumentace) jsou vizuálně sekundární.

## 7. Mělká, úkolově pojmenovaná IA

Notification/utility appka není ERP. Cílem je **málo top-level destinací**
pojmenovaných úkolem, ne jedna stránka na model.

- Slučuj sourozence: vzhled+chování → **Design**; cílení+vyloučení → **Targeting**;
  co se ukazuje → jedna stránka; metriky → **Insights**. (Won Toasts: 8 → 4 + Plan.)
- Rozdělení uvnitř stránky = **tučné subnadpisy** (`s-text type="strong"`) +
  progressive disclosure (princip 9), ne další položka v menu.
- Nová položka v menu si musí zasloužit místo; default je „patří to na existující
  stránku".

## 7b. Jednotný „studio shell" napříč všemi storefront-stránkami

Jakmile jedna konfigurační stránka najde dobrý tvar (Won Toasts: **segmentovaný
picker nahoře → jeden fokusovaný panel → sticky preview vpravo**), tenhle „shell"
je **standard pro všechny** storefront-ovlivňující stránky appky, ne jednorázovka.
Merchant se naučí jeden layout a používá ho všude.

- Extrahuj shell do **sdílené komponenty** (`SegmentedNav`, layout grid) a použij
  ji na Design/Targeting/… stejně. Ne že Toasts vypadá takhle a Design úplně jinak.
- **Picker musí na první pohled vypadat jako interaktivní control**, ne jako řada
  statických labelů — merchant reálně přehlédl obyčejnou řadu „pilulek" jako pouhý
  text. Použij jednoznačný **segmented-control / tabs** vzhled: seskupený „track"
  (tintěný/orámovaný kontejner) + **silný active stav** (vyvýšený bílý segment se
  stínem nebo filled), vizuálně odlišný od okolních akčních tlačítek (např. preset
  buttonů). `role="tablist"`/`aria-pressed`. Dvě různé řady pilulek na stejné stránce
  nesmí vypadat stejně.
- Dlouhá stránka s mnoha sekcemi pod sebou (§3i) se řeší **tímto shellem**: sekce
  se stanou segmenty pickeru, zobrazuje se **jeden panel v daný moment**, preview
  zůstává. Ne nekonečný scroll „section, section, section".
- Skryté panely se **stále submitují** (jen `display:none`), aby jeden Save Bar
  uložil celý formulář — segmentace je čistě vizuální, ne datová.
- Po zavedení shellu projdi **všechny** stránky a sjednoť je (viz §3g-bis). Jedna
  stránka bez shellu = viditelný nedodělek.

## 7c. Nastavení jedné věci se konfiguruje na JEDNOM místě — u té věci

Když merchant nastavuje konkrétní entitu (jeden toast, jeden produkt), nesmí kvůli
tomu **procházet 3 stránky** (vzhled tady, časování tam, cílení jinde). Nastavení,
která se té entity týkají, musí být dosažitelná **u ní** — merchant nasnímal appku
a řekl „chci to mít u Toast nastavení, ať nemusím procházet 3 stránky".

- **Globální default + volitelný per-item override**: appka veze globální default
  (jeden Design/timing pro všechny), ale u konkrétní entity jde relevantní hodnoty
  **buď vidět/upravit inline** (jasně označené „platí pro všechny"), **nebo**
  přebít per-item overridem. Ne nutit merchanta odskočit na jinou destinaci.
- IA (§7) drží málo destinací — tohle NEznamená rozbít shell na chaos; znamená to
  **přinést relevantní controly k entitě** (inline sekce/segment v jejím panelu),
  ne vytvořit novou top-level stránku.
- Pravidlo pozná se testem: „kolik obrazovek musím projít, abych dokončil nastavení
  jednoho toastu?" Víc než jedna bez dobrého důvodu = špatně.

## 8. Progressive disclosure — presety > parametry

Merchant má dostat skvělý výsledek dotykem **0–2 controlů**. Syrové knoflíky jsou
schované, ne nasypané.

- Nabídni **1-klik presety** („recipes", look/behavior presety) — aplikují sadu
  hodnot, co spolu dávají smysl.
- Pokročilé/detailní pole sbal pod **„Advanced" (defaultně zavřené)**. Základ =
  toggle + náhled + pár lidských voleb.
- **Nestohuj N feature-configů pod sebe.** Když má stránka víc funkcí (countdown,
  low-stock, announcement…), každá s ~10 poli, vertikální seznam splývá do sebe.
  Dej **picker** (segmented/list/tabs vlevo) — merchant klikne na funkci, co ho
  zajímá, a vidí **jen její** config. Jedna funkce na obrazovce v daný moment.
- **Výběr ≠ stav.** V pickeru musí být „co edituju" (výběr) a „co je zapnuté"
  (stav) **dva vizuálně odlišné signály**. Nepoužívej ovládací prvek, který se čte
  jako výběr (plné/prázdné kolečko = radio), k zobrazení stavu — merchant pak neví,
  proč je „vybráno" víc položek. Výběr = zvýrazněný řádek; stav = zelený „On" badge.
- I v pickeru platí preview-first: u **každé** položky musí jít vidět, jak ten
  konkrétní toast vypadá (náhled v panelu vybrané položky), ne jen formulář.
- Related pole seskup (toggle + jeho label/pole u sebe, viditelně oddělené mezerou
  od jiné skupiny), ať toggle nikdy nevypadá, že patří k cizí skupině.
- „Earn features, don't dump them": u každé featury se ptej, jestli ji reálný
  merchant použije. Niche věci gateuj do Pro nebo sluč. **Jednoduchost je feature.**

## 8b. Paralelní opakovaná pole = matice, ne plochý stack

Když renderuješ **N položek se stejnou sadou podpolí** (6 eventů × M jazyků, N
pravidel × pár nastavení), naivní `items.map(i => sub.map(s => <field/>))` vyrobí
plochý svislý stack, kde se u **každého** řádku opakuje stejný podlabel
(`EN`, `EN`, `EN`…) a řádky vizuálně splývají. To je konkrétní failure mode, který
merchant nasnímal a označil „splývá to, ošklivé".

- Poskládej to jako **mřížku/tabulku**: řádek = jedna položka, sloupce = sdílená
  dimenze. **Sdílenou dimenzi (jazyk) pojmenuj v hlavičce sloupce JEDNOU**, ne na
  každém poli. Když je dimenze triviální (1 jazyk), podlabel úplně **zmizí**.
- Každý řádek má **lidský label** (§4c) + vizuální kotvu, která ho odliší:
  **barevný swatch** (tady akcent daného eventu), ikonu, nebo řádkové pozadí. Nikdy
  6 identicky vypadajících řádků za sebou.
- Ke každému řádku ukaž **konkrétní příklad** výsledku (`e.g. „Added to cart"`),
  ať merchant ví, co edituje, bez otevírání storefrontu.
- Zarovnej pole do sloupců (CSS grid) — merchant scanuje po sloupci „všechny české
  texty", ne cikcak. Layout přes `div`+grid je OK; **kontrolky zůstávají `s-*`**.
- Jestli je opakovaných řádků hodně a jsou vzácně editované, sbal je pod §8
  disclosure — ale i sbalené musí být matice, ne stack.

## 9. Jednoduchý povrch, hloubka pod ním — first-paint MUSÍ být klidný

Nejsilnější a nejčastěji porušované pravidlo. §8 říká „sbaluj" — §9 říká **jak moc**
a **proč to pořád nestačí**. Hloubka appky je tvůj moat, ale je to **opt-in, ne
default view**. Konfigurační obrazovka musí na **první pohled působit krátce a
klidně**; síla je klik daleko. Je to ta samá věc, kterou slibuješ zákazníkovi na
storefrontu („nezahltím tě"), otočená na merchanta. **Ironie, kterou jsme si
vyrobili: appka co nezahltí zákazníka, zahlcuje merchanta.**

- **§9a — Řaď podle četnosti použití, ne podle schématu.** Ukaž ~20 % controlů,
  co ~80 % merchantů reálně sáhne (je to zapnuté? co to říká? jeden preset look).
  Zbytek (per-event barvy, tvar/pohyb, per-měna prahy, přepisy textů, custom CSS)
  sbal za pojmenovaný disclosure. „Každé pole schématu dostane vždy-viditelný
  control" = engineer-out failure mode (viz meta-princip).
- **§9b — §7c „inline first-class" ≠ „vždy otevřené".** Přinést controly k entitě
  (§7c) a mít je defaultně rozbalené jsou **dvě různé věci**. First-class znamená
  „dosažitelné tady", ne „nasypané na tebe". Primární controly viditelné; vzácné
  first-class **uvnitř** disclosure.
- **§9c — Opakování JE zahlcení.** N skoro-stejných polí (6 accent pickerů, 6
  prázdných currency řádků, 4 wording pole) se čte jako stěna, i když je každé
  triviální. Sbal je, nebo **lazy-add** („Přidat měnu" → jeden řádek naráz), ne
  pre-renderuj N prázdných.
- **§9d — Sbalený blok říká svůj stav v summary** („dědí global" / „upraveno",
  „1 měna nastavená"), ať nic důležitého není neviditelné — jen tiché.
- **§9e — Test klidu:** udělej screenshot celé stránky na první načtení. Když
  vidíš víc než ~5–7 primárních controlů bez scrollu, nebo blok ≥4 skoro-stejných
  polí, nebo prázdné opakované řádky → porušuješ §9, přeskládej.

**Reálné failure mody (Won Toasts, nesmí se opakovat):** Design → Look = **15+ polí
naráz** (6 accent pickerů + tvar/pohyb + branding vše rozbalené); Markets →
Currencies = **6 prázdných dvojic** napřed; jeden cart-toast panel = **~12 polí**
pod sebou. Oprava: primární viditelné, zbytek za disclosure s dobrým defaultem
(§9a/§9b), lazy-add pro měny (§9c).

---

## 10. Effect Proof — ukaž mechanismus, nepopisuj ho

U nastavení, jehož **následek není intuitivní**, přilep malý inline vizuál
**Bez → S** nakreslený na **věrné napodobenině toho samého primitivu, který vidí
shopper** (u Toasts: toast-chip). Merchant má **vidět**, co ovládací prvek dělá,
ne číst odstavec a představovat si to. Je to §1 (preview-first) aplikované na
**jeden control** místo celé konfigurace — proof je **u bodu rozhodnutí**, ne
v odděleném preview panelu.

- **§10a — Ukaž mechanismus, ne popis.** Text říká „seskupí rychlé změny"; proof
  ukáže `▪▪▪▪ → ▪ +4`. Jeden pohled nahradí větu i mentální model.
- **§10b — Proof MUSÍ být pravdivý vůči runtime.** Fake-ale-poctivé: čísla/chování
  se musí shodovat s tím, co engine reálně dělá (Cap proof zrcadlí storefront gate
  `maxPerSession`, „0 = bez limitu"). Proof, který lže, je horší než žádný proof.
  Sdílenou aritmetiku dej do enginu/core, ať admin a runtime nemůžou divergovat
  (viz [Řemeslné invarianty → „na co existuje test"](#co-merchant-má-ověřit-na-storefrontu-na-to-musí-existovat-test)).
- **§10c — Reaktivní, když následek závisí na hodnotě.** Když se dopad mění podle
  hodnoty (cap 3 vs 10, group-by Produkt vs Typ), proof se aktualizuje živě při
  psaní. Jinak statický.
- **§10d — Jen tam, kde je následek neintuitivní.** Proof u triviálního on/off
  (barva, „ukázat rámeček") je šum a porušuje §9. Vyhraď ho pro nastavení, která
  by merchant jinak nastavil špatně nebo nepochopil (merge, grouping, capy, mute).
- **§10e — Jeden sdílený primitiv, ne per-setting jednorázovky.** Jediný
  `EffectProof` rám + chip primitivum drží všechny proofy vizuálně identické a
  levné na přidání, takže se vzor šíří bez fragmentace.

**Reálná aplikace (Won Toasts):** Anti-spam → Merge `▪▪▪▪ → ▪ +4`, Group-by
(reaktivní: off/Produkt/Typ mění výsledek), Cap (reaktivní přes `capProof`
z core, zrcadlí runtime), Quiet (`▪▪▪ → — ticho —`). Auto-dismiss záměrně BEZ
proofu — je intuitivní (§10d).

---

## 11. Jeden význam = jedna barva (konzistentní, nepřetížená sémantika)

Každý vizuální kód nese **právě jeden význam** a ten vypadá **všude stejně**.
Merchant se jazyk naučí jednou. Jakmile dva různé významy sdílí barvu — nebo se
jeden význam kreslí dvěma trochu jinými způsoby — rozhraní přestává být čitelné.

- **§11a — Tři kódy jsou ortogonální a NESMÍ kolidovat.** V Won suite: **modrá =
  vybráno/aktivní** (na které kartě/tabu jsem), **jantarová = Pro/plán** (viz A2 +
  brand token), **zelená = živé/zapnuto** (běží to). „Vybráno" ≠ „zapnuto" ≠
  „prémiové" — tři otázky, tři barvy, nikdy nepřetěžuj. Čtvrtý význam = čtvrtý
  záměrný kód, ne recyklace existujícího.
- **§11b — Jedna selection afordance, jeden zdroj.** Každý picker (preset looky,
  Toasts launcher, taby) zvýrazní vybranou položku **stejně** — modrý ring. Žije
  v **jednom sdíleném helperu** (`selectionRing()` / `WON_SELECT`), nikdy
  přepisovaný per-karta, ať se nerozdrolí na N skoro-stejných kopií (přesně ten bug,
  co pravidlo odstartoval: dva pickery `2px`/`1.5px`, shadow `.16`/`.14`). Stejná
  lekce jako §10b: sdílený kód je jediná záruka vizuální pravdy.
- **§11c — Stejný význam, vzor se může lišit podle typu prvku.** Card grid a
  segmentované taby jsou různé *vzory*; můžou selection kreslit jinak (ring vs.
  vyvýšená pilulka), ale obojí čerpá ze **stejné selection barvy**. Sjednoť token,
  ne nutně celý tvar.
- **§11d — Stav je čitelný v klidu.** Vybráno / zapnuto / Pro musí být čitelné **bez
  interakce** — slovo („On"/„Off"), barevná tečka, ring — nikdy odvozené z toho, co
  chybí. Merchant nikdy nemá klikat, aby zjistil aktuální stav.

---

## Řemeslné invarianty (nemění se)

### 1. Nativní Polaris, nikdy surové HTML
Všechny kontrolky = `s-*` web komponenty (`s-button`, `s-switch`, `s-select`,
`s-number-field`, `s-color-field`, `s-text-field`, `s-badge`, `s-banner`,
`s-stack`, `s-section`). Nikdy `<button>/<input>/<select>` — vypadají
neostylovaně a shodí „Built for Shopify".
- `s-number-field value` musí být **string** → `value={String(n)}`.
- Přepínače postují `value` když jsou zapnuté → `<s-switch name="x" value="on">`,
  čti `form.get("x") === "on"`.
- Před psaním validuj: `learn_shopify_api(polaris-app-home)` →
  `validate_component_codeblocks`.

### 2. Kontextový Save Bar všude — žádný inline Save
Každý settings `<Form>` má atribut **`data-save-bar`**. App Bridge sám ukáže
Save/Discard lištu nahoře při jakékoli změně a hlídá odchod ze stránky.
- Inline „Save" tlačítko se **nepoužívá**. Discard = form reset; u živého preview
  přidej `onReset` na resync stavu.
- Formuláře drž **uncontrolled** (initial `value` z loaderu).
- **Živý preview navazuj přes NATIVNÍ event listener, ne React `onInput`/`onChange`.**
  React synthetic `onChange`/`onInput` se u `s-*` custom elementů **nevyvolá** (React
  je posílá jen pro nativní `<input>/<select>/<textarea>`) → `<Form onInput={sync}>`
  kolem Polaris polí `sync` nikdy nezavolá a preview „stojí" (hne se jen na Discard/
  reload). Sympt. od merchanta: „preview nereaguje, musím dát Zrušit". **Fix:** v
  `useEffect` `formRef.current.addEventListener('input'/'change', sync)` (nativní
  eventy z `s-*` na `<form>` bublají); v `sync` čti `new FormData(formRef.current)`;
  `onReset` pro resync. Platí na KAŽDÉ stránce s preview — jinak jedna žije, druhá stojí.
- Výjimka: jednorázové akce (upgrade plánu) zůstávají explicitním tlačítkem.

### Co merchant má ověřit na storefrontu, na to MUSÍ existovat test
Admin náhled ≠ důkaz, že to na storefrontu funguje. Jakmile změna ovlivní chování
na storefrontu (spacing/stacking, animace, close tlačítko, undo, surface, timing,
governance, práh), **ship s commitnutým testem** — Playwright E2E (Dawn+Horizon)
nebo unit na `@won/core`/storefront funkci. Napiš ho **před** fixem, ověř že
**padá** na nefixnutém stavu, pak fixni, pak ověř že **prochází**. Merchant řekl
„jakmile je něco, co si mám ověřit ve storefrontu, musí na to být test" — bez testu
je storefront-facing práce nedokončená. (Sedí i s theme pluginem „every
storefront-facing change ships with a committed Playwright spec".)

### Stav „je to živé?"
Instalační/onboarding krok má status badge, který **zezelená**
(`tone="success"`, „Active"), když je funkce zapnutá; jinak `tone="caution"`.
Merchant nikdy nesmí hádat, jestli appka běží. (Ukaž tento stav **jednou** —
princip 6.)

### Brand jen ve vlastních plochách; preview zůstává neutrální
Won amber/branding **nepatří** do nativního Polaris chrome ani do obsahu preview.
Preview je neutrální (barvy si řídí merchant). Brand žije v **app ikoně**,
ilustracích a empty states. Ne v tlačítkách, ne v preview.

### Jednotná navigace napříč appkami
Používej `WonNavMenu` z `@won/app-kit/admin-nav` (Overview home první, „Plan"
poslední). Merchant s víc Won appkami pozná tvar menu.

### Escape hatch: custom CSS + zdokumentované hooky
Pokročilý merchant musí mít možnost si to doladit. Nabídni **custom CSS** (Pro) a
zdokumentuj **stabilní** selektory a proměnné (`[data-won-*]`, `--won-*`).
Stabilita těchto hooků je kontrakt vůči merchantovi — nerozbíjej je mezi verzemi.

### Homepage: rychlé hledání
Na přehledové stránce nabídni `s-search-field`, který indexuje nastavení a
deep-linkuje na správnou stránku/pole.

---
Viz i `docs/nova-aplikace.md` (standing goals) a paměťovou poznámku
`polaris-web-components-admin-pattern`.
