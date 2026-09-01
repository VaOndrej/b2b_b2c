# Vrstva 3 — globální matice, oblast Rails

Měřeno na demo homepage, 1440 px, 8 řad ovládání (`.won-rail__controls`) v 7 sekcích.
Každá hodnota přepnuta v `themes/dist/horizon-dev/config/settings_data.json`, po každé
změně 14 s na sync a nové načtení stránky. Harness: `tmp/rail-matrix.mjs`.

Sekce: `promo_hero`, `categories`, `bestsellers`, `daily_grid`, `peek_hero`, `reviews`,
`tabbed_rail` (2 řady — druhá je `--sm-only`, na desktopu správně skrytá).

## won_rail_indicator

| hodnota | co je vidět | verdikt |
|---|---|---|
| `per_section` | 3 přetékající raily: `bestsellers` lišta, `peek_hero` tečky(3), `tabbed_rail` lišta | **OK** |
| `progress` | všechny 3 přetékající lištu, tečky nikde | **OK** |
| `dots` | všechny 3 přetékající tečky (2 / 3 / 2), lišta nikde | **OK** |
| `none` | žádný indikátor, šipky beze změny | **OK** |

Starý defekt „`dots` implementované na 2 ze 4 railů" je **prokazatelně opravený** — reagují
všichni čtyři konzumenti. Nepřetékající raily nezobrazí afordanci v žádné hodnotě
(theme-block-ux §7 drží napříč maticí).

## won_rail_arrows

| hodnota | co je vidět | verdikt |
|---|---|---|
| `per_section` | šipky na 3 přetékajících, `hidden` na zbytku | **OK** |
| `always` | totéž — `always` je horní mez, ne důvod ukázat mrtvé ovládání | **OK** |
| `never` | šipky se vůbec nevykreslí, indikátor zůstává | **OK** |

## won_rail_arrow_style

| hodnota | border-radius (všech 8 railů) | verdikt |
|---|---|---|
| `pill` | 999 px | **OK** |
| `square` | 0 px | **OK** |
| `soft` | 8 px | **OK** |
| `minimal` | 0 px, `background: rgba(0,0,0,0)` | **OK na stránce**, riziko nad médii (níž) |

Styl je identický na všech railech ve všech hodnotách — žádný DRIFT.

## won_rail_arrow_tone — **UX NÁLEZ (A11Y-001), opraveno**

Kontrast měřen složením přes nejbližšího neprůhledného předka (computed style sám o sobě
vrací `rgba(0,0,0,0.28)`, což neřekne nic).

| tón | glyf / plocha — před | po opravě |
|---|---|---|
| `surface` | 13,11 : 1 | 13,11 : 1 |
| `overlay` | **1,99 : 1** na 7 railech | **4,76 : 1** |

`auto` se rozpadá správně (surface na stránce, overlay nad médiem) — a právě proto zbylé
dvě hodnoty nikdo nezměřil: existující `won-rail-consistency` se sám skipuje s „arrow tone
is auto". Merchant, který zvolí `overlay` pro celý motiv, dostal bílý glyf na ploše, která
se přes bílou stránku složí do světlé šedi. Pod 3:1, což je WCAG 2.1 SC 1.4.11 pro UI prvek.

**Oprava:** `.won-rail__arrow--overlay` alpha `0.28` → `0.55`. Přes bílou vyjde ~#737373 →
4,76 : 1. Nad fotkou to čte jako o něco pevnější scrim, což je pro čitelnost lepší.

**Pravidlo:** hodnota nastavení určená pro jeden kontext (`overlay` = nad médii) musí přežít
i v tom druhém — merchant ji může zapnout globálně. Nestačí ji tak pojmenovat.

Guard: `tests/smoke/won-rail-arrow-contrast.spec.ts` — prohodí třídu tónu na reálném
tlačítku a měří skutečnou kaskádu, takže nepotřebuje round-trip přes nastavení motivu
a platí i pro budoucí tóny.

## Zůstává otevřené

1. ~~`arrow_style = minimal` nad médii~~ — **opraveno**. Plocha i okraj jsou `transparent`
   záměrně (merchant si `minimal` volí právě proto, že nechce plátek), takže scrim by to
   nastavení popřel. Místo něj `text-shadow: 0 1px 3px rgba(0,0,0,.75)` na zdvojeném
   selektoru `--minimal.--overlay`: glyf drží nad libovolnou fotkou a na stránce (tón
   `surface`, tmavý glyf) se neprojeví.
   Guard je psaný nad KASKÁDOU, ne nad jednou dvojicí tříd — projede všechny 4 styly × 2 tóny
   a chytne jakýkoli budoucí styl bez plátku: „když šipka nemá plochu ani okraj, musí mít stín".
2. **Známá vada potvrzena vizuálně:** na hero peek layoutu leží šipky přes tlačítko „Koupit"
   (`tmp/ppu-shots/hero-arrows-desktop-1440.png`). Nikdo ji nezadal.
3. Šipky nad médii jsou ze scope kontrastního specu **vynechané záměrně** — jejich pozadí je
   fotka, kterou metoda kompozice přes předka nepřečte. Ověřeno jen screenshotem.
4. Zbytek Vrstvy 3 (Cards, Effects, Catalog, Policy, Animation) **nezměřen**.
