# Admin UX standard pro Won appky

Interní inženýrská pravidla pro admin (embedded Polaris) **každé** Won appky.
Vznikla z reálného review Won Toasts — je to přesně to, co dělí skvělou appku od
průměrné. Když stavíš novou appku z templatu, projdi si to jako checklist; každé
pravidlo je závazné, dokud nemáš dobrý důvod se odchýlit.

## 1. Nativní Polaris, nikdy surové HTML
Všechny kontrolky = `s-*` web komponenty (`s-button`, `s-switch`, `s-select`,
`s-number-field`, `s-color-field`, `s-text-field`, `s-badge`, `s-banner`,
`s-stack`). Nikdy `<button>/<input>/<select>` — vypadají neostylovaně a shodí
"Built for Shopify".
- `s-number-field value` musí být **string** → `value={String(n)}`.
- Přepínače postují `value` když jsou zapnuté → `<s-switch name="x" value="on">`,
  čti `form.get("x") === "on"`.
- Před psaním validuj: `learn_shopify_api(polaris-app-home)` →
  `validate_component_codeblocks`.

## 2. Kontextový Save Bar všude — žádný inline Save
Každý settings `<Form>` má atribut **`data-save-bar`**. App Bridge sám ukáže
Save/Discard lištu nahoře při jakékoli změně a hlídá odchod ze stránky (přesně
jako editace produktu v Shopify).
- Inline „Save" tlačítko se **nepoužívá** — save bar je jediná úložná akce.
- Discard = form reset; u živého preview přidej `onReset` na resync stavu.
- Formuláře drž **uncontrolled** (initial `value` z loaderu); u live preview čti
  `new FormData(formRef.current)` na `onInput`/`onChange` (native eventy z `s-*`
  bublají na `<form>`). Nespoléhej na controlled `onChange` na custom elementech.
- Výjimka: jednorázové akce (upgrade plánu) zůstávají explicitním tlačítkem.

## 3. Vždy ukaž stav „je to živé?"
Onboarding/instalační krok má status badge, který **zezelená** (`tone="success"`,
„Active") ve chvíli, kdy je funkce zapnutá; jinak `tone="caution"` „Not active".
Merchant nikdy nesmí hádat, jestli appka běží.

## 4. Onboarding-first pořadí
První sekce = **předpoklad** (instalace app embedu / prerekvizita), teprve pak
konfigurace. Očísluj kroky („1 · …", „2 · …"). Primární CTA vede přesně tam, kam
merchant musí (např. theme editor → App embeds).

## 5. Nikdy neodváděj uživatele pryč kvůli konfiguraci
Vše, co spolu souvisí, je na jedné stránce.
- Dělení uvnitř stránky řeš **tučnými subnadpisy** (`<s-text type="strong">`), ne
  odkazy na jiné podstránky.
- Nedávej do sekcí odkazy „Edit X" mířící na jiné stránky admina — od navigace je
  levé menu.
- Související pole **seskup** (toggle + jeho label/pole u sebe, viditelně oddělené
  mezerou od jiné skupiny), ať toggle nikdy nevypadá, že patří k cizí skupině.

## 6. Prostorové a vizuální volby = náhled, ne dropdown
Když merchant volí pozici/umístění, ukaž **dummy obrazovku** s náhledem, kam
prvek dopadne (klikací zóny), ne textový select „top-right". Obecně: kde jde
volbu ukázat, ukaž ji — a live preview musí sdílet **stejné render tokeny** jako
storefront (jeden zdroj pravdy v `@won/core`).

## 7. Brand jen ve vlastních plochách; preview zůstává neutrální
Won amber/branding **nepatří** do nativního Polaris chrome ani do obsahu preview —
je to matoucí. Preview je neutrální (barvy si řídí merchant). Brand žije v: **app
ikoně** (per-app glyf na amber dlaždici — největší touchpoint v adminu),
ilustracích a empty states. Ne v tlačítkách, ne v preview.

## 8. Jednotná navigace napříč appkami
Používej `WonNavMenu` z `@won/app-kit/admin-nav` (Overview home první, „Plan"
poslední). Merchant s víc Won appkami pozná tvar menu; per-app identitu dělá
jméno (`shopify.app.toml`) + ikona appky (Partner dashboard).

## 9. Escape hatch: custom CSS + zdokumentované hooky
Pokročilý merchant musí mít možnost si to doladit. Nabídni pole na **custom CSS**
(Pro) a zdokumentuj **stabilní** selektory a CSS proměnné, na které smí cílit
(`[data-won-*]`, `--won-*`). Stabilita těchto hooků je kontrakt vůči merchantovi —
nerozbíjej je mezi verzemi.

## 10. Homepage: rychlé hledání
Na přehledové stránce nabídni `s-search-field`, který indexuje nastavení a
deep-linkuje na správnou stránku/pole. U appky s víc stránkami to výrazně šetří
klikání.

## 11. Featury si zaslouž, nenasypávej je
U každé featury se ptej: „využil by to reálný merchant?". Pokročilé/niche featury
(např. cílení podle stránky/zařízení) buď **gateuj do Pro**, nebo zvaž sloučení do
jiné stránky — default musí zůstat jednoduchý a přímočarý. Jednoduchost je
feature.

---
Viz i `docs/nova-aplikace.md` (standing goals) a paměťová poznámka
`polaris-web-components-admin-pattern`.
