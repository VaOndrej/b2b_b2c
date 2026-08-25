# Won Toasts — co zbývá do releasu

Stav k 2026-08-23. Zelené brány: `test:packages` 317+18, `test:unit -w won-toasts`
193, `typecheck:apps`, `lint:standalone`. E2E potvrzeno zelené (Ondřej, 22. 8.).

Appka je **feature-complete a otestovaná, ale nenasazená**. Nic z níže uvedeného
není kód, který by chyběl — je to nasazení, obchodní artefakty a jedna nová
komponenta (chatbot).

---

## 1. Deploy — blokuje všechno ostatní

| # | Co | Kde | Kdo |
|---|---|---|---|
| 1.1 | Fly app + Postgres, `fly postgres attach` | `apps/won-toasts/fly.toml` | Ondřej (účet) |
| 1.2 | Secrets: `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | Fly | Ondřej |
| 1.3 | Nahradit placeholdery `application_url`, `auth.redirect_urls`, `app_proxy.url` | `shopify.app.toml:5,72` | já |
| 1.4 | `shopify app deploy` + `fly deploy` | — | společně |
| 1.5 | Distribution: Public (unlisted) nebo Custom, install link | Partner Dashboard | Ondřej |

Postup krok za krokem je v [`apps/won-toasts/DEPLOY.md`](../apps/won-toasts/DEPLOY.md).

## 2. Ověření na živém storu (brána F2)

- **Reálný billing charge.** Dnes `billingBypassed()` platí mimo produkci, takže
  subscribe → charge → cancel nikdy neproběhlo naostro. Ověřit celý cyklus
  včetně `app_subscriptions/update` webhooku.
- **Hands-off běh** na jednom klientském storu, týdny bez zásahu. Tohle je jediný
  pravdivý test „done".
- Ověřit App Bridge latest + session tokens na produkční doméně.

## 3. App Store listing

| Položka | Formát | Stav |
|---|---|---|
| Ikona | 1200×1200 | chybí (návrh SVG udělám, finál na designéra) |
| Screenshoty | ≥3× 1600×900 | udělám Playwrightem z běžícího adminu |
| Název + tagline | 30 / 62 znaků | napíšu z korpusu |
| Feature bullets | 5× 80 znaků | napíšu |
| Popis | ≤500 slov | napíšu |
| Search terms | — | napíšu |
| Demo store URL | veřejný | Ondřej |
| Privacy policy URL | veřejná stránka | draft napíšu, hosting Ondřej |
| Support e-mail + hodiny | povinný e-mail | Ondřej |
| Pricing plán (Free / $5 Pro, 7denní trial) | Partner Dashboard | Ondřej |
| Kategorie + integrace | — | Ondřej |

Podpora **nemusí být 24/7** — Shopify chce jeden kanál, platný e-mail a odpověď
„in a timely manner". Do listingu napsat reálné hodiny, ne 24/7.

## 4. Support chatbot — zatím nepostavený

Dokumentace pro něj je **hotová a zamčená testy**; samotný bot neexistuje.
Architektura a pravidla: [`apps/won-toasts/docs/CHATBOT.md`](../apps/won-toasts/docs/CHATBOT.md).

Zbývá naimplementovat:

1. `support_link` extension → „Get support" v adminu míří na naši routu.
2. `/app/support` — embedded Polaris stránka s chatem.
3. `/api/support/ask` — retrieval nad `docs/dist/corpus.jsonl` (filtry `min_plan`,
   `status`, `lang`) + odpověď Claudem, výhradně z retrievnutých chunků.
4. Eskalace na e-mail, když není jistá odpověď (a vždy u billingu, mazání dat
   a výpadku konkrétního storu).
5. Kontext storu do každého dotazu: embed status, plán, zapnuté recepty a
   `describe` shrnutí. Nahrazuje screenshoty, stojí ~150 tokenů.
6. Nákladové pojistky: `max_tokens` 400, rate limit 20/h a 100/den per shop,
   měsíční strop `$20 + $0,50 × počet Pro storů` s fallbackem na support e-mail,
   logování `usage`.
   Model nákladů: [`won-toasts-chatbot-naklady.md`](won-toasts-chatbot-naklady.md).
7. Embeddings netřeba — 147 chunků zvládne keyword filtr. **Obrázky ve v1 ne**
   (jeden screenshot ≈ 4 800 tokenů proti 1 250 za textový dotaz).

Běží to **celé u nás na Fly**, ve stejném procesu jako appka. Shopify nehostuje nic.
Architektura a pravidla včetně pojistek: [`CHATBOT.md`](../apps/won-toasts/docs/CHATBOT.md).

## 5. Fast-follow (vědomě po releasu)

- **Protected customer data approval** → odkomentovat `orders/create`, rozsvítit
  social proof, order.summary a agregáty. Rozhodnutá cesta (a) z 13. 8.
- **Experimenty / holdout / A-B** — postavené, otestované, zaparkované za
  `EXPERIMENTS_LIVE_TICK_WIRED=false`. Rozsvítit až s reálným order volume.
- **Advanced rule builder UI** — generický `ToastRule[]` místo receptů.
- **Překlad korpusu do cs/sk** — dnes je `lang: en`. Frontmatter i chunky to už
  umí, jde jen o obsah.

## 6. Hygiena repa

- [`won-toasts-build-log.md`](won-toasts-build-log.md) končí u MVP5 (4. 8.),
  realita je o tři týdny dál. Buď dopsat, nebo označit za archiv.
- [`product-roadmap.html`](product-roadmap.html) je z 12. 8. — krok 7 release
  gate chce, aby odpovídal skutečnosti.
