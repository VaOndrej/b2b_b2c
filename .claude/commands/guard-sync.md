---
description: Najde testy, které nejsou v ručním seznamu guard:test:core, a nabídne jejich doplnění.
argument-hint: "[--fix]"
allowed-tools: Bash, Read, Edit
---

## Cíl

`guard:test:core` v `apps/b2b-companion/package.json` je **ručně udržovaný**
explicitní seznam cest (ne glob). Nový test soubor, který v seznamu chybí, se
tiše nespustí ve statické bráně ani v CI. Tento příkaz ten drift odhalí.

## Postup

1. Přečti `apps/b2b-companion/package.json` a z `scripts["guard:test:core"]`
   vytáhni seznam cest za `tsx --test` (jde o cesty relativní k
   `apps/b2b-companion/`).
2. Vylistuj skutečné testy:
   ```bash
   cd apps/b2b-companion && find tests -name '*.test.ts' | sort
   ```
3. Spočítej rozdíl:
   - **Chybějící v bráně** = existující `tests/**/*.test.ts`, které nejsou v
     seznamu `guard:test:core`. Tohle je hlavní riziko — vypiš je jako první.
   - **Mrtvé cesty** = položky v seznamu, které už na disku neexistují.
4. Vypiš přehledný report obou skupin s počty.

## Když je předán `--fix` (nebo `$ARGUMENTS` obsahuje `--fix`)

- U každého chybějícího testu se krátce zamysli, jestli patří do `core` brány
  (doménový/kontraktní/route/service test) — čistě E2E/manuální skripty do
  `guard:test:core` nepatří.
- Doplň chybějící core testy do `scripts["guard:test:core"]` v
  `apps/b2b-companion/package.json` (Edit), zachovej řazení podle domény.
- Odeber mrtvé cesty.
- Po úpravě ověř, že brána projde:
  ```bash
  npm run guard:test:core -w b2b-companion
  ```

Bez `--fix` **nic neupravuj** — jen reportuj a navrhni, co doplnit.

## Výstup

Report: kolik testů v bráně chybí, kolik cest je mrtvých, a (u `--fix`) co bylo
změněno a zda brána proběhla zeleně.
