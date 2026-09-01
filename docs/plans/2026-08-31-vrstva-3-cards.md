# Vrstva 3 — globální matice, oblast Cards

Měřeno na `/collections/automated-collection` (9 karet), desktop 1440 + mobil 390,
každá hodnota přepnuta v `settings_data.json`, 14 s na sync. Harness: `tmp/card-matrix.mjs`.

## Výsledky

| nastavení | hodnota | co je vidět | verdikt |
|---|---|---|---|
| `won_card_add_mode` | `button` | 0 stepperů, quick-add jako tlačítko | **OK** |
| | `stepper` | 1 stepper (jediný single-SKU produkt v kolekci), zbytek „Vybrat" | **OK** |
| `won_card_add_align` | `start` | ovládání u levé hrany média (změřeno geometricky) | **OK** |
| | `center` | na střed | **OK** |
| | `end` | u pravé hrany | **OK** |
| `won_card_add_reveal` | `hover` | desktop 1 z 9 viditelných v klidu, mobil 9 z 9 | **OK** |
| | `always` | 9 z 9 na obou viewportech | **OK** |

Doplňkové invarianty změřené ve všech 7 kombinacích × 2 viewporty:

- **tap targety** ≥ 44 px: 9/9 karet ve všech kombinacích, včetně `+`/`−` stepperu. Žádná
  výjimka.
- **kolize s badgem**: 0 překryvů ve všech kombinacích — `align` nikde nenarazí na štítek.
- **mobilní ekvivalent `reveal: hover`**: na 390 px je ovládání viditelné vždy (9/9), takže
  hodnota `hover` nezhasne quick-add na dotyku. To je přesně to, co matice žádá.

## Vyprodaná karta (VAR-003)

Omega 3 je v kolekci nedostupná (fixture na neaktivní lokaci). Její karta renderuje:

```html
<span class="won-pcard__add won-pcard__add--soldout" aria-disabled="true">
```

`<span>`, ne `<button>`/`<a>`, s `aria-disabled` a **bez jediné `won-fx` třídy** — neakce se
netváří klikatelně. Dostupná karta vedle ní má `won-fx won-fx--hover-lift …`. **OK.**

## Nález — pokrytí quick-addu visí na jednom produktu

V kolekci je **jediný** single-variantní produkt (`the-inventory-not-tracked-snowboard`
= Elektrolyty). Druhý zamýšlený single-SKU (Zinek + Selen) v ní **není** — jeho handle
vrací na storefrontu 404, je to draft/nepublikovaný fixture.

Není to vada motivu, ale **křehkost testovacího pokrytí**: celá cesta quick-add / stepper
stojí na jednom produktu. Když se jeho cena posune mimo pásmo automatické kolekce nebo
změní status, `won-card-quick-add.spec.ts` se tiše skipne s „no quick-add on this page"
a stepper přestane být testovaný, aniž by cokoli zčervenalo.

**Náprava vyžaduje zápis do adminu** (publikovat druhý single-SKU produkt / doladit cenu),
což čeká na „go". Zaznamenáno, neopraveno.
