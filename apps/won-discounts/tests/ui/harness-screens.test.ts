// The admin preview (MVP 3) imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

// Task 5: every admin screen is reachable in the dev harness (/dev/preview/<screen>)
// with fixtures, WITHOUT Shopify auth and without a database, and renders the real
// screen component in both admin languages. Rendered through React Router's static
// handler, i.e. the same loader → component path as a real request.

const SCREENS: { path: string; expect: RegExp[]; absent?: RegExp[] }[] = [
  { path: "overview", expect: [/data-won-tile="codes"/, /Slevy a kódy/, /Stav v obchodě/, /čeká na zápis|čekají na zápis/, /Zobrazení slev na webu/, /Zkontrolovat znovu/] },
  // Plan 6 Oct 2026 (P2/P3): Přehled shows only what has content or an action, and every problem carries its fix.
  { path: "overview?state=clean", expect: [/Slevy platí na webu i v pokladně/, /Zapnuto na webu/] },
  { path: "overview?state=native-error", expect: [/id="native"/, /Slevy v Shopify se nepodařilo načíst/, /Načíst znovu/] },
  {
    path: "overview?state=conflict",
    expect: [/Střetává se s Won/, /href="\/app\/discounts\/dev-fixture-2#codes"/, /Upravit kódy ve slevě „VIP kód“/, /href="shopify:\/\/admin\/discounts\/1003"/, /Otevřít v Shopify/, /Aplikace nemá oprávnění číst téma/, /Zkontrolovat znovu/, /<s-button href="\/app\/discounts" variant="secondary">Zobrazit slevy/],
  },
  { path: "overview?state=pro-cards", expect: [/Kampaně jsou v tarifu Pro/, /Výprodej je v tarifu Pro/, /data-won-tile-locked/, /<s-clickable href="\/app\/outlet"/, /Pro · odemknout/] },
  { path: "overview?state=pro-cards&plan=pro", expect: [/Žádná kampaň není naplánovaná/, /Žádný výprodej není aktivní/] },
  {
    path: "overview?state=live",
    expect: [/Vyžaduje pozornost/, /LETO15/, /Přesunout vše \(2\)/, /Vrátit zpět/, /3 aktivní z 6 · 1 naplánovaná · 1 neaktivní/, /platí jen pro skupiny zákazníků/, /Upravit, pro koho platí/],
  },
  {
    path: "overview?state=sync-failed",
    expect: [/Zápis se nepovedl 28\. 9\. 2026 16:20/, /Kód slevy „VIP10“ už v Shopify používá jiná sleva/, /Zkusit zapsat znovu/, /2 aktivní z 6 · 1 naplánovaná · 1 zatím neplatí · 1 neaktivní · 1 vypnutá/, /data-won-tile-issues/],
  },
  {
    path: "overview?state=moved",
    expect: [/1 sleva přesunuta do Won/, /Na co myslet/, /zbývajících 58/, /Nedokončené přesuny/, /PODZIM20/, /Je v záloze/, /Přesunuté do Won/, /LETO15/, /Vrátit zpět/],
  },
  { path: "overview?state=empty", expect: [/Zatím žádná sleva/, /Nastavení za 3 minuty/, /Pokračovat v průvodci/] },
  { path: "overview?readOnly=1", expect: [/Nastavení jen pro čtení/] },
  // P3: "Upravit" of a rule that needs attention opens the editor at the field that fixes it. P5: the line carries the limits.
  { path: "discounts", expect: [/Vaše slevy/, /Černý pátek/, /v EUR se nenabízí/, /Uloženo, zatím neplatí/, /href="\/app\/discounts\/dev-fixture-4#value"/, /href="\/app\/discounts\/dev-fixture-6#segments"/, /kód VIP10 · od 1\u00a0000\u00a0Kč · 1× na zákazníka/] },
  { path: "discounts?sync=ok", expect: [/6 slev · 3 aktivní · 1 naplánovaná · 1 neaktivní · 1 vypnutá/, /Naplánováno od 27\. 11\. 2026/] },
  // The empty list is the recipes themselves (§15b), not a sentence pointing at another section.
  { path: "discounts?state=empty", expect: [/Vyberte hotovou slevu/, /\/app\/discounts\/new\?recipe=percentAll/, /Uvítací kód/, /Vlastní sleva/] },
  { path: "discounts?sync=failed", expect: [/Zatím neplatí/, /Zápis do Shopify se nepovedl/, /Zápis se nepovedl 28\. 9\. 2026/, /Zkusit zapsat znovu/] },
  // The five sections, all there; the markers at the fields (the missing EUR amount, the start date); the status sentence links to its field.
  {
    path: "rule-editor",
    expect: [/Částka: Česko \(CZK\)/, /Částka: Slovensko \(EUR\)/, /nenabízí se/, /Europe\/Prague/, /Pro · odemknout/, /Naplánováno/, /Podmínky/, /Jak se uplatní/, /Kdy platí/, /Zapnuto/, /V EUR chybí částka/, /Sleva začne platit 27\. 11\. 2026\./, /href="#schedule"/, /id="conditions"/, /id="target"/, /id="markets"/],
  },
  { path: "rule-editor?rule=dev-fixture-2", expect: [/VIP10/, /1× na zákazníka/, /Jednou na zákazníka/, /Zákazník zadá kód VIP10\./, /V EUR chybí minimum/, /Vrátit automatický název/] },
  { path: "rule-editor?rule=dev-fixture-3", expect: [/HUF/, /Uloženo i pro HUF: 3\u00a0000\u00a0HUF\. Trh je vypnutý, hodnota zůstává\./, /Odebrat hodnotu v HUF/] },
  // B9: stored segments are said at their own block and can be removed there.
  { path: "rule-editor?rule=dev-fixture-6", expect: [/Neaktivní/, /Pokladna je neumí vyhodnotit, proto sleva není aktivní/, /Odebrat omezení na skupiny zákazníků/, /href="#segments"/, /id="segments"/] },
  { path: "rule-editor?result=unreadable", expect: [/Uložené nastavení se nepodařilo přečíst/, /Nahradit neplatnou konfiguraci/] },
  { path: "rule-editor?result=sync-failed", expect: [/Uloženo, ale do Shopify se zatím nezapsalo/, /Sleva „Černý pátek“ se do Shopify nezapsala/, /Zkusit zapsat znovu/] },
  { path: "rule-editor?rule=dev-fixture-2&result=collision", expect: [/nejde použít zároveň, pokladna je nerozliší/, /Upravit kódy/] },
  { path: "rule-editor?rule=dev-fixture-2&result=too-many", expect: [/Aktivních slev s kódem může být nejvýš 20, po uložení by jich bylo 21/] },
  { path: "rule-editor?rule=new&recipe=welcomeCode", expect: [/Uvítací sleva/, /VITEJ10/, /Neuloženo/, /Vrátit automatický název/] },
  // P5: a recipe's name is generated from its settings and the heading follows it.
  { path: "rule-editor?rule=new&recipe=freeShipping", expect: [/heading="Doprava zdarma od 1\u00a0500\u00a0Kč \/ 60\u00a0€"/, /Název se skládá z nastavení/, /name="nameAuto" value="1"/] },
  // B11: read-only disables the fields, not just Save.
  { path: "rule-editor?rule=dev-fixture-2&readOnly=1", expect: [/Nastavení jen pro čtení/, /<s-text-area[^>]*disabled/, /<s-switch[^>]*disabled/] },
  // P3 on Free: the Pro setting the plan does not run is marked where it is set, with a way to remove it.
  { path: "rule-editor?rule=dev-f2-market", expect: [/Sleva jen pro vybrané trhy je v tarifu Pro\. Váš tarif ji nespouští, proto sleva není aktivní\./, /Odebrat omezení na trhy/, /Odebrat sčítání s dalšími slevami/, /href="#markets"/, /jen trhy Slovensko · sčítá se s Podzimní sleva 10.%/] },
  { path: "rule-editor?rule=dev-fixture-2&plan=pro", expect: [/Pro koho platí a kombinace/, /Česko/, /Slovensko/, /Sčítá se s/, /Kombinování slev v Nastavení/, /\/app\/settings#combination/] },
  // Vyzkoušet košík is Pro: Free sees the locked frame with what the tool is for; ?plan=pro the tool with the shop's discounts to tick.
  { path: "try-cart", expect: [/S Pro si košík vyzkoušíte předem/, /href="\/app\/plan"/, /Košík je prázdný\. Přidejte produkty\./, /<s-button type="submit" variant="primary" disabled="[^"]*">Spočítat/] },
  {
    path: "try-cart?plan=pro",
    expect: [/Mikina Won \(M \/ černá\) × 2/, /Kód VIP10/, /Celkem/, /CZK · Česko/, /Ceny a země z trhu Česko/, /Podzimní sleva 10/, /Uplatní se samy: /, /<input type="checkbox" name="ruleId"[^>]*checked=""[^>]*value="dev-fixture-2"/, /kód VIP10/, /Teď/, /Vlastní datum a čas/, /data-won-try-cart-lines/],
  },
  { path: "try-cart?plan=pro&date=2026-11-27&time=00:00", expect: [/Začátek kampaně \(27\. 11\. 2026 00:00\)/, /<input type="hidden" name="date" value="2026-11-27"\/>/, /<input type="hidden" name="time" value="00:00"\/>/] },
  { path: "try-cart?state=margin", expect: [/href="\/app\/margin#costs"/] },
  { path: "try-cart?state=warnings", expect: [/Pokladna se může lišit/, /Zkusit zapsat znovu/] },
  { path: "try-cart?state=not-wired", expect: [/Výpočet košíku zatím není zapojený/] },
  { path: "onboarding", expect: [/1\. Co chcete řešit/, /Doprava zdarma nebo dárek/, /na první místo/] },
  { path: "onboarding?step=3&embed=on", expect: [/Zapnuto. Web je připravený/, /4\. První sleva/, /5\. Hotovo/] },
  // B16: step 3 can be skipped (the first discount does not need the website on); without anything outside Won there are four steps.
  { path: "onboarding?step=3", expect: [/Přeskočit, zapnu později/, /<input type="hidden" name="step" value="4"\/>/, /Sleva v pokladně platí i bez toho/] },
  { path: "onboarding?step=3&native=none", expect: [/4 kroky, zhruba 3 minuty/, /2\. Zapnout na webu/, /3\. První sleva/, /4\. Hotovo/] },
  { path: "onboarding?step=3&embed=none", expect: [/Odkaz teď nemáme/, /Zkontrolovat znovu/] },
  // N12: the guide counts what really runs, like the Slevy a kódy tile ("6 slev · 3 aktivní"); "Všechno je aktivní" only when all do.
  { path: "onboarding?step=5&embed=on&rules=1", expect: [/Slevy platí na webu i v pokladně/, /Aktivní slevy: 3 z 6/], absent: [/Všechno je aktivní/, /6 slev je aktivních/] },
  { path: "onboarding?step=5&embed=on&rules=1&live=6", expect: [/Všechno je aktivní/, /6 slev je aktivních/] },
  // N1: the goal "Doprava zdarma nebo dárek" leads to Odměny (prefilled), not to a discount recipe.
  { path: "onboarding?step=4&embed=on&goal=rewards", expect: [/Nastavit dopravu zdarma a dárek/, /href="\/app\/rewards\?start=shipping#steps"/, /Nebo začněte slevou/] },
  { path: "onboarding?step=4&embed=on&goal=rewards&rewards=live", expect: [/Milníky jsou nastavené/, /Milníky jsou aktivní\./, /5\. Hotovo/] },
  { path: "onboarding?step=5&embed=on&rules=1&live=0", expect: [/Ještě něco zbývá/, /Žádná zatím není aktivní/, /Sleva je uložená, ale zatím není aktivní/] },
  // MVP 7: steps 4 and 5 — the recipes in the onboarding itself, the checklist from real signals.
  { path: "onboarding", expect: [/5 kroků, zhruba 3 minuty/, /4\. První sleva/, /Sleva na všechno|% na vše/, /5\. Hotovo/, /Ještě něco zbývá/, /Web ještě není zapnutý/, /Otevřete obchod a dejte zboží do košíku/, /Otevřít obchod/], absent: [/Vyzkoušejte košík/] },
  // N11: the cart test is offered to the plan that has it.
  { path: "onboarding?plan=pro", expect: [/Vyzkoušejte košík/], absent: [/Otevřít obchod/] },
  { path: "move-dialog", expect: [/Co se stane/, /Co se ztratí/, /Počítadlo použití \(zatím 42×\) se smazáním slevy v Shopify ztratí/, /Na co myslet/, /zbývajících 58/] },
  { path: "move-dialog?all=1", expect: [/Přesunout 2 slevy do Won/, /LETO15/, /Doprava zdarma nad 2 000 Kč/, /Doplňte ji pro EUR/] },
  // Kampaně (MVP 6): Free locked in amber, Pro form + list by status, an edit, the errors, the Přehled card.
  { path: "campaigns", expect: [/S Pro naplánujete akci předem/, /Zobrazit tarif Pro/, /Víkend −20 %/, /Aktivní/, /Naplánované/, /Black Friday/, /Ukončit hned/] },
  {
    path: "campaigns?plan=pro",
    expect: [/Naplánovat kampaň/, /Co se v kampani změní/, /Podzimní sleva 10 %: 20\s%/, /Doprava zdarma: zapnutá/, /Sleva 200 Kč \/ 8 €: 400\sKč/, /Uložené změny, které se nepoužijí: změna něčeho, co už neexistuje\./, /Co kampaň udělá/, /Zatím nic nemění\. Zaškrtněte aspoň jednu slevu nebo množstevní slevu/, /<s-option value="23:45"/, /Vyzkoušet košík v době kampaně/, /Kampaň mění slevy, kódy a množstevní slevy\. Dárky běží během kampaně beze změny/, /Europe\/Prague/],
  },
  { path: "campaigns?plan=pro&edit=weekend", expect: [/Upravit kampaň/, /Kampaň právě běží/, /Uložit kampaň/, /Zrušit úpravy/] },
  // MVP 6.1: the tier sets a campaign can change, the campaign's own breaks on its card and in the form.
  {
    path: "campaigns?plan=pro&edit=bf",
    expect: [
      /Množstevní slevy v kampani/,
      /Celý obchod/,
      /Běžně: od 3 ks −10\s%, od 5 ks −15\s%, od 10 ks −20\s%/,
      /Vybrané produkty a kolekce \(2\)/,
      /Množstevní slevy \(Celý obchod\): od 3 ks −15\s%, od 5 ks −20\s%, od 10 ks −30\s%/,
      /Tabulka na stránce produktu se přepne minutu po začátku a 7 minut před koncem/,
      /Dárky běží během kampaně beze změny/,
      /Uložené změny, které se nepoužijí: změna něčeho, co už neexistuje\./,
      // B7: only a ticked set shows its rows; the summary is computed from the form.
      /name="cp\.tq\.global\.0"/,
      /Black Friday · 27\. 11\. 2026 00:00 – 30\. 11\. 2026 23:59 · mění: 2 slevy a 1 množstevní slevu/,
    ],
  },
  // The table's look (MVP 7): the custom look (locked amber on Free), card prices BETA, the AI brief.
  { path: "tiers", expect: [/Vlastní vzhled tabulky/, /V Pro sladíte tabulku s webem: vlastní barvy, zaoblení rohů a vlastní CSS/, /href="\/app\/plan"/, /Ceny podle množství na kartách produktů · BETA/, /Zkopírovat zadání pro AI/, /data-won-ai-prompt="tiers"/] },
  { path: "tiers?plan=pro&state=custom", expect: [/Vlastní barvy nebo CSS jsou nastavené/, /Zapnuto: karty ukazují první úroveň/, /Přidat prvek do karty produktu/, /--won-tiers-accent/, /data-won-custom-look=""/, /Platí jen uvnitř tabulky/] },
  { path: "tiers?plan=pro&state=issue", expect: [/Uložené vlastní CSS nejde použít/] },
  // Překlady: a table per language with human names, the default text and the merchant's own; Free's limit and the Pro CSV in amber.
  {
    path: "translations",
    expect: [
      /<s-page heading="Překlady"/,
      /čeština · výchozí jazyk obchodu/,
      /slovenština/,
      /Upravených textů: 3/,
      /Upravených textů: 1/,
      // Grouped by where the text shows; a row = its place, the extension's text, the merchant's own.
      /data-won-text-group="tiers"[\s\S]*data-won-text-group="milestones"[\s\S]*data-won-text-group="cart"[\s\S]*data-won-text-group="outlet"[\s\S]*data-won-text-group="campaigns"[\s\S]*data-won-text-group="cards"/,
      /Nadpis tabulky<\/div><div data-won-text-default="true"[^>]*>Množstevní sleva<\/div>/,
      /name="tx\.cs\.tiers\.heading"[^>]*value="Kup víc, plať míň"/,
      /name="tx\.sk\.tiers\.heading"[^>]*value="Kúp viac, zaplať menej"/,
      // A Milníky discount step's own name is a row, named by the step.
      /Vlastní název odměny: Sleva 5[\s\u00a0]% od 2[\s\u00a0]000[\s\u00a0]Kč/,
      /name="tx\.cs\.cart\.ms_name\.ms-five"[^>]*value="Věrnostní sleva \{value\}"/,
      // Free at its two languages: the next one is Pro's, said in amber with the way to it; so is the CSV.
      /Ve Free přeložíte texty do výchozího jazyka a jednoho dalšího/,
      /V Pro si texty stáhnete do tabulky/,
      /href="\/app\/plan"/,
    ],
  },
  // Kontrola kombinací (bod 16): the common carts the app planned itself, first on Vyzkoušet košík; the counts on Přehled.
  {
    path: "try-cart?plan=pro&combos=on",
    expect: [
      /Časté kombinace/,
      /\d+ v pořádku, \d+ upozornění/,
      /Je to výpočet, ne skutečná objednávka/,
      /data-won-combos=""/,
      /data-won-combo="tiers" data-won-combo-status="warning"/,
      /Množstevní sleva \+ sleva z objednávky \+ doprava zdarma \+ dárek ze stupně/,
      /Stupeň se slevou · Slovensko/,
      /Ceny v této měně jsou odhad podle vašich částek/,
      /data-won-combo-finding="margin"[^>]*>Ochrana marže slevu snížila nebo zrušila[^<]*(<!-- -->)? <s-link href="\/app\/tiers#global">Otevřít množstevní slevy/,
      /data-won-combo-finding="step_superseded"[^>]*>[^<]*(<!-- -->)? <s-link href="\/app\/rewards#step-3">Otevřít 3\. stupeň Milníků/,
      /<s-link href="\/app\/try-cart\?scenario=tiers">Otevřít v košíku/,
    ],
    absent: [/data-won-combos-locked/],
  },
  // Free: how many have a warning, never which or why — the list is the amber locked block with what Pro gives.
  {
    path: "try-cart?combos=on",
    expect: [/Časté kombinace/, /\d+ v pořádku, \d+ upozornění/, /V Pro uvidíte, která kombinace má upozornění a proč/, /data-won-combos-locked=""/, /href="\/app\/plan"/],
    absent: [/data-won-combo=/, /data-won-combo-finding/, /Ochrana marže slevu snížila/, /scenario=/],
  },
  { path: "try-cart?plan=pro&combos=sample", expect: [/košíky proto počítá s ukázkovým/, /data-won-combo="tiers"/], absent: [/Otevřít v košíku/] },
  { path: "overview?combos=on", expect: [/data-won-tile="tryCart"[\s\S]{0,3000}\d+ v pořádku, \d+ upozornění<\/div>/] },
  { path: "try-cart?plan=pro", expect: [/Vyzkoušet košík/], absent: [/Časté kombinace/] },
  { path: "translations?plan=pro", expect: [/data-won-add-language/, /<s-option[^>]*value="de"[^>]*>němčina/, /Stáhnout CSV/, /Nahrát CSV/] },
  { path: "translations?state=empty", expect: [/čeština · výchozí jazyk obchodu/, /Výchozí texty/, /data-won-add-language/] },
  { path: "translations?state=no-scope", expect: [/Aplikace nemá svolení číst jazyky zapnuté v Shopify/, /Povolit čtení jazyků/] },
  // A language the extension has no texts of its own for (it ships Czech, Slovak, English): the page says what a customer sees without the merchant's text.
  { path: "translations?state=downgraded", expect: [/němčina/, /Ve Free se v tomto jazyce na webu ukazují výchozí texty/, /data-won-lang-fallback="de"><div[^>]*>[^<]*Bez vašeho textu se v tomto jazyce ukáže anglický/], absent: [/data-won-lang-fallback="(cs|sk)"/] },
  { path: "translations?plan=pro&state=import", expect: [/data-won-import-preview/, /Změní se: 1/, /Odmítnuto: 2/, /Množstevní tabulka: Nadpis tabulky · slovenština/, /V textu chybí \{amount\}/, /neznámý text „tiers\.unknown“/, /Uložit změny z importu/] },
  // Every other element's look is on its module's page: ready-made looks previewed with the extension's own markup,
  // the colour, and the Pro part (amber and locked on Free, with what Pro gives and the way to it).
  {
    path: "rewards?look=checklist",
    expect: [
      /Vzhled žebříčku na webu/,
      /Vzhled na webu: Odškrtávací seznam/,
      /<input type="radio" name="preset"[^>]*value="checklist"[^>]*checked=""|<input type="radio" name="preset"[^>]*checked=""[^>]*value="checklist"/,
      /Ukazatel se značkami/,
      /Jedna věta/,
      /data-won-look-preview="milestones"/,
      /class="won-ms won-ms--compact"/,
      /Krátce bliknout, když zákazník dosáhne stupně/,
      /V Pro sladíte žebříček s webem/,
      /data-won-ai-prompt="milestones"/,
      /Platí jen uvnitř žebříčku/,
      /data-won-look-form="milestones"/,
    ],
  },
  { path: "rewards?plan=pro&look=custom", expect: [/data-won-look-css=""/, /Uložit vzhled/], absent: [/V Pro sladíte žebříček s webem/] },
  { path: "rewards?plan=pro&look=issue", expect: [/Uložené vlastní CSS nejde použít/] },
  { path: "outlet?plan=pro&look=strip", expect: [/Vzhled štítku výprodeje/, /Vzhled na webu: Pruh/, /Štítek s odpočtem/, /data-won-look-preview="outlet"/, /class="won-outlet__badge"/, /data-won-ai-prompt="outlet"/] },
  { path: "campaigns?plan=pro&look=card", expect: [/Vzhled banneru kampaně/, /Vzhled na webu: Karta/, /Banner s odpočtem/, /data-won-look-preview="campaign"/, /class="won-campaign__title"/, /data-won-ai-prompt="campaign"/] },
  // Tarif (MVP 7): the plan in force, the Pro offer with its price and trial, cancel with what runs on, uninstall prep.
  {
    path: "plan",
    expect: [
      /Máte tarif Free\./,
      /Pro · 29 USD měsíčně/,
      /Vyzkoušet Pro na 14 dní zdarma/,
      /14 dní zdarma, potom 29 USD měsíčně\. Zrušíte kdykoli tady v Nastavení/,
      /Testovací platba/,
      /Připravit na odinstalaci/,
      /Obnoví v Shopify slevy: LETO15, Doprava zdarma nad 2 000 Kč/,
      /vrátí jejich ceny: 2/,
      // The page is reached from Nastavení (it left the menu): a breadcrumb back.
      /<s-link slot="breadcrumb-actions" href="\/app\/settings">Nastavení<\/s-link>/,
      // What Pro adds is a list of links to the pages, not one sentence.
      /Pro přidá:/,
      /<s-list-item><s-link href="\/app\/outlet">Výprodej<\/s-link><\/s-list-item>/,
      /<s-list-item><s-link href="\/app\/try-cart">Vyzkoušet košík<\/s-link><\/s-list-item>/,
      // "Připravit na odinstalaci" asks first.
      /<s-modal id="won-plan-uninstall-dialog" heading="Připravit obchod na odinstalaci\?"/,
    ],
  },
  {
    path: "plan?plan=pro",
    expect: [/Máte Pro na zkoušku do 18\. 10\. 2026 14:00/, /Zrušit Pro/, /Doběhne do konce: Víkend −20 %, běžící výprodeje \(2\)/, /V tarifu Pro máte:/, /<s-modal id="won-plan-cancel-dialog" heading="Zrušit tarif Pro\?"/, /Ponechat Pro/],
  },
  { path: "plan?plan=pro&state=dev", expect: [/vývojářským přepínačem/, /Vyzkoušet Pro na 14 dní zdarma/] },
  { path: "plan?state=unknown", expect: [/Shopify teď neodpověděl/] },
  { path: "plan?result=subscribe_failed", expect: [/Předplatné se nepodařilo založit\./, /Shopify u tohoto obchodu platbu nepovolil/] },
  { path: "plan?result=uninstall_partial", expect: [/Část se nepovedla\. Ukončené výprodeje: 1, obnovené slevy: 1\. Nepovedlo se: výprodej \(cena se nezapsala\)/] },
  { path: "plan?result=cancelled", expect: [/Pro je zrušené\. Platí tarif Free\./] },
  // Přehledy (MVP 7): Free numbers + a labelled example of the Pro rows; Pro: the shop's own rows; honest empty states.
  { path: "analytics", expect: [/Posledních 30 dní/, /Slevy stály/, /Průměrná objednávka/, /Ukázka, ne vaše čísla/, /Objednávek v jiné měně \(EUR\): 3/, /S Pro uvidíte u každé slevy, kolik stála/, /href="\/app\/plan"/] },
  {
    path: "analytics?plan=pro",
    expect: [/Podzimní sleva 10 %/, /<s-link href="\/app\/discounts\/dev-fixture-1">/, /61 obj\. · stála 7\s420\sKč · tržby 71\s980\sKč/, /Množstevní slevy/, /Dárky zdarma/, /Ostatní slevy v objednávkách/, /Rozdaných dárků: 12/, /<s-link href="\/app\/rewards">/, /Prodaných kusů ve výprodeji: 31/, /<s-link href="\/app\/outlet">/, /Tržby jsou mezisoučet objednávek/],
  },
  { path: "analytics?state=unavailable", expect: [/Shopify zatím aplikaci nepovolil číst objednávky/, /<s-button href="\/app\/discounts" variant="secondary">Zobrazit slevy/] },
  { path: "analytics?plan=pro&state=empty", expect: [/Zatím žádná objednávka\. Čísla se objeví s první objednávkou\./, /<s-button href="\/app\/discounts" variant="secondary">Zobrazit slevy/] },
  { path: "campaigns?plan=pro&result=invalid", expect: [/Kampaň se překrývá s „Black Friday“/, /Zaškrtněte aspoň jednu slevu/, /value="Podzimní akce"/, /value="08:15"/] },
  // An error about one discount sits at that discount, a time error at the time control; the typed values stay (B14).
  { path: "campaigns?plan=pro&result=invalid-rule", expect: [/Vyberte čas\./, /value="150"/, /Hodnota u slevy „Podzimní sleva 10 %“ nesedí/, /Podzimní akce · /] },
  { path: "campaigns?plan=pro&result=sync-pending", expect: [/V Shopify zatím změna není celá/, /Zkusit zapsat znovu/] },
  { path: "campaigns?plan=pro&state=empty", expect: [/Nová kampaň/, /Vyplňte název, začátek a konec/] },
  { path: "campaigns?state=finishing", expect: [/Běžela při přechodu na Free, doběhne do konce/] },
  { path: "overview?state=campaigns", expect: [/Kampaně/, /Aktivní: Víkend −20 % do 29\. 9\. 2026 0:00/, /<s-clickable href="\/app\/campaigns"/] },
  { path: "overview?state=campaigns&finishing=1", expect: [/1 věc k vyřešení/] },
  { path: "outlet", expect: [/Výprodej/, /S Pro doprodáte zvolený počet kusů varianty se slevou/, /Zobrazit tarif Pro/, /Aktivní výprodeje/, /Mikina Won — L/, /Znovu otevřít výprodej jde v tarifu Pro/, /Zobrazení a vratky/] },
  {
    path: "outlet?plan=pro",
    expect: [/Spustit výprodej/, /Vyberte variantu, počet kusů a slevu/, /Prodáno 7 z 10 ks, vráceno 1, zbývá 4/, /Prodáno o 1 ks víc, než bylo k doprodeji/, /Upravené trhy s vlastní cenou: Slovensko/, /Zkusit znovu/, /Ukončit výprodej „Mikina Won — L“\?/, /Znovu otevřít/],
  },
  { path: "outlet?plan=pro&result=invalid", expect: [/Vyberte variantu/, /Kusů k doprodeji zadejte celým číslem od 1 do/, /0 ks · −30\s% · do 12\. 10\. 2026/, /value="2026-10-12"/] },
  // B14: a failed start keeps the picked variant and the typed values; the price before → after is computed.
  { path: "outlet?plan=pro&result=failed", expect: [/Mikina Won — L · 10 ks · −30\s% · bez data konce/, /Cena varianty: 1\s490\sKč → 1\s043\sKč/, /Změnit variantu/] },
  { path: "outlet?result=settings-pro&state=empty", expect: [/Zobrazení výprodeje jde nastavit v tarifu Pro/] },
  { path: "overview?state=outlet", expect: [/Výprodej/, /data-won-state="attention"/, /3 věci k vyřešení/, /<s-clickable href="\/app\/outlet"/] },
  // 5a (F-O1): no order access yet — the module and the card say the quota is not counted (harness default).
  { path: "outlet?plan=pro&state=empty", expect: [/Prodané kusy se zatím nepočítají\. Výprodej skončí datem nebo ručně/, /href="#outlet-ends"/, /Bez přístupu k objednávkám výprodej po doprodání neskončí\. Nastavte datum konce/] },
  // Ochrana marže (MVP 2): the module screen per state, the Přehled card, the editor note, a capped cart line.
  {
    path: "margin",
    expect: [
      /Ochrana marže/,
      /Min\. marže 20\u00a0% · bez nákupní ceny sleva nejvýš 40\u00a0%/,
      /\(cena po slevách − nákupní cena\) \/ cena po slevách, z ceny, kterou platí zákazník — u cen s DPH včetně DPH/,
      /nikdy neblokuje objednávku/,
      /Ochrana hlídá jen slevy, které běží přes Won Discounts\. O slevách vytvořených přímo v Shopify neví\./,
      /href="\/app#native"/,
      /step="0\.1"/,
      /Nejvyšší sleva pro produkty bez nákupní ceny/,
      /8 produktů nemá nákupní cenu/,
      /Ponožky Won/,
      /shopify:\/\/admin\/products\/3/,
      /Obnovit nákupní ceny/,
      /Nákupní ceny ze Shopify/,
      /Nastavení podle kolekcí/,
      /Pro · odemknout/,
      /S Pro uvidíte, u kterých produktů a slev ochrana zasáhne/,
      /Přehled zásahů/,
      /Zaplatí 750|zaplatí 750\u00a0Kč/,
    ],
  },
  {
    path: "margin?plan=pro",
    expect: [
      /Vlastní nastavení: Podzimní kolekce a Doplňky/,
      /Podzimní kolekce/,
      /Doplňky/,
      /Ochrana sníží 5 slev/,
      /Sníží se u 4 variant/,
      /Mikina Won — M \/ černá/,
      /hranice z nákupní ceny/,
      /nastavení kolekce/,
      /Slevy z objednávky/,
      /ne z objednávek/,
      /Sleva ve Won nikdy nesrazí cenu pod hranici, kterou tu nastavíte\./,
    ],
  },
  // Audit P2-1: before the first complete read, unread products have only the ceiling — said, and the impact is still being computed.
  {
    path: "margin?plan=pro&state=running",
    expect: [/Právě načítáme nákupní ceny: 340 z 1\u00a0240/, /Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen nejvyšší sleva 40\u00a0%/, /href="#costs"/, /Počítáme, kde ochrana zasáhne/],
  },
  { path: "margin?state=running", expect: [/Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen nejvyšší sleva 40\u00a0%/, /href="#costs"/] },
  {
    path: "margin?state=failed-first",
    expect: [/Dokud nenačteme nákupní ceny, platí u nenačtených produktů jen nejvyšší sleva 40\u00a0%/, /href="#costs"/, /Nákupní ceny se nepodařilo načíst ze Shopify/, /Technický detail: costs\.read: Throttled/],
  },
  { path: "margin?state=reauth", expect: [/Otevřete aplikaci, ať můžeme pokračovat na pozadí/] },
  // P1-1: a Pro collection over the 10 000-product limit says so at its row.
  { path: "margin?plan=pro&state=too-large", expect: [/Kolekce má víc než 10\u00a0000 produktů, tolik Won při jedné synchronizaci nenačte\. Proto platí přísnější hodnota pro celý obchod\./, /Rozdělte ji v Shopify na menší kolekce, nebo její nastavení odeberte/] },
  // P2-2: counted per rule; the rows are only the largest losses.
  { path: "margin?plan=pro&state=many", expect: [/Sníží se u 20 variant/, /Ukazujeme 10 z 20 s největším rozdílem/, /U 20 variant by sleva šla pod hranici/] },
  { path: "margin?plan=pro&state=impact-updating", expect: [/Ochrana sníží 5 slev · přepočítává se/, /Čísla se na pozadí přepočítávají/] },
  { path: "margin?plan=pro&state=impact-computing", expect: [/Počítáme, kde ochrana zasáhne/, /Počítá se na pozadí z nastavení slev a nákupních cen/] },
  { path: "margin?plan=pro&state=zero", expect: [/Nákupní cenu mají všechny produkty/] },
  { path: "margin?state=off", expect: [/Ochrana marže je vypnutá/, /Neaktivní/, /Načteme je ze Shopify, až ochranu zapnete a uložíte/] },
  { path: "margin?state=gate", expect: [/Tohle je v tarifu Pro, zákazník to nedostane/, /Ochrana marže pro jednotlivé kolekce je funkce Pro/, /Min\. marže 30\u00a0% · bez nákupní ceny sleva nejvýš 10\u00a0%/] },
  { path: "margin?state=failed&result=refreshed", expect: [/Načtení selhalo 28\. 9\. 2026 06:10/, /Načítání nákupních cen běží/] },
  { path: "margin?plan=pro&rule=dev-f2-collection", expect: [/Jen sleva „Podzimní kolekce 20 %“/, /Zobrazit všechny zásahy/, /Ochrana sníží 1 slevu/, /Sníží se u 4 variant/] },
  { path: "margin?result=invalid", expect: [/Zadejte 0 až 95 %/, /value="150"/] },
  // B14: the refused values come back as typed (also the refused 120 of a collection row); Přehled zásahů says it shows the saved state.
  { path: "margin?plan=pro&result=invalid", expect: [/value="150"/, /value="120"/, /Nejvyšší sleva bez nákupní ceny: Zadejte 0 až 100 %/, /Přehled počítá s uloženým nastavením/] },
  // The save's fixes worded like the server words them (issue-copy), never the core's English message.
  { path: "margin?result=fixes", expect: [/Uloženo\. Pár věcí jsme upravili/, /Procenta marže mají jedno desetinné místo\. 12,55\u00a0% se zaokrouhlilo na 12,6\u00a0%/] },
  { path: "margin?result=fixes&locale=en", expect: [/Margin percents have one decimal\. 12\.55% was rounded to 12\.6%/] },
  { path: "overview?state=margin", expect: [/id="native"/, /Ochrana marže/, /Min\. marže 20\u00a0%/, /data-won-state="active"/] },
  { path: "overview?state=margin-off", expect: [/Ochrana marže je vypnutá/, /data-won-state="inactive"/, /<s-clickable href="\/app\/margin"/] },
  { path: "overview?state=margin-running", expect: [/Nákupní ceny se ještě načítají, zatím platí jen nejvyšší sleva/, /data-won-state="active"/] },
  { path: "overview?state=margin-reauth", expect: [/data-won-state="attention"/, /1 věc k vyřešení/] },
  { path: "overview?state=margin-too-large", expect: [/data-won-state="active"/, /1 věc k vyřešení/] },
  { path: "rule-editor?rule=dev-f2-collection&margin=1&plan=pro", expect: [/Na 4 variantách se sleva sníží na hranici marže/, /\/app\/margin\?rule=dev-f2-collection#impact/] },
  // Free: no number (přehled zásahů is Pro), the link goes to its Pro preview.
  { path: "rule-editor?rule=dev-f2-collection&margin=1", expect: [/Ochrana marže tuhle slevu u některých produktů sníží\./, /Přehled zásahů v Pro/, /href="\/app\/margin#impact"/] },
  { path: "rule-editor?rule=dev-f2-collection&margin=computing&plan=pro", expect: [/Dopad ochrany marže na tuhle slevu se právě počítá\./] },
  {
    path: "try-cart?state=margin",
    expect: [/Hranice marže/, /kurzem odhadnutým z cen v trhu/, /pokladna použije aktuální kurz Shopify/, /1 položka nemá nákupní cenu/, /cena neklesne pod nákupní cenu s minimální marží 30/],
  },
  { path: "margin?plan=pro&locale=en", expect: [/Margin protection/, /tax included for tax-inclusive prices/, /Refresh cost prices/, /Where protection steps in/] },
  { path: "plan", expect: [/Tarif/, /Pro · 29 USD/, /nejvýš 20 aktivních s kódem/, /Shopify jich od aplikací spustí nejvýš 25/] },
  // Nastavení after the menu change: markets with their one action, the tools, and the plan sections (Tarif) at the end.
  {
    path: "settings",
    expect: [
      /Trhy a měny/,
      // N15: every market with what it gets; a missing amount is a link to its field; the switched-off market is listed, greyed.
      /2 trhy · chybí částky: Slovensko/,
      /data-won-market="sk"/,
      /data-won-market-missing=""[^>]*>[\s\S]*?href="\/app\/rewards#amounts"/,
      /data-won-market-off=""/,
      /Vypnuté v Shopify/,
      /href="shopify:\/\/admin\/settings\/markets" target="_top"/,
      /Spravovat trhy v Shopify/,
      /Nástroje/,
      /Vyzkoušet košík/,
      /<h2 id="plan"[^>]*>Tarif<\/h2>/,
      // The list of the page's sections next to them: one link per section, the first one marked.
      /<nav class="won-jump__nav" aria-label="Na této stránce" data-won-section-nav="true"/,
      /<a class="won-jump__link" href="#combination" aria-current="location">Kombinování slev<\/a>/,
      /<a class="won-jump__link" href="#unknown-market">Zákazník ze země mimo vaše trhy<\/a>/,
      /<a class="won-jump__link" href="#plan">Tarif<\/a>/,
      // Navigace a stav, bod 4: the one section with a state of its own carries the dot (a market misses an amount) …
      /<a class="won-jump__link" href="#markets"><span class="won-jump__dot"><span data-won-dot="attention"[\s\S]{0,700}?>Vyžaduje pozornost: <\/span><\/span><\/span><\/span>Trhy a měny<\/a>/,
      /Máte tarif Free\./,
      /Vyzkoušet Pro na 14 dní zdarma/,
      /Připravit na odinstalaci/,
      /Kombinace u jednotlivých slev nastavíte v editoru slevy v tarifu Pro\./,
      /<s-link href="\/app\/discounts">Otevřít slevy<\/s-link>/,
    ],
    // … and the sections that have no state have no dot (P2).
    absent: [/href="#(combination|unknown-market|tools|plan)"[^>]*><span class="won-jump__dot"/],
  },
  { path: "settings?plan=pro", expect: [/Máte Pro na zkoušku do 18\. 10\. 2026 14:00/, /Zrušit Pro/] },
  // The sub-navigation of "Slevy" on its five pages (default order in the harness: no layout loader).
  { path: "discounts", expect: [/<nav aria-label="Slevy" data-won-subnav="true"/, /<a href="\/app\/discounts" aria-current="page"/] },
  { path: "tiers", expect: [/<nav aria-label="Slevy" data-won-subnav="true"/, /<a href="\/app\/tiers" aria-current="page"/] },
  { path: "rewards", expect: [/<nav aria-label="Slevy" data-won-subnav="true"/, /<a href="\/app\/rewards" aria-current="page"/] },
  { path: "outlet", expect: [/<nav aria-label="Slevy" data-won-subnav="true"/, /<a href="\/app\/outlet" aria-current="page"/] },
  { path: "campaigns", expect: [/<nav aria-label="Slevy" data-won-subnav="true"/, /<a href="\/app\/campaigns" aria-current="page"/] },
  // MVP 3: Množstevní slevy — the set, the honest sentences, the faithful preview (the storefront's K8 markup + texts +
  // money format), the table on the product page, the storefront config, the Pro sets (K1) and what Free does not run.
  {
    path: "tiers",
    expect: [
      /Množstevní sleva pro celý obchod/,
      /Od 3 ks −10\u00a0%, od 5 ks −15\u00a0%, od 10 ks −20\u00a0%/,
      /Tohle je v tarifu Pro, zákazník to nedostane/,
      /Produkty v ní ve Free nedostanou žádnou množstevní slevu/,
      /Varianty produktu dohromady/,
      /S jinou slevou na stejný produkt se nesčítá: platí ta, která dá zákazníkovi víc\./,
      /Teď se to týká 1 slevy na produkty\./,
      /href="\/app\/settings#combination"/,
      /Ochrana marže je zapnutá: u produktů s nízkou marží může úroveň vyjít nižší/,
      /Zboží ve výprodeji a dárky úroveň nedostanou/,
      /class="won-tiers won-tiers--highlight"/,
      /data-won-discounts-tiers=""/,
      /data-count-mode="product"/,
      /data-won-discounts-tier-row="" data-min="3" data-active="true"/,
      /data-won-discounts-live-price="" data-unit-cents="71100"/,
      /711,00 Kč\/ks/,
      /3\u00a0ks za 2\.133,00 Kč \(711,00 Kč\/ks\)/,
      /Ještě 2\u00a0ks a zaplatíte 671,50 Kč\/ks\./,
      // The look switcher is a visible, saved field of this form.
      /Vzhled na webu/,
      /<input type="radio" name="preset"[^>]* value="highlight"/,
      /<input type="radio" name="preset"[^>]* checked=""[^>]* value="highlight"|<input type="radio" name="preset" value="highlight"[^>]* checked=""/,
      /Vlastní barvy a CSS/,
      /href="#look-tiers"/,
      /Náhled nepočítá s ochranou marže/,
      /Tabulka je na stránce produktu \(vzhled Horizon\)/,
      /Zobrazit na mém webu/,
      /Výjimky pro produkty a kolekce/,
      /Produkt s výjimkou se řídí jen jí, úrovně pro celý obchod pro něj neplatí/,
      /Uloženo, ve Free neplatí: tyto produkty teď nedostanou žádnou množstevní slevu\. Když výjimku odeberete, dostanou úrovně pro celý obchod\./,
      /Každý řádek košíku zvlášť/,
      // Free: how many sets are stored and that they do not apply; what they pick is listed by name.
      /Uložena 1 výjimka, ve Free neplatí/,
      /Mikina Won/,
      /Podzimní kolekce/,
      /V Pro nastavíte výjimky: jiné úrovně pro vybrané produkty a kolekce/,
      /aria-current="true"/,
      /aria-label="Ubrat kus"/,
      /aria-label="Přidat kus"/,
    ],
  },
  {
    path: "tiers?plan=pro",
    expect: [/Vybrat produkty/, /Vybrat kolekce/, /Mikina Won/, /Podzimní kolekce/, /Celý košík/, /Slovensko \(EUR\): úroveň od 6 ks se nenabízí/, /Od 2 ks −30\u00a0Kč \/ 1,20\u00a0€ za kus/],
  },
  {
    path: "tiers?state=empty",
    expect: [
      /Bez množstevních slev/,
      /data-won-state="inactive"/,
      /Přidejte první úroveň, nebo začněte hotovými úrovněmi/,
      /3 \/ 5 \/ 10 ks → 5 \/ 10 \/ 15 %/,
      /Ukázka: zatím nemáte žádnou úroveň/,
      /Tabulka zatím na stránce produktu není/,
      /Na webu chybí/,
      /Přidat na web/,
      /addAppBlockId=dev-api-key\/quantity_tiers&amp;target=mainSection/,
      /Žádná výjimka/,
    ],
  },
  {
    path: "tiers?state=failed",
    expect: [/Uložení na web selhalo 28\. 9\. 2026 16:20\. Do opravy může web ukazovat starší \(i vyšší\) úrovně, pokladna platí nové/, /Zkusit zapsat znovu/, /Nastavení tabulky na stránce produktu se na web nezapsalo \(metafieldsSet: Throttled/],
  },
  // Review fix 7: never written before → no "previous settings" to show.
  { path: "tiers?state=failed-first", expect: [/Uložení na web selhalo 28\. 9\. 2026 16:20\. Tabulka se na webu zatím neukazuje/, /Zkusit zapsat znovu/] },
  { path: "tiers?state=pending", expect: [/Poslední změna na webu ještě není/] },
  // Audit P3-8: only in an alternate template → not "on the product page"; the fix button stays.
  { path: "tiers?state=alternate", expect: [/Tabulka je jen u produktů se šablonou „bundle“\. Na stránce produktu, kterou používá většina produktů, zatím není\./, /Na webu chybí/, /Přidat na web/] },
  // Review fix 5: clearance items combine → they can get a tier; gifts never.
  { path: "tiers?state=outlet", expect: [/Dárky úroveň nedostanou\. Zboží ve výprodeji ji dostat může/] },
  // Review fix 18: Pro sees how many products each Pro set reaches (Free sees nothing).
  { path: "tiers?plan=pro&state=dawn", expect: [/Podle poslední synchronizace platí pro 14 produktů/] },
  // Audit: the checkout's room for tiers as a share (cap 550 B), with what takes room.
  // The room is said only close to its limit — and where the save was refused for it, at that line.
  { path: "tiers?plan=pro&result=too-large", expect: [/Místo pro úrovně v pokladně: využito \d+\u00a0%/, /id="capacity"/, /Úrovně by se do pokladny nevešly \(zabraly by 112\u00a0% místa/] },
  // A stored Pro custom look and a changed storefront text reach the preview (Pro only: BILL-1).
  { path: "tiers?plan=pro&state=custom", expect: [/data-won-custom-look=""/, /--won-tiers-accent:#0a7d4f/, /<p class="won-tiers__heading">Kup víc, plať míň<\/p>/] },
  // Odměny: the state lines say the real values; every state of the app embed check has its sentence and action.
  { path: "rewards", expect: [/<s-page heading="Milníky"/, /Doprava zdarma od 1\u00a0000\u00a0Kč \/ 40\u00a0€/, /Dárek: Ponožky Won — M od 1\u00a0500\u00a0Kč/, /Hodnota košíku se počítá před slevami/, /Kde je to vidět na webu/, /Česko: ve Free tu tento stupeň neplatí/, /Stupňů: 3 z 4/] },
  { path: "rewards?plan=pro", expect: [/3\. stupeň/, /Kšiltovka Won, Plátěná taška Won nebo Hrnek Won od 3\u00a0000\u00a0Kč \/ 120\u00a0€/, /Přidat stupeň/, /Změnit záložní dárek/] },
  { path: "rewards?plan=pro&state=discounts", expect: [/Sleva 5\u00a0% od 2\u00a0000\u00a0Kč \/ 80\u00a0€/, /Sleva 500\u00a0Kč \/ 20\u00a0€ od 5\u00a0000\u00a0Kč \/ 200\u00a0€/, /Stupňů: 5 z 12/, /Na rozdíl od dárku se sleva počítá ze zboží po slevách na produkty/] },
  { path: "rewards?plan=pro&state=discounts&markets=shared", expect: [/data-won-ms-table="3"/, /name="ms\.ms-fixed\.amount\.EUR@de" label="5\. stupeň, Německo \(EUR\)"/, /name="ms\.ms-fixed\.off\.EUR@sk" label="Sleva: Slovensko \(EUR\)"/] },
  { path: "rewards?state=empty", expect: [/Žádný stupeň/, /Přidat první stupeň/, /Košík žebříček neukazuje\. Won není na webu zapnutý/, /Zapnout na webu/] },
  { path: "rewards?state=embed-draft", expect: [/Won je zapnutý jen v nepublikovaném vzhledu obchodu/, /Zapněte Won i ve vzhledu, který zákazníci vidí/] },
  { path: "rewards?state=embed-unknown", expect: [/Nepodařilo se zjistit, jestli je Won na webu zapnutý/, /Otevřít úpravu vzhledu obchodu/] },
  { path: "rewards?state=embed-no-scope", expect: [/Won nemá přístup ke vzhledu obchodu/, /Otevřít úpravu vzhledu obchodu/] },
  { path: "rewards?result=invalid", expect: [/Vyberte dárek\./] },
  { path: "rewards?plan=pro&result=too-many", expect: [/V jednom trhu může platit nejvýš 6 stupňů\./] },
  { path: "rewards?result=limit-free", expect: [/Free má v každém trhu 2 stupně\. Odeberte stupeň, nechte u něj pole trhu prázdné, nebo přejděte na Pro, kde jich je 6\./] },
  // Review fix 3: plan-aware — on Pro a rule may stack with the ones its editor combines.
  { path: "settings?plan=pro", expect: [/V Pro se sečtou jen ty, které v editoru slevy spojíte\. Množstevní sleva se s jinou slevou na stejný produkt nesčítá nikdy/] },
  { path: "tiers?state=dawn", expect: [/--won-tiers-accent:#c0392b/, /--inputs-radius:0px/] },
  // Without access to the theme the check says nothing (no sentence without an action); the rest of the section stays.
  { path: "tiers?state=no-scope", expect: [/Tabulka na stránce produktu/, /Zobrazit na mém webu/] },
  { path: "tiers?result=invalid", expect: [/Sleva tady musí být aspoň taková jako od 3 ks/, /Úroveň od 5 ks už tu je/] },
  {
    path: "tiers?locale=en",
    expect: [/Quantity discounts/, /Quantity discount for the whole store/, /From 3 items −10%, from 5 items −15%, from 10 items −20%/, /Quantity discount/, /711,00 Kč each/, /Add table to the product page|View on my site/],
  },
  {
    path: "settings",
    expect: [
      /Kombinování slev/,
      /Sčítá se: produkty s objednávkou, produkty s dopravou a objednávka s dopravou/,
      /Dvě slevy na stejný produkt se nesčítají, platí výhodnější\. Množstevní sleva se s jinou slevou na stejný produkt nesčítá nikdy\./,
      /Zboží ve výprodeji další slevy nedostane/,
      /Platí pro zboží ve výprodeji \(modul Výprodej, Pro\)/,
      /Obě se sčítají\. Sleva z objednávky se počítá z ceny po slevách na produkty/,
      /href="\/app\/try-cart"/,
    ],
  },
  { path: "settings?state=changed", expect: [/Sčítá se: objednávka s dopravou/, /Platí buď slevy na produkty, nebo sleva z objednávky/, /Když má košík slevu na produkt \(i množstevní\), sleva na dopravu se neuplatní/] },
  { path: "settings?locale=en", expect: [/Combining discounts/, /Adds up: products with order, products with shipping and order with shipping/] },
  { path: "overview?state=tiers", expect: [/Množstevní slevy/, /Od 3 ks −10\u00a0%, od 5 ks −15\u00a0%, od 10 ks −20\u00a0%/, /1 věc k vyřešení/, /<s-clickable href="\/app\/tiers"/] },
  { path: "overview?state=tiers-empty", expect: [/Zatím žádná úroveň\. Kupte víc, zaplaťte míň/, /data-won-state="inactive"/] },
  {
    path: "try-cart?state=tiers",
    expect: [/Čepice/, /Množstevní sleva \(od 3 ks −10\u00a0%\) ušetří 156\u00a0Kč/, /Přidejte 1 ks a dostanete −15\u00a0%/, />Množstevní sleva</],
  },
  { path: "try-cart?state=tiers&plan=pro", expect: [/Množstevní sleva \(od 2 ks −30\u00a0Kč za kus\) ušetří 60\u00a0Kč/] },
  { path: "rule-editor?rule=dev-f2-collection&tiers=1", expect: [/Na produktech s množstevní slevou platí výhodnější z nich: tahle sleva, nebo úroveň\. Nesčítají se\./, /href="\/app\/tiers"/] },
  {
    path: "overview?state=live&locale=en",
    expect: [/Discounts &amp; codes/, /Needs attention/, /Discounts outside Won/, /Move all \(2\)/, /1 scheduled/],
  },
  { path: "rule-editor?locale=en", expect: [/Amount: Slovensko \(EUR\)/, /not offered/] },
];

let prevEnv: string | undefined;
before(() => {
  prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
});
after(() => {
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
});

async function render(path: string): Promise<{ status: number; html: string }> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const routes = [{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  if (context instanceof Response) return { status: context.status, html: "" };
  // A thrown 404 is asserted by status; rendering it would only print React
  // Router's default ErrorBoundary into the test log.
  if (context.statusCode !== 200) return { status: context.statusCode, html: "" };
  const router = createStaticRouter(handler.dataRoutes, context);
  const html = renderToString(createElement(StaticRouterProvider, { router, context }));
  return { status: context.statusCode, html };
}

for (const screen of SCREENS) {
  test(`harness renders /dev/preview/${screen.path} without auth`, async () => {
    const { status, html } = await render(screen.path);
    assert.equal(status, 200);
    assert.match(html, /<s-page/);
    for (const re of screen.expect) assert.match(html, re, `${screen.path}: expected ${re}`);
    for (const re of screen.absent ?? []) assert.doesNotMatch(html, re, `${screen.path}: not expected ${re}`);
    // §4c: nothing machine-shaped leaks into the page text (the serialized
    // loader data in <script> is data, not text, so it is left out).
    // Překlady shows the extension's own texts (the default column, the fields' placeholders) and the merchant's
    // (the fields' values) — those DO contain the storefront's `{n}` / `{value}` slots (the merchant must keep
    // them), so they are data too.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/ placeholder="[^"]*"/g, "")
      .replace(/(<div data-won-text-default="true"[^>]*>)[^<]*/g, "$1")
      .replace(/(name="tx\.[^"]*"[^>]*) value="[^"]*"/g, "$1");
    assert.doesNotMatch(text, /\{(n|name|value|currency|rule|currencies|date|count)\}/, `${screen.path}: leftover placeholder`);
    assert.doesNotMatch(text, />[^<]*\bundefined\b[^<]*</, `${screen.path}: "undefined" in text`);
    assert.doesNotMatch(text, />[^<]*\b(freeShipping|percentage|not_wired|draft_only|not_synced|max_percent|rateEstimated|linesWithoutCost)\b[^<]*</, `${screen.path}: raw enum in text`);
    // Copy must not promise what does not exist: no "unlimited", no segments "after connecting".
    assert.doesNotMatch(text, /neomezeně|unlimited|po napojení/i, `${screen.path}: overclaiming copy`);
  });
}

test("an unknown harness screen is a 404; the 'coming soon' page is gone", async () => {
  const { status } = await render("does-not-exist");
  assert.equal(status, 404);
  assert.equal((await render("coming-soon")).status, 404);
  assert.equal((await render("coming-soon?module=tiers")).status, 404);
});

test("Tarif: nothing without an action, nothing for developers in production, a failure in the merchant's words", async () => {
  // P2: with nothing to put back, "Připravit na odinstalaci" is not shown at all (no section, no dialog).
  const clean = (await render("plan?state=clean")).html;
  assert.doesNotMatch(clean, /Připravit na odinstalaci/);
  assert.doesNotMatch(clean, /won-plan-uninstall-dialog/);
  // Free has nothing to cancel: no cancel dialog.
  assert.doesNotMatch((await render("plan")).html, /won-plan-cancel-dialog/);
  // Production: the dev override and the test charge are not mentioned; the plan in force is.
  const production = (await render("plan?plan=pro&state=production")).html;
  assert.doesNotMatch(production, /Testovací platba|vývojářským přepínačem/);
  assert.match(production, /Máte Pro na zkoušku/);
  assert.doesNotMatch((await render("settings?planState=production")).html, /Testovací platba/);
  // A failed subscribe never shows Shopify's raw text when the cause is known.
  // (The serialized loader data in <script> is data, not text.)
  assert.doesNotMatch((await render("plan?result=subscribe_failed")).html.replace(/<script[\s\S]*?<\/script>/g, ""), /Shop cannot accept charges/);
  // The stray "Přejít na Přehled" button is gone, Free does not promise the cart preview (it is Pro), and no page uses the plan forms as page submits.
  const plan = (await render("plan")).html;
  assert.doesNotMatch(plan, /Přejít na Přehled/);
  assert.doesNotMatch(plan, /náhled košíku/);
  assert.doesNotMatch(plan, /type="submit"/);
});

test("Nastavení: 'Vyzkoušet v košíku' only for saved switches; the sub-navigation is not on pages outside Slevy", async () => {
  const settings = (await render("settings")).html;
  assert.match(settings, /Vyzkoušet v košíku/);
  assert.doesNotMatch(settings, /Nejdřív změny uložte/, "nothing changed yet: the button, not the note");
  for (const path of ["settings", "plan", "overview", "rule-editor", "margin", "translations", "analytics", "try-cart"]) {
    assert.doesNotMatch((await render(path)).html, /data-won-subnav/, `${path}: no sub-navigation`);
  }
});

test("review fixes in the harness: no Pro product counts on Free, no 'per product on Free' note unless the stored set counts the whole cart, clearance said only as it is", async () => {
  const free = await render("tiers");
  assert.doesNotMatch(free.html, /Podle poslední synchronizace platí pro/, "Free: no Pro numbers (BILL-1)");
  assert.doesNotMatch(free.html, /Na Free se místo celého košíku počítá po produktech/, "the stored set counts per product: nothing to explain");
  assert.match(free.html, /Zboží ve výprodeji a dárky úroveň nedostanou/);
  assert.doesNotMatch((await render("settings")).html, /V Pro se sečtou/, "Free: no Pro stacking claim");
});

test("plan 2026-10-06, dávka 5: nothing without content or action — no room-for-tiers line far from the limit, no 'everything is current' row, no dead Pro sample, no raw text keys, no embed section when it is on", async () => {
  const pro = (await render("tiers?plan=pro")).html;
  assert.doesNotMatch(pro, /Místo pro úrovně v pokladně/, "far from the limit: nothing to say");
  assert.doesNotMatch(pro, /Web má aktuální nastavení/);
  assert.doesNotMatch(pro, /Barvy a písmo z tématu|náhled ukáže, jen pokud/, "no font / theme notes under the preview");
  assert.match(pro, /Přidat výjimku/);
  const free = (await render("tiers")).html;
  assert.doesNotMatch(free, /Přidat výjimku/, "Free: no button that does nothing");
  assert.doesNotMatch(free, /Kolekce Doplňky|data-won-custom-look/, "no invented sample; no Pro look on Free");
  assert.match(free, /<s-link href="\/app\/plan">[\s\S]{0,400}?Pro · odemknout/, "the locked Pro marker is a link to the plan");
  const empty = (await render("tiers?state=empty")).html;
  assert.doesNotMatch(empty, /Kolekce Doplňky|Přidat výjimku/);
  // Feedback 3, bod 5: a placement that cannot be checked says so with the grey label and "Zkontrolovat znovu".
  assert.match((await render("tiers?state=no-scope")).html, /data-won-placement="unknown"[\s\S]*Zkontrolovat znovu/);
  assert.doesNotMatch((await render("tiers?plan=pro&state=custom&plan=free")).html, /Kolekce Doplňky/);
  // The storefront texts are Překlady's: no module page carries a text field.
  for (const path of ["tiers", "rewards", "outlet?plan=pro", "campaigns?plan=pro"]) assert.doesNotMatch((await render(path)).html, /name="tx\./, path);
  // Překlady never shows a text's key as its name.
  assert.doesNotMatch((await render("translations")).html.replace(/name="tx\.[^"]*"/g, ""), />(tiers|cart|cards|outlet|campaign)\.[a-z_]+</);
  assert.doesNotMatch((await render("tiers?state=custom")).html, /data-won-custom-look/, "Free never previews the Pro custom look (BILL-1)");
  const rewards = (await render("rewards")).html;
  // The green label is the STORED state (the same as the home tile), never the page's own unsaved form: the
  // "Stupně" tile carries it, once (the section under the tile does not repeat it).
  assert.equal((rewards.replace(/<script[\s\S]*?<\/script>/g, "").match(/data-won-state="active"/g) ?? []).length, 1, "the tile alone");
});

test("the tier note is only for a product rule (an order rule does not compete with a tier)", async () => {
  const { html } = await render("rule-editor?rule=dev-fixture-1&tiers=1");
  assert.doesNotMatch(html, /Na produktech s množstevní slevou/);
});

test("MVP 3 screens: one save for the whole form, last on the page", async () => {
  for (const path of ["tiers", "tiers?plan=pro", "settings"]) {
    // The page's own form (the first one; a look's section below it is a form of its own with its own save).
    const { html } = await render(path);
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    const submit = form.lastIndexOf('type="submit"');
    assert.ok(submit > 0, `${path}: a submit button`);
    assert.equal(form.indexOf('type="submit"'), submit, `${path}: exactly one submit button`);
    assert.match(form, /data-save-bar/, `${path}: the App Bridge save bar`);
  }
  // Each further form on Množstevní slevy saves one thing and says which.
  const forms = [...(await render("tiers?plan=pro")).html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0]);
  assert.deepEqual(forms.slice(1).map((f) => (f.match(/type="submit"/g) ?? []).length), [1, 1]);
  assert.match(forms[1]!, /data-won-look-form="tiers"[\s\S]*Uložit vzhled/);
  assert.match(forms[2]!, /data-won-cards-form=""/);
});

test("the preview is the storefront's markup (K8) with the storefront CSS confined to it — never a style for the admin", async () => {
  const { html } = await render("tiers");
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  assert.match(style, /^\.won-tiers-preview \{/, "every storefront rule nested under the preview scope");
  assert.match(style, /\.won-tiers--chips \.won-tiers__row/);
  // The markers the storefront script reads, in the K8 order.
  const block = html.slice(html.indexOf('class="won-tiers won-tiers--'));
  for (const marker of ["won-tiers__heading", "won-tiers__list", "won-tiers__row", "won-tiers__qty", "won-tiers__save", "won-tiers__unit", "won-tiers__live", "won-tiers__next"]) {
    assert.ok(block.includes(marker), marker);
  }
  assert.match(block, /<ol class="won-tiers__list" role="list">/);
});

/** Post a form to the harness as a page does; the action's answer, or the status it threw. */
async function post(path: string, fields: Record<string, string>): Promise<{ status: number; data: unknown }> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const handler = createStaticHandler([{ id: "preview", path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }]);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`, { method: "POST", body }));
  if (context instanceof Response) return { status: context.status, data: null };
  return { status: context.statusCode, data: context.actionData?.preview ?? null };
}

test("the harness action (forms posted in a preview) is guarded like the loader", async () => {
  assert.deepEqual(await post("tiers", { intent: "save" }), { status: 200, data: { ok: false, reason: "preview_only" } });
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await post("tiers", { intent: "save" })).status, 404);
  } finally {
    process.env.NODE_ENV = "test";
  }
});

test("the harness answers the CSV of Překlady for real (Pro), saves nothing, and refuses it on Free like the server", async () => {
  const exported = (await post("translations?plan=pro", { intent: "export" })).data as { ok: boolean; message: string; csv: string };
  assert.equal(exported.message, "export");
  assert.match(exported.csv, /Kúp viac, zaplať menej/);
  const changed = exported.csv.replace("Kúp viac, zaplať menej", "Kúp viac a ušetri").replace("Ušetříte celkem {amount}", "Ušetříte celkem");
  const planned = (await post("translations?plan=pro", { intent: "import-preview", csv: changed })).data as { message: string; plan: { changes: unknown[]; refused: unknown[] } };
  assert.equal(planned.message, "import-preview");
  assert.equal(planned.plan.changes.length, 1);
  assert.equal(planned.plan.refused.length, 1, "the text that lost {amount}");
  assert.deepEqual((await post("translations?plan=pro", { intent: "import-apply", csv: changed })).data, { ok: false, reason: "preview_only" });
  const free = (await post("translations", { intent: "export" })).data as { ok: boolean; errors: { key: string }[] };
  assert.equal(free.ok, false);
  assert.equal(free.errors[0]?.key, "translations.error.pro");
});

test("Ochrana marže: one save for the whole form, last on the page — after the read-only Přehled zásahů", async () => {
  for (const path of ["margin", "margin?plan=pro"]) {
    const { html } = await render(path);
    const submit = html.lastIndexOf('type="submit"');
    assert.equal(html.indexOf('type="submit"'), submit, `${path}: exactly one submit button`);
    for (const section of ["Ochrana marže", "Nákupní ceny", "Nastavení podle kolekcí", "Přehled zásahů"]) {
      assert.ok(html.indexOf(section) < submit, `${path}: "${section}" comes before Uložit`);
    }
  }
});

test("P2 (plan 6 Oct 2026): what has neither content nor an action is not rendered", async () => {
  // Přehled: no checkout row, no config footer, no targeting lecture; "Slevy vytvořené přímo v Shopify" only when there is something to do.
  const clean = (await render("overview?state=clean")).html;
  assert.doesNotMatch(clean, /id="native"/, "nothing outside Won: the section is not there");
  assert.doesNotMatch(clean, /Slevy platí v pokladně<|přijde v další verzi|Konfigurace: verze|Nejpozději po 24 hodinách/);
  assert.doesNotMatch(clean, /id="analytics"/, "the Přehledy card is hidden without numbers");
  const bare = (await render("overview")).html;
  assert.doesNotMatch(bare, /id="native"|Zatím nezkontrolováno|Kontrola slev v Shopify se zapne/);
  // The margin page says the protection does not see the discounts outside Won, with the link to them.
  assert.match((await render("margin")).html, /href="\/app#native"/);
  // B11: read-only disables Move / Undo.
  const readOnly = (await render("overview?state=live&readOnly=1")).html;
  assert.match(readOnly, /commandFor="won-move-dialog" command="--show" disabled="[^"]*">Přesunout/);
  assert.match(readOnly, /commandFor="won-undo-dialog" command="--show" disabled="[^"]*">Vrátit zpět/);
  assert.doesNotMatch((await render("overview?state=live")).html, /commandFor="won-move-dialog" command="--show" disabled=/);

  // Přehledy without numbers: one sentence and one next step — no tiles, no chart, no Pro rows for a Pro shop.
  for (const path of ["analytics?state=empty", "analytics?state=unavailable", "analytics?plan=pro&state=empty"]) {
    const html = (await render(path)).html;
    assert.match(html, /data-won-analytics-empty/, path);
    assert.doesNotMatch(html, /data-won-analytics-tiles|data-won-analytics-chart/, path);
  }
  assert.doesNotMatch((await render("analytics?plan=pro&state=empty")).html, /data-won-analytics-rules|Ukázka/);
  assert.doesNotMatch((await render("analytics?plan=pro")).html, /Ukázka/);

  // Vyzkoušet košík: no result section before a result, no free-text codes field, no "next version" promise.
  const tool = (await render("try-cart?state=empty")).html;
  assert.doesNotMatch(tool, /Co se uplatní|Zatím nespočítáno|name="codes"|přijde v další verzi/);
  assert.doesNotMatch((await render("try-cart")).html, /Co se uplatní|Celkem/, "Free: the locked frame, never a result");
  // Onboarding: one count for the guide and Přehled's card.
  assert.match((await render("overview?state=empty")).html, /Krok 1 z/);
});

test("navigace a stav, body 1 a 2: a view tile says only what changes; the section under it does not repeat the label or the sentence", async () => {
  const section = (html: string, id: string) => {
    const start = html.indexOf(`<section id="${id}"`);
    assert.ok(start >= 0, `section #${id}`);
    return html.slice(start, html.indexOf("</section>", start));
  };
  const viewTile = (html: string, id: string) => {
    const start = html.indexOf(`data-won-view-tile="${id}"`);
    assert.ok(start >= 0, `view tile ${id}`);
    return html.slice(start, html.indexOf("</button>", start));
  };
  const count = (html: string, text: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").split(text).length - 1;

  // Množstevní slevy: the label and the levels on the tile, once; the section keeps its name and what it is for.
  const tiers = (await render("tiers")).html;
  assert.match(viewTile(tiers, "global"), /data-won-state="active"[\s\S]*Od 3 ks −10\s%, od 5 ks −15\s%, od 10 ks −20\s%/);
  assert.doesNotMatch(viewTile(tiers, "global"), /data-won-tile-about|Úrovně slevy podle počtu kusů/);
  assert.match(section(tiers, "global"), /Množstevní sleva pro celý obchod[\s\S]*Platí pro všechny produkty\./);
  assert.doesNotMatch(section(tiers, "global").slice(0, 2500), /data-won-state=|Od 3 ks −10\s%, od 5 ks −15\s%/);
  // The table: where it stands is the tile's sentence; the section says what it is for .
  assert.equal(count(tiers, "Tabulka je na stránce produktu (vzhled Horizon)."), 1);
  assert.match(section(tiers, "block"), /Tabulka úrovní na stránce produktu: jestli je na webu a jak ji přidat\./);
  // A locked Pro tile keeps the amber look and its marker, also without the description.
  assert.match(viewTile(tiers, "exceptions"), /data-won-tile-locked[\s\S]*Pro · odemknout[\s\S]*Uložena 1 výjimka, ve Free neplatí/);
  assert.equal(count(tiers, "Uložena 1 výjimka, ve Free neplatí"), 1);

  // Ochrana marže: every view's sentence once.
  const margin = (await render("margin?plan=pro")).html;
  assert.match(viewTile(margin, "settings"), /data-won-state="active"/);
  assert.doesNotMatch(section(margin, "settings").slice(0, 2500), /data-won-state=/);
  for (const anchor of ["costs", "collections", "impact"]) assert.match(viewTile(margin, anchor), /data-won-tile-active/, `${anchor}: the tile says what is set`);
  assert.match(section(margin, "costs"), /Ke kolika produktům známe nákupní cenu a které ji nemají\./);
  assert.match(section(margin, "impact"), /Které slevy ochrana sníží a u kolika variant\./);

  // Milníky, Výprodej, Kampaně: the green / red label is the tile's alone; the home tile still describes the module.
  for (const [path, view, anchor] of [
    ["rewards", "steps", "steps"],
    ["outlet?plan=pro", "sales", "running"],
    ["campaigns?plan=pro", "list", "list"],
  ] as const) {
    const html = (await render(path)).html;
    assert.match(viewTile(html, view), /data-won-state="(active|attention)"/, path);
    assert.doesNotMatch(section(html, anchor).slice(0, 2500), /data-won-state=/, path);
    assert.doesNotMatch(html, /data-won-tile-about/, path);
  }
  const outlet = (await render("outlet?plan=pro")).html;
  assert.equal(count(outlet, "2 věci k vyřešení"), 1, "the count is on the tile, not again over the list");
  assert.match((await render("campaigns?plan=pro")).html, /Co právě běží, co je naplánované a co už skončilo\./);
  assert.match((await render("overview?state=modules")).html, /data-won-tile="tiers"[\s\S]*?data-won-tile-about/);
});

test("navigace a stav, bod 3: the strip under 'Slevy' carries a dot per module, the same state as its home tile; a locked module has the Pro badge and no dot", async () => {
  const link = (html: string, key: string) => {
    const at = html.indexOf(`data-won-subnav-item="${key}"`);
    assert.ok(at >= 0, `strip item ${key}`);
    return html.slice(html.lastIndexOf("<a ", at), html.indexOf("</a>", at));
  };
  const dot = (html: string, key: string) => /data-won-dot="(\w+)"/.exec(link(html, key))?.[1] ?? null;
  const tileState = (html: string, key: string) => /data-won-state="(\w+)"/.exec(html.slice(html.indexOf(`data-won-tile="${key}"`), html.indexOf("</s-clickable>", html.indexOf(`data-won-tile="${key}"`))))?.[1] ?? null;
  for (const [nav, overview] of [
    ["", "modules"],
    ["&nav=failed", "modules-failed"],
    ["&nav=off", "modules-off"],
  ] as const) {
    for (const plan of ["", "&plan=pro"]) {
      const strip = (await render(`tiers?x=1${nav}${plan}`)).html;
      const home = (await render(`overview?state=${overview}${plan}`)).html;
      for (const [page, tile] of [["discounts", "codes"], ["tiers", "tiers"], ["rewards", "rewards"], ["outlet", "outlet"], ["campaigns", "campaigns"]] as const) {
        const state = tileState(home, tile);
        // The tile says "locked" with its Pro marker and no label; the strip then has the badge and no dot.
        assert.equal(dot(strip, page), state, `${page}${nav}${plan}: the dot is the tile's state`);
        if (state === null) assert.match(link(strip, page), /data-won-plan-badge="pro"/, `${page}${nav}${plan}`);
      }
    }
  }
  const free = (await render("rewards")).html;
  assert.match(link(free, "discounts"), /data-won-dot="active"[\s\S]*>Aktivní: <\/span><\/span>/, "the state in words for screen readers");
  assert.doesNotMatch(link(free, "outlet"), /data-won-dot/);
  // The strip is the same on the five pages; pages outside "Slevy" have neither the strip nor its dots.
  const stripOf = (html: string) => html.slice(html.indexOf("data-won-subnav"), html.indexOf("</nav>", html.indexOf("data-won-subnav")));
  for (const path of ["discounts", "tiers", "rewards", "outlet", "campaigns"]) assert.equal((stripOf((await render(path)).html).match(/data-won-dot=/g) ?? []).length, 3, path);
  for (const path of ["margin", "translations", "analytics"]) assert.doesNotMatch((await render(path)).html, /data-won-subnav|data-won-dot=/, path);
});

test("navigace a stav, bod 5: the rule editor has the list of its sections; a red dot where the draft has something to fix, none elsewhere", async () => {
  const nav = (html: string) => {
    const start = html.indexOf("data-won-section-nav");
    assert.ok(start >= 0, "the list of sections");
    return html.slice(start, html.indexOf("</nav>", start));
  };
  const dotted = (html: string) => [...nav(html).matchAll(/href="#(\w+)"[^>]*>(<span class="won-jump__dot"><span data-won-dot="(\w+)")?/g)].map((m) => `${m[1]}${m[3] ? `:${m[3]}` : ""}`);
  // "Černý pátek": the amount is missing in EUR — the first section holds the marker, so it holds the dot.
  const html = (await render("rule-editor")).html;
  assert.match(html, /<nav class="won-jump__nav" aria-label="Na této stránce"/);
  assert.deepEqual(dotted(html), ["discount:attention", "conditions", "codes", "schedule", "pro"]);
  assert.match(nav(html), />Vyžaduje pozornost: <\/span><\/span><\/span><\/span>Sleva<\/a>/);
  for (const label of ["Podmínky", "Jak se uplatní", "Kdy platí", "Pro koho platí a kombinace"]) assert.match(nav(html), new RegExp(`<a class="won-jump__link" href="#\\w+">${label}</a>`), label);
  // Every link has its section on the page (the first section got its anchor; the old ones are where they were).
  for (const anchor of ["discount", "conditions", "codes", "schedule", "pro"]) assert.match(html, new RegExp(`<section id="${anchor}"`), anchor);
  for (const anchor of ["value", "target", "markets", "combines"]) assert.match(html, new RegExp(`<div id="${anchor}"`), `deep link #${anchor}`);
  // The dot follows the marker's section: a minimum missing in EUR (Podmínky), a Pro setting the plan does not run
  // or checkout cannot evaluate (the Pro section); a discount with nothing to fix has no dot at all.
  assert.deepEqual(dotted((await render("rule-editor?rule=dev-fixture-2&plan=pro")).html), ["discount", "conditions:attention", "codes", "schedule", "pro"]);
  assert.deepEqual(dotted((await render("rule-editor?rule=dev-fixture-6")).html), ["discount", "conditions", "codes", "schedule", "pro:attention"]);
  assert.ok(dotted((await render("rule-editor?rule=dev-f2-market")).html).includes("pro:attention"));
  assert.deepEqual(dotted((await render("rule-editor?rule=new&recipe=freeShipping")).html), ["discount", "conditions", "codes", "schedule", "pro"]);
  // English: the same list.
  const en = (await render("rule-editor?locale=en")).html;
  assert.match(en, /<nav class="won-jump__nav" aria-label="On this page"/);
  assert.match(nav(en), />Needs attention: <\/span><\/span><\/span><\/span>Discount<\/a>[\s\S]*>How it applies<\/a>/);
  // One form, one Save: the list sits inside the form and wraps every section.
  assert.equal((html.match(/<form /g) ?? []).length, 1);
});

test("navigace a stav, bod 6: Milníky — a row of step numbers in the header of 'Stupně a odměny'; a step not offered in a market is red", async () => {
  const row = (html: string) => {
    const start = html.indexOf('<nav class="won-jumps"');
    return start < 0 ? null : html.slice(start, html.indexOf("</nav>", start));
  };
  const marks = (html: string) => [...(row(html) ?? "").matchAll(/<a class="won-jumps__link" href="#(step-\d+)" title="([^"]+)"( data-won-jump-state="(\w+)")?/g)].map((m) => `${m[1]}${m[4] ? `:${m[4]}` : ""}`);
  const html = (await render("rewards")).html;
  // Three steps; the second has no amount for Slovensko (the row under it says so) — its number is red, with the dot.
  assert.deepEqual(marks(html), ["step-1", "step-2:attention", "step-3"]);
  assert.match(row(html) ?? "", /aria-label="Přejít na stupeň"/);
  assert.match(row(html) ?? "", /href="#step-2"[^>]*><span data-won-dot="attention"[\s\S]{0,600}?>Vyžaduje pozornost: <\/span><\/span><\/span><span aria-hidden="true">2<\/span><span data-won-reader-only[^>]*><span[^>]*>2\. stupeň<\/span><\/span><\/a>/);
  assert.doesNotMatch((row(html) ?? "").split('href="#step-2"')[0] ?? "", /data-won-dot/, "the first step has nothing to say");
  // Every number has its card; the row sits in the section's header, above the table.
  for (const id of ["step-1", "step-2", "step-3"]) assert.match(html, new RegExp(`<div id="${id}" data-won-ms-step=`), id);
  assert.ok(html.indexOf('<section id="steps"') < html.indexOf("data-won-jump-row") && html.indexOf("data-won-jump-row") < html.indexOf('id="amounts"'));
  // The tiles stay; there is no list of sections on this page (it would be a third navigation).
  assert.match(html, /data-won-view-tile="steps"/);
  assert.doesNotMatch(html, /data-won-section-nav/);
  // No step, or one: nothing to jump between, no row (P2).
  assert.equal(row((await render("rewards?state=empty")).html), null);
  // English.
  assert.match(row((await render("rewards?locale=en")).html) ?? "", /aria-label="Go to step"[\s\S]*title="Step 2" data-won-jump-state="attention"/);
});

test("navigace a stav, bod 7: Přehled — the module tiles come before the discounts made in Shopify; 'Vyžaduje pozornost' stays first", async () => {
  for (const state of ["live", "conflict", "moved", "sync-failed", "native-error"]) {
    const html = (await render(`overview?state=${state}`)).html;
    const at = (needle: string) => {
      const index = html.indexOf(needle);
      assert.ok(index >= 0, `${state}: ${needle}`);
      return index;
    };
    const order = [at(">Vyžaduje pozornost<"), at('<section id="status"'), at("data-won-tiles="), at('<section id="native"')];
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${state}: attention → store status → tiles → Shopify discounts`);
    // The list is still on the page, once, with its deep link.
    assert.equal((html.match(/<section id="native"/g) ?? []).length, 1, state);
  }
  // Nothing to do about discounts outside Won: the section is not rendered at all (P2), the tiles are.
  const clean = (await render("overview?state=clean")).html;
  assert.doesNotMatch(clean, /<section id="native"/);
  assert.match(clean, /data-won-tile="codes"/);
  // The setup guide of an empty shop is still the first thing, above the tiles.
  const empty = (await render("overview?state=empty")).html;
  assert.ok(empty.indexOf("Nastavení za 3 minuty") < empty.indexOf("data-won-tiles="));
});
