# Won Discounts — nezávislý audit srozumitelnosti: dlaždice, první nastavení, více trhů a měn

## Kdo jsi a co je cíl

Jsi UX auditor Shopify aplikace `won-discounts`. Díváš se na ni očima **obchodníka, který není technicky založený**: provozuje e-shop, slevy zná z praxe, ale neví, co je „synchronizace“, „blok aplikace“ nebo „šablona“. Nikdy neviděl dokumentaci.

Máš odpovědět na tři otázky a každou doložit screenshotem:

1. **Dlaždice.** Jak vypadají, co říkají a jestli je z nich bez klikání jasné, co se pod nimi skrývá a co je právě aktivní.
2. **První nastavení do pár minut.** Zvládne obchodník během zhruba pěti minut zapnout vše, co potřebuje, a nastavit stupně odměn podle hodnoty košíku (dárek a doprava zdarma)?
3. **Více trhů a měn.** Jde to celé řešit pro několik trhů najednou, nebo se obchodník utopí v opakovaném vyplňování?

Majitel appky (Ondřej) má dojem, že práce s více trhy a měnami je v aplikaci slabá. **Neber to jako závěr.** Ověř to, nebo vyvrať, a řekni přesně kde a proč. Stejně tak jeho souhlas s dlaždicemi neznamená, že jsou v pořádku.

Nic neopravuješ. Výstup je zpráva s nálezy a návrhy.

## Kde to je

- Repo: `~/Development/WonCommerce/Apps/b2b_b2c`, appka v `apps/won-discounts`, větev `won-discounts-feedback-2026-10-06`.
- Appku si prohlížíš v **dev náhledu** s připravenými daty, bez přihlášení do Shopify: `http://localhost:<port>/dev/preview/<obrazovka>`.
- Port se mění. Zjistíš ho takhle (vypíše port, na kterém náhled odpovídá):

```
for p in $(lsof -iTCP -sTCP:LISTEN -P | grep node | awk '{print $9}' | sed 's/.*://' | sort -u); do
  [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://localhost:$p/dev/preview/overview)" = "200" ] && echo $p
done
```

  Když vypíše víc portů, správný je ten, kde `curl -s http://localhost:<port>/dev/preview/overview | grep -c data-won-tile` vrátí číslo větší než 0. Když nevypíše nic, náhled neběží: napiš to Ondřejovi a skonči, sám nic nespouštěj.
- Seznam obrazovek a jejich stavů je v komentáři na začátku `apps/won-discounts/app/routes/dev.preview.$.tsx`.

### Obrazovky, které projdi

Každou ve **390 px a 1440 px**, v tarifu **Free i Pro** (`?plan=pro`) a česky; úvodní stránku a jednu stránku modulu navíc anglicky (`&locale=en`).

| Co | Adresa za `/dev/preview/` |
|---|---|
| Úvodní stránka, vše nastavené | `overview?state=modules` |
| Úvodní stránka, nový obchod | `overview?state=modules-off`, `overview?state=empty` |
| Úvodní stránka, selhaný zápis | `overview?state=modules-failed` |
| Úvodní stránka s upozorněními a slevami mimo Won | `overview?state=live` |
| Průvodce prvním nastavením | `onboarding`, `onboarding?step=3`, `onboarding?step=5&embed=on&rules=1` |
| Odměny (doprava zdarma, dárek) | `rewards`, `rewards?state=empty`, `rewards?state=embed-draft` |
| Množstevní slevy | `tiers`, `tiers?state=empty`, `tiers?state=alternate` |
| Výprodej | `outlet`, `outlet?state=empty`, `outlet?result=started` |
| Kampaně | `campaigns`, `campaigns?edit=bf` |
| Ochrana marže | `margin`, `margin?state=off`, `margin?state=running` |
| Slevy a kódy, editor slevy | `discounts?sync=ok`, `discounts?state=empty`, `rule-editor`, `rule-editor?rule=dev-fixture-2`, `rule-editor?rule=dev-fixture-3`, `rule-editor?rule=new&recipe=freeShipping`, `rule-editor?rule=dev-f2-market` |
| Nastavení (trhy a měny) | `settings` |
| Vyzkoušet košík | `try-cart`, `try-cart?state=margin` |

Na stránkách modulů jsou nahoře dlaždice, které přepínají panel pod sebou. **Proklikej každou dlaždici**, ne jen tu výchozí.

Vzorová data: obchod v CZK, trhy Česko (CZK) a Slovensko (EUR), Maďarsko (HUF) vypnuté. Několik slev schválně nemá částku v EUR.

## Co si přečti, než začneš

1. `docs/won-discounts/feedback-2026-10-06-kolo3-plan.md` — co se právě staví a co je rozhodnuté. Hlavně konec souboru (stav po bodech a „Doplnění 6. 10. večer“).
2. `docs/won-app-design-doctrine.md`, oddíly §18 a §19 — pravidla, která si appka sama dala. Nález, který některé porušuje, tak označ.
3. `docs/won-discounts/rozhodnuti.md`, části „Prahy per trh / měna“, „Free / Pro“ a „Onboarding“.
4. `docs/won-discounts/nakres-bod7-vyjimky.md` — připravená úprava výjimek, zatím neschválená.

### Co se teprve chystá (nehlas jako chybu, ale posuď, jestli to stačí)

- **Odměny → Milníky:** jeden žebříček stupňů podle hodnoty košíku, odměna u stupně je dárek, doprava zdarma nebo sleva z objednávky. Free 2 stupně, Pro 6. Dnešní stránka Odměny má dopravu a dárek zvlášť.
- **Vzhled → Překlady:** texty na webu pro každý jazyk obchodu, vzhled se přesune k jednotlivým modulům.
- **Vyzkoušet košík:** předpřipravené scénáře kombinací slev jako hlavní cesta. Dnes je jen ruční košík.

U otázky 2 a 3 výslovně napiš, co z dnešních potíží plánované Milníky vyřeší a co ne.

## Jak postupuj

### 1. Dlaždice

U každé dlaždice (úvodní stránka i stránky modulů) odpověz:

- Pozná obchodník z názvu a jedné věty, co pod dlaždicí najde? Přepiš si větu a zeptej se: řekl by to tak prodavač zákazníkovi?
- Je jasný rozdíl mezi „co to je“ a „co mám nastavené“?
- Rozumí štítkům „Aktivní“, „Neaktivní“, „Vyžaduje pozornost“, „Pro · odemknout“, „V tématu“, „Chybí v tématu“, „Neověřeno“? Ví u červeného, co má udělat?
- „3 věci k vyřešení“: dozví se kliknutím hned, které to jsou?
- Je poznat, která dlaždice je vybraná a že se na ni dá kliknout?
- Ořezává se někde text třemi tečkami tak, že zmizí to podstatné? Zkontroluj hlavně 390 px.
- Je pořadí dlaždic takové, v jakém by obchodník věci řešil?
- Neopakuje dlaždice jen nadpis sekce pod sebou?

Sepiš **slovníček žargonu**: každé slovo v rozhraní, kterému by laik nerozuměl, kde je a čím ho nahradit.

### 2. První nastavení do pěti minut

Projdi tři úkoly jako nový obchodník a u každého zapiš cestu krok za krokem:

- **A.** „Chci dopravu zdarma od 1 500 Kč a dárek od 2 000 Kč.“
- **B.** „Chci, aby to zákazník viděl v košíku a na stránce produktu.“
- **C.** „Chci mít jistotu, že to opravdu běží.“

U každého kroku: kam klikl, co musel přečíst, kde zaváhal a proč, kolik rozhodnutí udělal. Na konci odhadni čas a řekni, kde by to bez pomoci vzdal. Dev náhled nic neukládá, takže hodnotíš cestu a srozumitelnost, ne to, jestli se uložení povedlo.

Zvlášť posuď:

- Vede průvodce a úvodní stránka k těmhle úkolům, nebo je obchodník musí hledat?
- Ví po uložení, co má udělat dál (zapnout na webu, přidat blok)?
- Kolik z cesty tvoří věci, které by appka mohla udělat sama nebo předvyplnit?

### 3. Více trhů a měn

Tohle je hlavní část. Projdi každé místo, kde se zadává částka nebo kde záleží na trhu:

- doprava zdarma a dárek (Odměny),
- sleva pevnou částkou a minimální útrata (editor slevy),
- množstevní sleva částkou za kus (Množstevní slevy, `tiers?plan=pro`),
- výprodej a ceníky trhů (`outlet?plan=pro`),
- kampaně, které mění částky (`campaigns?plan=pro&edit=bf`),
- cílení slevy na trhy (editor slevy, Pro),
- Nastavení → trhy a měny,
- Vyzkoušet košík (volba trhu).

U každého místa odpověz:

- Kolikrát musí obchodník se třemi trhy a třemi měnami vyplnit „totéž“? Spočítej pole.
- Pozná hned, že mu v některém trhu něco chybí a co to pro zákazníka znamená? Kde se to dozví: u pole, na dlaždici, na úvodní stránce?
- Jde zadat jednu hodnotu a nechat appku navrhnout ostatní (přepočet kurzem jako návrh, který obchodník potvrdí)? Rozhodnutí zní „žádný tichý přepočet kurzem“. Návrh k potvrzení ho neporušuje, tichý přepočet ano.
- Mluví appka o „trhu“, nebo o „měně“? Jsou ty pojmy použité důsledně a rozumí jim obchodník, který zná jen „Česko“ a „Slovensko“?
- Co uvidí obchodník, který má jen jeden trh? Obtěžuje ho appka něčím, co se ho netýká?
- Co se stane, když v Shopify přidá čtvrtý trh? Dozví se, že mu v něm odměny a slevy neplatí?
- Existuje jedno místo, kde vidí všechny trhy vedle sebe a co v kterém platí?

Na konci téhle části navrhni **konkrétní řešení** (ne obecné rady): jak by mělo vypadat zadávání částek pro víc trhů, kde má být přehled po trzích a co má appka dělat sama. U každého návrhu odhadni, jestli je to úprava formuláře, nebo zásah do toho, jak appka ukládá data. Když si nejsi jistý, podívej se do kódu (`packages/core/src/discounts/`, `apps/won-discounts/app/components/model/markets.ts`) a napiš, co jsi tam našel.

## Jak pracuješ

- Screenshoty dělej Playwrightem, ukládej do `~/Development/WonCommerce/Apps/.playwright-mcp/audit-dlazdice/`. Název souboru = obrazovka, stav, šířka.
- Každý nález musí jít ukázat na screenshotu. „Mohlo by být matoucí“ bez příkladu není nález.
- Čti texty tak, jak jsou napsané. Nepředpokládej, že obchodník ví to, co víš ty z kódu.
- Pracuj inline, bez subagentů a bez workflow.
- **Nic neměň:** žádné úpravy kódu, žádné commity, žádný zápis do Shopify obchodu, žádné spouštění ani restart `shopify app dev`.
- Cizí necommitnuté soubory v repu nech být.

## Výstup

Jeden soubor: `docs/won-discounts/audit-dlazdice-trhy-2026-10-06.md`. Česky, věcně, bez omáčky. V tomhle pořadí:

1. **Verdikt ve třech větách:** jedna pro každou ze tří otázek. U otázky 3 výslovně: je dojem „slabé“ oprávněný, částečně, nebo ne.
2. **Pět věcí, které opravit jako první**, seřazené podle toho, kolik obchodníků na nich ztroskotá.
3. **Nálezy** v tabulce: závažnost (blokuje / zdržuje / ruší) · obrazovka a šířka · co obchodník vidí (doslovný text) · proč tomu nerozumí · návrh (nový text nebo změna) · screenshot.
4. **Cesty A, B, C** krok za krokem s odhadem času.
5. **Více trhů a měn:** počty polí, kde chybí přehled, konkrétní návrhy a jejich rozsah.
6. **Slovníček žargonu.**
7. **Co funguje dobře a nemá se měnit.**
8. **Co jsi nemohl ověřit** (dev náhled neukládá, skutečný Shopify admin jsi neviděl).

Do chatu pak napiš jen verdikt, pět priorit a odkaz na soubor.
