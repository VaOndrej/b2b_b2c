# Won Quantity — kontrakt prvního vertical slice

Tento dokument je zdroj pravdy pro první instalovatelnou verzi Won Quantity.
Popisuje pozorovatelné chování, hranice odpovědností a kompatibilitu s nativním
quantity flow v Shopify themes Horizon a Dawn.

## Produktový cíl

Merchant může pro shop nastavit výchozí minimum, krok a volitelné maximum a
později je přepsat pro konkrétní produkt nebo variantu. Storefront tato pravidla
zobrazí u existujícího quantity inputu a promítne je do jeho nativních HTML
constraints, aniž by vytvořil druhý product form nebo nahradil theme add-to-cart.

## Efektivní pravidlo

Pravidlo se skládá z celých kladných čísel:

- `minimum >= 1`;
- `step >= 1`;
- `maximum` je `null` nebo celé číslo `>= minimum`;
- precedence je `variant > product > shop default`;
- chybějící hodnota override dědí hodnotu z nižší úrovně;
- Won Quantity smí nativní theme/Shopify omezení pouze zpřísnit, nikdy uvolnit.

Při kombinaci s nativním inputem tedy platí vyšší minimum, kompatibilní přísnější
krok a nižší neprázdné maximum. Pokud kombinaci nelze bezpečně vyjádřit, aplikace
ponechá nativní omezení beze změny a ohlásí diagnostický stav; nesmí storefront
zablokovat.

## Behavior inventory

| Behavior                  | Vstup                                                                                         | Viditelný výsledek                                                                                                           | Fallback bez dat / při chybě                                                                            | Surface                                                         | Responsive a lokalizace                                                | Co zůstává nativní                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Globální zapnutí          | shop-scoped `enabled`                                                                         | při `true` vznikne app-owned ready marker a pravidlo; při `false` nejsou aktivní Won constraints ani notice                  | chybějící, neověřená nebo nedostupná konfigurace znamená bezpečný no-op                                 | všechny nalezené product formy                                  | stejné chování na desktopu i mobile; bez textu není locale závislost   | rendering stránky, dostupnost varianty a product form                           |
| Výběr pravidla            | ověřený shop, product GID a volitelný variant GID                                             | variant override dědí product/shop fallback a má nejvyšší prioritu                                                           | bez override se použije product, poté shop default; bez platného defaultu `min=1`, `step=1`, `max=null` | PDP, featured product a quick-add s identitou produktu/varianty | shodné pro Horizon/Dawn a všechny viewporty                            | Shopify identita vybrané varianty                                               |
| Aplikace constraints      | efektivní pravidlo + existující `input[name="quantity"]` (`min`, `step`, `max`)               | input dostane přísnější `min`, `step`, `max`; počáteční/neplatná hodnota se posune na první platnou hodnotu                  | bez inputu nebo při nekompatibilní kombinaci no-op a diagnostický marker; nikdy nevznikne náhradní form | product formy; ne cart line inputy v prvním slice               | DOM atributy jsou nezávislé na viewportu a jazyku                      | nativní quantity custom element, tlačítka +/− a browser validace                |
| Ruční změna množství      | `input`/`change` na nativním quantity inputu                                                  | hodnota se omezí na minimum/maximum a zarovná na platný krok; po skutečné změně probublají nativní `input` a `change` eventy | při runtime chybě se listener nesmí dotknout submit flow                                                | PDP, featured product, quick-add                                | shodné na touch/keyboard/mouse; text notice CS/EN                      | theme eventy a následné přepočty ceny/košíku                                    |
| Viditelná informace       | efektivní `minimum`, `step`, `maximum`                                                        | jeden idempotentní `[data-won-quantity-notice]` u nativního quantity inputu; zobrazuje jen relevantní omezení                | při defaultu `1/1/null` může notice zůstat prázdný/skrytý; při disable se odstraní                      | vedle každého spravovaného product quantity inputu              | CS podle Shopify locale `cs*`, jinak EN; layout nesmí mít pevnou šířku | theme label, volume pricing a quantity-rules markup                             |
| Variant change            | změna hidden `name=id`, Horizon `ProductSelectEvent`, Dawn `variantChange` nebo nahrazený DOM | konfigurace se znovu načte/aplikuje pro novou variantu a marker zůstane právě jednou                                         | neznámá varianta použije product/shop fallback; proxy timeout ponechá poslední nativně funkční form     | PDP a theme-rendered product surfaces                           | stejné po morphu na desktopu/mobile, CS/EN se znovu vyhodnotí          | Horizon morph, Dawn section fetch/view transition, URL aktualizace a focus      |
| Section morph / quick-add | nově vložený nebo nahrazený product form                                                      | enhancement se idempotentně naváže na nový uzel; staré app-owned markery/listenery se neuplatňují                            | bez product/variant identity nebo quantity inputu no-op                                                 | PDP, featured product, quick-add; více forem na stránce         | bez viewport-specific selektorů                                        | theme lifecycle, dialog a section rendering                                     |
| Add to cart               | nativní submit s existujícím `name=id` a `name=quantity`                                      | odeslaná quantity odpovídá validní hodnotě inputu                                                                            | app proxy nebo JS failure nesmí zabránit nativnímu submitu                                              | product form                                                    | shodné na desktopu/mobile; Shopify chyby zůstávají v theme locale      | jediný add-to-cart form, AJAX/fetch, cart drawer/notification, dynamic checkout |
| Cart                      | nativní cart line quantity inputy                                                             | v prvním slice žádné Won Quantity přepisování ani interception                                                               | plně nativní cart behavior                                                                              | cart page a drawer                                              | beze změny                                                             | odstranění řádku, Ajax Cart, inventory a server validation                      |

## Theme evidence a integrační pravidla

### Horizon

- `snippets/quantity-selector.liquid` renderuje nativní `name="quantity"` s
  `min`, `max`, `step`, cart quantity a theme custom elementem.
- `assets/component-quantity-selector.js` vlastní tlačítka, HTML validaci,
  `QuantitySelectorUpdateEvent`, effective maximum a veřejné
  `updateConstraints`. Won Quantity tyto prvky nepřepisuje.
- `assets/variant-picker.js` fetchuje nový section HTML a morphuje picker,
  featured product nebo celé `main`; product select je asynchronní.
- `assets/product-form.js` po variant change aktualizuje constraints i cart
  quantity a zachovává vlastní add-to-cart frontu. Appka proto musí být
  idempotentní po morphu a nesmí závodit s tímto flow.

### Dawn

- `sections/main-product.liquid` a `snippets/quantity-input.liquid` renderují
  existující `quantity-input`, `name="quantity"`, `min`, `max`, `step` a nativní
  quantity labels.
- `assets/global.js` vlastní `QuantityInput`, `stepUp`/`stepDown`, change event a
  stav plus/minus tlačítek.
- `assets/product-info.js` fetchuje section HTML, mění variant inputs, publikuje
  `variantChange` a aktualizuje quantity attributes/rules. Některé product
  kontejnery jsou při product swapu nahrazené celé.
- `assets/product-form.js` vlastní AJAX add-to-cart, cart sections a chyby.
  Won Quantity jej nesmí duplikovat ani nahrazovat.

### Přenos z B2B companion

Z `margin-guard.visibility-script.tsx` se přenáší pouze ověřené principy:

- rozpoznání nativního product quantity inputu;
- bezpečná normalizace minima/kroku/maxima;
- idempotentní resync po variant change a DOM mutation;
- stabilní app-owned DOM markery a bezpečný no-op.

Výslovně se **nekopíruje celý více než 4 000řádkový MarginGuard storefront
script**. Obsahuje B2B visibility, segmentaci, katalogy, pricing, discount a cart
orchestration, které Won Quantity nevlastní. Přenášejí se pouze prokázané
quantity behavior kontrakty a jejich stabilní testy; framework-free pravidla
zůstávají v `@won/core`.

## MVP acceptance criteria

První vertical slice je hotový, až:

1. má shop-scoped `enabled` a default `minimum`, `step`, optional `maximum`;
2. umí product a variant override s děděním;
3. zobrazí CS/EN pravidlo u existujícího quantity inputu;
4. zachová přesně jeden nativní product form a nativní add-to-cart flow;
5. přežije variant change, Shopify section morph, quick-add a více product forem;
6. selhání proxy nebo chybějící input skončí no-opem, nikoli rozbitým storefrontem;
7. stejný app-specific Playwright scénář projde na Horizon i Dawn v desktopním i
   mobilním viewportu bez nových console/page/network chyb.

## Mimo první slice

- customer/B2B segmentace a Shopify catalogs;
- product/variant visibility;
- pricing, volume price breaks a discount orchestration;
- přepis cart drawer/cart page množství a removal policy;
- collection pravidla;
- vlastní quantity widget nebo vlastní add-to-cart UI;
- billing, produkční observability a App Store onboarding.

## Vlastnictví

- `@won/core`: framework-free normalizace, precedence a validace quantity pravidel;
- `won-quantity`: shop-scoped persistence, app proxy, admin UI, extension a
  app-specific test data;
- `@won/testing`: pouze generický Horizon/Dawn runner, selektory a evidence;
- Horizon/Dawn: product form, variant rendering, quantity custom elements,
  cart/AJAX a accessibility behavior.
