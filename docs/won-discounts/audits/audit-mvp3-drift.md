# MVP 3 dílčí audit: drift Rust ↔ TS (množstevní úrovně, port 173fe47)

Read-only audit. Auditovaný stav je commit 173fe47. Mezi 173fe47 a HEAD (6e2e352) se `packages/core` ani extension nemění.

Scratch: `/private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/` (dál jen `scratch/`).

- Nativní harness i Wasm jsou sestavené z kopie extension (`scratch/crate`).
- Wasm vznikl oficiální cestou (cargo → wasm-opt `-Oz` → trampoline) a je bajt po bajtu shodný s buildem `shopify app dev`: sha1 fe3061bf…, 251 546 B.
- Generátory MVP 2 auditu (`audit-mvp2-drift/`) jsem použil beze změny.

## Výsledek

- **Logika úrovní v Rustu odpovídá TS.** Porovnáno 89 904 vstupů uzlů z 57 141 košíků, každý nativně i ve Wasm. Rozdílů je 575, všechny vysvětlené, logický žádný:

| Skupina | Vstupů uzlů | Rozdílů | Huge money (README) | Čtení čísel (P3-2) | Přijatá hrana `tier:<id>` (P3-1) | Logika |
|---|---|---|---|---|---|---|
| Úrovně, náhodné rodiny (tjunk, tties, tstack, tmargin, tmsg, tcount, tnum, tbig, twide, tout) | 71 378 | 532 | 507 | 25 | – | **0** |
| Deterministické sondy | 371 | 0 | – | – | – | **0** |
| Rodina tedge (pravidlo s id `tier:<setId>`) | 3 809 | 18 | – | – | 18 | **0** |
| Generátor MVP 2 beze změny (cesty MVP 1–2, bez úrovní) | 14 346 | 25 | – | 25 (už známá P3-1 z MVP 2) | – | **0** |
| **Celkem** | **89 904** | **575** | 507 | 50 | 18 | **0** |

  - Dalších 29 vstupů se liší jen textem JSON, ne hodnotou: procento pod 10⁻⁶ Rust tiskne jako `0.0000001`, TS jako `1e-7`. Jde o přijatý rozdíl README „Number text“.
  - Kontrola pravdivosti TS reference: všech 89 904 očekávaných výstupů jsem přepočítal proti snapshotu core 173fe47 (`git archive 173fe47`, `scratch/head/verify.mjs`), ne proti pracovnímu stromu. Výsledek: 0 rozdílů. Viz „Poznámky k průběhu“.
- **Paniky: 0.** Ověřeno v release nativně, ve Wasm a v debug buildu s kontrolou přetečení. Debug běžel na všech rodinách úrovní a na sondách.
- **Invarianty výstupu** (výstupy Rustu, všechny uzly jednoho košíku dohromady; 46 641 košíků, 71 749 uzlů, 50 201 kandidátů úrovně):
  - zpráva úrovně („Od …“ / „From …“) je jen ve výstupu automatického uzlu: 0 porušení;
  - řádek dostane produktovou slevu nejvýš z jednoho uzlu: 0 porušení;
  - součet produktových slev řádku nepřesáhne jeho mezisoučet: 0 porušení;
  - uzel doručení nikdy nevydá produktovou slevu: 0 porušení.
- **Hranice marže** (MVP 2 `check.mjs`, nejhorší zaokrouhlení Shopify, dvě hypotézy alokace objednávky) na rodinách úrovní: 134 801 zlevněných řádků, **0 porušení**.
  - Generátor MVP 2 ukázal 6 porušení. Všechna jsou ve 3 košících s 16–17místnými čísly, tedy známá P3-1 z MVP 2.
- **Rust nedá víc než TS mimo přijaté třídy.** Víc dává v 77 vstupech: 16 je přijatá hrana `tier:<id>` (P3-1), zbytek Huge money a čtení čísel (P3-2), vše jen nad junk daty.
- **Cesty MVP 1–2 se nezměnily.** Generátor MVP 2 na buildu MVP 3: 14 346 vstupů, 0 logických rozdílů, 25 rozdílů čtení čísel jako v MVP 2.
- **Instrukce a paměť:** žádný nový nález nad známé stop rule. Maxima jsou v sekci „Instrukce a paměť“.

## Fuzz: co a kolik

Generátor `scratch/gen3.mjs` (TS reference přes `tests/reference-adapter.js`), deterministické sondy `scratch/probes3.mjs`. Porovnání běží přes MVP 2 `compare.mjs`, klasifikace rozdílů přes `scratch/explain3.mjs`.

`explain3.mjs` třídí rozdíly takto:
- **huge**: některý mezisoučet, součet košíku, součet kusů nebo množství je ≥ 2⁵³;
- **čtení čísel**: TS nad vstupem přečteným přes serde_json dá přesně výstup Rustu;
- **jinak REAL**.

| Rodina | Vstupů uzlů / košíků | Co randomizuje navíc proti `parity.test.js` (tierCase) |
|---|---|---|
| tjunk | 15 497 / ~10 000 | junk na každé úrovni payloadu:<br>• záznam sady (ne-pole, krátký, navíc prvky), id (prázdné, číslo, duplicitní, Unicode, `tier:g`, 65 znaků)<br>• režim (`LINE`, `" line"`, `null`), měny (string, objekt, ne-string před shodou, duplicity, malá písmena, `""`)<br>• zlomy (neseřazené, duplicitní po `floor`, junk hodnota před platnou, délka 1/3+), procenta (−5, −0, 150, 1e-7, 33.335, 99.995)<br>• částky (null, `"500"`, −1, −0, 0.5, 1e13, vnořené pole), pole částek kratší / delší než měny<br>• `global` (číslo, null, pole, neexistující, duplicitní id)<br>• `tierRef` všech typů: number, bool, `[]`, `{}`, −0, velká písmena, mezery, `tier:<id>`, prefix id, Unicode |
| tcount | 15 753 / ~10 000 | několik variant jednoho produktu, dva produkty se stejným id a jiným metapolem, chybějící / číselné / prázdné id produktu, tvar produktu MVP 2 (bez `id`), množství 0 / 2,7 / 1,5 / −1 / `"3"` / null / 2³¹−1, dárky a outlet (`true` i seznam variant), outletWithAnything zap/vyp |
| tties | 7 746 / ~5 000 | pravidla se stejným procentem jako zlom, id pravidel kolem `tier:` (`tier`, `tier:`, `tier;`, `tier:a`, `TIER`, `tier9`, `_x`, `-x` …), priority 0 / ±1 / ±0,5 / `"1"` / 1000, ceny v jednotkách haléřů (remízy `Math.round`) |
| tstack | 7 815 / ~5 000 | 3–10 produktových pravidel, husté combinesWith (víc než 6 kandidátů, ořez poolu), combinesWith s `tier:<id>` i s id sady |
| tmargin | 7 746 / ~5 000 | marže (min / max / `col`, náklady u ceny), objednávka % i fixní, výlučný režim, kódová pravidla a jejich uzly |
| tmsg | 7 882 / ~5 000 | procenta s 3+ desetinnými místy a na hranici zaokrouhlení zprávy, částky v 10 měnách (JPY, KWD, BHD, ISK, HUF, GBP, PLN, XXX …), jazyky CS / SK / EN / DE / `""` / `cs` |
| tnum | 6 212 / 4 000 | 16–17místná čísla a exponenty mimo ±22 v minQty, procentech a částkách (0.9999999999999999, 2.9999999999999996, 1e-320, 1e300 …), množství ≥ 2⁵³ |
| tbig | 469 / 300 | 200–500 řádků, sada s 300 neseřazenými zlomy, 150 sad se 40 id, 60 sad s 22znakovými id |
| twide | 1 846 / 1 200 | 50–75 pravidel s Pro vazbami a úrovně: pravidla + sady > 64 (obecná `stack_search`) |
| tout | 412 / 270 | 200–500 řádků, každý s jinou hodnotou (částka zastropovaná cenou, marže): výstup nad rozpočtem 20 kB |
| tedge | 3 809 / 2 500 | přijatá hrana: produktová, objednávková i kódová pravidla s id `tier:<setId>` |
| sondy | 371 | jedna sémantika na vstup (A–K níže) |
| generátor MVP 2 | 14 346 / 8 000 | rodiny mix, search, search2, junk, big, bigcap (`SHORT=1` i bez) |

Sondy (`scratch/cases/probes`, všech 371 rovno TS):
- **A:** 23 druhů `tierRef` s globální sadou i bez ní, ids `__proto__` / `constructor` / emoji / `Ž` (NFC × NFD), metapole jako pole / string / null, každá kombinace klíčů pro čítač `found < keys` (s `col` i bez);
- **B:** první id vyhrává, neplatný režim před platným, `global` na duplicitu / přeskočenou sadu / ne-string, `tiers` / `sets` ne-objekt / ne-pole, 300 záznamů s 9 id;
- **C:** 40 tvarů zlomů × množství 1 / 2 / 3, nabídnuté vs. nenabízené částky, měny;
- **D:** režimy počítání a klíč produktu;
- **E:** remízy s 14 id a 7 prioritami, pořadí UTF-16 vs. UTF-8 (`tier:￿` vs. `tier:\u{10000}`), pravidlo pojmenované jako zpráva úrovně (seskupení výstupu), dvě sady se stejnou zprávou, remízy `Math.round`;
- **F:** Pro stack vyhrává / remizuje / prohrává, mesh 8 pravidel, combinesWith na `tier:g`;
- **G:** marže a výlučný režim, blokace dopravy;
- **H:** uzly (auto, kód, chybný kód, auto s kódem);
- **I:** zprávy, 16 procent × 2 jazyky, 13 měn, minQty 1 / 2 / 5 / 21 / 101, 9 jazykových kódů;
- **K:** doručení s úrovněmi.

Pokrytí větví (b102–b110, 41 692 uzlů, `scratch/cov-b.txt`; tbig / twide / tout přes `scratch/cov-out.mjs`):

| Větev | Uzlů |
|---|---|
| úroveň vydána automatickým uzlem | 10 437 |
| skupina 2+ řádků: per product / přes košík | 4 700 / 2 377 |
| řádek: globální sada / scoped tierRef / junk nebo `""` / neznámé id / dárek | 20 920 / 15 242 / 7 713 / 9 108 / 12 434 |
| zlom nenabízený v měně košíku (MKT-1) | 10 876 |
| payload: duplicitní id / junk záznam / neseřazené nebo duplicitní zlomy / zlomkové minQty | 7 050 / 6 957 / 10 533 / 9 758 |
| global zadán, ale nepoužitelný | 2 882 |
| úroveň = částka pravidla na řádku (remíza) | 3 740 |
| úroveň porazí pravidlo / Pro stack porazí dosaženou úroveň | 3 313 / 2 066 |
| částka zastropovaná cenou kusu | 2 433 |
| remíza zaokrouhlení procenta úrovně | 1 829 |
| marže zastropí úroveň / řádek s úrovní margin-tight / úroveň + objednávka | 1 481 / 2 309 / 3 683 |
| výlučný přepínač shodí úroveň | 542 |
| outlet řádek dostane úroveň (outletWithAnything) | 796 |
| kódový uzel vydá něco při nastavených úrovních | 3 052 |
| anglická zpráva / zpráva s desetinnou hodnotou / částka mimo CZK | 3 590 / 4 625 / 3 177 |
| pravidla + sady > 64 / z toho Pro stack vydán / úroveň vydána | 953 / 745 / 308 |
| výstup nad rozpočtem s kandidáty úrovně / úroveň vyřazena z výstupu | 111 / 8 |

## Nálezy

Žádné P0, P1 ani P2. Dva nálezy P3, oba jen nad daty, která aplikace nezapisuje.

### P3-1: přijatá hrana „pravidlo s id `tier:<setId>`“: README popisuje rozdíl, který už není vidět, a skutečný rozdíl je jinde (Rust dá víc)

**Co README tvrdí** (`extensions/won-discounts-engine/README.md:625`): TS dovolí úrovni zdědit Pro partnery takového pravidla, Rust ne.
- To už ve výstupu nenastane. Od fix round 2 v T1 je úroveň mimo pool stacku: `plan.ts` `pick` filtruje `module !== "tiers"`, takže zděděné partnery nikdy nepoužije.
- Ověřeno sondami p249 a p250 (stack s pravidlem `tier:g` a jeho partnerem): TS = Rust.

**Skutečný rozdíl.** Platí pro OBJEDNÁVKOVÉ pravidlo (automatické i kódové) s id `tier:<setId>`, když je zapnutá marže.
- TS ho zahodí:
  - `plan.ts:1132-1133` přepíše v `byId` pravidlo pseudo-pravidlem úrovně (produktové, 0 %);
  - `protectOrder` hledá komponenty objednávky přes `ctx.byId.get(c.ruleId)` (`plan-margin.ts:301`), takže počítá 0;
  - `best.amount <= 0` vrátí objednávku `null`. Stejný lookup je v `applyMarginProtection` (`plan-margin.ts:99`).
- Rust bere pravidlo podle indexu (`plan.rs:1263`, `rules[c.rule]`) a objednávku vydá.
- Důsledek: Rust dá víc než reference. Výlučný režim pak navíc přehodí vítěze: TS dá produkty, Rust objednávku.

**Důkaz.** Rodina tedge má 18 rozdílů z 3 809 vstupů. Všech 18 má zapnutou marži a objednávkové pravidlo s takovým id, 16 z nich dává v Rustu víc.
- Bez marže je 0 rozdílů: 90 vstupů, kde TS takovou objednávku vydal, je shodných.
- Minimální repro má 1 řádek CZK, sadu `g` a objednávku `tier:g` 10 % s marží `{min:0, max:100}`. TS dá `{"operations":[]}`, Wasm dá objednávku 10,00 Kč:
```
cd /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/apps/won-discounts/extensions/won-discounts-engine && npx tsx /private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/head/rerun.mjs /private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/repro/p3-edge-order-rule-tier-id.input.json
/Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/bin/function-runner-9.1.2 -f /private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/wasm/official.wasm --export cart-lines-discounts-generate-run --json < /private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/repro/p3-edge-order-rule-tier-id.input.json
```
(`head/rerun.mjs` počítá TS proti snapshotu core 173fe47, ne proti pracovnímu stromu.)

**Dosažitelnost.** Ze stavu aplikace ne: sanitizer dovolí v id pravidla jen `[A-Za-z0-9_-]`, sync takové id nezapíše. Proto P3.

**Návrh** (od nejlevnější):
1. Opravit text README: rozdíl je u objednávkového pravidla pod marží, ne u partnerů úrovně.
2. Lepší: v TS nedávat pseudo-pravidla úrovní do mapy, přes kterou se hledají pravidla. Úrovně mít v samostatné mapě, nebo v `applyMarginProtection` / `protectOrder` brát pravidlo z kandidáta, ne podle id. Hrana tím zmizí celá a z README může vypadnout. Repro pak poslouží jako regresní fixture.

### P3-2: čtení 16–17místných čísel (P3-1 z MVP 2) zasahuje i payload úrovní a může dát celý zlom navíc

- **Příčina.** serde_json (function-runner, nativní harness) čte některá čísla s ≥ 16 platnými číslicemi o 1 ulp jinak než `JSON.parse`. U úrovní to posune `floor`: minQty `0.9999999999999999` přečte Rust jako 1, zlom „Od 1 ks“ se nabídne. TS má `floor` = 0, zlom přeskočí.
  - Stejně tak `2.9999999999999996` → 3.
- **Důkaz.** Všech 25 takových rozdílů (tnum 19, první dávka 6) vysvětlí přepočet TS nad vstupem přečteným přes serde_json (`audit_normalize`). Repro: TS `{"operations":[]}`, Wasm „Od 1 ks −50 %“:
```
/Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/bin/function-runner-9.1.2 -f /private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/wasm/official.wasm --export cart-lines-discounts-generate-run --json < /private/tmp/claude-501/-Users-ondrej-Development-WonCommerce-Apps/f40f0268-3ab4-4a1a-acdc-a03c11a66304/scratchpad/audit-mvp3-drift/repro/p3-number-parse-minqty.input.json
```
- **Dosažitelnost.** Z aplikace ne:
  - formulář přijme minQty jen jako `/^\d{1,6}$/` a procento jako `/^\d{1,3}(?:[.,]\d{1,2})?$/` (`app/components/model/tiers.ts:62,64` v 173fe47);
  - sanitizer minQty floorne (`config/tiers.ts:47`);
  - částky jsou celé minor units;
  - `buildTiersPayload` čísla jen přepíše.
- **Návrh.** Do README „Numbers with 16 or more significant digits“ (`README.md:624`) doplnit payload úrovní. Pin test: `buildTiersPayload` zapisuje jen celá minQty, procenta s ≤ 2 desetinnými místy a celé částky.

### Potvrzené přijaté rozdíly (README), bez nového nálezu

- **Huge money:** 507 rozdílů. Množství nebo součty jsou ≥ 2⁵³, Rust saturuje v `i64` a TS ztrácí přesnost. Patří sem i počet kusů skupiny úrovně, protože množství ≥ 2⁵³ s cenou ≥ 1 minor unit vždy dá i součet ≥ 2⁵³.
- **Number text:** 29 rozdílů jen v textu JSON (`0.0000001` vs. `1e-7`), hodnoty jsou shodné.
- **Lone surrogate:** function-runner odmítne celý vstup („unexpected end of hex escape“). Běh tedy selže a nedá nic, tj. méně, ne víc. Viděno na 2 vygenerovaných vstupech, generátor pak upraven.
- **Junk payload a výkon:** sada s 1 000 zlomy (~9 kB) stojí na 1řádkovém košíku 16,4 % limitu (seřazené) až 17,9 % (sestupné), tj. ~200 instrukcí na bajt. Neseřazená cesta stojí +10 %. Sync takový payload nezapíše, cap 550 B ho zakáže.

## Instrukce a paměť

Rodiny nejsou stavěné na rozpočet, ten pokrývá T2 a jeho stop rule je známá. Slouží jako kontrola, že junk tvary úrovní nemají patologickou cenu:

| Rodina | Max % limitu (škálovaného řádky) | Tvar |
|---|---|---|
| úrovně, náhodné (≤ 30 řádků) | 11,5 % | tcount, 30 řádků |
| tbig | 74,7 % / 70,4 % | 215 / 437 řádků |
| tout | 65,2 % | 300 řádků, výstup nad rozpočtem |
| twide | 27,7 % | 19 řádků, 50–75 pravidel |
| sondy | 38,9 % | 1 řádek, 2 000 neseřazených zlomů (~20 kB configu, nad limitem 10 kB, tedy nedosažitelné) |
| generátor MVP 2 | 58,1 % | bigcap, 436 řádků |

Paměť je max 2 560 kB u úrovní a 2 624 kB u generátoru MVP 2, limit je 10 000 kB. Nikde přes 75 %.

## Co fuzz nepokrývá

- **Skutečná aritmetika a čtení čísel v produkčním Shopify:** stejně jako v MVP 2, model enginu.
- **Části jen v TS:** `tierHint`, outcomes, explain, Vyzkoušet košík, storefront `tiers-core.js`.
- **Duplicitní klíče JSON:** podle README nedosažitelné.
- **Necommitnuté změny pracovního stromu po 08:44.** Jiná práce v nich mění engine-path TS: `describeCappedTierBreak` v `plan-tiers.ts` / `plan-margin.ts` / `describe.ts` a `code-hash.ts`. Audit je na 173fe47. Upozornění: zastropovaná úroveň bude mít v TS jinou zprávu než v Rustu, dokud se změna neportuje. Drift test fixtures to zachytí.
- **Konstruované nejhorší rozpočtové tvary:** T2 (stop rule, cap 550 B).

## Testing gaps

- **`parity.test.js` tierCase má 4–6 pravidel**, takže nikdy nepřekročí 64 pravidel + sad (obecná cesta `stack_search` se šířkou partnerů > 1 slovo). twide to pokrylo (953 vstupů nad 64, 0 rozdílů). Doplnit do parity spolu s opravou `Partners` z review T2.
- **Žádná fixture ani parity case s výstupem nad 20 kB a kandidáty úrovně.** tout má 111 takových vstupů, 0 rozdílů. Stojí za jednu rozpočtovou fixture: degradace a vyřazení kandidáta úrovně.
- **Remízy na hranici id `tier:`** (`tier`, `tier:`, `tier;`, `TIER`, priorita ±1, pořadí UTF-16) jsou jen v sondách tohoto auditu. Parity má id `r0`–`r2` a `zz`.
- **Přijatou hranu P3-1 nedrží žádný test.** Pokud se opraví v TS, repro `p3-edge-order-rule-tier-id` jako fixture.

## Poznámky k průběhu

- **Souběžné změny core.** Od 08:44:16 jiná práce měnila `packages/core` v pracovním stromu, nejdřív sanitizer a payload, od 08:45:33 i engine-path.
  - Všechny TS reference (manifesty) jsou zapsané do 08:45:01.
  - Přepočet všech 89 904 vstupů proti snapshotu 173fe47 dal 0 rozdílů. Porovnání Rust ↔ TS se tedy týká committed TS.
  - Pokrytí a kontroly hranic (TS plán) po 08:45:33 závisí jen na hodnotách, ne na zprávách.
- **Zápis mimo scratch (moje chyba).** Při tvorbě repro jsem kvůli pracovnímu adresáři `npx tsx` v 08:44 zapsal 2 soubory `p3-*.input.json` do kořene `apps/won-discounts/extensions/won-discounts-engine/`. Během sekund jsem je přesunul do `scratch/repro/`.
  - `git status` extension je čistý.
  - V `scratchpad/app-dev.log` v tu dobu není build funkce, jen vite reload souborů core od jiné práce.
  - Doporučuji ověřit, že dev preview běží beze změny.

## Soubory ve scratch

- **Generátory:**
  - `gen3.mjs` (rodiny tjunk, tties, tstack, tmargin, tmsg, tcount, tnum, tbig, twide, tout, tedge);
  - `probes3.mjs` (sondy).
- **Porovnání, klasifikace, pokrytí a invarianty:**
  - `explain3.mjs` (huge / čtení čísel / REAL, Rust víc);
  - `cov3.mjs`, `cov-out.mjs` (pokrytí);
  - `inv3.mjs` (invarianty výstupu);
  - MVP 2 `compare.mjs`, `check.mjs`, `runwasm.mjs`, `instr.mjs` beze změny.
- **Dávky a logy:** `batch3.sh`, `batch2.sh` (generátor MVP 2), `run-all.sh`, `run-more.sh`, `run-m2.sh` a jejich `*.log`.
- **Kopie crate a buildy:**
  - `crate/`: kopie extension z 173fe47 + testy `audit_probe`, `audit_normalize` (jen `#[cfg(test)]`, Wasm se nemění);
  - `wasm/official.wasm` (= dev build);
  - `target-native/`, `target-debug/`, `target-wasm/`.
- **Snapshot core 173fe47:** `head/` s adaptérem přesměrovaným na snapshot, `rerun.mjs` (TS jednoho vstupu), `verify.mjs` (manifest vs. snapshot).
- **Repro a měření:**
  - `repro/`: vstupy k P3-1 a P3-2 a `mk.mjs`;
  - `junkcost/`: cena junk payloadu.
- **Vstupy:** `cases/<dávka>/` + `*.native.txt`, `*.debug.txt`, `*.wasm.json`, `*.compare.json`, `*.explain.json`, `*.check.txt`.
