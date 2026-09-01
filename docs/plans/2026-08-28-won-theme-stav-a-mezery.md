# Won theme — stav a mezery (2026-08-28)

Návrat po pauze. Poslední aktivita: deploy repo `won-theme-generic` 22. 8. 2026,
monorepo commit `590b6b4`. Tenhle dokument je snapshot, ne plán.

## Kde to je

**Vrstva `won-base` (monorepo, zdroj pravdy):** 27 sekcí, 15 bloků, 14 snippetů,
11 assetů, 4 locale soubory = 74 souborů (`wonBaseFileCount` v manifestu sedí).

**Deploy repo `won-theme-generic`:** složený motiv, 533 souborů v manifestu —
395 `vendor` (Horizon 3.2.1), 67 `won`, 51 `locale`, 16 `data`, 4 `meta`.
Ověřeno: **žádný soubor z `won-base` v deploy repu nechybí, vrstvy nedriftují.**
3 commity, žádný commit od `shopify` bota. **Motiv JE napojený na dev store**
přes GitHub integraci (`won-theme-generic/main`, verze 3.2.1, zatím nezveřejněný)
— chybí jen `Zveřejnit` / preview a vizuální QA, ne integrace.

**Pipeline hotová a použitelná:**
- `theme:compose` (horizon + skeleton), `theme:publish`, `theme:promote`
- `promote.mjs` dělá trojcestný merge s recompose jako merge base, vendor a
  merchant data hlasitě odmítá, locale povyšuje po klíčích `won.*`
- 17 smoke specs v `tests/smoke/` (parity, hidden natives, schema fáze,
  settings coverage, CTA invarianty, JSON-LD)
- Portabilita na Skeleton ověřená (trať B do Theme Store není zavřená)

**Prodejní jádro (dle BUILD-LOGu, živě ověřené):** PDP (variant-picker, cena za
jednotku, badges, rating, stock signal, sticky ATC, taby, nutrice, porovnání),
PLP (facety ze Search & Discovery, sort, stránkování), sdílená karta
`won-product-card` + globální `won-cart.js` quick-add. HP recept má 20 sekcí.

## Mezery — seřazeno podle toho, co blokuje peníze

### 1. Demo overlay je poskládaný jen ze třetiny (blokující pro prodej)
`themes/demo/horizon/` obsahuje **jen 3 recepty** — `index`, `product`,
`collection` (+ header/footer group). Zbylých 9 šablon (`page`, `blog`,
`article`, `search`, `cart`, `404`, `list-collections`, `page.contact`,
`password`) je **stock Horizon** — merchant i klient je uvidí bez jediné won
sekce. Navíc `config/settings_data.json` je **bit-identický s vendor Horizonem**
(manifest: `owner: merchant`, ale obsah = defaulty) → demo běží na Horizonových
barvách a typografii, ne na Won brandu. Demo je tím pádem půl-hotové právě v tom,
co klient posuzuje očima.

### 2. Trať „klientské repo" je neotestovaná
`promote.mjs` a `git merge upstream/main` jsou napsané a popsané v AGENTS.md,
ale nikdy neproběhly proti reálnému klientskému repu — `won-theme-generic` je
zatím jediné repo. Riziko: konflikt ve vstřikované části schématu (style
controls) je *zamýšlené* chování, ale nikdo neviděl, jak vypadá v praxi.

### 3. Hranice motiv ↔ appka není zapsaná (vyřešeno v hlavě, ne v repu)
`won-shipping-bar`, `won-bundle`, `won-qty-discount` **do motivu nepatří** — jsou
to appky. Motiv nese jejich **free tier** jako návnadu; kdo chce víc, koupí appku.
BUILD-LOG tohle neříká (řádek 163/194 je matoucí, jeden z nich hlásí shipping-bar
jako „HOTOVO") a AGENTS.md taky ne. Chybí: seznam „co je free tier v motivu / co
je placené v appce" a upgrade cesta z motivu do appky (`won-app-slot` už má
onboarding blank-state, ale žádný obsah).

### 4. Demo overlay = klientské repo startuje s demo obsahem
`demoOverlay: true`, `templates/index.json` má 20 demo sekcí a
`settings_data.json` 28 kB demo nastavení. Pro generic šablonu správně,
ale pro klientský klon je to obsah k vyhození. Chybí rozhodnutí:
publikovat s přepínačem `--no-demo`, nebo nechat merchanta smazat.

### 5. Chybí release/verzování
`release-notes.md` je Horizonu (3.2.1), ne Won vrstvy. Nikde není verze Won
vrstvy ani changelog, takže „stáhni si upstream" nemá co říct, co přijde.

### 6. Neuzavřené staré otázky z BUILD-LOGu
- Marquee: plynulá smyčka potřebuje JS duplikaci itemů (zatím scroll+reset)
- Configurator / problem-chooser: theme-native vs appka
- Reviews: vlastní Won app vs 3rd-party (Air) — drží Fázi C app-slotů
- Lighthouse celé knihovny nikdy neproběhl

### 7. „Fáze C a D" nejsou definované — jsou to dvě věty v BUILD-LOGu
Jediná zmínka je `themes/won-base/BUILD-LOG.md:194-195`:
- **Fáze C = app-sloty** — reviews / subscription / loyalty / search;
  bez appky mají degradovat na onboarding (blank-state, který zve k instalaci)
- **Fáze D = shoppable recepty a magazín** — content moat po vzoru Aktinu

Žádný plán, žádná akceptační kritéria, žádný kód. Než se na ně sáhne, musí se
z těch dvou vět udělat zadání — a C se navíc překrývá s free-tier hranicí (#3).

## Co bych udělal jako první tři kroky
1. **Dostavět demo overlay** — zbylých 9 receptů + kurátorovaný
   `config/settings_data.json` s Won brandem, aby demo nebylo z třetiny Horizon.
2. **Zapsat hranici motiv ↔ appka** do AGENTS.md a opravit matoucí řádky
   v BUILD-LOGu; z toho vyplyne obsah `won-app-slot` onboardingu (= půl Fáze C).
3. Preview na dev storu + vizuální QA HP/PDP/PLP na 390 px a 1440 px
   (Playwright), teprve pak `Zveřejnit`.
