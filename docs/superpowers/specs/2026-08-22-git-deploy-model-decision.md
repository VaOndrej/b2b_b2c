# Git deploy model — rozhodnutí

Datum: 2026-08-22 · Stav: **odsouhlaseno Ondřejem 2026-08-22** · SB: `generic-theme-git-deploy-pipeline`

## Rozpor, který se řešil

Ondřejovo zadání: *jedno generic deploy repo → zklonovat per klient → upravovat
u klienta → povýšit obecné části zpátky nahoru.*

Proti tomu stála disciplína repa: klonovalo by se `themes/dist/<base>-dev`, což je
složený výstup, který `compose.mjs` krok 1 při každém běhu maže (`rmSync`). A
současně `themes/clients/` už v monorepu existuje (prázdné) jako zamýšlená
klientská vrstva — dva soupeřící modely na totéž.

## Co rozpor rozpouští

Odpověď je v repu napsaná dvakrát, jen ne na jednom místě.

`themes/build/compose.mjs:8-9`:

> won-base owns CODE only. Merchant settings (`settings_data.json`,
> `templates/*.json`) belong to each client theme and are pulled from the live
> store, never from here.

`docs/theme-roadmap.html` §03:

> won-base vlastní kód; nastavení a JSON šablony jsou per-klient, taháš je z
> živého motivu (`shopify theme pull`), nikdy nejsou ve won-base. **Merchant
> edituje v editoru, ty vlastníš kód.**

Obousměrný sync se Shopify tedy **není konflikt** — je to už navržené dělení.
Shopify zapisuje zpátky jen merchant data. Compose vlastní jen kód. Perou se
teprve tehdy, když jeden sáhne na cestu toho druhého. Řešení je proto vymezit
množinu cest, ne vymýšlet merge strategii.

## Rozhodnutí

### 1. Dvě množiny cest s opačným vlastníkem

V každém deploy repu má každý soubor právě jednoho zapisovatele:

| Cesty | Zapisuje | Shopify zápis sem |
|---|---|---|
| `sections/*.liquid`, `blocks/`, `snippets/`, `assets/`, `layout/`, `locales/*.schema.json` | compose | **konflikt — odmítnout** |
| `config/settings_data.json`, `templates/*.json`, `sections/*-group.json` | Shopify (merchant v editoru) | očekávané |

Compose v klientském režimu do druhé skupiny **nesmí zapsat**. Demo overlay
(krok 4) se pro klienta neaplikuje — ten je jen pro `-dev` build.

**Musí se ověřit dřív, než se to postaví:** `locales/*.json` (ne `.schema.json`).
Překladač v theme editoru („Upravit výchozí obsah motivu") do nich zapisuje, a
compose krok 3 do nich deep-merguje won fragmenty. Pokud Shopify tuhle cestu
opravdu commituje, patří do druhé skupiny a merge se musí přepracovat.

### 2. Klientské repo je samostatné a je to místo, kde se pracuje

**Přepsáno 2026-08-22 po Ondřejově námitce.** Původně tu stálo, že zdrojem
klientské práce je `themes/clients/<klient>/` v monorepu. To nejde: Shopify
GitHub integrace se napojuje na repo, jehož **kořen je motiv**. Klient v podsložce
monorepa se napojit nedá. Ondřejovo zadání má přednost.

Topologie:

- **`won-theme-generic`** — private, motiv v kořeni, generuje ho compose z monorepa.
  Slouží jako **upstream** pro všechny klienty.
- **`won-theme-<klient>`** — private, vzniká klonem/forkem generic repa, má
  `upstream` remote na generic. Napojené na klientův store přes GitHub integraci.
  **Tady Ondřej pracuje.**
- **Monorepo** zůstává zdrojem pravdy pro `themes/won-base/**` a pro compose.
  `themes/clients/` se ruší jako zdrojová vrstva; smysl má nanejvýš jako místo
  pro metadata klienta (store handle, theme id, stav syncu).

### 3. Vrstva se určuje lookupem, ne archeologií

Obava, kvůli které jsem původně chtěl monorepo, byla, že v naklonovaném motivu
nejde poznat, do které vrstvy změna patří. To byl omyl — jde to, a triviálně,
protože layer membership je dané cestou:

| Soubor existuje v | Vrstva | Kam patří povýšení |
|---|---|---|
| `themes/won-base/**` | Won IP | ano, do `themes/won-base/` |
| jen v `themes/bases/<base>/**` | vendor | **ne** — override ničí přenositelnost na trať B |
| merchant cesty (viz tabulka výš) | data | ne, patří klientovi |
| nikde | klientský kód | ne, zůstává u klienta |

Compose má do buildu vysypat **manifest** s touto klasifikací pro každý soubor,
aby ji klientské repo neslo s sebou a promotion skript ji jen četl.

**Ověřit:** kam manifest umístit, aby ho Shopify nezakřičel. Motiv má pevnou sadu
top-level složek (`assets`, `blocks`, `config`, `layout`, `locales`, `sections`,
`snippets`, `templates`). Neznámá složka v kořeni může upload rozbít. Kandidáti:
root dotfile (`.won-manifest.json`), `.github/`. Nepředpokládej — vyzkoušej upload.

### 4. Tok změn oběma směry

**Dolů** (generic zlepšení → klienti): monorepo → `compose` → push do
`won-theme-generic` → v klientském repu `git merge upstream/main`. Git sám řeší,
co se změnilo, protože sdílejí historii.

**Nahoru** (klientské zlepšení → generic): klasifikuj změněné soubory podle
manifestu. Pro soubory z vrstvy Won IP platí deterministické přemapování cesty —
`sections/won-x.liquid` v klientském repu ↔ `themes/won-base/sections/won-x.liquid`
v monorepu. Povýšení je tedy `git format-patch` + `git apply --directory=themes/won-base`,
pak `compose` + `npm run test:smoke`, pak push do generic. Mechanický krok s testem,
přesně jak si Ondřej vyžádal.

Vendor soubory a merchant data se nikdy nepovyšují. Skript je musí odmítnout,
ne zamlčet.

### 5. Licence

Všechna repa private: Horizon licence zakazuje distribuci derivátu jakýmkoli kanálem
mimo dodání konkrétnímu merchantovi jako služba.

## Invariant, který musí platit

Změnu udělanou u klienta jde zařadit do vrstvy bez hádání, protože vrstvu určí
lookup v manifestu. Povýšení generické části nahoru je patch s přemapovanou
cestou plus běh testů — ne ruční kopírování a ne čtení diffů.

## Co se tím ruší

`themes/clients/` jako zdrojová vrstva padá — roadmapa §03 s ní počítala, ale
nedá se napojit na Shopify GitHub integraci. Roadmapu je potřeba opravit, ať
nezůstanou dva soupeřící modely.

---

# Postaveno 2026-08-22 — co se ověřilo a co se muselo změnit

Model výše platí. Tři věci se při stavbě upřesnily; tahle sekce je nadřazená tomu,
co je nad ní.

## Ověření 1: `locales/*.json` merchant EDITUJE → patří do druhé skupiny

Doloženo v docs shopify.dev (2026-08-22):

- *Storefront locale files* (`locales/*.json` bez `.schema`) „can be edited by merchants
  through the Shopify Language Editor" — jsou to soubory motivu, ne data mimo něj.
- GitHub integrace: *„Files are updated in GitHub whenever changes are made to a connected
  theme. This can't be disabled."*

Takže ano: merchantův překlad sem přiletí jako commit. Compose krok 3 do stejných souborů
deep-merguje won fragmenty → skutečná kolize. Řešení není přepracovaný merge, ale **jiný
merge v jiném směru**:

- **Dolů** (`publish.mjs`): do locale souborů v deploy repu se merguje **jen to, co tam
  chybí** (`mergeMissing`). Hodnota, kterou tam merchant má, vždycky vyhrává.
- **Nahoru** (`promote.mjs`): promotion je **po klíčích**, ne patchem. Vezme se jen leaf,
  který leží pod namespace, který fragment vlastní (`won.*`). Změněný vendor/merchant
  string se odmítne — a odmítne se i tehdy, když je ve stejném souboru vedle klíče,
  který projde.

`locales/*.schema.json` zůstává compose-owned: řídí theme **editor**, ne merchant content.

## Ověření 2: manifest patří do kořene jako dotfile

Doloženo dvakrát:

- docs: *„Folders in the repository that don't match the default theme structure are
  ignored."* — neznámá cesta v kořeni upload nerozbije, jen se nesynchronizuje.
- precedens: **čistý Horizon sám** má v kořeni `LICENSE.md`, `README.md`,
  `release-notes.md` a `.cursor/`. Osm theme adresářů je pevných, kořen ne.

Manifest tedy je `.won-manifest.json` v kořeni deploy repa. Vygeneruje ho `compose.mjs`
(krok 5) a nese ke každému souboru `owner` + `layer` + `sha`.

`sha` v modelu nebyla a ukázala se jako nosný prvek: je to jediný způsob, jak odlišit
*„tenhle soubor ještě nebyl publikovaný"* od *„do compose-owned souboru někdo v deploy repu
zapsal"*. To druhé je v generic repu konflikt a v klientském repu přesně ta změna,
kterou má promotion vzít nahoru.

## Změna 3: povýšení není `format-patch` + `git apply --directory`

**Původní návrh (bod 4 výše) by importoval build output do zdroje.** Won sekce v deploy repu
**není** svůj won-base zdroj: compose krok 2d jí do schématu vstřikuje sdílené style controls,
mění `render 'won-spacing'` na `won-style-vars` a přidává `render 'won-guard'`. Diff vzatý
proti složenému souboru a nalepený na zdroj by tuhle vstřikovanou vrstvu zapekl do
`themes/won-base/` — a příští compose by ji vstřikl podruhé.

Povýšení je proto **trojcestný merge**, kde merge base je znovu složený generic build:

```
ours   = themes/won-base/<path>              zdroj (mohl se mezitím posunout)
base   = themes/dist/<base>-generic/<path>   to, z čeho klientské repo vzniklo
theirs = <deploy repo>/<path>                klientem upravený soubor
```

`git merge-file --diff3 ours base theirs`. Klientská editace leží mimo vstřikované regiony,
takže projde čistě. Editace **uvnitř** vstřikovaného regionu skončí konfliktem — a to je
správný výsledek, ne chyba: ten obsah vlastní `themes/build/won-style-controls.json`
a měnit ho per-klient je ta vada, kterou chceme chytit.

Ověřeno na živém round tripu: úprava `sections/won-hero.liquid` v deploy repu doputovala
do `themes/won-base/sections/won-hero.liquid` jako přesně ty dva řádky, bez jediného řádku
vstřikované vrstvy, a statické smoke gaty (13 testů) zůstaly zelené.

## Co z toho vzniklo

| Soubor | Role |
|---|---|
| `themes/build/layers.mjs` | jediná definice „kdo tenhle soubor vlastní a do které vrstvy patří" |
| `themes/build/compose.mjs` | + `--no-demo`, `--out <dir>`, krok 5 = emise manifestu |
| `themes/build/publish.mjs` | dist → deploy repo; mirror kódu, seed merchant dat, additivní merge locales, detekce konfliktů |
| `themes/build/promote.mjs` | deploy repo → won-base; 3-way merge kódu, key-level merge locales, hlasité odmítnutí vendor/dat |
| `themes/build/deploy-repo/**` | starter kit pro deploy repo — `AGENTS.md`, `README.md`, SessionStart hook, `.agents/memory/theme-map.md` |

npm zkratky: `theme:compose`, `theme:generic`, `theme:publish`, `theme:promote`.

## Chování ověřené na scratch repu

| Situace | Výsledek |
|---|---|
| první publish do prázdného repa | 483 write + 15 seed + 31 locales + 4 scaffold |
| druhý publish beze změn | 0 zápisů (idempotentní) |
| merchant změnil `templates/index.json` a string v `locales/cs.json` | obojí zůstalo, publish je nepřepsal |
| klient upravil `sections/won-hero.liquid` | publish hlásí CONFLICT, promote ho povýší čistě |
| klient upravil `sections/hero.liquid` (vendor) | promote REFUSED — „override breaks portability" |
| klient přejmenoval `padding_top` uvnitř vstřikovaného bloku | promote CONFLICT, s odkazem na `won-style-controls.json` |
| klient upravil `won.a11y.close` i `general.MERCHANT_EDIT` ve stejném souboru | první povýšen, druhý odmítnut |
| klient dopsal odstavec do `AGENTS.md` | povýšeno do `themes/build/deploy-repo/AGENTS.md` |

## Zbývá (potřebuje Ondřejovo „go")

1. **Založit `won-theme-generic`** (private, účet `VaOndrej`) a udělat první publish + push.
   Zatím neexistuje — nic se nepushovalo.
2. **Ověřit upload reálně**: napojit repo přes Shopify GitHub integraci na
   `b2b-b2c-store-development`, potvrdit, že `.won-manifest.json` a `AGENTS.md` v kořeni
   projdou, a udělat změnu v theme editoru → přijde commit od `shopify` bota → další
   `publish` ji nesmí přepsat. Dokud tenhle krok neproběhne, je „Shopify ignoruje neznámý
   kořen" doložené jen dokumentací a precedentem Horizonu, ne pozorováním.
3. **Rozhodnout, co je v generic repu jako startovní merchant data.** Dnes se generic build
   skládá **s demo overlayem** (`themes/demo/horizon/**`), takže nový klon vypadá jako Won
   šablona, ne jako holý Horizon. Cena: demo šablony ukazují na demo kolekce/produkty, které
   v novém storu nejsou. Alternativa `--no-demo` = čistá Horizon data. Publish seeduje
   merchant cesty jen když chybí, takže volba se týká výhradně prvního klonu.
4. **Smazat `VaOndrej/dawn-base` a `VaOndrej/horizon-base`** — vznikla omylem, mirrorují už
   verzovaný vendor obsah a na jiné verzi (4.0.0 vs. 3.2.1, na které build stojí).

## Regrese chycená při prvním ostrém publish (2026-08-22)

Druhý `publish --apply` do stejného repa smazal `AGENTS.md`, `.gitignore`
a `.claude/settings.json`. Příčina: scaffold soubory se zapisují do manifestu
v deploy repu, ale v manifestu **buildu** nejsou — a mazací průchod (`compose-owned
soubory, které z buildu zmizely`) je proto vyhodnotil jako odešlé. Navrch se
`README.md` scaffoldu prala s `README.md` čistého Horizonu.

Fix: scaffold cesty jsou vyloučené z compose-owned mirroru i z mazacího průchodu —
starter kit vlastní svoje cesty, tečka. Ověřeno: fresh bootstrap 482+16+31+4,
druhý běh 0 zápisů, `AGENTS.md` na místě.

**Poučení pro pravidlo:** jakmile do manifestu zapisuju entries ze dvou zdrojů,
musí mazací průchod znát oba. Jinak druhý zdroj vypadá jako smazaný obsah prvního.

## Stav 2026-08-22 večer

`VaOndrej/won-theme-generic` — **private, existuje, 3 commity na `main`, 534 souborů.**
https://github.com/VaOndrej/won-theme-generic
Lokální klon: `~/Development/WonCommerce/won-theme-generic`.
Startovní merchant data: **demo overlay** (Ondřejova volba) — nový klon vypadá jako Won
šablona, ne jako holý Horizon.

Nezbývá než napojení na Shopify (bod 2 výše) a smazání `dawn-base` / `horizon-base`.
