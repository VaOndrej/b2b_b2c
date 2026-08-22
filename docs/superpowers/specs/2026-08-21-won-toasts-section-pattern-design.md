# Won Toasts — stavová sekce jako znovupoužitelný pattern

**Datum:** 2026-08-21
**Rozsah:** poslední kolo admin UX/vizuálu Won Toasts před releasem
**Řídící dokument:** [`won-app-design-doctrine.md`](../../won-app-design-doctrine.md) — Část I
**Nedotknutelné:** done-linka F1/F2/F3 (`orders/create` zůstává zakomentovaný, scope `read_themes`,
social proof + agregáty vypnuté, `EXPERIMENTS_LIVE_TICK_WIRED=false`)

---

## 1. Problém

Majitel formuloval pět stížností na admin. Vypadají jako pět různých úkolů, ale mají jednu příčinu.

| Stížnost | Zdroj |
|---|---|
| „Sekce nejsou sexy, přepracuj vizuál — má to platit genericky" | `won-toasts-prosim-prepracuj-mi-vizual-…` |
| „K čemu je mi tady výčet všech toastů, nic to neříká" | `tady-mi-to-prijde-malo-prehledne-…` |
| „Look and timing je PRO funkcionalita, ale je schovaná" | `look-and-timing-v-won-toasts-…` |
| „Custom CSS — málo a špatně odkomunikované" | `custom-css-mi-prijde-ze-je-malo-…` |
| „Targeting sjednotit a limitovat na Pro, ale neblokovat Free" | `won-toasts-targeting-muzeme-nejak-sjednotit-…` |

**Společná příčina: sekce popisují svoje schéma, ne svůj stav ani svůj důsledek.**

Konkrétně v dnešním kódu:

- `s-section heading="Placement"` neřekne, že je nastaveno `bottom-right`, `40px`, `max 3`.
  Merchant musí sekci otevřít a přečíst hodnoty z inputů.
- `Group` (v `app.design.tsx`) je jen tučný titulek + šedý hint. Sbalený `Group` nesdělí nic —
  což je přímé porušení §9d („disclosure summary říká pravdu").
- `ToastLauncher` ukazuje 7 karet s **popisem kategorie** místo se **stavem**. Po druhém dni
  provozu už merchantovi nesděluje nic nového.
- `ProFrame` rozlišuje `locked` a odemčený stav pouze alfou tintu (0.10 vs 0.18). Pro se tedy
  nikde neprodává — jen se ztlumí inputy. To je §16 splněné formálně, ne obsahově.
- `TypeStyleFields` je zabalený v nativním `<details>`, takže jediná per-type Pro featura
  v aplikaci je vizuálně slabší než kterýkoliv `s-select` vedle ní.

## 2. Řešení: tříslotová stavová sekce

Jeden sdílený primitiv, `WonSection`, který nahradí dvojici `s-section heading=` + `Group`.
Každá sekce i každá karta má tři pevné sloty:

1. **Identita** — glyf + titulek. Jedna barva na výsledkovou rodinu, ne na widget (§11).
2. **Stav v klidu** — jednořádkový souhrn aktuální konfigurace lidskou řečí
   („Vpravo dole · 40 px · max 3 najednou") + On/Off nebo Pro chip. Aplikace §11d
   („stav čitelný bez interakce") na úroveň sekce.
3. **Důsledek** — drobná vizuální stopa: buď mini `WonToastCard`, nebo `EffectProof` chipy.

Teprve pak tělo sekce. Sbalená sekce ukazuje sloty 1–3, takže i zavřená říká pravdu (§9d).

### 2.1 Odkud se bere souhrn

Formátovače žijí v `@won/core` vedle sanitizérů, ne v routě:

```
packages/core/src/toasts/describe.ts
  describePlacement(global)  → "Vpravo dole · 40 px · max 3 najednou"
  describeTiming(global)     → "5 s · zavíratelné · pauza při najetí"
  describeAntiSpam(global)   → "Slučuje podle produktu · max 8 / relaci"
  describeLook(theme)        → "Světlý · zaoblení 12 px · stín střední"
  describeTypeStyle(config, typeKey) → "Dědí globální design" | "Vlastní: tmavý, 3 s"
```

**Důvod:** stejná logika jako §10b / DATA-4. Kdyby si každá routa skládala string sama,
app #2 si ho napíše znovu a doktrína o znovupoužitelnosti bude lhát. Formátovače jsou čistě
funkční, takže je pokryje unit test v `test:packages`.

### 2.2 Layout sekce

Sekce dostane dvousloupcový interiér: ovládání vlevo, lokální důsledek vpravo. Stránka si
ponechává jeden sticky globální preview. Tím se využije šířka full-page appky, aniž by se
porušilo §7b (studio shell = jeden fokusovaný panel).

Dvousloupcový interiér je **opt-in** (`aside` prop). Sekce bez smysluplného lokálního
důsledku zůstane jednosloupcová — §10d zakazuje důkaz u triviálního přepínače.

## 3. Dopad na jednotlivé stížnosti

### 3.1 Stránka Toasts — „Běží teď" / „Můžeš zapnout"

`ToastLauncher` se přestane dělit podle kategorie a začne se dělit podle **stavu**:

- **Běží teď** — zapnuté toasty, každý s úryvkem živé zprávy a počtem zobrazení za 7 dní.
  Data z `summarizeAnalytics()`, který už routa `app._index.tsx` používá. Když data nejsou,
  karta říká „Sbírám data" — §5 nikdy nefabrikuje.
- **Můžeš zapnout** — vypnuté toasty s blurbem. Tam prodejní text smysl má.

Výsledek: stránka odpovídá na „co mi na storu běží a co bych mohl zapnout" (A3), ne na
„jaké typy toastů existují".

**Bez nového scope a bez nové PII** — `summarizeAnalytics` čte vlastní rollup tabulky.

### 3.2 Look & timing (per-type styl)

`<details>` zmizí. `TypeStyleFields` se stane plnohodnotnou `WonSection` se stavovým headerem,
jehož souhrn nese `describeTypeStyle()` — tedy „Dědí globální design" nebo „Vlastní: tmavý, 3 s".

Pro se prodává podle §16c: locked sekce zůstane čitelná, ovládání `disabled`, ale nad ním běží
**živý náhled toho, co by ta featura udělala**. Preview smí běžet v adminu; server entitlement
se nemění (BILL-1) a `gateConfigForPlan` zůstává beze změny.

### 3.3 Targeting

Sloučení už proběhlo — `app.exclusions.tsx` je dnes jen redirect a `app.targeting.tsx` má jednu
sekci „Where toasts show". **Datové modely zůstávají oddělené** (exclusions Free, targeting Pro)
a gatují se v action nezávisle. Zbývá vizuální část: `ProFrame` dostane stejné prodejní zacházení
jako 3.2 — Free vidí, co Pro dělá, ne jen ztlumené inputy.

### 3.4 Custom CSS

Není to feature gap. Per-type styl **už funguje** přes `TypeStyleFields`; je jen schovaný, což
řeší 3.2. Zbývají dvě reálné vady v kódu:

- `WonToastCard` má `wonType = "cart"` napevno jako default a žádný volající ho nepřepisuje,
  takže `[data-won-type="announcement"]` v preview nikdy nechytne.
- `NotificationPreview` vůbec nepřijímá `customCss`, takže merchant edituje CSS naslepo pro
  šest ze sedmi typů toastů.

Obojí je porušení §3k a opraví se předáním správného `wonType` a `customCss` do preview.

### 3.5 Sdílená render vrstva a header

`NotificationPreview` si dnes kreslí kartu ručně místo přes `WonToastCard` — přímé porušení A1.
Přepíše se na `WonToastCard`; `surface` (banner / inline / persistent) zůstane jako obal kolem
sdílené karty, ne jako druhá implementace karty.

Header safety už existuje ve `StorefrontPreview` (`HEADER_SAFE`), ale `ToastPreview` a
`AnimatedToastPreview` renderují do šedého boxu bez kontextu — A4 („preview renderuje reálný
kontext, ne prázdno"). Dostanou stejný header band a stejný clamp.

## 4. Zápis do doktríny

Pattern se do `won-app-design-doctrine.md` zapíše jako:

- **§17 — Sekce vede stavem, ne schématem.** Tři sloty (identita / stav v klidu / důsledek).
  Sbalená sekce říká pravdu. Souhrn pochází ze sdíleného formátovače, nikdy z ručního stringu
  v routě.
- **A7 — Jedna sekční skořápka na aplikaci.** `WonSection` je jediný způsob, jak se v adminu
  kreslí sekce nebo karta. Vizuální rozdíl mezi dvěma sekcemi je bug, stejně jako A1 pro preview.

## 5. Co se v tomhle kole NEDĚLÁ

- experiment engine / A-B / holdout / AI-advisor v2
- akční CTA §4 („Vybrat dárek", „+1 ks do slevy")
- extrakce billingu do `app-kit`
- ai-advisor v1
- deploy na Fly.io
- `won-toast-insights-suggestions-mvp13`

## 6. Zahozeno

- **`won-toasts-nemyslis-ze-kdyz-je-appka-nyni-rozsirena-na-celou`** — *not implemented*,
  uzavřeno 2026-08-21. Zadání odkazovalo na screenshot, který se nedochoval, a majitel si
  původní záměr už nepamatuje. Lepší využití šířky full-page appky částečně pokrývá
  dvousloupcový interiér sekce (§17 / A7). Kdyby to znovu vyvstalo, založit nový task
  s konkrétním screenshotem.

## 7. Stav bran před touto prací (naměřeno 2026-08-21, HEAD `fc13ee9`)

| Gate | Stav |
|---|---|
| `@won/core` | 290 pass, 0 fail, 0 skip ✅ |
| `@won/testing` | 18 pass, 0 fail, 0 skip ✅ |
| `test:unit -w won-toasts` | **25 z 75 fail** ❌ → opraveno, viz níže |
| `typecheck:apps` | ✅ |
| `lint:standalone` | **20 errors** ❌ — pre-existující, mimo dotčené soubory |

### 7.1 Oprava unit gate (hotová)

`fc13ee9` přepnul `schema.prisma` z `sqlite` na `postgresql`, ale čtyři testovací soubory dál
stavěly SQLite fixture (`datasourceUrl: file:…`) s ručním DDL, které navíc už driftovalo od
schématu (`ToastAppConfig.global` deklarován `TEXT`, ve schématu `Json`).

Nový `tests/lib/test-db.ts` zakládá izolované Postgres schema per testovací soubor pomocí
`prisma db push` — fixture je tedy **odvozená ze schema.prisma**, ne psaná ručně (DATA-3).
Výsledek: **75 pass, 0 fail, 0 skip**.

### 7.2 Lint (v rozsahu — rozhodnuto 2026-08-21)

20 pre-existujících chyb ve `app.analytics.tsx`, `app.experiments.tsx`, `popularity.server.ts`,
`storefront-src/won-toasts.js` a `apps/_template/tests/compliance-webhooks.test.ts`. Žádná
nevznikla v téhle práci; majitel rozhodl uklidit je v rámci tohohle kola, ať je
`lint:standalone` zelená před releasem.

Devět z nich jsou neescapované uvozovky/apostrofy v JSX, dvě `any`, jedno nepoužité `_req`,
tři `Shopify is not defined` ve storefront runtime.

**Pozor u `storefront-src/won-toasts.js`:** `Shopify` je globál, který na storefrontu injektuje
Shopify. Opravou smí být POUZE deklarace globálu pro ESLint (`/* global Shopify */` nebo
`globals` v konfiguraci) — nikdy změna runtime chování. Kdyby oprava sáhla na chování, je to
dotyk F1 a majitel musí dojet E2E ručně.

## 8. Verifikace

```bash
npm run test:packages                 # + nové testy describe*()
npm run test:unit -w won-toasts       # 75, vyžaduje běžící docker compose db
npm run typecheck:apps
npm run lint:standalone
npm run build:apps
npm run validate:shopify
```

E2E (`test:e2e -w won-toasts`) headless nejde — potřebuje živý `shopify theme dev` +
`SHOPIFY_E2E_STOREFRONT_BASE_URL`. **Tahle práce se nedotýká `storefront-src/won-toasts.js`
ani geometrie toastů**, takže F1 by neměla být dotčená; kdyby se to změnilo, bude to explicitně
označeno a majitel musí E2E dojet ručně.


---

## 9. Co se při stavbě ukázalo navíc (2026-08-21)

Tři věci, které v původní analýze nebyly, protože vyšly najevo až při čtení runtime.

### 9.1 Preview lhalo o „Surface"

`NotificationPreview` kreslil pro `banner` full-width lištu a pro `inline` holý text.
`storefront-src/won-toasts.js` nic takového nerenderuje — `surface` jde jen do
`isPersistentSurface()` a řídí **výhradně** to, jestli toast sám zmizí. Všechny čtyři varianty
jdou přes stejný `notifCard()` do stejného regionu.

Opraveno v preview: tvar je všude stejný toast a popisek říká, co surface reálně dělá.
**Neopraveno v runtime** — skutečný banner/inline by byl zásah do `won-toasts.js` (brána F1).

### 9.2 Ikony a accent u ne-cart toastů

Storefront staví tři různé karty:

| Karta | Ikona | Accent |
|---|---|---|
| `cartCard` | ano (`iconFor`) | podle eventu |
| `renderMilestoneToast` | **ne** | podle eventu |
| `notifCard` | **ne** | vždy `accentFor("info")` |

Preview kreslil ikonu i accent podle typu u všech tří. Merchant tedy ladil „Accent colour per
event" na barvy, které se u countdown / low-stock / announcement nikdy neprojeví.

Opraveno v preview, zamčeno kontraktem `preview-storefront-parity.contract.test.ts` — když někdo
ikony do runtime doplní, test spadne a donutí aktualizovat preview ve stejném commitu.

### 9.3 Per-currency práh v plánu vs. v kódu

Plán tvrdil, že per-currency práh není. Kód ho má (`milestones[].thresholds`, editace na
`/app/markets`). Plán opraven.

## 10. Výsledek bran po práci

| Gate | Před | Po |
|---|---|---|
| `@won/core` | 290 | **311** pass, 0 fail |
| `@won/testing` | 18 | 18 pass, 0 fail |
| `test:unit -w won-toasts` | **25 fail** | **79** pass, 0 fail |
| `test:unit -w won-app-template` | 16 | 16 pass, 0 fail |
| `typecheck:apps` | ✅ | ✅ |
| `lint:standalone` | **20 errors** | ✅ 0 |
| `build:apps` | ✅ | ✅ |
| `validate:shopify` | ✅ | ✅ 6 souborů, 0 offenses |

## 11. Otevřená rozhodnutí pro majitele

1. **Banner / inline surface** — implementovat je doopravdy ve storefrontu, nebo z nabídky
   odstranit? Dnes jsou to tři názvy pro jednu věc („nezmizí sám"). Zásah do runtime = ruční E2E.
2. **Ikony + per-type accent u notification toastů** — doplnit do runtime? Naráží to na perf
   budget: shipnutý asset má ~18 B rezervy do 11 kB gz stropu, takže by se muselo nejdřív něco
   uříznout (SF-2 zakazuje strop zvednout).
