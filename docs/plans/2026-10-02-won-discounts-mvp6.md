# Won Discounts MVP 6 — Kampaně (Pro) (implementační plán, inline)

> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §2 (`Campaign`), §3 (C4, transport), §4.6, §7
> (Kampaně = Pro, A6 downgrade), §10 (MVP 6). Rozhodnutí: `rozhodnuti.md` „Kampaně (Black Friday)“. Mezery A6, A8.
> Dluh: build log „Parkované otázky a dluh“ (fáze 1 přepnutí kampaně). Stav:
> [`../won-discounts-build-log.md`](../won-discounts-build-log.md). Práce **inline bez subagentů**.

(Plán se doplňuje po měření B0; kontrakty se zafixují a commitnou před implementací.)

## Rozpočet — kampaně (B0, stop-pravidlo zapsané před měřením)

Co je dnes (MVP 1–5): engine TS i Rust umí kampaň (handshake `campaignId` + `varsVersion`, přepisy pravidel,
re-target refy `rule@k`), ale **živá kampaň nikdy neprošla měřením rozpočtu instrukcí** — všechny rodiny mají
`campaignActive: false`. Rezerva po MVP 5: 0,11 bodu (99,89 %).

**Měření (jeden průchod, bez šplhání):** všech 3 320 vstupů rodin cap 550 (`budget-families-cap550.tar.gz`)
× 3 režimy `tests/budget-families/campaign-variants.mjs` = 9 960 běhů na Wasm dnešního `main` (bez změny funkce):
- `none` — kampaň živá a platná, bez přepisu (handshake + smyčka resolve);
- `value` — přepisy `value` nejodkazovanějších pravidel, kolik se vejde do 9 000 B configu;
- `retarget` — přepisy `target` nejodkazovanějších pravidel, kolik se vejde; refy řádků na ně → `rule@k`.

**Stop-pravidlo:** max < 100 % a 0 DIFF (parita TS) → kampaně bez nové meze, funkce se pro přepisy pravidel nemění.
Max ≥ 100 % → mez v syncu / adminu (strop počtu přepisů s re-targetem nebo počtu `rule@k` refů na produkt) zapsaná do
specu, přeměřit jen dotčený režim jednou. DIFF → chyba enginu, opravit dřív než cokoli dalšího.
Každá pozdější změna logiky funkce v MVP 6 (např. přepisy sad úrovní) se přeměří stejnou sadou.
