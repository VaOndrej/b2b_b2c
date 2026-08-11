---
description: Založí novou Won aplikaci klonem apps/_template a projede scaffolding kroky.
argument-hint: "<app-name>"
allowed-tools: Bash, Read, Edit
---

## Cíl

Přidání nové aplikace je opakovaný vícekrokový flow (kopie `_template`,
přejmenování `@won/*`, Prisma, sqlite, zápis do roadmapy). Tento příkaz ho
provede konzistentně a bez zapomenutých kroků.

Název nové aplikace je v `$ARGUMENTS` (kebab-case, např. `won-stepper`). Pokud
chybí, zeptej se a nepokračuj.

## Postup

1. Ověř, že cíl `apps/<app-name>` ještě neexistuje. Pokud ano, zastav se.
2. Zkopíruj scaffold **bez build artefaktů**:
   ```bash
   cp -R apps/_template apps/<app-name>
   rm -rf apps/<app-name>/node_modules apps/<app-name>/build apps/<app-name>/.react-router
   ```
3. Přejmenuj balíček: v `apps/<app-name>/package.json` změň `name` z
   `won-app-template` na `<app-name>` (Edit).
4. Uprav `apps/<app-name>/shopify.app.toml` a `README.md` — název, handle,
   popis. Prázdný `client_id` nech doplnit přes `shopify app config link`.
5. Vygeneruj Prisma klienta a připrav lokální DB:
   ```bash
   npm install
   npm run prisma:generate -w <app-name>
   npm run prisma:migrate:deploy -w <app-name>
   ```
6. Ověř základní bránu:
   ```bash
   npm run typecheck -w <app-name>
   npm run lint -w <app-name>
   npm run test:unit -w <app-name>
   ```
7. **Roadmap sync (povinné dle AGENTS.md):** přidej novou aplikaci do
   `docs/product-roadmap.html` jako rozpracovanou (ne hotovou) a zachovej
   stávající vizuální jazyk.

## Výstup

Jaká aplikace vznikla, které kroky proběhly zeleně, co ještě čeká na uživatele
(`shopify app config link`, doplnění client_id) a potvrzení roadmap syncu.
