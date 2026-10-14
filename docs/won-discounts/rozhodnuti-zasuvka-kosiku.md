# Won Discounts: zásuvka košíku (podklad k rozhodnutí, balík C)

Stav 14. 10. 2026. Rozhoduje Ondřej.

## O co jde

- **Zásuvka košíku** je panel, který vyjede z boku po kliknutí na „Přidat do košíku“. Většina obchodů ji má místo
  přechodu na stránku košíku.
- **Panel Milníků** v ní ukazuje žebřík (kolik zbývá do dopravy zdarma, dárku, slevy), výběr dárku s možností
  ho odmítnout a pole na slevový kód. Je to hlavní místo modulu Milníky.
- **Blok aplikace do zásuvky nejde v žádném vzhledu**, ani v Horizonu. Zásuvka je ve vzhledu snippet, ne sekce,
  a Shopify do snippetů bloky aplikací nepouští.

## Jak to funguje dnes

- Skript `won-discounts-cart.js` zná **dvě přesné adresy**: Horizon (`cart-drawer-component .cart-drawer__summary`)
  a Dawn (`#CartDrawer .drawer__footer`). Najde je a panel tam vloží sám, hned po zapnutí Won.
- V ostatních vzhledech se panel do zásuvky nedostane. Pomůže jen značka `<won-discounts show="cart">`
  (průvodce s AI z balíku E).
- Když je na stránce značka, adresy se nepoužijí. Značka má vždy přednost.

## Varianta 1: výjimka pro Horizon a Dawn

Adresy zůstanou jako jediná výjimka z „žádného hádání“.

- **Klient na Horizonu nebo Dawnu má panel v zásuvce hned po instalaci**, bez úpravy kódu.
- **Riziko:** když Shopify ve vzhledu změní kód zásuvky, panel zmizí a nikdo si toho nevšimne.
- **Jak riziko zmenšit (nové, umožňuje to balík E):** aplikace teď čte soubory vzhledu. Umí ověřit, že
  `snippets/cart-drawer.liquid` pořád obsahuje to, na co skript míří. Řádek „Zásuvka košíku“ pak ukáže
  „Na webu (automaticky)“, nebo „Na webu chybí“ s tlačítkem „Připravit zadání pro AI“. Tiché selhání tím zmizí.
- Upravené odnože Horizonu a Dawnu fungují, dokud nesahaly na zásuvku. Kontrola výš to pozná.

## Varianta 2: jen značka

Adresy se smažou. Do zásuvky se panel dostane jen úpravou kódu.

- **Čistší:** žádné místo, kde se skript může tiše splést.
- **Po instalaci je zásuvka prázdná u všech.** Dárek se do košíku přidá dál, zákazník ale nevidí proč a nemůže ho
  odmítnout. Kód se do zásuvky nedá zadat.
- **Každý klient musí upravit kód vzhledu.** S AI pár minut, přesto krok navíc u jádra modulu.
- **App Store 5.1.1:** ruční úprava vzhledu by byla jediná cesta k hlavní funkci modulu. To recenze vyčte
  pravděpodobněji než volitelnou značku (varianta (a) z 14. 10.).

## Doporučení

**Varianta 1 s kontrolou čtením vzhledu.** Klienti na nejčastějších vzhledech mají panel hned, ostatní dostanou
průvodce a kontrola zachytí, když adresa přestane platit. Zbytek balíku C (smazat skript karet, záložní pruh,
přepsat přepínač karet) na rozhodnutí nezávisí.
