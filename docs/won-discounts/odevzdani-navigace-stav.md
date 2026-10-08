# Odevzdání: navigace a stav uvnitř stránek Won Discounts

8. 10. 2026. Zadání: `prompt-navigace-stav.md`. Všech sedm bodů je hotových a na `origin/main`.

## Jak si to ověřit

Náhled běží na portu procesu `react-router dev` (dnes 54481):

- http://localhost:54481/dev/preview/tiers (dlaždice, hlavička, tečky v pruhu; `?plan=pro`, `?nav=failed`, `?nav=off`, `?locale=en`)
- http://localhost:54481/dev/preview/rule-editor (sloupec s tečkou; vymažte částku, přepněte na kód)
- http://localhost:54481/dev/preview/rewards (řádek stupňů, druhý je červený)
- http://localhost:54481/dev/preview/overview?state=live (dlaždice nad slevami ze Shopify)
- http://localhost:54481/dev/preview/settings (tečka u Trhy a měny)

Testy:

```
cd /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/apps/won-discounts
npm run typecheck && npm run test:unit
WON_PREVIEW_BASE_URL=http://localhost:54481 npm run test:e2e:preview
```

## Výstup brány (poslední běh, commit `3688bcc`)

- `npm run typecheck`: bez chyb.
- `npm run test:unit`: node testy 1804 prošlo, 0 neprošlo. Testy enginu 699 prošlo, 0 neprošlo (6 souborů).
- `npm run test:e2e:preview`: 11 prošlo, 0 neprošlo (38 s).
- `npm run build`: prošel.

Na začátku (krok 0) bylo node testů 1790. Přibylo 14 testů, žádný nebyl smazán ani přeskočen. Jeden test zanikl s funkcí, kterou hlídal (`goalsOfLayoutData`), nahradily ho dva nové.

## Změřené hodnoty (1440 × 900)

Řada dlaždic (výška) a začátek obsahu (od horního okraje stránky):

| Stránka | Řada před | Řada po | Obsah před | Obsah po |
|---|---|---|---|---|
| Množstevní slevy | 166 px | 95 px | 495 px | 424 px |
| Milníky | 208 px | 115 px | 345 px | 252 px |
| Výprodej (Pro) | 190 px | 115 px | 435 px | 360 px |
| Kampaně (Pro) | 166 px | 78 px | 303 px | 215 px |
| Ochrana marže | 184 px | 113 px | 264 px | 193 px |

Cíl 80–90 px splňuje jen řada Kampaní. Ostatní jsou vyšší, protože věta souhrnu má dva až tři řádky nebo je pod ní řádek „k vyřešení“. Text se nezkracuje, jak zadání chce.

Na 390 px: Množstevní slevy 437 → 251 px, Milníky 251 → 182, Výprodej 438 → 268, Kampaně 355 → 205, Ochrana marže 396 → 238.

Přehled, začátek dlaždic modulů: 1 029 → 546 px (1440), 1 356 → 746 px (390).

Editor slevy se sloupcem: na 1024, 1200 i 1440 px má formulář 403 px a panel „Co uvidí zákazník“ 303 px vedle sebe. Rozložení jsem neměnil.

## Co se změnilo

Cesty jsou od `apps/won-discounts/`.

**Body 1 a 2: nízké dlaždice, hlavička neopakuje stav**
- `app/components/shell/ModuleTile.tsx:200`: `ViewTile` bez popisu, glyf vedle textu. `:89` společný rámeček dlaždice. `ModuleTile` na Přehledu beze změny vzhledu.
- `app/components/screens/TiersScreen.tsx:286`, `MarginScreen.tsx:256`, `OutletScreen.tsx:522`, `CampaignsScreen.tsx:593`, `MilestonesScreen.tsx:453`: hlavička bez štítku a bez věty z dlaždice.
- `app/components/tiers/TiersBlockSection.tsx:55`: volitelná vysvětlující věta (Vzhled má dál původní souhrn).
- Dlaždice „Kde ochrana zasáhne“ na Pro nově říká souhrn zásahů, „Nastavení podle kolekcí“ na Pro jmenuje kolekce.

**Bod 3: tečka v pruhu**
- `app/components/shell/WonSection.tsx:255`: `StatusDot`, jedna tečka pro pruh, sloupec i řádek stupňů. Barvy z tabulky štítku.
- `app/components/model/module-status.ts:216`: `storeStatuses`, jeden výpočet pro Přehled i pruh.
- `app/lib/integration/pages.server.ts:173`: `loadDiscountPageStates`. `app/routes/app.tsx:39` ho volá, `:49` říká, kdy se layout načte znovu.
- `app/components/shell/SubNav.tsx:29`: `DiscountNav`, stejná cesta pro aplikaci i náhled. `app/routes/dev.preview.$.tsx:214`: fixtury.

**Bod 4: tečka ve sloupci**
- `app/components/shell/SectionNav.tsx:27`, `app/components/screens/SettingsScreen.tsx:143`.

**Bod 5: editor slevy**
- `app/components/screens/RuleEditorScreen.tsx:386` a `:408`.
- `app/components/model/rule-status.ts:172`: `sectionsToFix`. `app/components/model/rule-form.ts:107`: `fieldSection`. `app/components/model/describe.ts:205`: sekce a jejich kotvy.
- `app/components/rule-editor/DiscountSection.tsx:140`: kotva `#discount`.
- `app/components/shell/WonSection.tsx:331`: `openSectionsAround`, jedna cesta pro přímé odkazy i sloupec (`SectionNav.tsx:145`).

**Bod 6: řádek stupňů**
- `app/components/shell/JumpRow.tsx:38`, `app/components/shell/scroll.ts:4`, `app/components/screens/MilestonesScreen.tsx:296` a `:460`.

**Bod 7: Přehled**
- `app/components/screens/OverviewScreen.tsx:486`.

**Doktrína**
- `docs/won-app-design-doctrine.md`: §19d, §19e a nový §19f (`:377`): kdy pruh, dlaždice, sloupec, řádek čísel; jedna tečka.

**Hesla**
- Přidáno: `milestones.steps.jump` (cs, en).
- Smazáno z obou jazyků: `tiers.view.global.about`, `margin.view.settings.about`, `milestones.view.steps.about`, `milestones.view.web.about`, `outlet.view.sales.about`, `outlet.view.info.about`, `campaign.view.form.about`, `campaign.view.places.about`, `campaign.list.live.*`.

## Cena teček v pruhu (bod 3)

- Layout loader čte uloženou konfiguraci a databázi (kolem devíti dotazů) a dva malé dotazy do Shopify: časové pásmo a měna obchodu, stav automatické slevy. Oba se drží 60 s v paměti.
- Nespouští zápis do Shopify, nečte téma ani slevy mimo Won.
- Layout se nově načte i při přechodu na jinou stránku aplikace. To stojí jen dotazy do databáze. Integrační test měří: první načtení 2 dotazy do Shopify, další stránka ve stejné minutě 0.

## Zkus to rozbít

| Zkouška | Výsledek |
|---|---|
| Šířky 390, 768, 899, 900, 1024, 1440 | 9 stránek × čeština Free a angličtina Pro. Našla se jedna chyba, viz níž. Po opravě nic nepřetéká. |
| Editor: vymazat částku, přepnout typ, přepnout na kód | Tečka se objeví, zmizí a přesune na „Jak se uplatní“ bez uložení. Také u výběru produktů bez produktu. |
| Editor: sbalená sekce, poslední sekce, tři rychlé kliky | Sbalená se rozbalí a stránka dojede na konec. Poslední sekce je označená, i když nedojede k okraji. Po třech klicích platí poslední. |
| Uložení s chybou v jiném pohledu | `tiers?plan=pro&state=exceptions&result=invalid-exception`: otevře se pohled Výjimky, štítek na dlaždici sedí. Zkoušeno na fixtuře odmítnutého uložení, ne skutečným odesláním. |
| Přímé odkazy | `settings#combination`, `settings#markets`, `rule-editor#value`, `#more`, `#codes`, `#combines`, `rewards#amounts`, `tiers#pro`, `tiers#block`, `overview#native`: všechny vedou na místo a otevřou správný pohled. |
| Milníky: 0, 1, 12 stupňů, přidat, odebrat, chybějící částka | 0 a 1 stupeň řádek nemají. 12 stupňů se na 390 px zalomí na tři řádky bez posuvu do strany. Po odebrání se čísla přepočítají. Chybějící částka zčervená a po vyplnění zmizí. |
| Free a Pro, čeština a angličtina | Zamčený modul nemá tečku a má štítek Pro. Na Pro má tečku i štítek. Angličtina našla chybu níž. |
| Klávesnice a omezený pohyb | Tab projde pruh, dlaždice i sloupec v pořadí stránky, fokus je vidět, Enter funguje. S `prefers-reduced-motion` je skok okamžitý, nově i u přímých odkazů editoru. |
| Neuložené změny | Klik ve sloupci ani v řádku stupňů nepíše hash, nenaviguje a formulář drží vyplněné hodnoty. Ověřeno v náhledu, kde není App Bridge, viz „Co jsem neověřil“. |
| Bez JavaScriptu | Odkazy ve sloupci jsou obyčejné kotvy a fungují. |

**Nalezená chyba:** Nastavení v angličtině přetékalo na 390 px o 109 px do šířky. Text pro čtečky u tečky je absolutně pozicovaný a jeho kontejnerem byl lepivý řádek, takže položka odrolovaná mimo řádek roztáhla stránku. Opraveno v `app/components/shell/WonSection.tsx:242` (`ReaderOnly` má vlastní obal). Hlídá ji test šířek v `tests/e2e-preview/admin.navigation.spec.ts` a test značky v `tests/ui/nav.test.ts`. Chyba byla na produkci od commitu `35c117a` do `3688bcc`.

## Commity

Všechny jsou v `origin/main`, `git status -sb` hlásí shodu.

| Hash | Zpráva |
|---|---|
| `0867661` | Nastavení: sloupec „Na této stránce“, audit a zadání (krok 0) |
| `5b10bb5` | navigace a stav (1 a 2): nízké dlaždice, hlavička neopakuje stav |
| `f157c5c` | navigace a stav (3): tečka v pruhu pod „Slevy“ |
| `35c117a` | navigace a stav (4): tečka ve sloupci |
| `60f5a08` | navigace a stav (5): sloupec v editoru slevy |
| `43421d2` | navigace a stav (6): řádek stupňů v Milnících |
| `3688bcc` | navigace a stav (7): Přehled, oprava přetečení, e2e proti náhledu, doktrína |

`git pull --rebase` v tomto stromu neprošel kvůli cizím necommitovaným souborům (`DEPLOY.md`, `product-roadmap.html`), které nesmím stashovat. Před každým pushem jsem proto udělal `git fetch` a ověřil, že `origin/main` nemá nic navíc (`0` commitů za mnou), a pushoval jako fast-forward.

## Kompromisy v kódu

1. **Časovač 900 ms v `SectionNav.tsx`.** Po kliknutí drží označenou položku, než doběhne plynulý scroll. Je z předchozí session, commitoval jsem ho v kroku 0 a nepřepsal. Čistší by bylo čekat na událost `scrollend`.
2. **Pruh a Přehled se můžou minutu lišit.** Stav automatické slevy se pro pruh drží 60 s. Když ji obchodník v Shopify vypne nebo zapne, Přehled to ukáže hned, tečka do minuty.
3. **Do cache jde i nepovedené čtení časového pásma.** Minutu se pak plánované slevy posuzují podle UTC.
4. **Chyby z odmítnutého uložení nejsou živé.** Tečka u sekce po nich zůstane do dalšího uložení, stejně jako hláška u pole.
5. **Řádek stupňů červení jen chybějící částku.** Dárek bez vybraného produktu stupeň nečervení, v zadání je jen částka.
6. **`!important` v `ModuleTile.tsx`** u dlaždic Přehledu na úzké obrazovce je původní, nesahal jsem na něj.
7. **Přímý odkaz na předposlední sekci krátké stránky** označí ve sloupci poslední sekci. Je to původní pravidlo „na konci stránky platí poslední“.
8. **Náhled vrací z loaderu `{ screen, discountNav }`** místo samotných props. Upravil jsem podle toho kontraktní test.

## Co jsem neudělal nebo neověřil

- **Skutečný embedded admin.** Vše je ověřené v náhledu a testy proti falešnému Shopify. Dotaz App Bridge na opuštění stránky a layout loader s reálnou session jsem v prohlížeči nezkoušel.
- **Nasazení na Railway.** Každý push šel do `origin/main`, stav nasazení jsem nekontroloval.
- **Texty.** Vysvětlující věty dlaždic jsem přesunul do hlaviček tam, kde sekce žádnou neměla. Kde už sekce vysvětlení měla, původní věta z dlaždice zanikla. Stojí za přečtení na pěti stránkách.
- **Věta „Výjimku pro vybrané produkty nebo kolekce nastavíte níž“** u Množstevních slev neodpovídá dlaždicím (výjimky jsou jiný pohled). Byla tam už předtím, neměnil jsem ji.

## Evidence

`docs/won-discounts/evidence/navigace-stav/`: `pred-*` a `po-*` pro osm stránek na 390 a 1440 px, k tomu `po-pruh-*` (stavy teček), `po-rule-editor-1024/1200`, `po-rewards-stupne-1440`, `po-rewards-12-stupnu-390`.
