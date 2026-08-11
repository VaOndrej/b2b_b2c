---
name: won-release-gate
description: Kanonický release checklist pro won-apps — zrcadlí predev/predeploy brány a statickou bránu z CI, plus pod-chráněný theme track. Použij před deployem aplikace nebo před merge do main, když chceš mít jistotu, že nic z brány nechybí.
---

# Won release gate

Sjednocuje `predev`/`predeploy` brány jednotlivých aplikací a statickou bránu z
`.github/workflows/ci.yml` do jednoho projitelného checklistu. Cíl: nic tiše
neproklouzne, zejména theme track, který je jinak mimo CI (jen `validate:shopify`
na jedné extensioně).

## Kdy použít

Před `shopify app deploy` kterékoli aplikace, před merge do `main`, nebo když si
chceš ověřit, že lokální stav odpovídá tomu, co po tobě bude chtít CI.

## Checklist (spouštěj z rootu repa)

1. **Package brána (doména):**
   `npm run test:packages`
2. **b2b-companion:** `npm run guard:test:core -w b2b-companion`
   - před tím zvaž `/guard-sync` — nový test nemusí být v ručním seznamu.
   - plná brána vč. E2E (pomalé, před deployem): `npm run guard:test -w b2b-companion`
3. **won-toasts:** `npm run test:unit -w won-toasts`
   - pokud se dotklo `storefront-src/`: `npm run build:storefront -w won-toasts`
4. **Statická brána napříč:**
   - `npm run typecheck:apps`
   - `npm run lint:standalone`
   - `npm run build:apps`
   - `npm run validate:shopify`
5. **Theme track (pokud se dotklo `themes/**`):**
   - `node themes/build/compose.mjs <base>` (nebo `/theme-compose <base>`)
   - `npm run test:smoke` s responzivními invarianty (390px, tap ≥44px,
     `assertCarousel` dle `data-mobile-mode`)
6. **Sekret/DB guard:** ujisti se, že se necommitují `.env`, `*.sqlite`,
   `dev.sqlite` ani tokeny (CI to hlídá — nepřekvap ho lokálně).
7. **Roadmap sync (AGENTS.md):** `docs/product-roadmap.html` odpovídá skutečně
   implementovanému a ověřenému stavu.

## Self-audit (AGENTS.md)

Po každé nenulové implementaci si sám a bez vyzvání zodpověz: *„Je tu něco, co
jsem hacknul, ošidil, obešel nebo přešel mlčením?"* Vypiš reálné zkratky,
technický dluh a NEOVĚŘENÉ předpoklady, seřazené podle závažnosti. Nikdy neříkej
„vše čisté", pokud to není doslova pravda.

## Výstup

Které kroky proběhly zeleně/červeně, co bylo přeskočeno a proč, a explicitní
potvrzení, že theme track i roadmap jsou pokryté (nebo nebyly dotčené).
