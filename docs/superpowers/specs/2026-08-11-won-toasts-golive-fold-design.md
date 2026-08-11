# Won Toasts — přepracování „Go live" foldu (not-live stav)

Datum: 2026-08-11
Rozsah: `apps/won-toasts/app/routes/app._index.tsx`, jen `else` (not-live) větev.

## Problém

Když merchant otevře Won Toasts a ještě není live, první fold sežere
dekorativní **svislá zeď 6 preview toastů** (`<ToastPreview>`), a skutečný
úkol tohoto stavu — *jít live ve 2 krocích* — je odsunutý pod fold. Hierarchie
je obrácená: hloubka produktu (jak vypadají všechny typy toastů) je hrdina ve
chvíli, kdy ji merchant ještě nemůže použít; jediná akce (zapnout) je poznámka
pod čarou.

Merchant appku už nainstaloval → důvěru zvyšovat netřeba. Kritické je, aby to
**nakonfiguroval za ~30 sekund**.

## Cíl

Not-live fold = čistý, akce-first guided setup. Dvě jasné kliky do live, nic co
by kradlo prostor nebo pozornost. Hloubka (vzhled / grouping / všechny typy)
čeká připravená na Design a Toasts a odemkne se přirozeně až po go-live.

## Návrh

Nová struktura not-live větve (shora dolů, celá nad fold):

1. **Hlavička + progress.** `Go live` heading, `Not live yet` badge a tiché
   `1 of 2 done` počítadlo (guided-setup pocit „skoro tam", drží 30s tempo).
2. **Krok 1 — Turn on Won Toasts.** Inline `s-switch` ve `Form method="post"
   data-save-bar` (beze změny logiky). Done → `✓ Done` badge.
3. **Krok 2 — Enable the app embed.** Primary tlačítko na `embedDeepLink`
   (target _blank) + `Re-check`, a `embedNote` jako human vysvětlení statusu
   (draft / disabled / not-enabled — už hotové v loaderu). Tenhle krok je ten
   reálně blokující, dostane vizuální váhu.
4. **„Co přijde potom" řádek** — jedna subdued věta místo preview:
   `Once both are on, you'll see exactly what shoppers see — plus live numbers.`
   Odpovídá na „kam se podělo preview": schválně až po live.

## Co se odstraňuje

- `<ToastPreview ... />` z not-live větve (řádky ~387–391). Preview se v
  not-live stavu **nikdy** neukáže.

## Co zůstává beze změny

- Live dashboard větev (stats / health / upsell).
- Cold-start „New store?" hint.
- `SettingsSearch` sekce.
- `action` (persist enabled), `loader`, embed-status detekce, `SetupStep`,
  `StatCard` — beze změny logiky. `SetupStep` se jen vizuálně použije jako
  dřív, plus progress caption.

## Odůvodnění (žádná ztráta)

`ToastPreview` dál žije na Design (`app.design.tsx:725`) a Toasts má
`AnimatedToastPreview` — merchant vizuál potká tam, kde má smysl (ladění
vzhledu), a poprvé na home až jako live. Odstranění z go-live foldu tedy nic
neztrácí, jen napravuje pořadí.

## Duše (product-roadmap)

Sedí na doktrínu Won Toasts: onboarding jako hlavní zbraň (ukradeno ToastiBaru),
radikální jednoduchost, „nezahltí" — merchant v not-live stavu má jeden job a
fold ho k němu vede beze smetí.

## Testy / akceptace

- Not-live stav: fold obsahuje přesně 2 kroky + progress + „co potom" řádek;
  **žádný** `ToastPreview`.
- Krok 1 switch stále persistuje `enabled` (save-bar flow beze změny).
- Krok 2 deep-link a `Re-check` fungují jako dřív; `embedNote` se zobrazuje.
- Live stav a cold-start hint beze změny (regrese-check).
- Gate: `won-toasts` workspace test brána zelená.
