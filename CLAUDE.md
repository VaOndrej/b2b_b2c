# Pravidla pro práci v tomhle repu

Monorepo: Shopify aplikace (`apps/`) a generická theme. Součástí jsou live klientské projekty.

Tenhle soubor je o *způsobu spolupráce*, ne o architektuře kódu. Pravidla vznikla
z auditu 21 sessions v tomhle repu (viz `WonCommerce/Apps/docs/audit/`).

## Zápis do live

- Do live storu ani do Shopify adminu nezapisuju nic bez explicitního "go" od Ondřeje.
  Všechno držím připravené lokálně ve skriptech.
- Před každou hromadnou nebo destruktivní změnou dat udělám lokální zálohu
  a řeknu, kde je.
- Každý migrační nebo dávkový skript umí `--dry-run` a pouštím ho první.
  Výstup dry-runu ukážu dřív, než se zeptám na "go".

## Rozsah změny

- Sáhnu jen na to, co je v zadání. Varianty, metapole, handly, URL a SKU
  nechávám být, pokud to není výslovně zadané.
- Když změna mění handle nebo URL, řeknu to dopředu a navrhnu redirect.

## Důkaz místo tvrzení

- Vizuální změnu neuzavírám bez screenshotu z Playwrightu ve viewportech
  390px a 1440px, nebo bez přímé URL na běžící `shopify theme dev` / `shopify app dev`.
- "Hotovo" bez důkazu je nedokončená práce.
- Když má Ondřej něco ověřit sám, přikládám rovnou přesný příkaz do terminálu,
  ne jeho popis.

## Rozsah session

- Když session přeroste ~15 promptů nebo se téma posune mimo úvodní zadání,
  navrhnu zapsat stav do SB a pokračovat v nové session.
- Dávku nesouvisejících tasků ze SB neřeším najednou. Jeden task = jedna session.

## Second Brain

- Co ověřím nebo rozhodnu, zapíšu do SB jako task nebo note. Ne jen do chatu.

## Specifika monorepa

- Když z feedbacku vyplyne pravidlo platné pro víc aplikací, zapíšu ho rovnou
  do templatu pro nové appky, ne jen do konkrétní aplikace.
- Před `shopify app dev` ověřím, že běžící porty nekolidují s jinými theme dev
  procesy, které mohou běžet v jiných terminálech.
