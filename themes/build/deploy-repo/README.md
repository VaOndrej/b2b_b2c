# Won theme — deploy repo

Složený Shopify motiv: čistý **Horizon** + **Won IP** vrstva. Nevzniká ručně.

- Zdroj Won vrstvy: monorepo `WonCommerce/Apps/b2b_b2c`, adresář `themes/won-base/**`
- Build a sync sem: `npm run theme:publish -- --repo <cesta k tomuhle repu> --apply`
- Vrstva každého souboru: `.won-manifest.json`

**Než tady cokoli změníš, přečti [AGENTS.md](AGENTS.md).** Platí to pro lidi i pro AI —
editace vendor souboru tady je to, co zabije přenositelnost šablony na dalšího klienta.

Repo je private a musí zůstat private (Horizon licence).
