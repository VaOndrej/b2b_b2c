# Výprodej — proč mate a návrh nového postupu (9. 10. 2026, čtvrté kolo)

## Co bylo zjištěno

- **Bloky v šabloně:** Shopify nový blok přidává vždy na konec (úvodní stránka: poslední sekce; produkt: konec údajů
  o produktu). Odkaz na přidání umí zvolit jen šablonu a sekci, pozici ne. Zápis do šablony přes API by pozici
  určit uměl, ale potřebuje oprávnění `write_themes`, které Shopify veřejným aplikacím běžně nedává.
- **Proč Výprodej mate:** o tom, co zákazník uvidí, rozhodují čtyři věci na třech místech:
  1. úroveň zobrazení (jedno nastavení pro celý obchod, dlaždice „Jak výprodej funguje“),
  2. přepínač štítku u každého výprodeje,
  3. blok „Sale badge“ v šabloně produktu (a jeho místo v ní),
  4. kolik kusů zbývá.
  Obrazovka říkala „Zbývá X ks“ jako zapnuté, i když chyběl blok nebo nezbýval kus.
- **Tvůj produkt:** proč se „Zbývá X ks“ neukazuje, jsem z kódu nezjistil. Řádek „Na webu teď“ u výprodeje to po
  nasazení řekne (chybí blok / skrytý štítek / nezbývá kus).

## Co je už hotové (v pracovním stromu)

- U každého běžícího výprodeje řádek **„Na webu teď: …“** s důvodem, když něco zapnutého vidět není, a tlačítka
  „Zobrazit produkt na webu“, „Otevřít v úpravě vzhledu“, „Přidat štítek do šablony“.
- U každého bloku aplikace věta, **kde v šabloně leží** (kolikátá sekce úvodní stránky, nad nebo pod tlačítkem
  Koupit), červeně, když je potřeba ho přesunout. Před přidáním věta, kam ho Shopify dá.

## Návrh nového postupu (nepostaveno, čeká na rozhodnutí)

**A. Průvodce ve třech krocích místo tří dlaždic** (doporučuju)
1. *Co doprodat:* varianta, počet kusů, sleva, konec.
2. *Jak to bude vidět:* zobrazení se volí **u výprodeje**, ne pro celý obchod. Náhled vedle. Když chybí blok
   štítku, krok to řekne a nabídne přidání.
3. *Spustit:* shrnutí větou, tlačítko, potom rovnou odkaz na produkt na webu.
Seznam výprodejů zůstane jako první obrazovka. „Jak výprodej funguje“ se zmenší na kombinace s ostatními slevami.

**B. Nechat tři dlaždice, jen přesunout zobrazení k výprodeji.** Menší zásah, postup zůstane roztroušený.

**C. Štítek bez bloku v šabloně.** Vložení aplikace by štítek vsadilo k ceně samo (skript hledá cenu v šabloně).
Odpadne ruční přidávání i přetahování, ale v cizích šablonách se místo může netrefit. Jde přidat k A i B.

Rozdíl A/B proti dnešku v datech: úroveň zobrazení se přesune z nastavení obchodu na výprodej (běžící výprodeje
převezmou dnešní hodnotu).

## Rozhodnutí (10. 10. 2026)

Ondřej: varianta **A**. Text štítku si nastavuje sám u výprodeje a štítek se vkládá jako blok na stránku produktu
(varianta C se nedělá). Postaveno: tři kroky, zobrazení a text u výprodeje, úprava u běžícího výprodeje.
