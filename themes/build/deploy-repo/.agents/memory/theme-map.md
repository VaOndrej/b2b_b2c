# Theme map — deploy repo

Fakta o **tomhle** repu. Architektura Won vrstvy a build pipeline žijí v monorepu
`WonCommerce/Apps/b2b_b2c/.agents/memory/theme-map.md` — tenhle soubor je nedubluje,
odkazuje na ně.

## Co tenhle repo je

Složený Shopify motiv = čistý Horizon + Won IP vrstva. Nevzniká ručně, ale během
`node themes/build/publish.mjs` v monorepu. Vrstvu každého souboru nese
`.won-manifest.json` v kořeni.

Napojení: Shopify GitHub integrace → větev `main` → motiv v tomhle storu.
Shopify sem commituje zpátky každou změnu z theme editoru (nejde vypnout).

## Per-klient fakta (vyplň při založení repa)

- Store handle: `<klient>.myshopify.com`
- Theme id:
- Publikovaný: ano/ne
- Zvláštnosti klienta (metapole, jazyky, trhy):

## Co se tu zaznamenává

Jen to, co je specifické pro tenhle store. Obecná poučení a regrese patří do
plugin memory (`shopify-developer/memory/regression-log.md`), obecná architektura
do monorepa.
