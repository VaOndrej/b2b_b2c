# PDP: jedna detailní zóna místo dvou

*2026-09-02 · b2b_b2c · rozhodnutí Ondřej: „Jedno Podrobnosti"*

## Co bylo špatně

Změřeno na `/products/the-videographer-snowboard`, 1440×1400:

| | y | výška |
|---|---|---|
| pásmo `detail` (bez nadpisu) | 1136 | 501 |
| sekce `tabs` — nadpis **Podrobnosti** | 1637 | 250 |

Uvnitř pásma (`content_columns: 2` → CSS multi-column):

| blok | x | y | š | v |
|---|---|---|---|---|
| Parametry | 60 | 1184 | 628 | 278 |
| Nutriční hodnoty | 752 | 1184 | 628 | 228 |
| Kdy užívat | 752 | 1452 | 628 | 137 |

Dvě chyby:

1. **Kdy užívat přeteklo do pravého sloupce** pod nutriční tabulku (levý sloupec končí y=1462, pravý y=1589 → 127 px prázdna vedle Parametrů). Časová osa se tak čte jako poznámka pod tabulkou.
2. **Dvě detailní zóny.** Fakta bez nadpisu, a hned pod nimi nadpis, který detaily teprve slibuje.

## Co se změnilo

- `themes/won-base/blocks/won-panel.liquid` — panel přijímá vnořené `@theme` / `@app` bloky. Jeden slot `.won-panels__panel-blocks`, větve tabs/accordion se otevírají a zavírají kolem něj.
- `themes/demo/horizon/templates/product.json` — sekce `detail` smazána; záložky Podrobnosti = **Popis · Parametry · Nutriční hodnoty · Použití · Skladování**. Tabulky vnořené do svých panelů s prázdným vlastním `heading`, `won-dosage` vnořený do *Použití* pod jeho textem.
- `tests/smoke/won-pdp-detail-zone.spec.ts` — nová stráž.
- `tests/smoke/won-pdp-composition.spec.ts` — selektor rozšířen o `.won-panels__panel-blocks`.

## C3 upload gate

Prošel: `Synced » update blocks/won-panel.liquid`, `Synced » update templates/product.json`. Cestou odhalil chybu, kterou lokální lint nemá jak najít — viz regression-log.

## Otevřené

- Sekce `won-band` s `content_columns` má pořád CSS multi-column, takže lichý počet nestejně vysokých bloků přeteče i jinde (homepage). Na PDP už to nevadí, jinde neověřeno.
- Záložková navigace se na 390 px láme do dvou řádků. Čitelné, ale pět záložek je strop.
