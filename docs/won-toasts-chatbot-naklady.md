# Won Toasts chatbot — model nákladů

Podklad: `apps/won-toasts/docs/dist/corpus.jsonl` — 147 chunků, 45 725 znaků
textu, průměr 311 znaků, medián 276. Anglický markdown ≈ 3,7 znaku na token →
**celý korpus ≈ 12–13 tis. tokenů**.

Ceny (Anthropic API, listovní, k 2026-06-24 — před spuštěním ověřit):

| Model | Vstup / 1M | Výstup / 1M |
|---|---|---|
| Claude Opus 5 | $5 | $25 |
| Claude Sonnet 5 | $3 | $15 (do 31. 8. 2026 zaváděcí $2 / $10) |
| Claude Haiku 4.5 | $1 | $5 |

Kurz níže počítám 23 Kč/$.

## Skladba jednoho dotazu

Retrieval variantou (top ~8 chunků, což je při průměru 85 tokenů na chunk
zhruba 700 tokenů) vychází jeden dotaz na:

- systémový prompt s pravidly odpovídání: ~500 tokenů
- retrievnuté chunky: ~700 tokenů
- otázka merchanta: ~50 tokenů
- **vstup celkem ≈ 1 250 tokenů**
- odpověď: ~250 tokenů (při `max_tokens` 400 a instrukci na stručnost)

| Model | Vstup | Výstup | Celkem / dotaz |
|---|---|---|---|
| Haiku 4.5 | $0,0013 | $0,0013 | **$0,0026** ≈ 0,06 Kč |
| Sonnet 5 | $0,0038 | $0,0038 | **$0,0076** ≈ 0,17 Kč |
| Opus 5 | $0,0063 | $0,0063 | **$0,0126** ≈ 0,29 Kč |

Zhruba polovina ceny je výstup — délka odpovědi je nejsilnější páka, ne velikost
korpusu.

## Měsíčně

Počítáno na jeden dotaz; konverzace o třech výměnách stojí zhruba dvojnásobek
(historie se posílá znovu každý turn).

| Dotazů / měsíc | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|
| 500 | $1,3 (~30 Kč) | $3,8 (~87 Kč) | $6,3 (~145 Kč) |
| 2 000 | $5,2 (~120 Kč) | $15 (~350 Kč) | $25 (~580 Kč) |
| 10 000 | $26 (~600 Kč) | $76 (~1 750 Kč) | $126 (~2 900 Kč) |

Pro srovnání: Pro tarif je $5/měsíc. Jeden merchant na Pro utratí za support
chatbota na Sonnetu zhruba 0,17 Kč za dotaz — musel by se ptát ~600× měsíčně,
aby ti chatbot sežral celé předplatné.

## Varianta bez retrievalu

Korpus je tak malý, že se vejde do promptu celý — žádná vektorová databáze,
žádný embedding krok (Anthropic embeddings API stejně nemá; pro 147 chunků
stačí keyword filtr).

Celý korpus v promptu = ~13 000 tokenů vstupu na dotaz:

- **s prompt cachingem a hustým provozem** (dotazy častěji než 5 min od sebe):
  cache read je 0,1× → Sonnet $0,0078/dotaz, tedy prakticky stejně jako retrieval
- **s řídkým provozem** (pár dotazů denně): cache vyprší mezi dotazy, platíš
  plný vstup, a navíc 1,25× při zápisu → Sonnet ~$0,05/dotaz, **šestkrát dráž**

Řídký provoz je realistický scénář prvních měsíců, takže retrieval je bezpečnější
volba: cena nezávisí na tom, jak často se kdo ptá.

Pozn.: systémový prompt (~500 tokenů) je pod minimem pro cachování (Sonnet 5:
1024 tokenů, Opus 5: 512), takže u retrieval varianty se cachovat stejně nedá
a není proč.

## Co skutečně ohrožuje rozpočet

Ne běžný provoz, ale zneužití. Bez limitů může kdokoliv s přístupem do adminu
poslat tisíce dotazů.

1. **Rate limit per shop** — např. 20 dotazů za hodinu, 100 za den.
2. **Tvrdý `max_tokens`** (400) a instrukce na stručnost.
3. **Měsíční strop na celou appku** s alertem; po překročení chatbot odpovídá
   „napište nám na e-mail" místo volání modelu.
4. **Logovat `usage` z každé odpovědi** do stejné tabulky jako Insights —
   bez měření je jakýkoliv odhad výše jen odhad.

## Doporučení

Sonnet 5 jako výchozí model s retrievalem. Haiku 4.5 je 3× levnější a na
odpovídání z 8 retrievnutých chunků by nejspíš stačil — ale u supportu je cena
chyby vyšší než rozdíl 0,11 Kč na dotaz. Reálná čísla po prvním měsíci ukážou,
jestli se vyplatí přepnout.
