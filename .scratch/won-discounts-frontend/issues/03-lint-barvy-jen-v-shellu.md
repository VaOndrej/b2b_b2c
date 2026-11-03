# 03: Lint: barvy jen v shellu (varování)

**What to build:** Když někdo napíše hex barvu nebo rgba do obrazovky nebo části mimo shell a tokeny, lint ho upozorní. Zatím jako varování, aby šlo přecházet postupně (chybou se stane v ticketu 25). Audit D1.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] npm run lint hlásí varování pro hex/rgba literál v komponentách mimo shell
- [x] Shell a tokeny varování nehlásí
- [x] Počet varování je zapsaný v ticketu jako výchozí stav (audit naměřil 121 hex mimo tokens)

## Důkaz

- Pravidlo: `.eslintrc.cjs`, override pro `apps/won-discounts/app/components/**/*.tsx` bez `components/shell/**`,
  `no-restricted-syntax` jako `warn` na literál nebo šablonu s hex barvou (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) nebo `rgb(`/`rgba(`.
  Hláška: „Barva patří do components/shell/ (tokens.ts), ne do obrazovky.“ Ticket 25 ho přepne na `error`.
- **Výchozí stav: 54 varování** (56 barev v 54 literálech, 2 literály mají dvě barvy). Ve shellu 0 varování
  (tam je 95 barev, smějí tam být). Audit naměřil 121 hex ve všech `.tsx` mimo `tokens.ts` včetně shellu; dnes je to 56 + 95 včetně `rgba(`.
- `npm run lint`: 0 chyb, 58 varování (54 nových + 4 dřívější import/no-duplicates).
- Brána: node 2041/2041, engine 720/720, typecheck 0, E2E preview 48/48. `docs/won-discounts/evidence/frontend-03/metrics.json`.

| Soubor | Varování |
|---|---|
| `app/components/screens/OutletScreen.tsx` | 13 |
| `app/components/tiers/ProTierSets.tsx` | 8 |
| `app/components/screens/AnalyticsScreen.tsx` | 4 |
| `app/components/screens/MilestonesScreen.tsx` | 4 |
| `app/components/looks/LookSection.tsx` | 3 |
| `app/components/margin/MarginProof.tsx` | 3 |
| `app/components/tiers/TiersPreview.tsx` | 3 |
| `app/components/RuleTable.tsx` | 2 |
| `app/components/looks/AccentPicker.tsx` | 2 |
| `app/components/looks/LookPreview.tsx` | 2 |
| `app/components/rewards/MilestonePreview.tsx` | 2 |
| `app/components/rule-editor/ApplySection.tsx` | 2 |
| `app/components/screens/TryCartScreen.tsx` | 2 |
| `app/components/RecipeGrid.tsx` | 1 |
| `app/components/screens/TranslationsScreen.tsx` | 1 |
| `app/components/tiers/TierSetEditor.tsx` | 1 |
| `app/components/try-cart/CombinationsSection.tsx` | 1 |
