# Won Toasts admin — sjednocený vizuální & UX systém (master balík)

Datum: 2026-08-11
Rozsah: `apps/won-toasts/app/**` (routes + components + lib). Bez zásahu do
storefront rendereru (`storefront-src/`, extensions) a bez změny cen/Functions.

## Proč (jeden problém, ne 12 tweaků)

Admin je poskládaný **per-stránka**, ne ze sdílených primitiv → nekonzistence,
„splývání", preview co lže, hloubka vidět napřed. 12 bodů z merchant-review je
7 vláken jednoho systému. Postavíme pár generických stavebních kamenů a nasadíme
je všude — konzistence vznikne konstrukcí, ne záplatami.

## Doktrína (napříč vším)

1. **Zlatý podnos + poctivost:** admin za klienta udělá práci a diagnostikuje
   (nenechává ho pátrat); nikdy nelže (preview, čísla).
2. **Generický systém:** jedna komponenta (`Field`, `PlanBadge`, `Card`,
   `Preview`) použitá všude stejně — žádné per-page varianty.
3. **Míň na první pohled:** vzácné/pokročilé = za disclosure; hutná density.

## Zamčená rozhodnutí

- **Amber token** `--won-amber` ≈ `#D9A83A` (přesný hex potvrdí merchant; jedno
  místo). WonCommerce brandová jantarová pro plan-gating „Pro".
- **Pro badge** = amber **outline** (Pro) / neutrální šedá (Free), konzistentní
  umístění.
- **Preview** = backdrop **vždy světlý** storefront; **jeden jednotný vzhled/
  renderer napříč VŠEMI typy** (klient se soustředí na zapnutí + nastavení).
- **Insights „silent gap"** = diagnostika **konkrétní příčiny** + deep-link na
  fix (one-click fix = pozdější vrstva).
- **History/rollback** = pryč z Insights, sloučit do jednoho místa (de-dup s
  Design).

---

## W1 · Field & typografie (ZÁKLAD) — bod 7

**Problém:** label pole („Theme mode"), help text a input mají stejnou váhu →
struktura nejde skenovat, vše splývá.

**Design:** sdílený `Field` primitiv:
- **label** = `type="strong"` (bold), jasně dominantní;
- **help** = `color="subdued"`, menší;
- konzistentní vertikální rozestup (label → control → help) a mezi poli.

**Generické:** nahradí ruční `s-text`/label okolo každého `s-*` controlu ve
všech routes (design, toasts, targeting, languages, analytics, plan).

**Soubory:** nový `app/components/Field.tsx`; postupně přepsat pole v routes.
**Akceptace:** label bold vs help subdued vizuálně odlišené; jeden wrapper;
žádné pole bez help (drží pravidlo „no dead controls").

## W2 · Plan-gating systém (Pro/Free) — body 1, 2, 9

**Problém:** „Pro" se renderuje 3× jinak (šedý `<s-badge>Pro</s-badge>` na
kartách; zelený `tone="success"` v hlavičkách override; text jinde). „Free"
badge je misplaced (nalepený doprostřed věty „Run everywhere, except… [Free]").

**Design:** jeden `<PlanBadge tier="pro|free" />`:
- Pro = amber outline (`--won-amber` text + rámeček);
- Free = tichá neutrální šedá;
- konzistentní **umístění** — badge vždy na konci nadpisu sekce/karty, ne uvnitř
  věty; oddělený mezerou.

**Generické:** nahradí VŠECHNY dnešní varianty:
`ToastLauncher.tsx:103`, `SegmentedNav.tsx:82`, `TypeStyleFields.tsx:37`,
`app.toasts.tsx:828/848/868/888`, `app.design.tsx:561/599/630`,
`app.targeting.tsx:139` (misplaced Free), `app.analytics.tsx:244`.

**Akceptace:** jediná Pro/Free komponenta; amber jen z tokenu; žádný badge uvnitř
věty; vizuální parita napříč stránkami.

## W3 · Karty, sekce & density — body 2, 5, 12

**Problém:** vnořené karty se stackují s různým tónem pozadí + rámečkem → drhnou
(2). Toasts picker fold je moc vysoký (5). Insights vizuál se nelíbí (12).

**Design:**
- Jednotný **card-shell** (pozadí/rámeček/radius/stacking) — vnořená karta má
  definovaný vztah k rodiči (odsazení, ne kolize tónů).
- **Toasts picker kompaktnější:** menší karty (méně paddingu), hustší grid,
  skupinové hlavičky užší. Zachovat outcome-grouping (líbí se), jen zhutnit.
- **Insights** překreslit tímtéž card systémem (viz W6).

**Soubory:** nový/rozšířený card util; `ToastLauncher.tsx`, `app.toasts.tsx`
picker; `TypeStyleFields.tsx` (nested); `app.analytics.tsx`.
**Akceptace:** vnořené karty nekolidují; picker fold viditelně nižší; Insights
používá stejné karty.

## W4 · Progressive disclosure — bod 3

**Problém:** per-toast override „Look & timing for this toast" je vždy rozbalený
— skoro nikdo do něj neklikne, ale zabírá hodně místa.

**Design:** override = collapsed disclosure (jako „Advanced (where it shows)" /
„Selling in more currencies?"). Generický vzor: pokročilé/vzácné = defaultně
zabalené, s jasným souhrnem stavu na hlavičce (inherits global / customised).

**Soubory:** `TypeStyleFields.tsx`, `app.design.tsx:651` kontext.
**Akceptace:** override defaultně zabalené; rozbalí se na klik; hlavička říká,
jestli je toast custom nebo dědí global.

## W5 · Preview: poctivé & jednotné — body 4, 6 (+ preview-timing fix)

**Problém:** dva animate ovladače („Preview ⟷ Animate" toggle + „Static/Animate"
v mocku) = matoucí (4). Preview renderer se liší napříč typy (4). Bold preset
ztmaví i backdrop, i když renderer nemění pozadí eshopu (6).

**Design:**
- **Jedno preview, jeden vzhled** napříč všemi typy — merchant vidí pořád stejný
  to-scale storefront mock, mění se jen obsah toastu.
- **Ovladače sjednotit:** jeden přepínač stavu (Static/Animate) + Desktop/Mobile;
  zrušit duplicitní „Preview ⟷ Animate" toggle.
- **Backdrop vždy světlý** storefront (renderer nemění pozadí eshopu); dark je
  jen samotný toast, když má dark theme. Odstranit `isDark ? tmavý backdrop`.
- Spojit sem hotový (necommitnutý) **preview-timing fix** (label = reálná
  hodnota, dwell reálný do 12 s).

**Soubory:** `StorefrontPreview.tsx`, `AnimatedToastPreview.tsx`,
`app.toasts.tsx`, `app.design.tsx`, `app/lib/preview-timing.ts`.
**Akceptace:** jeden animate ovladač; backdrop světlý i pro Bold/dark toast;
stejný preview vzhled napříč typy; preview-timing testy zelené.

## W6 · Insights: filozofie + obsah + umístění — body 10, 11, 12

**Problém:** „X is configured but hasn't shown once. Check its triggers or
targeting" hází práci na klienta (10). Insights obsahuje history/rollback, který
tam nepatří a dubluje Design (11). Vizuál se nelíbí (12).

**Design:**
- **Diagnostika (zlatý podnos):** místo vágní výzvy spočítat KONKRÉTNÍ příčinu a
  říct ji + deep-link:
  - app embed vypnutý → „Zapni embed" (link na go-live);
  - v Targeting vyloučené relevantní stránky / všechny → „Uprav targeting";
  - typ je Off → „Zapni tento toast";
  - jinak (opravdu jen málo provozu) → honest „zatím málo návštěv".
  Zdroj: rozšířit `silent_gap` v `app.analytics.tsx:169` +
  `insights-metrics.ts:238` o důvod (číst embedStatus, targeting exclusions,
  per-type enabled).
- **History/rollback ven z Insights** → jedno dedikované místo (de-dup s Design
  „History"). Insights = jen pozorování + ROI + per-type úspěšnost.
- **Vizuál** přes W3 card systém + W1 typografii.

**Soubory:** `app.analytics.tsx` (odebrat rollback, rozšířit diagnostiku),
`packages/core/src/toasts/insights-metrics.ts` (důvod silent-gapu),
`app.design.tsx` (History konsolidace).
**Akceptace:** každý silent-gap má konkrétní příčinu + akční link; Insights
neobsahuje rollback; jeden zdroj historie; vizuál konzistentní.

## W7 · Pokrytí překladů (audit) — bod 8

**Problém:** Languages slibuje „translate everything your toasts say" — ověřit,
že je to pravda.

**Design:** projít VŠECHNY shopper-viditelné řetězce (titulky „Added to cart",
„Removed", „Updated"; grouping „+N more"; „Undo"; milestone / free-shipping /
gift / low-stock / order-summary / recent-sales copy) a potvrdit, že každý žije
v překládatelné `messages` mapě, ne natvrdo v presentation. Doplnit mezery.

**Soubory:** `packages/core/src/toasts/presentation.ts` a související;
`app.languages.tsx` / message katalog.
**Akceptace:** test/audit prokáže, že žádný shopper-viditelný string není
hardcoded mimo `messages`; Languages pokrývá kompletní copy.

---

## Pořadí realizace

**W1 → (W2 ∥ W3) → W4 → W5 → W6**, **W7** paralelně/nezávisle. Každé vlákno =
vlastní TDD (kde je čistá logika) + vizuální QA (Playwright) pro čistě
vizuální změny. Master spec je střešní; jednotlivá vlákna dostanou při realizaci
svůj krátký plán.

## Zapadá sem
- Embed-scan fix — hotový, commitnutý.
- Preview-timing fix — hotový, commit v rámci W5.
- Go-live fold redesign (spec `2026-08-11-won-toasts-golive-fold-design.md`) →
  sjednotit pod W3/W4 (density + disclosure + karty).

## Mimo rozsah
Storefront renderer, ceny/Functions, nové typy notifikací, live A/B serving.
