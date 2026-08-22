# Pravidla pro práci v tomhle repu

> **Pro všechny AI agenty: tohle si přečti dřív, než sáhneš na první soubor.**
> Repo vypadá jako obyčejný Shopify motiv, ale není. Je to **složený výstup** ze
> tří vrstev s různým vlastníkem. Editovat "jen ten jeden soubor" tady umí tiše
> zabít přenositelnost celé šablony na další klienty.

Tenhle motiv se needituje ručně jako celek. Vzniká buildem v monorepu
`WonCommerce/Apps/b2b_b2c` a synchronizuje se sem skriptem.

## Jak s tímhle repem pracovat

Ondřej edituje motiv přes plugin **shopify-developer**. Začni tedy příkazem
`/shopify-dev` — načte planning gate, testovací disciplínu a paměť repa. Tenhle
soubor plugin nenahrazuje, doplňuje ho o **vrstvení**, které plugin nezná.

Paměť tohohle repa: `.agents/memory/theme-map.md`.

## Tři vrstvy, tři vlastníci

Klasifikace není odhad — nese ji `.won-manifest.json` v kořeni repa. Ten vygeneroval
build a je v něm ke **každému souboru** dvojice `owner` / `layer`.

| `layer` | Co to je | Kde je zdroj pravdy | Smí se to tady editovat? |
|---|---|---|---|
| `won` | Won IP — `won-*` sekce, bloky, snippety, assety | monorepo `themes/won-base/**` | **Ano** — a pak se to povyšuje nahoru (viz níž) |
| `vendor` | Čistý Horizon od Shopify | klon `Shopify/horizon` | **Ne, nikdy** |
| `data` | Merchant data — `templates/*.json`, `config/settings_data.json`, `sections/*-group.json` | tenhle store | Ano, ale edituje je merchant v theme editoru |
| `locale` | Locale soubory — base + Won fragment slitý dohromady | fragment v `themes/won-base/locales/` | Jen klíče pod `won.*` |
| neuvedeno v manifestu | Klientský kód, který tu vznikl | tenhle repo | Ano, zůstává tady |

Zjistit vrstvu jednoho souboru:

```bash
python3 -c "import json,sys;print(json.load(open('.won-manifest.json'))['files'].get(sys.argv[1],'client-only'))" sections/won-hero.liquid
```

## Co se tady NIKDY needituje

1. **Vendor soubory** (`layer: vendor`). Override Horizonu je přesně to, co dělá práci
   nepřenositelnou — Won vrstva má běžet i na Skeletonu (trať B, produkt do Theme Store).
   Chceš změnit chování nativní sekce? Postav vedle ní `won-*` variantu a nativní schovej
   z pickeru přes `HIDE_NATIVE_SECTIONS` v `themes/build/compose.mjs`.
2. **Blok sdílených style controls** ve schématu `won-*` sekcí (padding, accent, corner
   radius, typografie, motion, viditelnost). Ten do sekcí vstřikuje build z jednoho
   zdroje `themes/build/won-style-controls.json`. Editace per-klient se při povyšování
   projeví jako konflikt — správně.
3. **`.won-manifest.json`**. Generuje ho build.

## Povýšení změny do generic šablony

Když je změna v `won` vrstvě obecná (tj. dá se použít i u dalších klientů), patří nahoru.
Postup je mechanický, ne ruční kopírování:

```bash
cd ~/Development/WonCommerce/Apps/b2b_b2c

# 1. Co všechno se tady od posledního publish změnilo a kam to patří (nic nezapisuje)
npm run theme:promote -- --repo ~/Development/WonCommerce/won-theme-<klient>

# 2. Když report sedí, provést. Součástí je recompose obou tratí + statické smoke gaty.
npm run theme:promote -- --repo ~/Development/WonCommerce/won-theme-<klient> --apply
```

Co skript dělá a proč tomu jde věřit:

- **Vrstvu čte z manifestu**, nehádá ji z diffu.
- **Vendor soubory a merchant data hlasitě odmítne.** Neprojdou potichu.
- Won soubory povyšuje **trojcestným merge** proti přesně tomu buildu, ze kterého tenhle
  repo vznikl (`git merge-file` s recompose jako merge base). Proto se do zdroje nedostane
  nic, co do sekce vstřikuje build — a proto edit uvnitř vstřikované části skončí konfliktem.
- Locale klíče povyšuje **po klíčích**, jen ty pod `won.*`. Merchantův překlad zůstává tady.
- Po `--apply` sám pustí `compose` pro horizon i skeleton a statické smoke gaty.
  Behaviorální smoke potřebuje živý server — příkaz vypíše na konci.

Nový soubor, který tu vznikl od nuly (např. `sections/won-neco.liquid`), manifest nezná.
Povýší se jen když ho vyjmenuješ:

```bash
npm run theme:promote -- --repo <repo> --include sections/won-neco.liquid --apply
```

**Co nepatří nahoru:** cokoli, co se váže na tenhle konkrétní obchod — jeho handly kolekcí,
jeho texty, jeho barvy, jeho metapole. Obecné je to, co by druhý klient zapnul beze změny.

## Stažení zlepšení z generic šablony dolů

Tenhle repo vznikl klonem `won-theme-generic` a má na něj `upstream` remote:

```bash
git remote add upstream git@github.com:VaOndrej/won-theme-generic.git   # jednou, při založení
git fetch upstream && git merge upstream/main
```

Sdílejí historii, takže merge řeší git sám. Merchant data se nepřepíšou — generic šablona
je do klientských repozitářů nezapisuje.

## Že to Shopify píše zpátky sem, je v pořádku

Repo je napojené přes Shopify GitHub integraci, takže **každá změna v theme editoru sem
přiletí jako commit od `shopify` bota**. Vypnout to nejde a nevadí to: build vlastní kód,
Shopify vlastní merchant data. Perou se teprve tehdy, když jeden sáhne na cestu druhého —
a přesně to `publish.mjs` hlídá a odmítne přepsat.

Když ale bot commitne do souboru s `layer: won` nebo `vendor`, je něco špatně (nejspíš
někdo editoval kód v Shopify **code editoru**). To řeš, ne ignoruj.

## Než řekneš "hotovo"

Platí pravidla monorepa (`b2b_b2c/CLAUDE.md`), hlavně tahle tři:

- Vizuální změnu neuzavírej bez screenshotu z Playwrightu na **390 px a 1440 px**.
- Každý dávkový skript umí `--dry-run` a pouštíš ho první; výstup ukaž před "go".
- Do live storu nic bez výslovného "go" od Ondřeje.

## Licence

Repo je a musí zůstat **private**. Horizon licence zakazuje distribuci odvozeného motivu
mimo dodání konkrétnímu merchantovi jako služba.
