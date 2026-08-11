# Repository-wide agent instructions

Tyto instrukce platí pro celý repozitář a pro všechny agentní playbooky v
`agents/`.

## Povinná synchronizace produktové roadmapy

`docs/product-roadmap.html` je živý source of truth pro produktovou roadmapu
WonApps.

Při každém úkolu, který implementuje nebo mění repozitář — zejména při stavbě
nové aplikace či funkce, bugfixu, refaktoru, změně architektury, datového modelu,
Shopify extension/function, testovací infrastruktury, workflow nebo stavu
milníku — musí agent v rámci stejného úkolu také relevantně upravit
`docs/product-roadmap.html`.

Povinný postup:

1. Před implementací si přečti relevantní část `docs/product-roadmap.html`.
2. Urči, které aplikace, stavy, závislosti, milníky, schopnosti nebo další kroky
   změna ovlivňuje.
3. V rámci stejného diffu uprav roadmapu tak, aby popisovala skutečný stav po
   změně, nikoli plánovaný nebo neověřený výsledek.
4. Zachovej současný vizuální jazyk, responzivitu a sémantickou strukturu HTML.
5. Před dokončením zkontroluj, že roadmapa a implementace nejsou v rozporu, a
   uveď aktualizaci roadmapy v závěrečném shrnutí i mezi provedenými ověřeními.

Roadmap update není volitelná dokumentační práce ani následný follow-up. Úkol se
změnou repozitáře není hotový, dokud není `docs/product-roadmap.html` relevantně
synchronizovaný. Nevytvářej však nepravdivý progress: neprovedené nebo
neověřené části musí zůstat označené jako plánované, rozpracované nebo blokované.

Výjimkou jsou čistě read-only úkoly bez změn souborů, například vysvětlení,
analýza, audit nebo plán. Pokud se z takového úkolu stane implementace, povinnost
se okamžitě aktivuje.

## Povinný kritický self-audit po implementaci

Po **každé** nenulové implementaci (jakákoli změna souborů) si PŘED předáním k
review sám polož a PRAVDIVĚ zodpověz otázku:

> „Je tu něco, co jsem hacknul, ošidil, obešel, nebo přešel mlčením?"

Odpověď dej uživateli **sám a bez vyzvání**, BEZ okrašlování:

- Vypiš reálné **zkratky, technický dluh, nedodělky** a **NEOVĚŘENÉ předpoklady**
  (např. „nevidím admin vizuálně", „neověřil jsem chování na Free plánu",
  „mock měl 4 metriky, dodal jsem 3").
- **Seřaď podle závažnosti** — materiální (kazí záměr uživatele) → kosmetické.
- **Rozlišuj** „hotové a ověřené" vs. „hotové ale neověřené" vs. „vědomý kompromis".
- **Nikdy neříkej „vše čisté", pokud to není doslova pravda.** Falešné ujištění je
  horší než přiznaný dluh — uživatel staví další práci na tvém slově.

Toto platí **i po zeleném gate**: zelený typecheck/lint/build/test neznamená, že
jsi neošidil *záměr*. Výjimka: čistě read-only úkoly (vysvětlení, analýza, audit,
plán) — povinnost se aktivuje v okamžiku, kdy z nich vznikne implementace.

## Nativní Claude Code nástroje (`.claude/`)

Repo má vlastní Claude Code commands, subagenty a skills v `.claude/`. Jsou to
nativní nástroje (ne prozaické playbooky v `agents/`) — vyvolávají se přímo.

### Commands (`.claude/commands/`)

- **`/guard-sync`** — porovná ruční seznam `guard:test:core` v
  `apps/b2b-companion/package.json` se skutečnými `tests/**/*.test.ts` a nahlásí
  testy mimo bránu (tichý skip) i mrtvé cesty. S `--fix` doplní chybějící.
- **`/theme-compose <horizon|skeleton>`** — jeden vstup pro theme build:
  `compose.mjs` → připomínka restartu `theme dev` → `validate:shopify` →
  responzivní smoke.
- **`/new-app <name>`** — scaffold nové aplikace klonem `apps/_template`
  (přejmenování `@won/*`, Prisma, sqlite, roadmap sync).

### Subagenti (`.claude/agents/`)

- **`won-auditor`** — read-only seniorní audit celého monorepa (findings-first,
  `P0`–`P3`). Port `agents/claude-complete-project-audit.md`.
- **`won-test-runner`** — vybere a spustí správnou testovací bránu podle
  dotčeného workspace (core / b2b / toasts / theme) a interpretuje výstup.
- **`shopify-functions-dev`** — specialista na Shopify Functions a extensions,
  drží v souladu source ↔ config ↔ generated ↔ testy. Port
  `agents/codex-shopify-functions-and-extensions.md`.

### Skills (`.claude/skills/`)

- **`won-release-gate`** — kanonický release checklist (zrcadlí `predev`/
  `predeploy` a statickou bránu z CI + pod-chráněný theme track).
- **`won-visual-qa`** — řízené vizuální QA storefrontu přes Playwright
  (screenshoty na 390/768/1280) místo ad-hoc `.jpeg` v rootu.

### Hook (`.claude/settings.json`)

Zamýšlený `Stop` hook připomene tento AGENTS.md rituál (roadmap sync +
self-audit), když je pracovní strom špinavý; u read-only úkolů mlčí. Vyžaduje
schválení uživatelem (spouští shell) — viz `.claude/settings.json`.

## Ověřování storefrontu (responzivní invarianty)

Každá změna dotýkající se storefrontu (`themes/**/*.liquid|css|js`) se ověřuje
spuštěním `test:smoke` a voláním sdíleného invariantu `assertResponsiveSane(page)`
na mobilním viewportu (390px) — žádný horizontální overflow, nic širšího než
viewport, control tap targety ≥44px. Horizontální snap-scrollery (carousel, card
row, slider) se navíc ověřují přes `assertCarousel(...)` v režimu čteném z
`data-mobile-mode` (`single` = jedna vycentrovaná karta, default; `peek`; `N`).

Postup, prahy i kanonický kód helperu vlastní skill `shopify-dev` →
`shopify-theme-testing` („Universal Responsive Invariants"). Pokud repo Playwright
harness nebo `tests/support/responsive-invariants.ts` ještě nemá, řiď se pokynem
skillu a založ je podle něj — nekopíruj invarianty ručně po komponentách.
