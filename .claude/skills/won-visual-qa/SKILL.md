---
name: won-visual-qa
description: Řízené vizuální QA storefrontu přes Playwright — screenshoty na definovaných viewportech + kontrola responzivních invariantů, místo ad-hoc .jpeg souborů v rootu repa. Použij, když chceš vizuálně ověřit theme/storefront změnu nebo doložit stav před/po.
---

# Won visual QA

Nahrazuje ad-hoc vizuální QA (ručně ukládané `.jpeg` do rootu repa) opakovatelným
Playwright postupem s konzistentními viewporty a napojením na sdílené responzivní
invarianty.

## Kdy použít

Změna dotýkající se storefrontu (`themes/**/*.liquid|css|js`), theme sekce/bloku,
nebo když chceš doložit vizuální stav před/po zásahu.

## Postup

1. **Slož theme** na cílový base, pokud jsi to ještě neudělal:
   `node themes/build/compose.mjs <base>` (viz `/theme-compose`). Po compose
   restartuj `shopify theme dev` — jinak vidíš starý stav.
2. **Invarianty first.** Před screenshoty spusť `npm run test:smoke` a ověř
   `assertResponsiveSane(page)` na 390px (žádný horizontální overflow, nic
   širšího než viewport, tap targety ≥44px) a `assertCarousel(...)` dle
   `data-mobile-mode`. Zdroj pravdy je skill `shopify-dev` →
   `shopify-theme-testing`. Vizuální QA nesupluje invarianty, doplňuje je.
3. **Screenshoty** přes Playwright MCP (`browser_navigate`, `browser_resize`,
   `browser_take_screenshot`) na těchto viewportech:
   - mobil 390×844
   - tablet 768×1024
   - desktop 1280×800
   Pokrytí: home, kolekce, PDP a každá dotčená sekce/blok.
4. **Artefakty ukládej mimo root** — do scratchpadu nebo `apps/*/build/qa/`, ne
   do kořene repa. Necommituj binární náhledy bez záměru.

## Výstup

Krátký přehled: co bylo ověřeno, na kterých viewportech, výsledek invariantů,
a seznam pořízených screenshotů s cestami. Vizuální regrese popiš konkrétně
(sekce + viewport + co je špatně).
