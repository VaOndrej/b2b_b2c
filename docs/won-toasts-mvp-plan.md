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

---

## 7b. v2 — obecný notification engine (MVP6–14)

> **Kontext (ZAMČENO, viz `docs/product-roadmap.html` Won Toasts karta):** po
> MVP0–5 (1.0 = cart-notifikátor) přerůstá Won Toasts na **jednotný notification
> engine** (cart eventy + countdown + urgency + announcement + social proof pod
> jedním designem, jedním rate-limit/conflict „mozkem", jednou Shadow-DOM
> plochou). **Odlišení:** unified engine + trust („real events only", GDPR-first,
> perf budget) + jednoduchost — NE počet featur. **Konkurenční benchmark =
> ToastiBar (MPS/Channelwill whitelabel):** ~11 typů live, skvělý onboarding,
> ale bloatware + fabrikovaná čísla + impression-metered pricing. Poctivé háčky:
> „real only" zužuje trh a vyrábí cold-start daň → odpověď = cart eventy jedou
> od 1. návštěvy + countdown/announcement jako výplň + agregát až s objemem.
>
> **Pořadí je záměrné a závazné:** onboarding první (MVP6), pak usnadnění (MVP7),
> pak **frequency governance jako GATE** (MVP8) — a teprve po něm smí přijít
> jakýkoli *page-view* typ (MVP9+). Žádný page-view typ se nesmí implementovat
> ani zapnout před dokončením MVP8.
>
> Každý MVP níže: shippable, **TDD červené testy první**, E2E na Dawn i Horizon,
> stejný gate jako 1.0. Markery zůstávají (`[data-won-toasts-embed]`,
> `data-won-toasts-status="ready"`, `[data-won-toasts-region]`,
> `[data-won-toast][data-type]`, `[data-won-toast-delta/undo/close]`). Watermark
> `[data-won-branding]` byl odstraněn (výchozí stav = bez brandingu).

> **⏱ Stav implementace — snímek z auditu kódu 2026-08-07.** Badge-y `Spec`
> u MVP6–14 níže **zaostávají za kódem** (plán se needitoval, jak se stavělo).
> Skutečný stav proti `apps/won-toasts` + `packages/core/src/toasts|cart`:
>
> - **Shipped (v kódu, ověřeno):** MVP8 frequency governance + quiet mode ·
>   MVP9 countdown + low-stock + cart-activity · MVP11 announcement + agregáty ·
>   napříč: locale-as-data + Languages route, undo bez reloadu, per-typ
>   `byType` look+behavior (cart sdílí 1 klíč), PositionField + desktop/mobile
>   preview, živý preview přes native `input/change` binding, exkluze.
> - **Částečně:** MVP7 (presety „Start from a look" ano; hlubší self-service ne) ·
>   MVP10 (cílení + exkluze ano; scheduling neověřeno) · MVP12 (social-proof
>   endpoint ano; cold-start honesty/fallback neověřeno) · MVP13 (Insights/analytics
>   ano; **AI advisor `ai-advisor.ts` je DEFERRED — odpojen z UI 2026-08-06**;
>   per-typ success metrika NE).
> - **Neověřeno / spíš ne jako top-level:** MVP6 (onboarding/Dashboard není
>   samostatný nav tab) · MVP14 (BFS/a11y/reálný billing).
> - **Potvrzeně NENÍ (reálný backlog):** per-měna free-shipping práh (jedno
>   `thresholdCents` proti košíku v jakékoli měně — Markets ignoruje) ·
>   storefront **event icon** (preview ho kreslí, `won-toasts.js` ne = parity bug) ·
>   střední no-code branding vrstva (gradient/font/icon picker mezi on-off a raw
>   Custom CSS) · per-typ Insights metrika (→ MVP13).
>
> Nav IA (aktuální): Toasts · Design · Languages · Targeting · Insights · Plan.
> Zdroj: SB backlog audit, viz memory `won-toasts-backlog-audit`.

### MVP6 — Onboarding & aktivace → badge `Spec` (Free)
Ukradeno ToastiBaru; řeší náš vlastní `enabled=false` + „chybí app embed"
footgun (nová instalace se sotva zobrazí, když merchant nezapne app embed).
- **Admin — Quick setup guide** (Polaris modal/stránka): 2 úkoly + progress bar
  („X of 2 tasks complete") + „All Done" success.
  - Úkol 1 „Enable app": nastaví `ToastAppConfig.enabled=true` (od install už
    default true — viz service `create`, ale toggle zůstává viditelný a
    reverzibilní).
  - Úkol 2 „Enable app embed": tlačítko deep-linkuje do theme editoru na app
    embed —
    `/admin/themes/current/editor?context=apps&template=index&activateAppId=<extensionUuid>/won_toasts_embed`.
    Po návratu „Continue" re-checkne stav.
- **Admin — Dashboard/Přehled**: karta **„Theme embed status: Enabled/Disabled"**
  + tlačítko „Manage theme embed"; karta „App is enabled / Disable"; **empty-state
  detekce** („nový obchod bez objednávek" přes Admin GraphQL `orders(first:1)` →
  banner: nabídni cold-start-safe typy /countdown, cart-activity/, social proof
  až po 1. objednávce).
- **Embed detekce (jak):** číst current theme `settings_data.json` (Admin
  GraphQL `theme` → asset), najít blok extension v `current.blocks` a ověřit
  `disabled != true`. Fallback: storefront probe na `/apps/won-toasts/config` už
  existuje, ale ten neověří app embed → primární je settings_data.
- **Akceptační kritéria:** (1) unit: embed-status parser vrací
  enabled/disabled/unknown z fixtur settings_data (blok povolený / zakázaný /
  chybějící). (2) unit: deep-link URL builder produkuje výše uvedený tvar. (3)
  unit: empty-state banner logika = `ordersCount === 0`. (4) E2E: onboarding
  projde stavy 0/2 → 1/2 → All Done; dashboard zobrazí embed-status kartu.

### MVP7 — Usnadnění & self-service → badge `Spec` (Free core, Pro hloubka)
- **Presety (`@won/core`):** `PRESET_LOOKS` (4–6 pojmenovaných theme presetů:
  Minimal / Bold / Luxury / Playful …) + `PRESET_BEHAVIORS`
  (Subtle / Standard / High-urgency global presetů). Admin: preset picker; klik =
  aplikuje do configu; „Customize" odkryje Advanced.
- **Progressive disclosure:** Vzhled i Chování mají `Basics` (≤5 polí) vs
  `Advanced` (plný katalog přílohy A). Default = Basics.
- **Fire test toast (2 režimy, oba přes tentýž renderer, aktuální NEuložený
  stav):**
  - In-admin: vyrenderuje toast v Přehledu (už existuje preview).
  - „Preview on my store": tlačítko otevře storefront s podepsaným query
    paramem `?won_test=<type>&exp=<ts>&sig=<hmac>`. Embed ověří `sig` (HMAC z
    krátkého tokenu vydaného config endpointem, TTL ~5 min) → vystřelí
    **syntetický** event stejnou render pipeline. Marker `data-won-test="1"`.
    **Nezapisuje do košíku, neloguje analytiku.**
- **Plné per-event UI:** každý rule/event má on/off, `surface`, zprávu, styl, CTA
  (rozšíření stránky Eventy & zprávy).
- **Recommended defaults podle typu obchodu** (Fashion/Electronics/B2B →
  přednastaví preset + pravidla; volitelně krok v MVP6 onboardingu).
- **Import/export configu (JSON)** + **duplikace pravidla**.
- **„+N more" collapse** — dotáhnout admin toggle nad existujícím
  `overflowStrategy: "collapse"` (chip už v storefront JS).
- **Haptika** toggle (default OFF, mobil, `navigator.vibrate`) — **žádný zvuk**.
- **In-toast +1 / −1 stepper:** **Pro toggle, default OFF**. User-initiated zápis
  přes `/cart/change.js` (jako Undo → neporušuje „pure surface"), optimistic +
  rollback + idempotence + re-sync z `/cart.js`.
- **Akceptační kritéria:** (1) unit: aplikace presetu deterministicky nastaví
  očekávaná pole. (2) unit: HMAC podpis test-tokenu se ověří / expirovaný
  odmítne. (3) E2E: „preview on my store" → toast s `data-won-test="1"`, a
  `cartItems` se NEzmění. (4) unit: export→import round-trip = identický config.
  (5) E2E (Pro): +1 stepper zvýší qty řádku o 1; při chybě API rollback.

### MVP8 — Frequency governance → badge `Spec` (Free) — **GATE**
Bez tohoto se NEIMPLEMENTUJE žádný page-view typ (MVP9+).
- **Core (`rate-limit` + cooldown rozšíření):** `maxPerSession` (per-rule i
  global), per-rule `cooldown.minIntervalMs`, `suppressAfterDismiss`
  (po zavření se stejný `groupKey` v okně nevrátí), **cross-page dedupe**
  (persistуje `lastSeen`/`announced` přes `sessionStorage` per **cart token**),
  **quiet mode** (global mute okno / úplné ztlumení).
- **Enforcement:** conflict engine (§3) přidá krok „governanceOK(rule, state)"
  před `render`; page-view typy bez governance = tvrdě nerenderovat.
- **Storage:** namespace `won-toasts:<token>:<key>` v `sessionStorage` (private
  mode fail-open, jak už dělá `announced()` v JS).
- **Admin:** Chování → sekce Frequency (maxPerSession, cooldown, quiet mode).
- **Akceptační kritéria:** (1) unit: N+1-tý emit v session je potlačen při
  `maxPerSession=N`. (2) unit: po dismissu se rule se stejným groupKey v okně
  nevrátí. (3) unit: quiet mode = 0 emitů. (4) E2E: opakované page-view spouštění
  téhož typu na 5 PDP → max `maxPerSession` toastů, ne 5.

### MVP9 — První VIDITELNÝ cold-start-safe typ → badge `Spec` (Free countdown, Pro hloubka)
Aby MVP6–8 nebyly jen plumbing — první typ, co dá appce viditelný důvod
existovat. Funguje od 1. návštěvy i na malém obchodě (odpověď na cold-start).
Vše governováno MVP8.
- **Countdown timer** (vrácen ze škrtů): nový `trigger.type="countdown"`, surface
  `persistent-toast`|`banner`, config `{ endsAt?: ISO | evergreenMs?: number,
  pages: ("product"|"cart"|"landing"|"all")[], style }`. Renderer nový blok
  DD:HH:MM:SS, marker `[data-won-countdown]`. Evergreen = per-session odpočet.
- **Low-stock urgency** `trigger.type="stock.low"`: čte dostupný inventory
  (product JSON `variants[].inventory_quantity` je-li vystaven, jinak Storefront
  API), config `threshold`; „Only N left". Marker `[data-won-toast][data-type=
  "stock"]`.
- **Cart-activity** `trigger.type="cart.activity"`: agregát z **reálných** cart
  eventů („X lidí přidalo do košíku") — server-side counter, žádná fabrikace.
- **Admin:** stránka Recepty/Notifikace přidá karty Countdown / Low-stock /
  Cart-activity (styl ToastiBar mřížky, ale bez bloatu).
- **Akceptační kritéria:** (1) E2E: countdown se renderuje na product page s
  `[data-won-countdown]` a odpočítává. (2) E2E: low-stock se ukáže jen když
  inventory < threshold; jinak nic. (3) unit: cart-activity číslo = reálný
  counter (seed), nikdy náhodné. (4) E2E: governance (MVP8) limit platí i pro
  tyto typy.

### MVP10 — Cílení, časování & exkluze → badge `Spec` (Pro cílení, Free základní exkluze)
- **Scheduling:** `rule.schedule { startsAt?, endsAt?, daysOfWeek?: 0–6[],
  hours?: [from,to], tz: "shop" }`. Core `isScheduledNow(rule, now, shopTz)`
  (TZ shopu z Admin API). Mimo okno = pravidlo neaktivní.
- **Inclusion targeting (rozšíření conditions):** per-product/collection/tag,
  segmenty (`customerState` už; přidat `first-time` vs `returning` přes cookie,
  `customerTags` přes customer objekt v app-proxy), geo/Market
  (`request.locale`/country / Shopify Markets).
- **Exclude-URLs (nová admin stránka, Free):** quick toggles
  (Home/Product/Cart/Collection/…), **meta-tag opt-out**
  (`<meta name="won-toasts:active" content="false">` → storefront respektuje a
  no-opne), per-URL per-app exclusion list (glob/prefix match v configu, storefront
  matchuje `location.pathname`).
- **Akceptační kritéria:** (1) unit: `isScheduledNow` true/false dle okna + dne +
  hodiny v TZ shopu. (2) E2E: exclude „Home" → na home nic, na PDP ano. (3) E2E:
  stránka s meta-tag opt-out → embed no-opne. (4) unit: URL matcher (prefix/glob)
  pokrývá query/hash edge-cases.

### MVP11 — Announcement & agregáty → badge `Spec` (Free announcement basic, Pro hloubka)
- **Announcement** `trigger.type="announcement"`: merchantem psaná zpráva,
  scheduled (MVP10), surface toast|banner|persistent, i18n (locales). Governováno
  MVP8.
- **Agregáty z REÁLNÝCH dat** (jasně odlišené jako agregace, ne jednotlivé
  eventy): `order.summary` („X objednávek za Y dní"), `cart.summary` („X lidí
  přidalo Z položek za W h"). Server: `orders/create` webhook → inkrementuje
  counters; endpoint vrací agregát. **Žádná fabrikace čísel.**
- **Akceptační kritéria:** (1) E2E: announcement se ukáže dle rozvrhu, mimo okno
  ne. (2) unit: order/cart summary counter = reálná seed data. (3) E2E: agregát
  má vizuálně odlišený marker `data-won-aggregate="1"` (ne stejný jako jednotlivý
  event).

### MVP12 — Social proof → badge `Spec` (Pro; cold-start honesty)
- **Recent sales** `trigger.type="order.created"`: `orders/create` webhook →
  ukládá **anonymizované** eventy (křestní jméno + město, konfigurovatelné
  on/off), retence N dní. Storefront fetchuje feed přes app proxy → „Anna
  z Prahy koupila X před 5 min". Marker `[data-won-toast][data-type="sale"]`.
- **Privacy:** per-pole toggle (jméno/město), **opt-out** per objednávka, GDPR
  `customers/redact` maže eventy zákazníka (napojit na MVP14 webhooky).
- **Cold-start honesty:** pod prahem N reálných objednávek se social proof
  **nezapne** (nebo jen agregát z MVP11) — **NEfabrikuje**. Fallback = manuální/
  agregovaná varianta, jasně odlišená.
- **Akceptační kritéria:** (1) unit: webhook payload → uložený anonymizovaný
  event (bez PII nad jméno+město). (2) E2E: feed renderuje uložené eventy. (3)
  unit: `customers/redact` smaže eventy daného zákazníka. (4) unit: pod prahem
  objednávek feed prázdný a typ se nezapne.

### MVP13 — Insighty, experimenty & AI advisor → badge `Spec` (Pro)

**Filosofie:** *instrumentovat bohatě, ukazovat poctivě.* Syrová čísla neprodávají
upgrade — hodnota vzniká třemi vrstvami nad datasetem: **per-typ success metrika**,
**kauzální důkaz (holdout)** a **cross-store benchmarky** (moat portfolia, který
single-store analytika nikdy nemá). Rozpadeno na fáze MVP13a–e; každá má vlastní
akceptační kritéria a je autonomně spustitelná (rozhodnutí odsouhlasena — viz konec).

**ŘÍDÍCÍ PRINCIP — jednoduchý povrch, sofistikovaný engine (nepřekročitelné):**
sofistikovanost žije v ENGINU (měření, experimenty, auto-rollback, benchmarky, AI) —
**merchant UI zůstává minimální, intuitivní, přehledné.** Won Toasts je notifikační
engine, ne datová platforma; nesmí od merchanta chtít moc nastavování ani ho zavalit
grafy. Pravidlo pro celé MVP13: **málo settingů · insight KARTY ne dashboardy · one-
click akce · auto dělá těžkou práci · progressive disclosure.** Když featura přidá
merchantovi kognitivní zátěž bez jasné hodnoty, patří pod „auto" nebo pryč.

**Závazná korekce premisy (admin review 2026-08-06):** interim on-device
„Suggestions" (`ruleBasedSuggestions` v `@won/core/toasts/ai-advisor`, DEFERRED,
odpojen z UI) stály na špatné premise — *kliky nejsou signál hodnoty pro informativní
toasty.* „Added to cart" má z principu ~0 CTR (shopper ji přečte, neklikne) → to
**neznamená** bezcennost. Success metrika **per-typ** je nepřekročitelný základ, na
kterém stojí dashboard i advisor.

#### MVP13a — Instrumentace (event atomy + dimenze + pipeline + privacy)
- Storefront JS emituje per-toast lifecycle: `shown` (v DOM) → `visible`
  (IntersectionObserver, reálně ve viewportu) → `dwell_ms` → `hover/pause` →
  `read_through` (vydržel plnou dobu) → `click` (cta|body) → `dismiss` (manuální ×)
  vs `auto_fade` → **`suppressed`** (chtěl se zobrazit, blokoval cooldown/cap/quiet/
  exclusion — **s důvodem**; tichá zablokovaná zobrazení jsou stejně cenná).
- Dimenze na každém eventu: `type`, `semantic`, `surface`, `pageType`, `device`,
  `customerState`, `locale`, `currency`, `hourOfDay`, `dayOfWeek`, `lookPreset`,
  `abVariant`.
- Pipeline: app-proxy `/collect` (rozšíří `analytics.server.ts`), append-only event
  store per shop → denní **rollup** tabulka (dashboard čte rollup, ne raw). Governance
  session-id (už existuje) = anonymní klíč.
- **Privacy (must, EU):** session-hash, ne customerId; žádná jména/e-maily do
  analytiky (order.created ukáže jméno shopperovi, ale neukládá); retention window;
  ctít Shopify **protected customer data**; uninstall + GDPR redact maže eventy.
- **Akceptační:** unit — každý lifecycle event se zaznamená s dimenzemi; `suppressed`
  se počítá s důvodem; rollup agreguje deterministicky; PII-scrub test.

#### MVP13b — Per-typ success metrika + poctivý dashboard (surface)
- Metrika per typ (závazné): **akční** (announcement-link/countdown/CTA) → CTR;
  **informativní** (stock.low/cart.activity/order.summary/order.created) →
  read-through + low-dismiss + reach; **cart/milestone** (free-shipping/gift) →
  progrese k prahu + delta hodnoty košíku.
- Merchant volí per typ **cíl (goal)**; dashboard se ladí podle něj.
- Surface = **insight karty**, ne tabulka syrových eventů: „Nejlépe fungující toast",
  „Kde ztrácíš pozornost" (vysoký fast-dismiss), „Nejlepší čas/den", **tiché insighty**
  („0 toastů na cart page s X % trafficu", „countdown skončil před N dny").
- **Snadný rollback (must, dead-simple):** vizuální **časová osa** uložených stavů
  (staví na version history, už existuje) — merchant vidí *„co se změnilo"* (diff v
  lidské řeči, ne JSON) a **jedním klikem** vrátí nastavení k libovolnému timestampu,
  s okamžitým preview. Scénář: otestuje featuru ve slabém týdnu → vypadá že „funguje"
  → další týden je to k ničemu → jeden klik zpět. Prezentace = maximálně jednoduchá,
  bez strachu; každý stav pojmenovaný časem + co ho vyvolal (ruční / experiment /
  auto-pilot).
- **Monthly ROI report:** měsíčně **holdout-proven** číslo („Won ti tenhle měsíc
  prokázaně přinesl X Kč") → sticky retence; jedna karta, ne report-generátor.
- Plan tiering: **Free** = reach/on-off + health + rollback; **Pro** = per-typ
  success + čas + karty + ROI.
- **Akceptační:** unit — success metrika per typ počítá správně; **bez falešné
  atribuce** (toast = asistence); insight karty se generují z rollupů; rollback obnoví
  přesně uložený stav a ukáže lidsky čitelný diff.

#### MVP13c — Experimenty: holdout + experiment-gated changes (money + safety layer)
- **Holdout:** deterministický split podle hashe cart tokenu — X % vidí toasty,
  (100−X) % ne; srovnání konverze / hodnoty košíku / progrese. **Jediný poctivý důkaz
  „toasty přinesly Y Kč"** → nejsilnější upgrade/retention argument.
- **Experiment-gated changes — KAŽDÁ ZMĚNA JE EXPERIMENT (diferenciátor):**
  jakákoli změna konfigurace (AI advisor **i ruční edit**) se dá nasadit jako
  experiment — nová konfigurace běží pro X % návštěvníků, stará pro zbytek, po dobu
  (default týden / do statistické významnosti). Měří per-typ success + guardraily.
  **Auto-promote** když varianta vyhraje (významně), **auto-rollback** když prohraje
  nebo shodí guardrail. Staví na version history (už existuje). Per-change volba
  **„Apply now" vs „Test first"**; u impaktních změn se testování navrhne samo. → to
  je princip *„žádná změna nikdy nerozbije eshop"*.
- **Guardrail circuit breaker (self-healing):** nezávisle na experimentech — když
  živá konfigurace shodí **tvrdou metriku** (pokles konverze nad práh / spike
  dismiss-rate / chybovost storefront JS), **auto-pauza + rollback + alert**. Bezpečná
  síť, která dělá „nikdy nerozbije eshop" doslovným.
- Statistická přísnost: **min-sample + min-doba + sekvenční test** (nepromovat šum);
  **jeden aktivní experiment na shop** (queue), aby se experimenty nepletly.
- Per-look A/B, per-message A/B (už existuje), timing A/B — vše přes tentýž engine.
- **Segment-aware:** experiment se vyhodnotí i **per-segment** (mobil vs desktop,
  guest vs logged-in) — výhra na mobilu ≠ na desktopu. Report per-segment; volitelně
  aplikovat vítěze per-segment (advanced, skryté za disclosure — řídící princip).
- **What-if forecast:** před spuštěním ukázat **odhad dopadu** z historických dat
  (rozsah), aby merchant věděl, co čekat, a nespouštěl slepě.
- **Experiment audit log:** čitelná historie experimentů + výsledků (promoted /
  reverted / expired) — sdílí časovou osu se snadným rollbackem (MVP13b); pro
  merchanta i pro support.
- **Attributed revenue** best-effort, jasně označené **„assisted" vs „holdout-proven"**.
- **Akceptační:** unit — split deterministický pro token; holdout kohorty se
  nepřekrývají; experiment auto-promote jen při dosažení min-sample+významnosti;
  guardrail breach → auto-rollback; attribution poctivě (assisted ≠ proven).

#### MVP13d — Cross-store benchmarky (moat)
- Anonymní agregát napříč Won obchody: percentily read-rate/CTR/dismiss **per typ** +
  „stores like yours" (segment dle oboru/velikosti). Jen agregát, **žádná cross-store
  PII**, k-anonymita (počítat jen z ≥ N obchodů).
- **Akceptační:** benchmark počítá jen z agregátů ≥ N obchodů; opt-out respektován.

#### MVP13e — AI advisor SE SUBSTANCÍ (re-enable na per-typ metrikách)
- Claude API (`claude-opus-4-8`/`claude-sonnet-5`): „AI Setup" navrhne pravidla dle
  typu obchodu; „AI Optimize" vezme **reálné per-typ metriky + benchmarky + holdout**
  a vrátí **strukturovaný JSON** s konkrétními akcemi (zkrať duration, přesuň pozici,
  změň cíl) → merchant potvrdí. **Nikdy „vypni 0 CTR" plošně.** Zapnout teprve po
  MVP13b. Každý návrh se aplikuje přes MVP13c (experiment-gated), ne rovnou naživo.
- **Vysvětlitelnost (trust):** každý návrh ukáže **důkaz** („na základě 1 240
  impressions, 0 kliků, a že jde o informativní toast měřený read-throughem, ne CTR")
  — ne black-box.
- **Benchmark-triggered návrhy:** „stores like you mají read-rate 40 %, ty 25 % — zkus
  tenhle experiment" (propojí MVP13d → advisor → experiment).
- **Auto-pilot (opt-in, top tier):** advisor průběžně pouští malé experimenty a
  **auto-promuje vítěze v rámci guardrailů** — „set & forget optimalizace". Vždy
  vypnutelné, s logem co udělal.
- **Cross-store meta-learning (moat++):** výsledky experimentů napříč Won obchody
  krmí **priory advisora** („tahle změna obvykle vyhrává u doplňků") — privacy-safe
  agregát, compounding data moat. Jen agregované vzory, žádná cross-store konfigurace.
- **Akceptační:** vrací JSON dle schématu (mock LLM); nevalidní odmítne/retry;
  test — nenavrhne vypnout informativní toast kvůli 0 CTR; každý návrh nese evidenci;
  auto-pilot respektuje guardraily a jde vypnout.

#### Rozhodnutí (odsouhlaseno 2026-08-10 — autonomous-ready)
1. **Event objem/retention:** agregovat při ingestu (counters); raw jen **30 dní**
   (debug), rollup **denní**, retention **365 dní**. Žádné samplování.
2. **Holdout:** default **10 %**, zapínatelné, Pro-only, s explainerem; 0 = vypnuto.
3. **Benchmarky:** **opt-out** (agregát není PII), **k-anonymita ≥ 10** obchodů; obor
   = merchant self-select setting.
4. **Attribution:** session-window = **„assisted"**; **„proven" jen z holdoutu**.
   Mimo holdout nikdy netvrdit kauzalitu.
5. **Goal per typ:** **předdefinovaný enum** (ne volný text) — free-shipping→AOV,
   announcement→clicks, stock.low→read-through, …
6. **Perf:** batch + flush na `pagehide`/visibility + ~5 s, **`sendBeacon`**, lazy
   init po prvním toastu; držet **~15 kB gz**.
7. **Data model:** Prisma **`ToastEvent`** (raw, krátkodobý) + **`ToastRollup`**
   (shop/date/typ/dims/counters); uninstall + GDPR redact maže obojí.
8. **AI advisor náklad:** **on-demand** („AI Optimize"), cache dle config-hashe na
   N h, rate-limit per shop. Žádné periodické LLM.
9. **Gating default:** impaktní změny (timing/pozice/pravidla/AI) → **„Test first"**;
   kosmetika (barvy/text/copy) → „Apply now". Merchant může přepnout.
10. **Významnost + doba:** **Bayesovský** (prob-to-be-best ≥ 95 %), min **7 dní** +
    min-sample; **auto-expire po 14 dnech → keep original**.
11. **Guardraily:** pokles konverze > ~**15 % rel.**, spike dismiss, JS error > 0;
    **traffic floor** — pod N sessions/den nespouštět rollback (žádné false alarmy).
12. **Auto-pilot rozsah:** jen bezpečné páky (duration/pozice/cooldown/look), **NE**
    zapínání/vypínání pravidel; **denní cap 1** experiment.

### MVP14 — Kvalita & Built for Shopify → badge `Spec` (Free kvalita, release gate)
- **A11y:** `aria-live` politeness config, dismiss-all, focus management, SR-only
  text, `role=status|alert` dle severity.
- **Performance mode:** lazy-load JS až při interakci/cart change, perf budget
  **~15 kB gz**, žádný layout shift.
- **Collision avoidance:** auto-offset od sticky header / cookie lišty / chatu.
- **Money/locale formátování + RTL.**
- **Reálný Shopify Billing / managed pricing** (nahradí dev plan toggle z MVP5).
- **GDPR webhooky:** `customers/data_request`, `customers/redact` (napojit na
  MVP12 social proof data), `shop/redact`.
- **Release checklist §8 zelený.**
- **Akceptační kritéria:** (1) a11y audit projde (aria-live/role, focus,
  reduced-motion). (2) perf budget check v CI (bundle gz ≤ prah). (3) billing
  flow (subscribe/cancel/proration) E2E. (4) GDPR webhook handlery mažou/exportují
  data a vrací 200.

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

---

## Definition of Done (2026-08-13)

**Rámec:** Won Toasts je **pilot** — dokazuje build-harness (billing, app-block/embed,
`@won/core`, GDPR webhooky, admin patterny), ne flagship. „Hotovo" definují **dvě brány +
hands-off běh**, NE feature-parita s Vitals/Fera. Strategický kontext: [`severka.html`](severka.html)
(Vlna 0). Kód projít review 2026-08-13 (reálný stav, ne paměť).

**Skutečný diferenciátor Toasts** = poctivost + akční cart/milestone/free-ship vrstva +
no-fabrication cold-start. NE social proof (komodita) ani experiment engine (přebudováno na pilot).

### Done-linka (jediné reálné blokery)

| MVP | Co | Stav |
|---|---|---|
| **F1 — Zelená release gate** | Červené E2E (a11y `role=status` + geometry overflow/pozice/touch-target) zelené. | **Fast gates ZELENÉ** (2026-08-13: core 290+18, app unit 75, contract build/parity/perf/theme-extension, typecheck — 0 fail, 0 skip). E2E **nelze ověřit headless** — vyžaduje živý `shopify theme dev` + `SHOPIFY_E2E_STOREFRONT_BASE_URL`. Red artefakty z 12.8. 17:04 zastaralé; HEAD 18:38 „all passing on fresh theme+app run". → **Akce: 1× spustit `test:e2e -w won-toasts` lokálně proti `b2b-b2c-store-development`** = autoritativní potvrzení F1. |
| **F2 — Hands-off na reálném storu** | Nasadit na 1 klientský store, běžet týdny bez zásahu; ověřit **reálný billing charge flow** (v dev je bypass) + resolve configu + správné střílení toastů. | otevřené — nejpravdivější test „done". |
| **F3 — Rozhodnout order-data linku** | Vědomě: (a) shipnout core BEZ live social proof/agregátů + Partner protected-data approval paralelně → `orders/create` zapnout po approvalu; NEBO (b) máš-li approval, odkomentovat webhook (`shopify.app.toml:45`) → social proof + agregáty poctivě naživo. Cold-start nikdy nefabrikuje (nakódováno). | **ROZHODNUTO 2026-08-13: cesta (a)** — shipnout core BEZ order-data featur (social proof + agregáty vypnuté, `orders/create` zůstává zakomentovaný, žádná PII scope navíc). Partner protected-data approval řešit paralelně; webhook odkomentovat, až approval přijde. **Social proof = fast-follow, ne done-blocker.** |

### PARK — explicitně NE done-blockery (stop gold-platingu)

- **Experimenty / holdout / A-B / auto-rollback + AI-advisor v2** — postaveno + otestováno, leží
  mrtvé za zakomentovaným `orders/create` (`EXPERIMENTS_LIVE_TICK_WIRED=false`). **Zaparkovat** —
  rozsvítí se až s reálným order-volume + důvodem. (Shoduje se s „Vědomě NEimplementovat: plný
  enterprise experiment engine v MVP".)
- **Akční CTA §4** (Vybrat dárek, +1 ks do slevy) — nice-to-have; **Undo stačí** jako důkaz akčního toastu.
- **Extrakce billingu do `app-kit`** — až u **app #2** (extract-on-second-use), ne teď.
- **ai-advisor v1** — už deferred, nech mrtvý / smaž.
- **Housekeeping (ne blocker):** srovnat tento plán s kódem (plán tvrdí „per-currency práh NENÍ",
  kód ho má; event-icon parity možná už opravena).
