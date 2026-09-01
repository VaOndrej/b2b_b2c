# Prompt pro druhou AI — iterační audit a vylepšování Won theme

Zkopíruj všechno pod čarou jako první zprávu do nové session (Claude Code v repu
`~/Development/WonCommerce/Apps/b2b_b2c`). Prompt je psaný tak, aby model
nepotřeboval nic dovysvětlovat a hlavně **aby si nemohl vymýšlet, že něco prošlo**.

Stav ke dni 30. 8. 2026: demo katalog je dorovnaný (16 doplňků s českými popisy,
variantami, cenami, skladem a metafieldy), plná sada 248 passed / 0 failed / 28 skipped.

---

Jsi senior e-commerce konzultant a Shopify theme engineer v jedné osobě. Tvoje
práce není „projít testy", ale **udělat z téhle šablony eshop, který prodává** —
a nechat za sebou důkazy, ne dojmy.

## Kontext

Repo: `~/Development/WonCommerce/Apps/b2b_b2c`. Generická Shopify šablona:
overlay `won-*` nad Horizonem. Zdroj pravdy je `themes/won-base/**`, build
`node themes/build/compose.mjs horizon` → `themes/dist/horizon-dev`. Dist se při
každém composu maže — **nikdy do něj needituj**.

Na začátku si přečti, v tomhle pořadí:
1. `.agents/memory/theme-map.md` — architektura téhle šablony, celé.
2. `~/Development/WonCommerce/Tools/shopify-developer/rules/AGENTS.md` + `rules/conventions.md`
   + `rules/theme-block-ux.md` — závazný workflow a pravidla pro autoring bloků.
3. `~/Development/WonCommerce/Tools/shopify-developer/memory/regression-log.md` —
   **grepni si ho na oblast, které se chystáš dotknout.** Je v něm devět zápisů
   z pastí, do kterých už někdo spadl.
4. `docs/plans/2026-08-30-won-theme-e2e-matrix.md` — **testovací matice, kterou
   máš projít.** To je tvoje zadání.
5. `CLAUDE.md` — způsob spolupráce (zejm. „důkaz místo tvrzení").

Znalostní báze pro roli konzultanta: `~/Development/WonCommerce/Tools/EshopAudit`
- `data/knowledge-base/audit-rules.json` — 94 pravidel s `id`, `severity`, `check`,
  `problem_signal`, `recommendation`. **Každý UX nález cituj jeho `id`.**
- `data/knowledge-base/audit-checklist.md` — váhy a bodování 0–5 pro skóre oblastí.
- `data/knowledge-base/wf-block-catalog.json` + `wf-page-recipes.json` — jaký blok
  má pokrývat která pravidla a v jakém pořadí patří na stránku.
- `data/prompts/ux-system.txt` — jak uvažovat o závažnosti a o cenové hladině
  produktu. **Přečti si tam odstavec o PRICE TIER**: tahle šablona prodává
  doplňky stravy = impulzní zboží, takže quick-add z karty a express platba jsou
  správně, ne friction.

## Prostředí

```bash
cd ~/Development/WonCommerce/Apps/b2b_b2c
node themes/build/compose.mjs horizon
lsof -ti tcp:9292 | xargs -r kill -9 ; sleep 3
shopify theme dev -e horizon --port 9292     # počkej na HTTP 200, ne na hlášku
npm run test:smoke                            # 248 testů, desktop 1440 + mobil 390
```

Prohlížeč: **headless Playwright z tohohle repa** (`npx playwright test`), nikdy
Playwright MCP proti uživatelovu Chromu. Screenshoty do `tmp/`.

## Jak pracuješ — nepřekročitelné

1. **Test první, červený, pak fix, pak zelený.** Každá změna, která se projeví na
   storefrontu, přichází s Playwright specem v `tests/smoke/`. Spec napsaný po
   opravě, který je rovnou zelený, nehlídá nic — takový oprav, ne šablonu.
2. **Invarianty, ne výčty.** Test se ptá „přetéká-li rail, má afordanci?", ne
   „má sekce Bestsellery šipky?". Cílem je, aby nová sekce spadla sama.
3. **Měř chování, ne přítomnost.** Computed style, geometrie, `animationstart`,
   stav `/cart.js`. „Třída je v DOM" není důkaz, že je něco vidět.
4. **Po skriptovaném zásahu do Liquidu čti VÝSTUP, ne zdroj.** Text-replace přes
   čtyři sekce tu jednou nechal viset `-%}` za `{% endcomment %}` a to se
   **vyrenderovalo na homepage**. Prošlo to theme checkem, MCP `validate_theme`
   i 241 zelenými testy — všechny čtou zdroj nebo chování. Hlídá to teď
   `tests/smoke/won-no-raw-liquid.spec.ts`.
5. **`test.skip` je nález.** Když test skipne kvůli defaultní hodnotě nastavení,
   ta funkce je netestovaná. Buď ji nastav tak, aby běžela, nebo napiš, že je
   nepokrytá. V poslední sadě je 28 skipů — projdi je a rozhodni u každého.
6. **Jedna oprava = jedna změna.** Žádné „při té příležitosti jsem taky…".
7. **Nesahej na Shopify admin ani na produkční data** bez výslovného „go".
   Přepínání `themes/dist/**/config/settings_data.json` je v pořádku (dist se
   stejně přegeneruje), zápis do adminu ne. Když už na admin sáhneš:
   dry-run první, záloha `node themes/demo/tools/dump-products.mjs`, a **skript
   jen doplňuje, nikdy neuklízí cizí data** — „úklid" skladu tu jednou smazal
   záměrné multi-location fixtures.
8. **Zápis do paměti ve stejné úloze**, ne na konci dne:
   `~/Development/WonCommerce/Tools/shopify-developer/memory/regression-log.md`
   (symptom → příčina → fix/pravidlo → ověření) a `.agents/memory/theme-map.md`
   (stabilní architektonický fakt). Odvozuj zápis z diffu, ne z commit message.
9. **Sebeaudit po každé implementaci**, nevyžádaně: co jsi ošidil, co je
   neověřené, co je vědomý kompromis. Seřazeno podle závažnosti. „Všechno čisté"
   říkej jen tehdy, když to doslova platí.

## Smyčka

Opakuj, dokud neplatí podmínka STOP:

**1 — Vyber si buňku matice.** Pořadí podle výtěžnosti: Vrstva 5 (existující
testy + skipy) → Vrstva 3 (globální nastavení × všichni konzumenti) → Vrstva 2
(schémata sekcí) → Vrstva 4 (datové okrajové stavy) → Vrstva 1 (journey audit).
Neber víc než jednu oblast na iteraci.

**2 — Projdi ji jako expert, ne jako skript.** U každého případu si odpověz na
čtyři otázky z `ux-system.txt` (Vím kde jsem? Vím co dál? Proč věřit? Co mě
zdržuje?) a přiřaď `id` pravidla z `audit-rules.json`, pokud sedí.

**3 — Klasifikuj každý nález** jako: OK · MRTVÉ NASTAVENÍ · DRIFT · UX NÁLEZ ·
PŘÍLEŽITOST · NEOVĚŘENO (a proč). Definice jsou v matici.

**4 — Oprav nejzávažnější**, podle `severity` × váhy oblasti. Když je oprava
konfigurační schopnost (nový control), drž `theme-block-ux.md`: jeden pružný blok
místo N presetů, `info` u každého neobvyklého nastavení, corner radius všude,
kanonická `id`, sdílený button snippet, **locale klíče do `cs` i `en.default`
v jedné změně**.

**5 — Ověř**: `npm run test:smoke` (0 failed, skipy vysvětlené) + MCP
`validate_theme` na změněné soubory + screenshoty 390 a 1440.

**6 — Zapiš** do regression-logu a theme-mapu. Pak nová iterace.

## První úloha, ať nezačínáš od nuly

**Cena za jednotku lže u kapslí.** `won-price-per-unit` má `amount_metafield:
won.net_weight_g` a fallback `amount: 1000`. Kapsle metafield s hmotností nemají,
takže blok si váhu vymyslí a na PDP Vitamínu D3 + K2 svítí „Cena za 100 g:
$72.99 / 100 g" — číslo, které nic neznamená. Vymyšlená jednotková cena je horší
než žádná (PRC-001: cena musí být transparentní).

Rozhodni a udělej: buď blok při chybějícím metafieldu nerenderuje nic, nebo se
u kapslí přepne na „za porci" (`won.servings` je na produktech nastavený).
Ať tak či tak: **test první**, invariant „jednotková cena se nikdy neopírá o
fallback, který si vymyslí referenční množství".

## Co hlásit uživateli

Česky, stručně, tímhle tvarem:

1. Jedna věta, co je hotové.
2. Odrážky změn s `soubor:řádek`.
3. Tabulka projitých buněk matice s verdikty a **čísly** (ne „prošlo").
4. Sebeaudit — co je neověřené nebo kompromis.
5. Jedna věta: co potřebuješ rozhodnout.

Dlouhé rozbory piš do `docs/plans/` a odkaž na ně, ne do chatu.

## STOP

Zastav a shrň, když platí všechno:
- žádná buňka není MRTVÉ NASTAVENÍ ani DRIFT,
- každé pravidlo z mapy blok→pravidla je pokryté, nebo je zdůvodněno proč ne,
- skóre podle `audit-checklist.md` ≥ 85 % v každé oblasti, kterou šablona ovlivňuje,
- plná sada zelená, žádný nevysvětlený skip,
- poslední kolo přineslo jen nálezy `low` / `opportunity`.

Zastav i dřív, kdykoli narazíš na rozhodnutí, které mění produkt (ne kód) —
například „má se tenhle blok chovat takhle?". Zeptej se jednou, konkrétně, a
navrhni, co bys udělal ty.

## Známé hranice — ať je neobjevuješ znovu

- **Katalog je od 30. 8. reálný**: 16 doplňků, české popisy (odstavec + odrážky +
  dávkování), osy variant (Balení / Počet kapslí / Příchuť), ceny, SKU, sklad,
  metafieldy `won.rating|rating_count|delivery|net_weight_g|servings` +
  `custom.nutrition`. Data v `themes/demo/tools/supplement-catalog.json`, zápis
  `seed-supplement-catalog.mjs` (dry-run default). **Handly zůstávají
  snowboardové** (`the-collection-snowboard-liquid` = Whey Protein) — nepřejmenovávat,
  visí na nich demo šablony i testy.
- **Quick-add na kartě má jen produkt s JEDINOU variantou.** Po zavedení velikostí
  zbyly single-SKU schválně dva (Elektrolyty, Zinek + Selen) a jejich cena je
  nastavená tak, aby spadly do automatické kolekce, ze které čerpají raily. Když
  jim změníš cenu mimo pásmo 200–800, zmizí z homepage a s nimi celé pokrytí
  quick-addu / stepperu.
- **Store má 3 lokace, online obsluhuje jen „Shop location".** `inventoryQuantity`
  v adminu sčítá lokace, takže může ukazovat 50 u varianty, která je na
  storefrontu nedostupná. Dostupnost ověřuj přes `/products/<handle>.js`.
- **Omega 3 je nedostupná odjakživa** — leží na neaktivní „Snow City Warehouse".
  Není to regrese, je to fixture.
- **Multi-location fixture je rekonstruovaný, ne původní.** U
  `the-multi-location-snowboard` a `the-multi-managed-snowboard` byla zásoba na
  dvou lokacích omylem sloučena a pak ručně doplněna zpět (50+50). Přesná původní
  čísla nikdo nemá.
- **Checkout nelze měnit** — Shopify. Pravidla CHK-* zaznamenej, neboduj.
- **Známá otevřená vada, kterou nikdo nezadal:** na hero peek layoutu leží šipky
  přes tlačítko „Koupit" třetího slidu.
- Jednou během souběžného běhu dvou sad spadly `customization-layer` (Tier 3) a
  `storefront` (hero loop — autoplay 6 s závodí s klikáním). Ve dvou následných
  čistých bězích zelené. Watch item, ne potvrzená vada.
- Zápis do `won-theme-generic` dělá `node themes/build/publish.mjs --repo
  ../../won-theme-generic --reseed-demo [--apply]`. **`--reseed-demo` je u
  generického upstreamu povinný**, jinak demo šablony zamrznou.
