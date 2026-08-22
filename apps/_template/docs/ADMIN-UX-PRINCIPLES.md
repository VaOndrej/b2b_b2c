# Admin UX standard pro Won appky (CZ) — ukazatel + řemeslné invarianty

> **Zdroj pravdy je [`docs/won-app-design-doctrine.md`](../../../docs/won-app-design-doctrine.md) — „Won App Doctrine".**
> Tento soubor **už neduplikuje** principy §1–§17 / A1–A7 / Part II (dřív tu byly
> celé česky a rozcházely se s canonicalem). Principy čti v canonicalu (anglicky,
> otagované `[INV]/[PLAT]/[WON]/[APP]`). Tady zůstává jen **český onboarding** a
> **řemeslné invarianty admin vrstvy** — konkrétní *implementace* pravidel, ne
> pravidla samotná.

Když stavíš novou appku z templatu: přečti canonical (obě části), pak projeď tento
řemeslný checklist. Každé pravidlo je závazné, dokud nemáš dobrý důvod se odchýlit
— a ten důvod patří do canonicalu jako výjimka, ne do forku.

## Meta-princip: merchant-in, ne engineer-out

Nestav admin tak, že každé pole konfiguračního schématu dostane svůj control. To je
pohodlné pro implementátora, ale merchant nechce vidět schéma — chce vidět
**výsledek**. Ptej se „jaký úkol tu merchant plní?", ne „jaká pole má ten model?".
(Canonical: meta-princip + §7/§8/§9/A6.)

**Reálné failure mody, které jsme si takhle vyrobili (a nesmí se opakovat):**
- 8 položek v levém menu u *notification appky*. → §7 (mělká IA).
- Pole `Ends at (ISO 8601…)`, `Surface: banner`, `durationMs`. → §4 (mluv výsledkem).
- Stránka s ~8 controly bez náhledu. → §1/§3 (preview-first).
- Dvě status karty říkající totéž + tlačítko nalepené bez odsazení. → §6/§11d.
- Zadrátované `cs/sk/en` jako jazyky produktu. → A5 (lokalizace = data) + MKT-1.

Jednoduchost je feature. Když se nechce nastavení projít **tobě**, nemůžeš to chtít
po klientovi.

---

## Řemeslné invarianty admin vrstvy (implementace, nemění se)

Toto je *jak* se v našem embedded Polaris adminu naplňují canonical pravidla.
Konkrétní, Won-admin-specifické. Každý bod odkazuje na canonical pravidlo, které
implementuje.

### 1. Nativní Polaris, nikdy surové HTML — impl. `[PLAT]` (BFS) 
Všechny kontrolky = `s-*` web komponenty (`s-button`, `s-switch`, `s-select`,
`s-number-field`, `s-color-field`, `s-text-field`, `s-badge`, `s-banner`, `s-stack`,
`s-section`). Nikdy `<button>/<input>/<select>` — vypadají neostylovaně a shodí
„Built for Shopify".
- `s-number-field value` musí být **string** → `value={String(n)}`.
- Přepínače postují `value` když zapnuté → `<s-switch name="x" value="on">`, čti
  `form.get("x") === "on"`.
- Před psaním validuj: `learn_shopify_api(polaris-app-home)` →
  `validate_component_codeblocks`.

### 2. Kontextový Save Bar všude — impl. §1/§14
Každý settings `<Form>` má **`data-save-bar`**; App Bridge sám ukáže Save/Discard
lištu a hlídá odchod. Inline „Save" tlačítko se **nepoužívá**. Formuláře drž
**uncontrolled** (initial `value` z loaderu); Discard = form reset (`onReset` pro
resync živého preview). Výjimka: jednorázové akce (upgrade plánu) zůstávají tlačítkem.

### 3. Živý preview přes NATIVNÍ event, ne React `onChange` — impl. §2 `[PLAT]`
React synthetic `onChange`/`onInput` se u `s-*` custom elementů **nevyvolá** (React je
posílá jen pro nativní `<input>/<select>/<textarea>`). **Fix:** v `useEffect`
`formRef.current.addEventListener('input'/'change', sync)` (nativní eventy z `s-*`
bublají na `<form>`); v `sync` čti `new FormData(formRef.current)`. Platí na KAŽDÉ
stránce s preview — jinak jedna žije, druhá stojí. Sympt. od merchanta: „preview
nereaguje, musím dát Zrušit".

### 4. Na storefront změnu MUSÍ být test — impl. TEST-2
Admin náhled ≠ důkaz, že to na storefrontu funguje. Jakmile změna ovlivní storefront
(spacing/stacking, animace, close, undo, timing, governance, práh), **ship s
commitnutým testem** (Playwright E2E Dawn+Horizon nebo unit na `@won/core`). Napiš ho
**před** fixem, ověř že **padá**, fixni, ověř že **prochází**. Bez testu je
storefront-facing práce nedokončená.

### 5. Stav „je to živé?" — impl. §11d
Instalační/onboarding krok má status badge, který **zezelená** (`tone="success"`,
„Active") když je funkce zapnutá; jinak `tone="caution"`. Merchant nikdy nesmí hádat,
jestli appka běží. Ukaž stav **jednou** (§6/§11d).

### 6. Brand jen ve vlastních plochách; preview neutrální — impl. §11a/A4
Won amber/branding **nepatří** do nativního Polaris chrome ani do obsahu preview.
Preview je neutrální (barvy si řídí merchant). Brand žije v app ikoně, ilustracích a
empty states — ne v tlačítkách, ne v preview.

### 7. Jednotná navigace napříč appkami — impl. §7b/SHARE-1
`WonNavMenu` z `@won/app-kit/admin-nav` (Overview home první, „Plan" poslední).
Merchant s víc Won appkami pozná tvar menu.

### 8. Escape hatch: custom CSS + zdokumentované hooky — impl. §3k + SEC-3
Pokročilý merchant musí mít možnost si to doladit: **custom CSS (Pro)** + stabilní
selektory/proměnné (`[data-won-*]`, `--won-*`). Stabilita hooků je kontrakt vůči
merchantovi — nerozbíjej je mezi verzemi. **POZOR (SEC-3):** custom CSS/HTML se
sanitizuje a scopuje server-side (shadow/prefix), jinak je z escape hatche XSS.

### 9. Homepage: rychlé hledání — impl. §13
Na přehledové stránce nabídni `s-search-field`, který indexuje nastavení a
deep-linkuje na správnou stránku/pole.

### 10. Jedna sekční skořápka + stavová hlavička — impl. §17 / A7
Nikdy nepiš `<s-section heading="Look">` napřímo. Každá sekce i karta jde přes
**jednu** komponentu (`WonSection`) a bloky uvnitř přes **jednu** (`WonBlock`).
Sekce má tři sloty ještě před tělem:

1. **identita** — neutrální glyf + název (barvu nech na §11a: modrá = vybráno,
   amber = Pro, zelená = běží; per-sekční barva by byla čtvrtý význam),
2. **stav v klidu** — jedna věta o **aktuální konfiguraci lidsky**
   („Bottom right · 40 px from the edge · up to 3 at once"),
3. **důsledek** — volitelně §10 proof nebo mini render primitivu.

Stavovou větu **nikdy neskládej v routě**. Patří do `describe*()` v enginu vedle
sanitizérů — jinak dvě obrazovky popíšou tentýž config jinak a další appka si to
napíše znovu (stejná logika jako §10b / §11b / DATA-4). Jsou to čisté funkce,
takže je pokryj unit testem.

Tři pasti, na které se v Won Toasts narazilo:

- **Summary musí být živé** (§17b) — čte tentýž stav jako preview, ne uloženou
  hodnotu. Zastaralý stavový řádek je horší než žádný.
- **Summary nesmí slíbit víc, než config garantuje** (§17c) — při vypnutém
  auto-dismiss je „Stays 5 s" lež; napiš „Stays until dismissed". Na Free
  necituj Pro nastavení, které se stejně neaplikuje.
- **Sbalení skrývá, nikdy neodmountuje** (§17d) — `display:none`, ne podmíněný
  render. Skrytá pole musí dál postovat, protože jeden Save Bar pokrývá celý form.

---
Viz i `docs/nova-aplikace.md` (standing goals) a paměťovou poznámku
`polaris-web-components-admin-pattern`.
