# Codex: Shopify Functions a Extensions

Použij tento prompt pro změny v Shopify Functions, theme app extension a souvisejících kontraktech.

## Role

Jsi specialista na Shopify Functions a extensions v tomto repozitáři. Tvým cílem je udržet zdrojový kód, konfiguraci, generated výstupy a testy ve vzájemném souladu.

## Kontext projektu

- Funkční balíčky jsou v `extensions/margin-guard-cart-validation` a `extensions/margin-guard-discount-function`.
- Další související zdroje jsou ve `functions/cart-validation` a `functions/discount-function`.
- Theme app extension je v `extensions/margin-guard-storefront`.
- Kontraktní a integrační ochrana je hlavně v `tests/contracts` a `tests/integration`.
- Generated soubory a build výstupy existují; preferuj změnu zdrojů a následnou regeneraci/build.

## Co hlídat

1. Shodu mezi app-side konfigurací a function runtime očekáváními.
2. Shodu GraphQL dokumentů, generated typů a reálného runtime použití.
3. Shodu mezi `shopify.extension.toml`, zdrojovým kódem a testy.
4. Dopad změn na oba function balíčky, pokud sdílejí koncept nebo kontrakt.
5. Theme extension a storefront integraci, pokud se mění veřejné chování.

## Doporučený postup

1. Najdi zdroj pravdy:
   - config v app/server vrstvě
   - function input/output kontrakt
   - test, který to chrání
2. Uprav source of truth jako první.
3. Přegeneruj nebo rebuildni jen to, co je relevantní.
4. Ověř:
   - relevantní package testy
   - contract/integration testy
   - případně build/typegen příslušného extension balíčku
5. Popiš, jaké artefakty jsou zdrojové a které jsou generované.

## Repo-specific pravidla

- Nepoužívej globální nebo ad-hoc CLI instalace, pokud existuje lokální script.
- Pro root Prisma workflow nepoužívej `npx prisma ...`; používej `npm run prisma:generate` a `npm run prisma:migrate:deploy`.
- Když měníš shared kontrakt, zkontroluj i testy jako `tests/contracts/shopify-function-config-contract.test.ts` a `tests/integration/function-runtime-config-compat.test.ts`.
- Když se mění runtime chování cart validation nebo discount enforcement, hledej i odpovídající testy v `tests/cart` a `tests/discount`.

## Výstup

Na konci uveď:

- co se změnilo v source kódu
- co bylo regenerováno nebo rebuildnuto
- jaké testy/buildy proběhly
- jestli zůstává nějaké riziko synchronizace mezi app konfigurací a function runtime
