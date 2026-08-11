# Won Theme — Universal Customization Layer (W3-b)

Autonomous-ready plán. Cíl: **merchant změní v theme editoru u každého bloku
prakticky vše** (text, barvy, mezery vč. nadpis→text, ohraničení v px, padding,
radius, typografii…) — a má tak eshop plně v rukou bez kódu.

**Reconciliace s tezí tématu** (`theme-roadmap.html` §thesis: *„závěr NENÍ vystav
vše… řídit přes tokeny + presety"*): „změnit vše" ≠ hromada bespoke settingů per
blok (chaos). = **jeden sdílený `won-style-controls` fragment** jedoucí přes už
*LOCKED* token-cascade. Naplňuje tezi, neporušuje ji.

**ŘÍDÍCÍ PRINCIP — A6 „simple surface, sophisticated engine"** (viz
`won-app-design-doctrine.md`): editor nesmí merchanta zavalit. **Preset + obsah
první**, „Vzhled" collapsible, „Advanced" schované, **curated defaults** (netknutý
blok = krásný). Sofistikovanost žije ve fragmentu + snippetu, ne v merchantově hlavě.

---

## Stav dnes (grounded — proč to řešíme)

De-facto standard už existuje, ale je **kopírovaný a nekonzistentní**, bez sdíleného
snippetu — přesně ta „chaos" kopie-místo-sdílení + díry:

| setting | pokrytí | problém |
| --- | --- | --- |
| `padding_top` / `padding_bottom` | 26/27 | kopie v každém souboru (maintenance debt) |
| `color_scheme` | 26/27 | kopie |
| `section_width` | 21/27 | nekonzistentní |
| `gap` | 8/27 | většina sekcí nemá |
| `corner_radius` | **2/27** | doktrína „radius everywhere" nesplněná |
| `align` | 1/27 | skoro nikde |
| sdílený `won-style-vars` snippet | **0** | neexistuje |

W3-b to **sjednotí** (jeden fragment místo 26 kopií) a **doplní** (radius/gap/border/
typografie všude).

---

## Jádro řešení

1. **`won-style-controls`** — kanonický schema fragment (JSON) s univerzální sadou
   stylových settingů.
2. **`snippets/won-style-vars.liquid`** — z těch settingů vysází inline
   `style="--won-*: …"` na root sekce (per-block override token-cascade; jako už dělá
   corner-radius). Token-only → **portuje na Horizon i Skeleton**.
3. **compose build-step** (`themes/build/compose.mjs`) fragment **injektuje** do
   každé `won-*` sekce a obalí root snippetem — stejný mechanismus jako
   paragraph-insert / native-prune z W2. Jeden zdroj, 26 konzumentů; nahradí
   kopírované settingy.
4. **`won-tokens.css`** konzumuje `--won-*` vars (rozšířit existující).

---

## Inventář controlů

### Tier 1 — univerzální (viditelné, KAŽDÁ sekce)
- **Spacing:** `pad_block_start`, `pad_block_end`, `pad_inline` (px range), `gap`,
  **`heading_gap`** (nadpis→text).
- **Šířka & zarovnání:** `section_width` (full/page/narrow), `content_align`,
  `text_align`.
- **Pozadí:** `bg_type` (none/color/gradient/image), `bg_color`, `bg_gradient_to`,
  `bg_image`, `overlay`, `overlay_color`, `backdrop_blur`.
- **Ohraničení & tvar:** `border_width` (px), `border_color`, `border_style`,
  `corner_radius` (px), `shadow` (none/sm/md/lg).
- **Barvy (na kaskádě, default inherit scheme):** `text_color`, `heading_color`,
  `accent_color`, `bg_color`.
- **Viditelnost:** `hide_desktop`, `hide_mobile`.

### Tier 2 — typografie + motion (druhá vrstva, „Vzhled")
- `heading_size`, `body_size` (px nebo scale), `heading_weight`, `font_mode`
  (inherit/custom), `font_family`, `letter_spacing`, `line_height`, `text_transform`,
  `animate_in` (none/fade/slide/scale).

### Tier 3 — Advanced (power, schované)
- raw px override všeho, per-side border, custom shadow string.

### Obsah — per blok (specifické, co blok umí)
- richtext kde próza, image picker, link field, repeatable bloky, **per-blok
  preset/look** (curovaný start jako toast look presety).

---

## Fázový rozpad + akceptační kritéria

### W3b-1 — základ + migrace
- `snippets/won-style-vars.liquid` + `won-style-controls` fragment (Tier 1) +
  compose injekce (idempotentní, depth-aware jako paragraph-insert).
- **Audit + migrace** existujících kopírovaných settingů (`padding_*`,
  `color_scheme`, `section_width`, `gap`, `corner_radius`) → standard fragment
  (**dedupe, ne přidat vedle**).
- Pilot 2–3 sekce + Playwright.
- **Akceptační:** theme-check VALID; žádná sekce nemá duplicitní control; pilot
  sekce renderuje stejně/lépe; Playwright — změna `padding`/`corner_radius`/`border`
  přes nový control se projeví na storefrontu; locale parity (en+cs) 0 missing.

### W3b-2 — roll-out
- Tier 1 na všech 26 + preset picker per blok.
- **Akceptační:** všech 26 má Tier 1 (grep); smoke zelený; každý blok má ≥1 preset;
  netknuté sekce vypadají jako předtím (curated defaults).

### W3b-3 — typografie + motion
- Tier 2 controly + CSS konzumace, fallback na defaulty.
- **Akceptační:** změna velikosti/váhy/fontu/animace se projeví; bez controlu =
  token default; reduced-motion respektován.

### W3b-4 — Advanced + guardraily
- Tier 3 raw px + **lehké guardraily**: min/max na ranges + **soft contrast
  warning** (nehard-blokovat — svoboda merchanta).
- **Akceptační:** advanced override funguje; contrast warning se ukáže při nízkém
  kontrastu; nikdy netvrdý blok uložení.

### Průběžně
- `won-design-system.md` docs (dokumentovat fragment + tokeny); **portability check
  na Skeletonu** (fragment token-only → musí jet i tam).

---

## Rozhodnutí (odsouhlaseno 2026-08-10 — autonomous-ready)

1. **Scope:** Tier 1 na **všech** sekcích; Tier 2 druhá vrstva; raw px za „Advanced".
   Curated defaults — netknutý blok je krásný.
2. **DRY mechanismus:** **compose build-step** injektuje fragment + sdílený
   `won-style-vars` snippet (konzistentní s repo; NE ruční kopie).
3. **px vs scale:** default = **fluid token**; když merchant zadá px → override. Ne
   obojí naráz.
4. **Barvy:** ctít **LOCKED kaskádu** — default inherit global color scheme, per-blok
   override optional. Nikdy nutit per-blok barvu.
5. **A6 / disclosure:** preset + obsah první, „Vzhled" collapsible, „Advanced"
   schované. Editor nesmí zavalit.
6. **Guardraily:** min/max na ranges + soft contrast warning; **nehard-blokovat**.
7. **Reconcile existující:** **migrovat** 26× kopírované settingy na fragment
   (dedupe), NE přidat vedle.
8. **Rollout:** **inkrementálně** (pilot → 26), ne big-bang.
9. **Interakce s Horizon:** nesahat na Horizon color-scheme systém; `--won-*`
   override jen na won leaf.

---

## Napojení / mechanika (pro implementaci)

- Nový build-step v `themes/build/compose.mjs` (vzor: existující 2c native-prune +
  paragraph-insert z W2) — depth-aware injekce do top-level `settings`, idempotentní.
- `won-style-vars` renderuje jen ty vars, které merchant změnil (jinak token
  default) — žádné zbytečné inline overrides.
- CSS kontrakt v `themes/won-base/assets/won-tokens.css`; radius už jede přes
  `--won-radius-md/sm`, rozšířit o spacing/border/typo vars.
- Testy: `tests/smoke/` (Playwright, desktop+mobile) — každá storefront-facing změna
  má spec (red→green). Validace: MCP `validate_theme` per soubor +
  `NODE_OPTIONS=--max-old-space-size=8192 shopify theme check` (celý dist crashne bez
  heap bumpu; won-* musí mít 0 offenses).

Viz `won-app-design-doctrine.md` (§1–§8, A1–A6) a `won-design-system.md` (token
kontrakt) jako závazný rámec.
