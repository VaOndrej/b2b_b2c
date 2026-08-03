# Won Toasts — kompletní plán do release (v2)

První plnohodnotná appka z `apps/_template`. Konfigurovatelný storefront
notification engine. Cíl: **maximální kontrola klienta** nad tím, jak toasty
vypadají, co groupují, které eventy zachytávají, jak dlouho zůstávají a jestli
jdou zavřít — vše z Polaris adminu, s živým náhledem. **Standing goal: každá Won
appka cílí na odznak Built for Shopify.**

> v2 = po druhém strategickém průchodu. Zásadní posun: z „nastavení toastů" na
> **pravidlový systém (rules engine)**, který zpracovává nákupní eventy a
> rozhoduje, *zda, kdy a jak* zákazníkovi něco ukázat. Silnější produktová
> pozice a lepší základ pro rozšiřování.

## 0. Vůdčí principy

1. **Config je jediný zdroj pravdy.** Žádná behaviorální konstanta není v kódu
   natvrdo (burst 600 ms, pozice, délka, barvy). Vše je pole v configu s
   defaultem, validované, bezpečné i při neúplné/starší konfiguraci.
2. **Preview parity (WYSIWYG).** Admin i storefront renderují **tentýž Web
   Component `<won-toast-host>`** z balíčku `@won/toast-ui`, krmený *neuloženým*
   stavem formuláře. Preview není napodobenina — je to tentýž renderer + tatáž
   prezentační logika.
3. **Rules engine, ne plochý config.** Globální vzhled/chování je flat; **eventy
   jsou `ToastRule[]`.** Nový event = nové pravidlo, ne dalších 20 polí typu
   `giftToastColor`.
4. **Event ≠ surface.** Toast není vždy nejlepší forma. Každé pravidlo si volí
   `surface` (toast / persistent / cart-inline / progress / banner / none), aby
   appka zákazníka „netoastovala" při každém pohybu.
5. **Akční toasty od začátku.** Hodnota není v oznámení, ale v možnosti hned
   reagovat (Zpět, Zobrazit košík, Vybrat dárek, +1 ks do slevy).
6. **Native-first → Built for Shopify.** Embedded (App Bridge latest + session
   tokens), Polaris, theme app extension (žádné ScriptTag/Asset API), managed
   billing, GDPR webhooky, perf budget. BFS je post-launch cíl, ale architektura
   ho nesmí nikdy blokovat.
7. **Kvalita se ve Free negativně nekazí.** Základní použitelnost, přístupnost,
   spolehlivost a základní design jsou i ve Free. Pro odemyká *rozsah*, ne
   *kvalitu*.
8. **Progresivní rozšiřování.** Verzovaný config + migrace; nové eventy bez
   breaking changes; merchant nemusí rozumět programování.
9. **Toasts oznamuje, negrantuje.** Appka nemění ceny ani nepřidává produkty
   (žádná Function). Dopravu zdarma drží **Shopify shipping rate**, dárek řeší
   **Won GiftLadder** (Function, `_gift_progress`, cena 0). Toasts hlídá práh a
   **oznamuje** postup/dosažení; práh v configu = tentýž number, který merchant
   zadal v dopravě. Integrace s GiftLadder: Toasts detekuje `_gift_progress`
   řádek a přesně oznámí „Dárek odemčen" + akci „Vybrat dárek". Tahle hranice
   drží appku jednoduchou a spolehlivou.

## 1. Datový model (rules engine, verzovaný)

```ts
interface ToastAppConfig {
  version: number;                 // schema verze → migrace
  enabled: boolean;
  global: GlobalSettings;          // queue, defaulty chování, summarize
  theme: ToastTheme;               // vzhledové tokeny (system/light/dark/custom)
  rules: ToastRule[];              // eventy → prezentace/akce/priorita
  locales: LocaleDictionary;       // texty + pluralizace per jazyk
  targeting: GlobalTargeting;      // app-wide include/exclude (Pro)
  plan: "free" | "pro";
}

interface ToastRule {
  id: string;
  enabled: boolean;
  name: string;                    // merchant-friendly ("Doprava zdarma")
  trigger: ToastTrigger;           // { type: "cart.added" | "milestone.free_shipping" | ... }
  conditions: ToastCondition[];    // AND; cartValue, hasTag, collection, customerState…
  surface: MessageSurface;         // toast | persistent-toast | cart-inline | progress | banner | none
  presentation: ToastPresentation; // styleOverride + templateRef + ikona
  actions: ToastAction[];          // interaktivní CTA
  severity: "info" | "success" | "reward" | "warning";
  priority: number;                // tie-break v conflict engine
  cooldown: ToastCooldown;         // once-per: session|cart|customer + minIntervalMs
  grouping: ToastGrouping;         // groupKey, burstWindowMs, mergeDeltas
  localeOverrides?: Record<string, Partial<ToastRule>>;
}

type MessageSurface =
  | "toast" | "persistent-toast" | "cart-inline" | "progress" | "banner" | "none";
```

### Milestone stavový model (klíčové pro dopravu/dárek/slevu)

Milník se nesmí „oslavovat" při každé změně košíku. Engine počítá per-milník
přechod z předchozího do nového stavu:

```ts
type MilestoneState =
  | "unreached" | "approaching" | "just_reached" | "reached" | "just_lost";
```

Toast pro dopravu zdarma se pouští jen na `just_reached`; „zbývá X" progress
běží v `approaching` (typicky jako `surface: "progress"`, ne toast); pokles pod
práh = `just_lost` (volitelně tichý). Stav se drží per **cart token** (přežije
tab i reload), případně per customer u přihlášených.

### Flat vrstvy (global + theme) — plný katalog konfiguračních polí

Zůstává vše z v1 jako **defaulty**, které pravidlo může přepsat. Zkráceně:

- **`global` (chování/queue):** `position` (3×3 grid), `offsetTop/Inline`,
  `durationMs`, `autoDismiss`, `pauseOnHover`, `closeable`, `clickAction`,
  `maxVisible`, `overflowStrategy` (`queue|collapse`), `stackDirection`,
  `mobileBehavior`, `onPageChange`, `whenDrawerOpen`, a grouping defaulty
  (`groupingMode`, `burstWindowMs=600`, `mergeDeltas`, `dedupeWindowMs`,
  `rateLimitPerMin`), a `summarizeConcurrent` (viz §3).
- **`theme` (vzhled):** `themeMode` (system/light/dark/custom), `accent.<type>`,
  `colorBg/Text`, `cornerRadius`, `shadow`, `border`, `backdropBlur`, `width`
  (+ min/max), `gap`, `density`, `animationIn/Out` + `animationMs`, přepínače
  `showImage/Price/Delta/Icon`, `iconSet`, `fontMode`, `customCss` (Pro).

Kompletní tabulky `pole → typ → default → admin control → MVP` jsou v příloze A.

## 2. Živý náhled + Scenario Lab

- `@won/toast-ui` exportuje `<won-toast-host>` + čistou render funkci — jeden
  zdroj pro admin i storefront.
- **Preview** reaguje živě na neuložený stav formuláře (pozice, barvy, duration,
  grouping, light/dark, responzivita).
- **Scenario Lab** (silná diferenciace): merchant spustí realistické scénáře,
  ne jen jeden toast —
  `přidat 1×` · `přidat 3× během burst okna` · `odebrat` · `+/− množství` ·
  `dosáhnout dopravy zdarma` · `ztratit dopravu zdarma` · `dárek` ·
  `konflikt více milníků současně` · `chyba cart API` · `mobil` · `dlouhý SK
  překlad` · `chybějící obrázek` · `max toastů` · `reduced-motion` ·
  `jen klávesnice`. Odhalí problémy s pořadím/groupováním/responzivitou před
  publikováním. Používá tentýž renderer + tentýž conflict engine jako storefront.

## 3. Priority & conflict engine (deterministický)

Řeší situaci: *přidání produktu + překročení dopravy zdarma + dárek + množstevní
sleva v jednom okamžiku.* Bez toho tři až čtyři toasty přes sebe.

```
onCartChange(prev, next, cfg):
  events = deriveEvents(prev, next)          // cart diff + milestone přechody
  cands  = []
  for rule in cfg.rules where rule.enabled:
    ev = match(rule.trigger, events)
    if ev and passes(rule.conditions) and passes(rule.targeting)
       and cooldownOK(rule, state) and milestoneIsFresh(ev):   // jen just_* přechody
      cands.push({rule, ev})

  cands = dedupe(cands, cfg.global.dedupeWindowMs)             // stejný groupKey → 1
  cands = groupBursts(cands, rule.grouping.burstWindowMs)      // "+3 ks"

  sort cands by (severityRank desc, priority desc, ts desc)

  if cfg.global.summarizeConcurrent and rewardCount(cands) >= 2:
     emit ONE summary toast: "Produkt přidán. Navíc doprava zdarma a dárek."
        (akce z nejvyššího reward pravidla)
  else:
     visible = take(cands, cfg.global.maxVisible)
     enqueueOverflow(rest, cfg.global.overflowStrategy)        // queue | "+N"

  render(visible)   // skip surface ∈ {none, cart-inline, progress} → není toast
  markAnnounced(cands, state)                                  // proti opakování
```

Pravidla: `severityRank` (`warning>reward>success>info`), pak `priority`, pak
recency. Cooldown a `markAnnounced` brání opakovanému oslavování téhož milníku;
`just_lost` resetuje announce flag, takže opětovné překročení zase oslaví.
Stav (`announcedMilestones`, cooldowny) žije per cart token.

## 4. Akční toasty

Každá akce (`ToastAction`) = optimistic update + rollback:

| Akce | Trigger toastu | Chování |
|---|---|---|
| Zpět / Vrátit | removed | znovu přidá odebraný řádek |
| Zobrazit košík / Do pokladny | added | otevře drawer / redirect |
| Vybrat dárek | gift `just_reached` | otevře výběr dárku |
| +1 ks do slevy | qty tier `approaching` | přidá 1 ks a překreslí |
| Přidat doporučený | free-ship `approaching` | one-click add produktu k prahu |

Každá akce řeší: loading, optimistic, rollback při chybě/timeoutu, opakovaný
klik (idempotence), změnu košíku z jiného tabu (re-sync z `/cart.js`),
klávesnici a focus management. Bez těchto stavů se akce nepustí do release.

## 5. Analytics lifecycle (v modelu od začátku, sběr až MVP4+)

Každý event dostane stabilní ID a měřitelný lifecycle **už teď** (doplnit
metriku později bez změny architektury):

```
detected → normalized → eligible → grouped → queued → displayed
        → interacted → dismissed
```

Metriky: displayed, read-long-enough, CTA used/failed, cart opened, checkout
reached, order completed. **Bez falešného připisování konverzí** — toast se
loguje jako *asistence*, ne příčina; A/B (Pro) měří inkrementální rozdíl.
Privacy: consent-aware, minimální sběr, žádné PII v event payloadu.

## 6. Tarify (ZAMČENO — dělení podle rozsahu, ne kvality)

- **Free (použitelná, ne zmrzačená):** cart eventy **added / removed / ±qty**;
  **default vzhled** (neutrální system + light/dark, bez design studia);
  **lokalizace** cs/sk/en; **přístupnost**; **preview + Scenario Lab**;
  **základní** groupování (burst merge); **1–2 milníková pravidla** z receptů.
  Branding „Powered by Won".
- **Pro ($5):** **design studio** (plný vzhled + custom barvy/animace),
  **pokročilé groupování** (per-variant/custom group key, dedupe/cooldown/rate),
  **neomezená pravidla** + advanced rules builder, **targeting**,
  **experimenty/A-B**, pokročilé **analytics**, **custom CSS**, integrace,
  export/import, bez brandingu.

> Pozn.: přístupnost, spolehlivost, lokalizace a preview jsou i ve Free — Pro
> gate-uje **rozsah**, ne kvalitu (BFS „quality-not-gated").

## 7. MVP žebřík do release (nejrychlejší cesta k testovatelné appce)

Každý MVP: shippable, **TDD červené testy první**, E2E na Dawn i Horizon. Gate:
`test:unit -w won-toasts && typecheck && build && validate:shopify`.
Config je **verzovaný od MVP0** (i když pravidla přijdou později) → žádné
breaking migrace.

### MVP0 — Skeleton → badge `Scaffold`
- Klon `_template`, `ToastAppConfig{version,enabled}` + migrace, config proxy
  (`won-toasts-config-ok`), app embed no-op `<won-toast-host>`
  `data-won-toasts-status="ready"`, Polaris App Home s `enabled` + install check.
- Testy: contract (embed shape), service (default config), E2E (embed+ready).

### MVP1 — Cart toasty → badge `Alpha`
- Core: `deriveEvents` (cart diff, ignoruje `_gift_progress`), `planToastQueue`
  základ. Storefront: wrap fetch/XHR + `cart:updated` → rekonciliace `/cart.js`.
  Render added/removed/±qty s deltou, auto-dismiss, `position`, `durationMs`,
  offsety z configu.
- **Akce už tady:** „Zpět" u removed (optimistic + rollback).
- Admin: stránka Chování (základ). Preview: ne. E2E: add→toast+delta→dismiss;
  removed→Zpět vrátí položku.

### MVP2 — Design studio + preview → badge `Alpha→Beta`
- `<won-toast-host>` style tokeny, `resolveToastPresentation`. Admin: Vzhled +
  Přehled s **živým preview** a základní **Scenario Lab** (1×, 3× burst,
  mobil/desktop, light/dark). Closeable ×, responzivní varianty.
- E2E: změna barvy/radiusu se projeví v preview i storefront; × zavře.

### MVP3 — Grouping, surface & conflict engine → badge `Beta`
- Core: `groupEvents` (burst/dedupe/mergeDeltas), overflow, rate-limit,
  **milestone stavový model** + **conflict engine** (§3), **surface** routing.
- Admin: Chování rozšířené (grouping, maxVisible, overflow, summarizeConcurrent,
  per-surface volba). Scenario Lab: „konflikt více milníků".
- E2E: 3× rychle → jeden toast `+3`; 4 milníky současně → jeden summary toast;
  `approaching` doprava jde do progress, ne toast.

### MVP4 — Rules builder, eventy & šablony → badge `Beta`
- Core: `ToastRule[]` builder, template renderer + **pluralizace**, milníky
  doprava/dárek/qty-sleva; **integrace Won GiftLadder** (detekce `_gift_progress`
  → „Dárek odemčen" + „Vybrat dárek"). Admin: Eventy & pravidla (trigger, podmínky,
  prezentace, akce, priorita, cooldown), šablony s placeholder chips
  (`{qty}{delta}{product}{variant}{price}{cartTotal}{remaining}{threshold}{discount}`),
  locale taby, per-rule barva/ikona/délka/CTA/priorita.
- Analytics lifecycle začíná logovat. E2E: vlastní pravidlo + šablona/locale;
  gift toast s výběrem dárku.

### MVP5 — Cílení, Pro, billing → badge `Shipped`
- Shopify Billing API (Free/$5), feature gating (rozsah, ne kvalita), custom
  CSS, targeting, experimenty (základ), upgrade flow, remove branding.
- Testy: tier-gate, targeting match, billing flow. E2E: Free vs Pro rozsah;
  targeting „jen mobil".

## 8. Release checklist (BFS-ready)

- [ ] **Built for Shopify readiness** (post-launch milník): embedded + **App
      Bridge latest** + **session tokens**; storefront Lighthouse dopad pod prah
      (~≤10 b); dobré hodnocení; žádné kritické issues; rychlá podpora.
- [ ] Storefront perf budget **~15 kB gz**, žádný layout shift, lazy init.
- [ ] GDPR webhooky (`customers/data_request`, `customers/redact`, `shop/redact`).
- [ ] Billing flow (subscribe/cancel/proration/test charge).
- [ ] A11y audit (aria-live/role status|alert, focus, reduced-motion, čas na
      přečtení, screen-reader pořadí, žádné zahlcení SR).
- [ ] Guardrails (§9), config export/import (JSON), uninstall čistí data.
- [ ] Kompatibilita Dawn + Horizon zelená v CI; adapter vrstva (§10).
- [ ] App Store listing (ikona, screenshoty design studia + Scenario Lab).

## 9. Guardrails (ochrana před špatným UX)

Rozliš **tvrdou validaci** (nepustí uložit), **varování**, **doporučení**,
**auto-fix**:
- durationMs < ~1500 → varování „málo času na přečtení"; kontrast pod WCAG →
  tvrdá validace u custom barev; >N aktivních pravidel / konfliktní pravidla →
  detektor konfliktů; agresivní animace/frekvence → varování; toast překrývající
  cookie lištu/chat → doporučení k offsetu; chybějící překlad → varování +
  fallback; „nepravdivá urgency" a dark patterns → produkt je nenabízí.

## 10. Kompatibilita & adapter vrstva

Core engine nesmí záviset na konkrétní implementaci košíku. **Cart adapter**
normalizuje zdroje eventů (Ajax Cart API, drawer, cart page, quick-add, product
form, Section Rendering, Bundles, subscriptions, apps zachytávající add-to-cart,
více tabů) do jednoho `NormalizedCartEvent`. Cíl: Dawn + Horizon MVP, ostatní
přes adaptery bez zásahu do core. Headless mimo scope MVP.

## 11. Admin informační architektura (ZAMČENO — recepty + simple, builder v Advanced)

Admin nesmí být obří technický formulář. Dvě roviny:

- **Simple (default):** knihovna **receptů** (přednastavená pravidla —
  „Toast po přidání", „Doprava zdarma", „Dárek", „+1 ks do slevy"). Merchant
  recept zapne a upraví jen povrch: text, barvu (Pro), délku, CTA. Vše s živým
  preview.
- **Advanced (skryté, opt-in):** plný **rules builder** (trigger → podmínky →
  surface → prezentace → akce → priorita → cooldown → grouping), detektor
  konfliktů, koncepty/publikování, duplikace a pauza pravidla.

Stránky: **Přehled** (enabled, install check, preview + Scenario Lab, plán) ·
**Recepty** · **Vzhled** (Pro design studio) · **Pravidla** (Advanced) ·
**Eventy & zprávy** (šablony, locale) · **Cílení** (Pro) · **Analytics** (Pro) ·
**Plán/Billing**.

## 13. Knihovna receptů (shopper-first scénáře)

**Konfigurační model:** každý scénář = **jeden recept** = **1 přepínač + max ~3
pole + okamžité preview**. Merchant nikdy neskládá pravidlo od nuly (to je až
Advanced). Free = default vzhled + až **3 aktivní recepty**; Pro = neomezeně +
design + integrace + targeting. Lens u každého: *co zákazník chce vidět* a *proč
to není otravné*.

| Recept | Co zákazník chce / proč není otravné | Nastavení (pole) | Surface | Tarif |
|---|---|---|---|---|
| Přidáno do košíku | „proběhlo to" + náhled; jen na akci | text, délka | toast | Free |
| Odebráno + **Zpět** | oprava omylu bez frustrace | text | toast+akce | Free |
| Změna množství „+2 ks" | ujištění; burst merge → 1 toast | text | toast | Free |
| **Sleva/kód uplatněn** „ušetřil jsi {discount}" | zmírní úzkost „platí můj kód?"; čte cart | text | toast | Free |
| Varianta vybrána „Vybráno: L" | potvrzení volby; často stačí `none` | text, on/off | toast/none | Free |
| Vítej zpět — košík čeká | jistota, že o věci nepřijde | text | banner | Free |
| **Doprava zdarma** (progress + dosažení) | vidí kolik zbývá + oslavu; progress ≠ spam | práh, texty, CTA | progress+toast | Free |
| **Dárek** (s GiftLadder) | „mám dárek" + výběr; detekce `_gift_progress` | práh/napojení, text | toast+akce | Free/Pro |
| Množstevní sleva „+1 ks = −10 %" | konkrétní motivace ušetřit | tier, text | toast/inline | Pro |
| Kombinovaný progress | „máš dopravu, do dárku zbývá X" | pořadí milníků | progress | Pro |
| Doručení dnes „objednej do 2 h" | rozhoduje o koupi; cutoff pravdivý | cutoff, text | inline/toast | Pro |
| Skladem málo „poslední 3 ks" | pravdivá naléhavost; jen reálný inventory | práh ks, text | inline/toast | Pro |
| Akce končí „sleva do půlnoci" | pravdivá urgence; jen reálný konec | konec, text | banner | Pro |
| Loyalty „získáš {points} bodů" | odměna za nákup; integrace | napojení, text | toast | Pro |
| Přihlas se pro body (host) | motivace k účtu, nevtíravě | text, frekvence | toast | Pro |
| Předplatné aktivováno „−10 % navždy" | ujištění o benefitu subscription | text | toast | Pro |

**Guardrails (globálně, aby to bylo příjemné):** jedna oslava na milník
(announced flag + cooldown, `just_lost` reset); globální frekvenční strop + tichý
režim pro drobné eventy; „approaching" defaultně `progress`, ne toast; pravdivá
data only (žádná fake urgency); reduced-motion + a11y bez zahlcení SR.

## Příloha A — plné tabulky konfiguračních polí

## Příloha B — Top 25 backlog (vážené skóre)

Váhy: uživatelská hodnota 30 % · merchant 25 % · diferenciace 20 % ·
jednoduchost 15 % · nízké riziko kompatibility 10 %. Skóre 1–10, řazeno sestupně.
Kurátorský výběr skutečně odlišných funkcí (ne textové varianty).

| # | Funkce | Kategorie | Tarif | Fáze | Skóre |
|---|---|---|---|---|---|
| 1 | Undo „Zpět" po odebrání (optimistic + rollback) | Cart / akce | Free | MVP1 | 9.1 |
| 2 | Burst merge „+3 ks" v okně 600 ms | Grouping | Free | MVP3 | 8.9 |
| 3 | Milestone stavy (just_reached apod.) — neblikat | Milníky | Free | MVP3 | 8.8 |
| 4 | Doprava zdarma: progress (approaching) jako `progress` surface | Doprava | Free/Pro | MVP4 | 8.7 |
| 5 | Conflict engine + summary toast (víc milníků naráz) | Grouping/priorita | Free | MVP3 | 8.6 |
| 6 | Scenario Lab (burst/konflikt/mobil/dlouhý SK/chyba API) | Preview | Free | MVP2 | 8.6 |
| 7 | „Zobrazit košík / do pokladny" akce | CTA | Free | MVP1 | 8.4 |
| 8 | Doprava zdarma dosažena (just_reached toast) | Doprava | Free | MVP4 | 8.3 |
| 9 | Recepty (přednastavená pravidla) + simple režim | Admin | Free | MVP4 | 8.3 |
| 10 | Dárek odemčen + akce „Vybrat dárek" | Dárky | Free/Pro | MVP4 | 8.1 |
| 11 | „+1 ks do slevy" nudge (qty tier approaching) | Slevy | Pro | MVP4 | 8.0 |
| 12 | Pluralizace + lokalizace cs/sk/en | i18n | Free | MVP4 | 7.9 |
| 13 | Surface routing (toast vs inline/progress/none) | Architektura | Free | MVP3 | 7.9 |
| 14 | Detektor konfliktních/neplatných pravidel (guardrail) | Admin/guardrail | Pro | MVP4 | 7.7 |
| 15 | Cart adapter (Ajax/drawer/quick-add/Bundles/subs) | Kompatibilita | Free | MVP1–3 | 7.7 |
| 16 | Cross-sell „přidej X pro dopravu zdarma" | Upsell/akce | Pro | po MVP | 7.6 |
| 17 | Targeting (page/collection/device/customerState) | Cílení | Pro | MVP5 | 7.4 |
| 18 | Design studio (plný vzhled + animace) | Vzhled | Pro | MVP2 | 7.3 |
| 19 | Markets: prahy/formát dle měny a marketu | i18n/Markets | Pro | po MVP | 7.2 |
| 20 | Cooldown/rate-limit proti opakovanému oslavování | Grouping | Free | MVP3 | 7.1 |
| 21 | Analytics asistence (bez falešné atribuce) | Analytics | Pro | MVP4+ | 7.0 |
| 22 | Config export/import (JSON) | Dev/admin | Pro | MVP5 | 6.8 |
| 23 | A/B test textu/pozice/CTA | Experimenty | Pro | po MVP | 6.6 |
| 24 | B2B: jiné prahy / potlačit consumer nudge | B2B | Pro | dlouhodobě | 6.3 |
| 25 | Custom CSS | Vzhled | Pro | MVP5 | 6.1 |

**Vědomě NEimplementovat (feature creep / dark patterns):** falešná urgency
(„jen 2 ks!" bez pravdy), fake „X lidí kouká", auto-oslavování při každém
scrollu, zvuk defaultně zapnutý, toast na každý mikropohyb, plný enterprise
experiment engine v MVP, headless podpora v MVP, per-zákazník ML personalizace.

(Detailní `pole → typ → default → admin control → MVP` per Behavior / Grouping /
Appearance / Events / Targeting — viz git historie v1 tohoto souboru; v2 je
přeskupila do vrstev `global` / `theme` / `rules`, hodnoty a defaulty zůstávají.)
