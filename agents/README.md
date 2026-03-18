# Agents

Soubory v tomto adresáři slouží jako playbooky pro práci podle role nebo typu úkolu.

## Konvence pro zadání

- Když zadání obsahuje `dle agents/<soubor>.md`, použij tento soubor jako hlavní instrukci pro řešení úkolu.
- Když zadání výslovně říká `vytvoř subagenta dle agents/<soubor>.md`, načti daný soubor a použij ho jako pracovní prompt pro subagenta.
- Když zadání říká jen `udělej X dle agents/<soubor>.md`, je v pořádku použít playbook lokálně nebo přes subagenta podle povahy práce. Pro větší audit, testy nebo samostatnou oblast preferuj subagenta.
- Pokud existuje více relevantních playbooků, použij ten nejbližší typu úkolu. Další použij jen jako doplněk, ne jako konkurenční instrukci.

## Příklady

- `Připrav testy dle agents/tests.md`
- `Vytvoř subagenta dle agents/tests.md a oprav slabá místa v testech pro pricing`
- `Projdi checkout bug dle agents/codex-bugfix-debug.md`
- `Implementuj feature dle agents/codex-feature-delivery.md`

## Očekávaný způsob práce

1. Načti zvolený playbook.
2. Použij jeho workflow, checklist a výstupní pravidla.
3. Drž se nejmenšího smysluplného zásahu.
4. Na konci vždy uveď, co bylo změněno a jaké ověření proběhlo.
