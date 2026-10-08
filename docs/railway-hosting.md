# Hosting Shopify aplikací na Railway

**Stav: připraveno, nenasazeno.** Nic z tohoto souboru neběželo proti skutečnému Railway účtu. Ověřené je jen to,
že `railway.json` obou aplikací odpovídá schématu Railway a že Docker image Won Discounts jde postavit lokálně
(build log MVP 7).

## Co běží kde

| Kus | Kde | Jak se tam dostane |
|---|---|---|
| Admin, webhooky, app proxy, scheduler | Railway služba (Docker image) | push do GitHubu → Railway postaví `apps/<app>/Dockerfile` |
| Databáze | Railway Postgres | `DATABASE_URL` referencí, migrace v pre-deploy kroku |
| Slevová funkce (Wasm), theme extension, config aplikace | Shopify | `shopify app deploy` z počítače s Rustem |

Railway tedy hostuje jen server. Funkce a rozšíření se k němu nenasazují.

## Jeden projekt pro všechny aplikace

Projekt `won-shopify-apps`, prostředí `production`, region EU West (Amsterdam).

| Služba | Zdroj | Config |
|---|---|---|
| `won-discounts` | GitHub `VaOndrej/b2b_b2c`, větev `main` | `/apps/won-discounts/railway.json` |
| `won-discounts-db` | Postgres | — |
| `won-toasts` | stejné repo | `/apps/won-toasts/railway.json` |
| `won-toasts-db` | Postgres | — |

Každá aplikace má vlastní Postgres. Stojí to navíc zhruba půl až jeden dolar měsíčně, ale obnova ze zálohy
jedné aplikace nesáhne na druhou a `DATABASE_URL` je jedna reference bez ručního skládání.

`b2b-companion` zatím připravený není: jeho `Dockerfile` je starý template (SQLite ve volume, build mimo
workspace). Než půjde na Railway, potřebuje stejný Postgres port jako Won Discounts.

## Nastavení služby (jednou, v dashboardu)

Platí pro každou aplikaci, `<app>` je `won-discounts` nebo `won-toasts`.

1. **Source**: repo `VaOndrej/b2b_b2c`, větev `main`.
2. **Root Directory**: nechat prázdné. Aplikace berou `@won/core` a `@won/app-kit` jako zdroják z workspace,
   build potřebuje celé repo.
3. **Config-as-code path**: `/apps/<app>/railway.json`. Cesta je absolutní od kořene repa, Railway ji
   z Root Directory neodvozuje.
4. **Networking**: Generate Domain, port `3000`. Pro ostrý provoz vlastní doména (viz níže).
5. **Variables**:

   ```
   DATABASE_URL=${{<app>-db.DATABASE_URL}}
   SHOPIFY_API_KEY=<client id produkční aplikace>
   SHOPIFY_API_SECRET=<z Partner Dashboardu>
   SHOPIFY_APP_URL=https://<doména služby>
   SCOPES=<scopes ze shopify.app.toml, oddělené čárkou>
   PORT=3000
   ```

   `NODE_ENV=production` a `HOST=0.0.0.0` jsou v image. `WON_DEV_PLAN` nenastavovat.

Zbytek drží `railway.json`: Dockerfile, migrace před nasazením (`prisma migrate deploy`), healthcheck,
jedna replika bez uspávání, restart při pádu, watch patterns (push, který se aplikace netýká, ji nenasadí).

## Jedna replika, pořád zapnutá

Won Discounts drží zámky, frontu synchronizace a scheduler v procesu (`apps/won-discounts/DEPLOY.md`, „One
instance"). Proto `numReplicas: 1` a `sleepApplication: false`. Dvě repliky by pouštěly každou naplánovanou
úlohu dvakrát. Uspaná služba by nestihla konec slevy podle data ani webhook.

## Tarif

Free tarif na ostrý provoz nestačí:

- dává 1 USD kreditu měsíčně a 0,5 GB RAM na službu (dokumentace Railway, 2026-10-04);
- trvale běžící Node server + Postgres vyjde odhadem na 3–6 USD měsíčně za jednu aplikaci (RAM 10 USD/GB,
  CPU 20 USD/vCPU, účtuje se skutečná spotřeba). Odhad, ne měření.

Na vyzkoušení nasazení Free stačit může, dokud kredit nedojde. Pro první obchod počítej s Hobby (5 USD měsíčně,
v ceně 5 USD spotřeby). Kolik projektů Free dovolí vedle `web-platform`, jsem v dokumentaci nenašel, ukáže to
dashboard při zakládání.

## Shopify: produkční aplikace zvlášť

Vývojová aplikace zůstává na `shopify app dev` (tunel, SQLite). Produkční má vlastní `client_id` a vlastní
config:

```bash
cd apps/won-discounts
shopify app config link          # založí shopify.app.production.toml
```

V něm nastavit `application_url`, `auth.redirect_urls` (`https://<doména>/api/auth`) a `app_proxy.url`
(`https://<doména>/won-discounts`) na Railway doménu. Potom:

```bash
PATH="$HOME/.cargo/bin:$PATH" npx shopify app deploy --config production
```

Doménu zvol před prvním obchodem a neměň ji. URL aplikace je zapsaná u Shopify i v app proxy, změna znamená
nový `shopify app deploy` a výpadek mezi oběma kroky. Proto vlastní doména (např. `discounts.<tvoje-doména>`)
místo `*.up.railway.app`.

## Pořadí prvního nasazení

1. Release gate aplikace (`apps/<app>/DEPLOY.md`, oddíl „Release gate").
2. Railway: projekt, Postgres, služba, proměnné, doména.
3. První deploy z Railway, `https://<doména>/healthz` vrací `ok` (Won Discounts).
4. `shopify app deploy --config production`.
5. Instalace na obchod, jedno otevření aplikace, onboarding, zkušební košík.

## Co zůstává z Fly.io

`fly.toml` v obou aplikacích zůstal beze změny, plány a audit MVP 7 se na něj odkazují. Je to nepoužitá
alternativa nad stejným `Dockerfile`. Až bude Railway nasazené a ověřené, dá se smazat spolu s Fly kroky
v `DEPLOY.md`.

## Kapacita jedné repliky (měřeno 2026-10-04)

Měřeno lokálně, ne na Railway: produkční build (`react-router-serve`), Apple M4, SQLite, Shopify Admin API
nahrazené lokální odpovědí, podepsané app proxy požadavky na `/won-discounts/cart-plan`, košík o 3 řádcích,
teplá cache, `autocannon` 15 s.

| Souběžných spojení | Požadavků/s | p50 | p99 | Chyby |
|---|---|---|---|---|
| 10 | 4 399 | 2 ms | 3 ms | 0 |
| 50 | 4 273 | 11 ms | 16 ms | 0 |
| 200 | 4 048 | 48 ms | 67 ms | 0 |

Samotný výpočet plánu (bez HTTP a session): 44 µs pro košík do 5 řádků, 88 µs pro 100 řádků. Paměť procesu
111 MB po startu, 338 MB po zátěži.

Railway bude pomalejší (sdílené vCPU, Postgres po síti místo SQLite na disku). Odhad, ne měření: stovky až
nízké tisíce požadavků za sekundu. Tisíc obchodů po 2 000 změnách košíku denně dělá v průměru 23 požadavků
za sekundu, takže výkon serveru strop není.

Strop je jinde:

- **30 čtení Shopify za minutu na obchod** (`CART_PLAN_READS_PER_MINUTE`). Změřeno před úpravou cache: ze 100
  košíků s dosud neviděnou variantou dostalo odpověď 29, zbylých 71 skončilo 429 a nápověda se nezobrazila.
  Limit zůstává jako pojistka. Od 2026-10-04 si ale server načtená data pamatuje 10 minut místo jedné a zahodí
  je ve chvíli, kdy do obchodu sám zapíše (synchronizace, zrcadlo nákupních cen, výprodej), takže čtení je
  potřeba jen pro variantu, kterou za posledních 10 minut nikdo v košíku neměl.
- **Cache**: nejvýš 2 000 variant na obchod a 100 000 záznamů celkem (`CART_PLAN_SHOP_MAX`,
  `CART_PLAN_CACHE_MAX`). Velký katalog jednoho obchodu nevytlačí ostatní. Cache žije v paměti procesu, další
  důvod pro jednu repliku.
- **Ladicí logování** v `packages/app-kit/src/shopify.server.ts` (`LogSeverity.Debug`, `httpRequests: true`)
  zapsalo 77 MB logu za 45 s zátěže a do logu jde hlavička `X-Shopify-Access-Token` v čitelné podobě.
  Před prvním nasazením vypnout.
