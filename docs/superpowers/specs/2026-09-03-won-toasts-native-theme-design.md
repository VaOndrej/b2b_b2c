# Won toasts nativně v generic theme

**Datum:** 2026-09-03
**Rozsah:** `themes/won-base/**` + fragment nastavení; deploy do `won-theme-generic` buildem
**Velikost:** odpovídá Free úrovni appky Won Toasts

---

## 1. Zadání a jeho hranice

Generic theme má umět toasty **sám, bez nainstalované appky**. Šablona se nasazuje
samostatně a nesmí na appce záviset.

Appka `apps/won-toasts/` se tímhle **nijak neřídí a neovlivňuje** — je odsunutá.
Nesdílí se s ní kód, konfigurace ani názvosloví nastavení. Kdyby se někdy měly
sjednotit, je to samostatné rozhodnutí, ne implicitní závazek téhle specifikace.

### Ve scopu

| oblast | co |
|---|---|
| události | přidáno, navýšeno, sníženo, odebráno |
| seskupení | jedna hláška na variantu; opakovaná změna přepíše obsah a restartuje časovač |
| souběh | nejvýš 3 toasty najednou, nejstarší odchází první |
| nastavení | zapnuto, pozice, trvání, max. počet, miniatura produktu |
| texty | z locales, měnitelné merchantem, překladatelné |
| drawer | při zapnutých toastech se potlačí jeho automatické otevření |

### Mimo scope — vědomě

- **Sociální důkaz** (`cart.activity`, `order.summary`). Nativně to nejde: motiv
  nevidí objednávky ani košíky cizích zákazníků. Není to odloženo, je to nemožné.
- **Cílení a vyloučení, barvy per typ, custom CSS.** V appce to je Pro.
- **Countdown, announcement, stock.low.** Nejsou reakcí na košík — je to obsah,
  a obsah do motivu patří jako sekce nebo blok, ne jako toast.
- **Undo.** Je to zápis do košíku, ne hláška. Vlastní rozhodnutí, vlastní vydání.

---

## 2. Architektura

Čtyři nové soubory a jeden fragment. `won-cart.js` se **nemění vůbec**.

| soubor | odpovědnost | závisí na |
|---|---|---|
| `assets/won-toast.js` | odvodí typ hlášky z rozdílu košíků a vyrenderuje ji | `cart:refresh`, `data-` atributy z configu |
| `assets/won-toast.css` | region, karta, animace, `prefers-reduced-motion` | tokeny motivu |
| `snippets/won-toast-config.liquid` | přeloží nastavení a texty do `data-` atributů | `settings.won_toast_*`, locales |
| `themes/build/won-toast-settings.json` | skupina Won · Toasty | — (compose injektuje sám) |
| `tests/smoke/won-toast.spec.ts` | strážce chování | běžící dev server |

**Proč samostatný soubor a ne uvnitř `won-cart.js`:** toast má jednu úlohu —
ukázat hlášku. Když poslouchá událost místo aby ho někdo volal, umí ho vyvolat
i variant picker, sticky ATC nebo produktová stránka, aniž by o toastu cokoli
věděly. `won-cart.js` už dnes dělá tři věci a má 480 řádků.

**Proč přes `layout/theme.liquid` a ne jako sekce v header group:**
`sections/header-group.json` je v manifestu `owner: merchant, layer: data` —
publish ji nikdy nepřepíše, takže na existující eshopy by toast nedorazil a
merchant by ho mohl omylem smazat. `layout/theme.liquid` je compose-owned a
compose do něj už dnes vpichuje won assety.

### Datový tok

```
won-cart.js (beze změny)  ─┐
variant picker             ├─→  cart:refresh {cart}  ─→  won-toast.js
sticky ATC / PDP          ─┘                               │
                                                           ├─ porovná s posledním stavem
                                                           ├─ odvodí typ na variantu
                                                           └─ vyrenderuje / přepíše kartu
```

Toast si drží poslední známý košík. Typ vzniká z rozdílu množství na variantu:
nové nebo vyšší → `added` / `increased`, nižší → `decreased`, na nulu → `removed`.
Tím je nezávislý na tom, kdo změnu provedl, a nemůže se rozejít se skutečností —
zdrojem pravdy je vždycky košík z payloadu, nikdy dopočet z kliků.

---

## 3. Nastavení

Skupina **Won · Toasty**, fragment `themes/build/won-toast-settings.json`.

| id | typ | default | poznámka |
|---|---|---|---|
| `won_toast_enabled` | checkbox | `true` | vypnuté = region se vůbec nevyrenderuje |
| `won_toast_position` | select | `top_right` | `top_right`, `top_left`, `bottom_right`, `bottom_left` |
| `won_toast_duration` | range 2–8 s, krok 1 | `4` | |
| `won_toast_max` | range 1–5, krok 1 | `3` | kolik jich smí být naráz |
| `won_toast_media` | checkbox | `true` | miniatura produktu |

Vypnutí je úplné: `won-toast-config.liquid` nevyrenderuje nic a `won-toast.js`
se bez configu neaktivuje. Žádný mrtvý DOM, žádný listener.

## 4. Texty

Storefront fragment `themes/won-base/locales/en.default.json` a `cs.json`:

```json
"won": {
  "toast": {
    "added":     "{{ product }} v košíku",
    "increased": "{{ product }} — {{ quantity }} ks",
    "decreased": "{{ product }} — {{ quantity }} ks",
    "removed":   "{{ product }} odebráno"
  }
}
```

Merchant je mění v editoru jazyků, překlad na jazyk eshopu jde přes standardní
locale soubory. Chybí-li klíč, toast se **nezobrazí** — nikdy neukáže
`translation missing`.

## 5. Chování v hraničních situacích

| situace | co se stane |
|---|---|
| šest karet rychle za sebou | šest toastů, ale strop `won_toast_max` je sráží na 3 |
| pětkrát „+" na jedné kartě | jedna karta, obsah se přepíše, časovač se restartuje |
| košík vyprázdněn odjinud | jedna hláška `removed` na variantu, ne lavina |
| `prefers-reduced-motion` | žádná animace, jen zobrazení a skrytí |
| dlouhý název produktu | dva řádky, pak `text-overflow: ellipsis` |

## 6. Testy

`tests/smoke/won-toast.spec.ts`:

1. přidání do košíku ukáže právě jednu hlášku se jménem produktu
2. vypnuté nastavení → v DOM není region ani listener
3. šest rychlých tapů na různé karty → nejvýš `won_toast_max` toastů naráz
4. pět tapů na jednu kartu → jeden toast, ne pět
5. při zapnutých toastech nemá `<cart-drawer-component>` atribut `auto-open`

## 7. Otevřené k pozdějšímu rozhodnutí

- **Undo u `removed`.** Nejužitečnější chybějící kus. Vlastní spec.
- **Sjednocení názvosloví s appkou**, kdyby se appka vrátila. Dnes záměrně oddělené.
