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

const SCREENS: { path: string; expect: RegExp[] }[] = [
  { path: "overview", expect: [/data-won-tile="codes"/, /Slevy a kódy/, /Stav v obchodě/, /čeká na zápis|čekají na zápis/, /Zobrazení slev na webu/, /Zkontrolovat znovu/] },
  // Plan 6 Oct 2026 (P2/P3): Přehled shows only what has content or an action, and every problem carries its fix.
  { path: "overview?state=clean", expect: [/Slevy platí na webu i v pokladně/, /Zapnuto v živém tématu/] },
  { path: "overview?state=native-error", expect: [/id="native"/, /Slevy v Shopify se nepodařilo načíst/, /Načíst znovu/] },
  {
    path: "overview?state=conflict",
    expect: [/Střetává se s Won/, /href="\/app\/discounts\/dev-fixture-2#codes"/, /Upravit kódy ve slevě „VIP kód“/, /href="shopify:\/\/admin\/discounts\/1003"/, /Otevřít v Shopify/, /Aplikace nemá oprávnění číst téma/, /Zkontrolovat znovu/, /<s-button href="\/app\/discounts" variant="secondary">Zobrazit slevy/],
  },
  { path: "overview?state=pro-cards", expect: [/Kampaně jsou v tarifu Pro/, /Výprodej je v tarifu Pro/, /data-won-tile-locked/, /<s-clickable href="\/app\/outlet"/, /Pro · odemknout/] },
  { path: "overview?state=pro-cards&plan=pro", expect: [/Žádná kampaň není naplánovaná/, /Žádný výprodej není aktivní/] },
  {
    path: "overview?state=live",
    expect: [/Vyžaduje pozornost/, /LETO15/, /Přesunout vše \(2\)/, /Vrátit zpět/, /3 aktivní · 1 naplánovaná · 1 neaktivní/, /cílí na segmenty zákazníků/, /Upravit cílení/],
  },
  {
    path: "overview?state=sync-failed",
    expect: [/Synchronizace selhala 28\. 9\. 2026 16:20/, /Kód slevy „VIP10“ už v Shopify používá jiná sleva/, /Synchronizovat znovu/, /2 aktivní · 1 naplánovaná · 1 nezapsaná · 1 neaktivní · 1 vypnutá/, /data-won-tile-issues/],
  },
  {
    path: "overview?state=moved",
    expect: [/1 sleva přesunuta do Won/, /Na co myslet/, /zbývajících 58/, /Nedokončené přesuny/, /PODZIM20/, /Je v záloze/, /Přesunuté do Won/, /LETO15/, /Vrátit zpět/],
  },
  { path: "overview?state=empty", expect: [/Zatím žádná sleva/, /Nastavení za 3 minuty/, /Pokračovat v průvodci/] },
  { path: "overview?readOnly=1", expect: [/Nastavení jen pro čtení/] },
  // P3: "Upravit" of a rule that needs attention opens the editor at the field that fixes it. P5: the line carries the limits.
  { path: "discounts", expect: [/Vaše slevy/, /Černý pátek/, /v EUR se nenabízí/, /nezapsáno do Shopify/, /href="\/app\/discounts\/dev-fixture-4#value"/, /href="\/app\/discounts\/dev-fixture-6#segments"/, /kód VIP10 · od 1\u00a0000\u00a0Kč · 1× na zákazníka/] },
  { path: "discounts?sync=ok", expect: [/6 slev · 3 aktivní · 1 naplánovaná · 1 neaktivní · 1 vypnutá/, /Naplánováno od 27\. 11\. 2026/] },
  // The empty list is the recipes themselves (§15b), not a sentence pointing at another section.
  { path: "discounts?state=empty", expect: [/Vyberte recept/, /\/app\/discounts\/new\?recipe=percentAll/, /Uvítací kód/, /Vlastní sleva/] },
  { path: "discounts?sync=failed", expect: [/Nezapsáno/, /synchronizace selhala/, /Synchronizace selhala 28\. 9\. 2026/, /Synchronizovat znovu/] },
  // The five sections, all there; the markers at the fields (the missing EUR amount, the start date); the status sentence links to its field.
  {
    path: "rule-editor",
    expect: [/Částka v CZK/, /Částka v EUR/, /nenabízí se/, /Europe\/Prague/, /Pro · odemknout/, /Naplánováno/, /Podmínky/, /Jak se uplatní/, /Kdy platí/, /Zapnuto/, /V EUR chybí částka/, /Sleva začne platit 27\. 11\. 2026\./, /href="#schedule"/, /id="conditions"/, /id="target"/, /id="markets"/],
  },
  { path: "rule-editor?rule=dev-fixture-2", expect: [/VIP10/, /1× na zákazníka/, /Jednou na zákazníka/, /Zákazník zadá kód VIP10\./, /V EUR chybí minimum/, /Vrátit automatický název/] },
  { path: "rule-editor?rule=dev-fixture-3", expect: [/HUF/, /Uloženo i pro HUF: 3\u00a0000\u00a0HUF\. Trh je vypnutý, hodnota zůstává\./, /Odebrat hodnotu v HUF/] },
  // B9: stored segments are said at their own block and can be removed there.
  { path: "rule-editor?rule=dev-fixture-6", expect: [/Neaktivní/, /Pokladna ho neumí vyhodnotit, proto sleva není aktivní/, /Odebrat cílení na segmenty/, /href="#segments"/, /id="segments"/] },
  { path: "rule-editor?result=unreadable", expect: [/Uložené nastavení se nepodařilo přečíst/, /Nahradit neplatnou konfiguraci/] },
  { path: "rule-editor?result=sync-failed", expect: [/Uloženo, ale do Shopify se zatím nezapsalo/, /Sleva „Černý pátek“ se do Shopify nezapsala/, /Synchronizovat znovu/] },
  { path: "rule-editor?rule=dev-fixture-2&result=collision", expect: [/nejde použít zároveň, pokladna je nerozliší/, /Upravit kódy/] },
  { path: "rule-editor?rule=dev-fixture-2&result=too-many", expect: [/Aktivních slev s kódem může být nejvýš 20, po uložení by jich bylo 21/] },
  { path: "rule-editor?rule=new&recipe=welcomeCode", expect: [/Uvítací sleva/, /VITEJ10/, /Neuloženo/, /Vrátit automatický název/] },
  // P5: a recipe's name is generated from its settings and the heading follows it.
  { path: "rule-editor?rule=new&recipe=freeShipping", expect: [/heading="Doprava zdarma od 1\u00a0500\u00a0Kč \/ 60\u00a0€"/, /Název se skládá z nastavení/, /name="nameAuto" value="1"/] },
  // B11: read-only disables the fields, not just Save.
  { path: "rule-editor?rule=dev-fixture-2&readOnly=1", expect: [/Nastavení jen pro čtení/, /<s-text-area[^>]*disabled/, /<s-switch[^>]*disabled/] },
  // P3 on Free: the Pro setting the plan does not run is marked where it is set, with a way to remove it.
  { path: "rule-editor?rule=dev-f2-market", expect: [/Cílení na trhy je v tarifu Pro\. Váš tarif ho nespouští, proto sleva není aktivní\./, /Odebrat cílení na trhy/, /Odebrat sčítání s dalšími slevami/, /href="#markets"/, /jen trhy Slovensko · sčítá se s Podzimní sleva 10.%/] },
  { path: "rule-editor?rule=dev-fixture-2&plan=pro", expect: [/Cílení a kombinace/, /Česko/, /Slovensko/, /Sčítá se s/, /Kombinování slev v Nastavení/, /\/app\/settings#combination/] },
  // Vyzkoušet košík is Pro: Free sees the locked frame with what the tool is for; ?plan=pro the tool with the shop's discounts to tick.
  { path: "try-cart", expect: [/S Pro si košík vyzkoušíte předem/, /href="\/app\/plan"/, /Košík je prázdný\. Přidejte produkty\./, /<s-button type="submit" variant="primary" disabled="[^"]*">Spočítat/] },
  {
    path: "try-cart?plan=pro",
    expect: [/Mikina Won \(M \/ černá\) × 2/, /Kód VIP10/, /Celkem/, /CZK · Česko/, /Ceny a země z trhu Česko/, /Podzimní sleva 10/, /Uplatní se samy: /, /<input type="checkbox" name="ruleId"[^>]*checked=""[^>]*value="dev-fixture-2"/, /kód VIP10/, /Teď/, /Vlastní datum a čas/, /data-won-try-cart-lines/],
  },
  { path: "try-cart?plan=pro&date=2026-11-27&time=00:00", expect: [/Začátek kampaně \(27\. 11\. 2026 00:00\)/, /<input type="hidden" name="date" value="2026-11-27"\/>/, /<input type="hidden" name="time" value="00:00"\/>/] },
  { path: "try-cart?state=margin", expect: [/href="\/app\/margin#costs"/] },
  { path: "try-cart?state=warnings", expect: [/Pokladna se může lišit/, /Synchronizovat znovu/] },
  { path: "try-cart?state=not-wired", expect: [/Výpočet košíku zatím není zapojený/] },
  { path: "onboarding", expect: [/1\. Co chcete řešit/, /Doprava zdarma nebo dárek/, /na první místo/] },
  { path: "onboarding?step=3&embed=on", expect: [/Zapnuto. Web je připravený/, /4\. První sleva/, /5\. Hotovo/] },
  // B16: step 3 can be skipped (the first discount does not need the website on); without anything outside Won there are four steps.
  { path: "onboarding?step=3", expect: [/Přeskočit, zapnu později/, /<input type="hidden" name="step" value="4"\/>/, /Sleva v pokladně platí i bez toho/] },
  { path: "onboarding?step=3&native=none", expect: [/4 kroky, zhruba 3 minuty/, /2\. Zapnout na webu/, /3\. První sleva/, /4\. Hotovo/] },
  { path: "onboarding?step=3&embed=none", expect: [/Odkaz do editoru tématu teď nemáme/, /Zkontrolovat znovu/] },
  { path: "onboarding?step=5&embed=on&rules=1", expect: [/Všechno je aktivní/, /slev běží|slevy běží|sleva běží/] },
  { path: "onboarding?step=5&embed=on&rules=1&live=0", expect: [/Ještě něco zbývá/, /Žádná zatím není aktivní/, /Sleva je uložená, ale zatím není aktivní/] },
  // MVP 7: steps 4 and 5 — the recipes in the onboarding itself, the checklist from real signals.
  { path: "onboarding", expect: [/5 kroků, zhruba 3 minuty/, /4\. První sleva/, /Sleva na všechno|% na vše/, /5\. Hotovo/, /Ještě něco zbývá/, /Web ještě není zapnutý/, /Vyzkoušejte košík/] },
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
  // Vzhled (MVP 7): the custom look (locked amber on Free), card prices BETA, the storefront texts, the AI brief.
  { path: "appearance", expect: [/Vlastní vzhled/, /V Pro sladíte tabulku s webem: vlastní barvy, zaoblení rohů a vlastní CSS/, /href="\/app\/plan"/, /Ceny podle množství na kartách produktů · BETA/, /Texty na webu/, /Výchozí texty/, /Zkopírovat zadání pro AI/] },
  { path: "appearance?plan=pro&state=custom", expect: [/Vlastní barvy nebo CSS jsou nastavené/, /Zapnuto: karty ukazují první úroveň/, /Upravených textů: 1/, /Přidat blok do karty produktu/, /--won-tiers-accent/] },
  { path: "appearance?plan=pro&state=issue", expect: [/Uložené vlastní CSS nejde použít/] },
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
  { path: "campaigns?plan=pro&result=sync-pending", expect: [/V Shopify zatím změna není celá/, /Synchronizovat znovu/] },
  { path: "campaigns?plan=pro&state=empty", expect: [/Nová kampaň/, /Vyplňte název, začátek a konec/] },
  { path: "campaigns?state=finishing", expect: [/Běžela při přechodu na Free, doběhne do konce/] },
  { path: "overview?state=campaigns", expect: [/Kampaně/, /Aktivní: Víkend −20 % do 29\. 9\. 2026 0:00/, /<s-clickable href="\/app\/campaigns"/] },
  { path: "overview?state=campaigns&finishing=1", expect: [/1 věc k vyřešení/] },
  { path: "outlet", expect: [/Výprodej/, /S Pro doprodáte zvolený počet kusů varianty se slevou/, /Zobrazit tarif Pro/, /Aktivní výprodeje/, /Mikina Won — L/, /Znovu otevřít výprodej jde v tarifu Pro/, /Zobrazení a vratky/] },
  {
    path: "outlet?plan=pro",
    expect: [/Spustit výprodej/, /Vyberte variantu, počet kusů a slevu/, /Prodáno 7 z 10 ks, vráceno 1, zbývá 4/, /Prodáno o 1 ks víc, než bylo k doprodeji/, /Upravené ceníky: Slovensko/, /Zkusit znovu/, /Ukončit výprodej „Mikina Won — L“\?/, /Znovu otevřít/],
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
      /Ochrana hlídá jen slevy, které běží přes Won Discounts\. Slevy mimo Won nevidí\./,
      /href="\/app#native"/,
      /step="0\.1"/,
      /Strop slevy pro produkty bez nákupní ceny/,
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
    expect: [/Právě načítáme nákupní ceny: 340 z 1\u00a0240/, /Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen strop slevy 40\u00a0%/, /href="#costs"/, /Počítáme, kde ochrana zasáhne/],
  },
  { path: "margin?state=running", expect: [/Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen strop slevy 40\u00a0%/, /href="#costs"/] },
  {
    path: "margin?state=failed-first",
    expect: [/Dokud nenačteme nákupní ceny, platí u nenačtených produktů jen strop slevy 40\u00a0%/, /href="#costs"/, /Nákupní ceny se nepodařilo načíst ze Shopify/, /Technický detail: costs\.read: Throttled/],
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
  { path: "margin?state=gate", expect: [/Pro funkce není aktivní/, /Ochrana marže pro jednotlivé kolekce je funkce Pro/, /Min\. marže 30\u00a0% · bez nákupní ceny sleva nejvýš 10\u00a0%/] },
  { path: "margin?state=failed&result=refreshed", expect: [/Načtení selhalo 28\. 9\. 2026 06:10/, /Načítání nákupních cen běží/] },
  { path: "margin?plan=pro&rule=dev-f2-collection", expect: [/Jen sleva „Podzimní kolekce 20 %“/, /Zobrazit všechny zásahy/, /Ochrana sníží 1 slevu/, /Sníží se u 4 variant/] },
  { path: "margin?result=invalid", expect: [/Zadejte 0 až 95 %/, /value="150"/] },
  // B14: the refused values come back as typed (also the refused 120 of a collection row); Přehled zásahů says it shows the saved state.
  { path: "margin?plan=pro&result=invalid", expect: [/value="150"/, /value="120"/, /Strop slevy bez nákupní ceny: Zadejte 0 až 100 %/, /Přehled počítá s uloženým nastavením/] },
  // The save's fixes worded like the server words them (issue-copy), never the core's English message.
  { path: "margin?result=fixes", expect: [/Uloženo\. Pár věcí jsme upravili/, /Procenta marže mají jedno desetinné místo\. 12,55\u00a0% se zaokrouhlilo na 12,6\u00a0%/] },
  { path: "margin?result=fixes&locale=en", expect: [/Margin percents have one decimal\. 12\.55% was rounded to 12\.6%/] },
  { path: "overview?state=margin", expect: [/id="native"/, /Ochrana marže/, /Min\. marže 20\u00a0%/, /data-won-state="active"/] },
  { path: "overview?state=margin-off", expect: [/Ochrana marže je vypnutá/, /data-won-state="inactive"/, /<s-clickable href="\/app\/margin"/] },
  { path: "overview?state=margin-running", expect: [/Nákupní ceny se ještě načítají, zatím platí jen strop slevy/, /data-won-state="active"/] },
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
      /CZK \(Česko\)/,
      /href="shopify:\/\/admin\/settings\/markets" target="_top"/,
      /Spravovat trhy v Shopify/,
      /Nástroje/,
      /Vyzkoušet košík/,
      /<h2 id="plan"[^>]*>Tarif<\/h2>/,
      /Máte tarif Free\./,
      /Vyzkoušet Pro na 14 dní zdarma/,
      /Připravit na odinstalaci/,
      /Kombinace u jednotlivých slev nastavíte v editoru slevy v tarifu Pro\./,
      /<s-link href="\/app\/discounts">Otevřít slevy<\/s-link>/,
    ],
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
      /Pro funkce není aktivní/,
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
      // The look switcher is a visible, saved field of this form (the same `preset` Vzhled writes).
      /Vzhled na webu/,
      /<input type="radio" name="preset"[^>]* value="highlight"/,
      /<input type="radio" name="preset"[^>]* checked=""[^>]* value="highlight"|<input type="radio" name="preset" value="highlight"[^>]* checked=""/,
      /Vlastní barvy a CSS/,
      /href="\/app\/appearance#custom"/,
      /Náhled nepočítá s ochranou marže/,
      /Tabulka je na stránce produktu v tématu Horizon/,
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
    expect: [/Vybrat produkty/, /Vybrat kolekce/, /Mikina Won/, /Podzimní kolekce/, /Celý košík/, /V EUR \(Slovensko\) se úroveň od 6 ks nenabízí/, /Od 2 ks −30\u00a0Kč \/ 1,20\u00a0€ za kus/],
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
      /Chybí v tématu/,
      /Přidat do tématu/,
      /addAppBlockId=dev-api-key\/quantity_tiers&amp;target=mainSection/,
      /Žádná výjimka/,
    ],
  },
  {
    path: "tiers?state=failed",
    expect: [/Uložení na web selhalo 28\. 9\. 2026 16:20\. Do opravy může web ukazovat starší \(i vyšší\) úrovně, pokladna platí nové/, /Synchronizovat znovu/, /Nastavení tabulky na stránce produktu se na web nezapsalo \(metafieldsSet: Throttled/],
  },
  // Review fix 7: never written before → no "previous settings" to show.
  { path: "tiers?state=failed-first", expect: [/Uložení na web selhalo 28\. 9\. 2026 16:20\. Tabulka se na webu zatím neukazuje/, /Synchronizovat znovu/] },
  { path: "tiers?state=pending", expect: [/Poslední změna na webu ještě není/] },
  // Audit P3-8: only in an alternate template → not "on the product page"; the fix button stays.
  { path: "tiers?state=alternate", expect: [/Tabulka je jen v šabloně product\.bundle\. Na stránce produktu, kterou používá většina produktů, zatím není\./, /Chybí v tématu/, /Přidat do tématu/] },
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
  { path: "rewards", expect: [/Doprava zdarma od 1\u00a0000\u00a0Kč \/ 40\u00a0€/, /Ponožky Won — M od 1\u00a0500\u00a0Kč/, /Práh dárku se počítá před slevami/, /Košík ukazuje odměny, dárek a pole pro kód/, /V Pro nastavíte víc prahů/] },
  { path: "rewards?plan=pro", expect: [/2\. práh/, /Kšiltovka Won, Plátěná taška Won nebo Hrnek Won od 3\u00a0000\u00a0Kč \/ 120\u00a0€/, /Přidat další práh/, /Změnit záložní dárek/] },
  { path: "rewards?state=empty", expect: [/Doprava zdarma vypnutá/, /Žádný dárek/, /Košík odměny neukazuje\. Won není v tématu zapnutý/, /Zapnout v tématu/] },
  { path: "rewards?state=embed-draft", expect: [/Won je zapnutý jen v nepublikovaném tématu/, /Zapněte Won i v živém tématu/] },
  { path: "rewards?state=embed-unknown", expect: [/Nepodařilo se ověřit, jestli je Won v tématu zapnutý/, /Otevřít editor tématu/] },
  { path: "rewards?state=embed-no-scope", expect: [/Won nemá přístup k tématu/, /Otevřít editor tématu/] },
  { path: "rewards?result=invalid", expect: [/Vyberte dárek\./] },
  { path: "rewards?plan=pro&result=too-many", expect: [/Prahů může být nejvýš 5\./] },
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
    path: "appearance",
    expect: [
      /Vzhled na webu: Zvýrazněná úroveň/,
      /name="preset"/,
      /value="tiles"/,
      /won-tiers--default/,
      /won-tiers--highlight/,
      /won-tiers--chips/,
      /won-tiers--tiles/,
      /Kompaktní štítky v řádku/,
      /Uloženo/,
      /V Pro sladíte tabulku s webem/,
      // Human names of the storefront texts, never the extension's keys.
      /Nadpis tabulky · česky/,
      /Košík: tlačítko pro odmítnutí dárku · anglicky/,
      /<s-color-field/,
    ],
  },
  { path: "appearance?state=empty", expect: [/Ukázka: zatím nemáte žádnou úroveň/, /Přidat do tématu/, /Zapnutí Won v tématu/, /Košík na webu ukáže slevy a odměny až po zapnutí Won v tématu/, /Zapnout v editoru tématu/] },
  // The stored custom look and the changed text are in the four previews (Pro).
  { path: "appearance?plan=pro&state=custom", expect: [/data-won-custom-look=""/, /<p class="won-tiers__heading">Kup víc, plať míň<\/p>/] },
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
  { path: "rule-editor?locale=en", expect: [/Amount in EUR/, /not offered/] },
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
    // §4c: nothing machine-shaped leaks into the page text (the serialized
    // loader data in <script> is data, not text, so it is left out).
    // MVP 7: the storefront text editor shows the extension's own texts as input placeholders — those DO contain
    // the storefront's `{n}` / `{value}` slots (the merchant must keep them), so placeholder attributes are data too.
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/ placeholder="[^"]*"/g, "");
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
  for (const path of ["settings", "plan", "overview", "rule-editor", "margin", "appearance", "analytics", "try-cart"]) {
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
  const appearance = (await render("appearance")).html;
  assert.doesNotMatch(appearance, /row_qty · cs|>tiers\.heading|Tady vidíte|Zapnutí Won v tématu/);
  assert.doesNotMatch((await render("tiers?state=custom")).html, /data-won-custom-look/, "Free never previews the Pro custom look (BILL-1)");
  const rewards = (await render("rewards")).html;
  // The green label is the STORED state (the same as the home tile), never the page's own unsaved form: both
  // sections carry it, and it does not depend on the switch.
  assert.equal((rewards.replace(/<script[\s\S]*?<\/script>/g, "").match(/data-won-state="active"/g) ?? []).length, 4, "two tiles + their two sections");
});

test("the tier note is only for a product rule (an order rule does not compete with a tier)", async () => {
  const { html } = await render("rule-editor?rule=dev-fixture-1&tiers=1");
  assert.doesNotMatch(html, /Na produktech s množstevní slevou/);
});

test("MVP 3 screens: one save for the whole form, last on the page", async () => {
  for (const path of ["tiers", "tiers?plan=pro", "appearance", "settings"]) {
    const { html } = await render(path);
    const submit = html.lastIndexOf('type="submit"');
    assert.ok(submit > 0, `${path}: a submit button`);
    assert.equal(html.indexOf('type="submit"'), submit, `${path}: exactly one submit button`);
    assert.match(html, /data-save-bar/, `${path}: the App Bridge save bar`);
  }
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

test("the harness action (forms posted in a preview) is guarded like the loader", async () => {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  assert.deepEqual(mod.action(), { ok: false, reason: "preview_only" });
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => mod.action(),
      (err: unknown) => err instanceof Response && err.status === 404,
    );
  } finally {
    process.env.NODE_ENV = "test";
  }
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
  // Přehled: no checkout row, no config footer, no targeting lecture; "Slevy mimo Won" only when there is something to do.
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
