---
description: Složí Won theme na zvolený base (Horizon/Skeleton) a ověří responzivní invarianty.
argument-hint: "<horizon|skeleton>"
allowed-tools: Bash
---

## Cíl

Jeden vstupní bod pro theme build flow, který je jinak roztroušený v bespoke
`.mjs` skriptech a kmenovém vědění. `compose.mjs` maže `dist/` a rebuilduje z
pristine base — kurátorovaný obsah musí žít v `themes/won-base/` nebo
`themes/demo/<base>/`, jinak ho compose zničí.

## Base

Cíl je v `$ARGUMENTS`. Povolené hodnoty: `horizon` (klientský track) nebo
`skeleton` (produktový track). Pokud chybí nebo je neplatný, zeptej se, který
base skládat, a nepokračuj.

## Postup

1. Slož theme:
   ```bash
   node themes/build/compose.mjs <base>
   ```
   Výstup jde do `themes/dist/<base>-dev`.
2. Připomeň uživateli: **po compose je nutný restart `shopify theme dev`** — dev
   server drží starý sklad tokenů/sekcí a neuvidí nové soubory bez restartu.
3. Validuj theme:
   ```bash
   npm run validate:shopify
   ```
4. Pokud se změna dotýká storefrontu (`themes/**/*.liquid|css|js`), spusť
   responzivní invarianty:
   ```bash
   npm run test:smoke
   ```
   Ověř `assertResponsiveSane(page)` na 390px (žádný horizontální overflow, tap
   targety ≥44px) a `assertCarousel(...)` podle `data-mobile-mode`. Kanonický
   postup vlastní skill `shopify-dev` → `shopify-theme-testing`.

## Výstup

Co se složilo, kam, výsledek validace a smoke testů, a explicitní připomínka
restartu dev serveru.
