# Won Companion: konkurence na Shopify App Store

**Aktualizace 1. 10. 2026:** sekce 1–6 jsou historický průzkum z 28.–29. 9., nikoli aktuální
spec Companiona. Rozhodnutí nyní: 14 dní zdarma → Basic $10 / Pro $30 měsíčně, bez povinné
integrace s Won Discounts. Doplňující kvalitativní analýza hodnoty, pozitivních zkušeností
a ochoty přejít je v sekci 7. Údaje konkurentů nejsou plošně přeměřené pro celý původní seznam.

Stav k 28. 9. 2026. Všechna čísla (hodnocení, počty recenzí, ceny, BFS) jsou přečtená ten den z živých listingů na apps.shopify.com, případně z ceníku na webu vývojáře. Co z živé stránky ověřit nešlo, je označené jako **neověřeno**.

Jak jsem data sbíral:
- BFS: odznak „Built for Shopify“ v hlavičce listingu, ne v kartách podobných aplikací.
- 1–2★: počty z filtru recenzí. Stížnosti jsem vybral z nejnovějších 20 recenzí s 1–2★ u každé aplikace.
- Plochy a zdroje doporučení: z popisu v listingu, z tagů funkcí a z dokumentace, kde je to uvedené.
- Listing při čtení z české IP ukazuje u Aftersell, Kaching Bundles, UpCart a Search & Discovery štítek „Popular with stores like yours · Based in Czech Republic“. **Oprava 1. 10.: personalizovaný štítek nedokládá český tržní podíl ani rozšířenost.**

Zkratky: PDP = produktová stránka, ATC popup = popup po přidání do košíku, TY = thank-you / order status stránka, PP = one-click post-purchase stránka, Plus = jen pro Shopify Plus.

## 1. Souhrnná tabulka

| App (vývojář, sídlo) | Hodnocení / recenze (1–2★) | Cenový model | BFS | Plochy | Zdroje doporučení | Bundly |
|---|---|---|---|---|---|---|
| **Candy Rack** (Digismoothie, Praha) | 4,9 / 262 (2) | Podle počtu objednávek obchodu: $29.99 (0–50) → $399.99 (5 000+). Upsell tržby neomezené. Free jen pro dev/trial obchody | ano | ATC popup, PDP embed, vlastní drawer, popup při kliknutí na checkout, checkout, PP, TY | ruční, Shopify Product Recommendations, Candy Rack AI, Google Gemini | ano (volume bundly, quantity breaks) |
| **Rebuy** | 4,7 / 852 (29) | Podle objednávek, balíčky od $25/měs. za balíček, Platform One $534/měs. Monetize zdarma = reklamy na TY | ne | PDP, Smart Cart drawer, košík, checkout, PP, TY, stránka účtu, re-order landing (email/SMS) | AI, ruční pravidla, top sellers, „Buy it again“ | ano |
| **ReConvert** (Upsell.com) | 4,8 / 3 094 (81) | Free do 50 obj. nebo $50 upsell tržby; Growth od $9.99, pak metrováno „objednávky obchodu nebo upsell tržba, co je vyšší“; Scale $199, Elite $499 | ne | PDP, košík/drawer, popup, checkout (Plus), PP, TY | AI, ruční, FBT | ano |
| **Aftersell** (Rokt) | 4,8 / 1 062 (34) | Podle objednávek: Post-Purchase $34.99 (200 obj., strop $999.99), Pre-Purchase $59.99, Complete $79.99 (500 obj., strop $1 359.99). Rokt Thanks = reklamy na TY | ano | PDP, AI drawer, checkout (Plus), PP, TY | ruční, recommendation engine (jen Complete) | ne (add-ony, upgrady) |
| **Selleasy** (Logbase) | 4,9 / 2 728 (31) | Podle všech objednávek obchodu: $0 (≤50), $9 (≤500), $19 (≤1 000), $29 (1 000+) | ano | PDP (FBT, add-ony, popup), drawer, popup v košíku, checkout, PP, TY/order status | ruční, automatické komplementární, AI (50 AI doporučení zdarma) | ano (FBT) |
| **Frequently Bought Together** (Code Black Belt) | 4,9 / 1 203 (14) | Free (max 3 ruční bundly); $14.99 (≤50 obj.), $19.99 (≤500), $39.99 (500+) | ano | PDP, košík | AI, ruční, globální | ano (4 typy slev) |
| **Also Bought** (Code Black Belt) | 4,8 / 373 (3) | **Flat $19.99/měs.**, bez limitu objednávek a trafficu | ano | PDP, košík | automatické z historie objednávek, ruční, naposledy viděné, podle typu/kolekce | ne |
| **In Cart Upsell** | 4,8 / 584 (18) | Podle Shopify plánu, flat: $9.99 / $19.99 / $49.99. Free = 1 nabídka + watermark | ne | PDP, košík/drawer, popup při kliknutí na checkout, PP, TY | ruční pravidla, „AI autopilot“ | okrajově |
| **UFE** | 4,8 / 499 (17) | Free ≤50 obj.; „Pay Per Use“ od $9.99 (usage, přesný vzorec **neověřeno**); Unlimited $299 | ne | PDP popup/in-page, košík, TY, „aftersale“ | ruční, AI | ano (bundly, volume, BOGO) |
| **iCart** | 4,7 / 451 (19) | Podle objednávek: free prvních 100 obj., $9 (0–100), $19 (101–200), $29 (201–500) | ne | drawer, cart popup, stránka košíku, PDP | AI + ruční | ano |
| **UpCart** (Rokt) | 4,8 / 944 (45) | Podle objednávek: $29.99 (≤200), $34.99 (≤500), $54.99 (≤1 000) | ano | drawer | ruční, AI (tag) | ne |
| **Kaching Bundles** | 5,0 / 6 077 (43) | Podle přidané tržby: $14.99 (≤$1k), $29.99 (≤$5k), $59.99 (≤$10k), dál výš | ano | PDP (quantity breaks, bundly) | ruční | ano (jádro) |
| **Kaching Cart Drawer** | 5,0 / 1 416 (7) | Podle objednávek: $9.99 (99), $14.99 (199), $24.99 (499) | ano | drawer | FBT slider (podle recenze AI chybí) | ne |
| **Fast Bundle** | 5,0 / 3 473 (24) | Podle tržby z bundlů: $19 (≤$1k), $49 (≤$3k), $139 (≤$10k), auto-detekce +$49 | ne | PDP bundly, FBT, drawer, POS | AI FBT, ruční | ano |
| **Bundler** | 4,9 / 2 697 (27) | **Free pro všechny**; $9.99 / $19.99, bez limitu tržeb | ano | PDP, landing stránky, POS | ruční | ano |
| **Wiser** | 4,9 / 558 (7) | Podle objednávek: free (0–50), $9 (51–100), $19 (101–300), $49 (301–500) | ne | homepage, PDP, drawer, checkout, PP, TY | AI FBT, ruční, meta/tagy, bestsellery, naposledy viděné | ano |
| **LimeSpot** | 4,6 / 507 (29) | Turbo podle objednávek ($9.99 → $19.99 do 250 obj.); Max podle tržby obchodu ($50 → $150 při $50k) | ne | všechny stránky, checkout, PP, email/SMS (Max) | AI personalizace, ruční, segmenty (Max) | ano |
| **Glood** | 4,7 / 123 (9) | Podle zobrazení widgetu: free (základ), $19.99 (10k zobrazení), $69.99 (100k), $299.99; nad limit $1 za 1–2k zobrazení | ne | PDP, mini cart, checkout (až tarif $299.99), TY | AI podle chování, FBT, pravidla (Pro), trending | ano (Pro) |
| **Zoorix** | 4,9 / 389 (3) | Free s brandingem; $7.99–$29.99 podle tržby přes Zoorix | ne | PDP, drawer | AI cross-sell, ruční | ano |
| **Vitals** (40+ nástrojů) | 4,9 / 2 953 (29) | $29.99 + usage od cca $1 000 přičtených tržeb (od $10) | ano | PDP bundly, drawer, popupy | ruční | ano |
| **Honeycomb** | 4,6 / 161 (6) | Podle zobrazení funnelu: free 100, $54.99 (2 000), $109.99 (5 000), $169.99 (10 000) | ne | PDP, košík, checkout (Plus), PP, TY | ruční, autopilot AI | okrajově |
| **Zipify OCU** | 4,6 / 565 (40) | Podle upsell tržby: $9.95 (≤$200), $25–99 ($200–2 500), od $149, strop $999 | ano | PDP, drawer/košík, checkout (Plus), PP, TY (PostProfit) | ruční, Dynamic AI, cílení podle customer tagů | ne |
| **Shopify Search & Discovery** | 2,7 / 505 (140) | **$0** | – (first-party) | jen PDP, sekce v šabloně | related: automaticky (historie nákupů, popis, kolekce); complementary: ručně, max 10 na produkt | ne |
| **Reroute** (niche, vyprodané zboží) | 5,0 / 3 | Free (10 produktů), $6.99 (100), $14.99 (neomezeně), flat | ne | PDP (inline/popup) | ruční mapování, Shopify Recommendations API | ne |

Mimo hlavní srovnání:
- **Monk**: listing `apps.shopify.com/monk-cart-upsell-cross-sell` vrací 404. Z App Store zmizel.
- **Nosto** (4,7/61) a **Visely** (5,0/33, od $199): enterprise vyhledávání a personalizace, jiný segment.
- **Essential Upsell** (5,0/2 399, BFS): metruje přidanou tržbu ($9.99 do $500, $39.99 bez limitu).
- **Candy Cart** (Digismoothie): popup při checkoutu, flat podle Shopify plánu $19.99–99.99.

## 2. Aplikace po jedné

**Candy Rack**: nejbližší přímý konkurent, a to i lokálně
- Pražská firma, admin v češtině, BFS, 4,9. Má ATC popup, výměnu za „better or bigger item“ (volba „Remove parent product when upsell product is added“) a jako zdroj i Shopify Product Recommendations. To kryje velkou část plánu Won.
- Cena roste s objednávkami celého obchodu, ne s upsell tržbou. Na živém obchodě chybí free tarif, nejlevnější je $29.99.
- Obě 1★ recenze (jedna z CZ, Snuffstore.eu) si stěžují na slíbený free plán, který platí jen pro dev/trial obchody.
- A/B testy dělá přes Intelligems, tedy přes další placenou aplikaci. Holdout přímo v aplikaci neuvádí.

**Rebuy**: prémiová platforma pro velké DTC
- Nejširší rozsah: Smart Cart, checkout, PP, „Buy it again“ z historie objednávek, A/B testy i s variantou „bez widgetu“ (holdout).
- Stížnosti na cenu: inzeruje $25/měs., po instalaci přijde nabídka kolem $1k/měs. Recenze zmiňují i $999/měs. a přeúčtování.
- Nasazení rozbilo košík (Safari bug, odhad ztráty $25k; deployment, po kterém nešel dokončit nákup). Nastavení je složité, podpora slabá.
- Free „post-purchase offers“ jsou reklamy třetích stran (Rebuy Monetize, $0.20–0.35 na objednávku).

**ReConvert / Upsell.com**
- Nejvíc recenzí v kategorii (3 094). Kryje PDP až TY.
- Účtuje podle všech objednávek obchodu, včetně POS. Po trialu přicházejí nečekané faktury $400–900. V jednom případě byly poplatky vyšší než upsell tržba (€424 proti €340).
- 2026: několik 1★ recenzí popisuje affiliate reklamy (booking.com, Capital One) na TY/checkout zapnuté bez souhlasu obchodníka.

**Aftersell (Rokt)**
- BFS, silný v PP a TY. Mezi CZ obchody populární.
- Cena roste s objednávkami obchodu, ne s výsledkem („I was charged $149.99 because my store grew“). Recenze zmiňují i poplatek za objednávku.
- PP upsell nefunguje s Apple Pay, Shop Pay ani Google Pay. Recenze uvádějí i účtování po ukončení používání.
- Rokt Thanks = reklamy na TY ($0.30–0.80 na objednávku).

**Selleasy**
- Rozsahem skoro 1:1 s Won (FBT, add-ony, popup, drawer, TY). Levný ($9 do 500 objednávek), BFS.
- Po 50 objednávkách účtuje podle všech objednávek obchodu. Ceny se měnily ($8.99 → $16.99 → $19).
- Po odinstalaci nebo špatné recenzi agresivně kontaktuje obchodníka. Jeden případ checkoutu za $0 u kola za $1 199.

**Frequently Bought Together (CBB)**
- Referenční FBT widget: AI i ruční bundly se slevami, hvězdičky z Judge.me a Loox.
- Stížnosti: ruční bundly se špatně zakládají a vykázané tržby obchodníci zpochybňují („ventas... falsas“).

**Also Bought (CBB)**
- Jediný zavedený hráč s čistě flat cenou ($19.99, bez limitů). Doporučení z historie objednávek. Bundly ani slevy nemá.
- Málo 1–2★ recenzí (3). Jedna si stěžuje na pomalé načítání doporučení v košíku (5+ min).

**In Cart Upsell**
- Flat cena podle Shopify plánu, neomezené objednávky. Kryje PDP, košík, popup při checkoutu i PP.
- Opakované chyby (nabídky se nezobrazují, černá obrazovka), zpomalení webu, podpora odpovídá pomalu.

**UFE**
- Účtuje podle všech objednávek včetně POS. Účtuje i po odinstalaci.
- TY nabídky přestaly fungovat po změnách TY stránky na straně Shopify a obchodníky nikdo neupozornil.

**iCart / UpCart / Kaching Cart Drawer** (cart drawery s upsellem)
- Všechny nahrazují košík. Odtud opakované stížnosti: zbylý kód po odinstalaci, rozbitý košík (i o BFCM), nekompatibilita s tématy (UpCart: Horizon, Impact), zoom na iOS.
- UpCart: jedna 1★ recenze vadí, že upsell přidává produkt, místo aby ho vyměnil.

**Kaching Bundles / Fast Bundle / Bundler** (bundly a quantity breaks)
- Pro doplňky stravy relevantní kvůli „kup 2–3 balení“. Konkurují tak bigger-pack swapu nepřímo, přes množstevní slevy na PDP.
- Kaching: cena roste s tržbou až na $300/měs., podpora se v 2026 zhoršila, chyba s vnucenou špatnou variantou.
- Fast Bundle: počítá tržbu celých objednávek s bundlem, ne přírůstek (až $299/měs.). Přidání do košíku zpožďuje asi 3 s. Podle recenze ze 8/2026 byl dočasně stažen z App Store (**neověřeno**, listing 28. 9. funguje).
- Bundler: funkce free tarifu jsou ve skutečnosti za paywallem a nepodporuje Translate & Adapt.

**Wiser / LimeSpot / Glood** (AI doporučení)
- Wiser účtuje podle všech objednávek. Obchodníci si stěžují na „procento ze všech prodejů“ a na funkce za paywallem.
- LimeSpot má nejhorší poměr stížností na účtování (tržba obchodu → $348–587/měs., jednou $10k). Připisuje si tržby, ukazuje draft a archivované produkty.
- Glood: poplatky za zobrazení nad limit (+$107), slabá relevance doporučení, pomalá podpora.

**Zipify OCU / Honeycomb** (funnely)
- Zipify metruje upsell tržbu až do stropu $999. Má výpadky zachycení plateb u upsellu a PP nepodporuje Apple Pay ani Klarnu. PostProfit = nabídky na TY, u kterých není jasné, zda jde o třetí strany (**neověřeno**).
- Honeycomb metruje zobrazení funnelu. Jedna recenze: popupy u ad-driven obchodu s jedním produktem výrazně snížily CVR.

**Shopify Search & Discovery**: nulová cenová kotva
- Complementary jsou jen ruční, max 10 na produkt, jen PDP a jen v tématech s podporou. Related generuje automaticky.
- 2,7★: 1–2★ recenze míří na regresi vyhledávání od 6/2026 a limit 25 filtrů, ne na doporučení.
- Podle komunity nezobrazuje doporučení u vyprodaných produktů (**neověřeno** na živém obchodě).

## 3. Mezery na trhu

Hypotézy mezer podle listingů a negativních recenzí; absence v listingu nedokazuje absenci funkce a recenze nedokazuje četnost chyby:
1. **Férové účtování.** Nejčastější stížnost napříč kategorií: platí se z objednávek nebo tržby celého obchodu, ne z toho, co aplikace přinesla (ReConvert, UFE, Wiser, LimeSpot, Selleasy, Aftersell, Fast Bundle). Flat cenu mají jen menší nebo užší aplikace (Also Bought, In Cart Upsell, Bundler, Candy Cart). Flat cenu s rozsahem popup + košík + PDP + FBT + TY jsem nenašel.
2. **Důvěryhodné měření.** Obchodníci zpochybňují vykázané tržby (LimeSpot, Wiser, FBT CBB). Kontrolní skupinu bez widgetu nabízí jen Rebuy, a to v placeném balíčku Flows & A/B Testing, a Candy Rack přes placený Intelligems. Holdout jako standard v SMB ceně chybí.
3. **Reklamy třetích stran na TY.** Rebuy Monetize, Aftersell/Rokt Thanks, ReConvert (podle recenzí bez souhlasu), Zipify PostProfit (**neověřeno**). U zdravotních a supplement značek je to riziko pro důvěru. Postoj „žádné cizí reklamy“ je jasně odlišující.
4. **Rozbité téma a košík.** Aplikace, které nahrazují drawer, způsobují opakované výpadky a nechávají po sobě kód. Doporučení jako blok v existujícím košíku přes theme app extension je argument. To, jak Won řeší drawer, je třeba rozhodnout.
5. **Relevance.** Stížnosti na nesmyslná doporučení (draft a archivované produkty, nepodobné zboží). Explicitní pravidlo „radši nic než špatné doporučení“ (práh kvality, skrytí widgetu) jsem v listinzích nenašel.
6. **Vyprodané zboží.** Náhradu za vyprodaný produkt řeší jen niche aplikace Reroute (3 recenze, 03/2026). V upsell sadách to nenabízí nikdo.
7. **Recenze jsou nafouknuté.** Několik 1★ recenzí popisuje žebrání o úpravu hodnocení (Honeycomb, LimeSpot, Selleasy, Vitals). Hodnocení 4,8–5,0 proto nic neodlišuje.

Won Companion: unikátní vs. parita

| Funkce Won | Stav | Kdo už to má |
|---|---|---|
| ATC popup / bottom sheet s 1-click přidáním | parita | Candy Rack, Selleasy, UFE, Honeycomb, In Cart Upsell |
| Doporučení z **celého košíku** v popupu | možná unikátní (**neověřeno**) | Candy Rack spouští popup podle přidaného produktu. Cart-level logiku nemá doloženou žádná SMB aplikace |
| Doporučení v košíku a draweru | parita | skoro všichni |
| PDP „related“ | parita, a zdarma v S&D | S&D, Also Bought, Wiser, Glood… |
| FBT widget s checkboxy a „přidat vše“ | parita | FBT CBB, Selleasy, Wiser, Glood, Fast Bundle |
| Bigger-pack swap (výměna řádku) | parita s Candy Rackem | Candy Rack (true upsell/upgrade), Aftersell (checkout upgrade, jen Plus). Ostatní jen přidávají |
| Náhrada vyprodaného zboží | téměř unikátní v sadě | jen Reroute (niche) |
| Krátký ručně psaný důvod u páru | v listinzích nenalezeno | – |
| Cold start ze Shopify signálů | parita | Candy Rack, Essential Cart Drawer, Reroute |
| Buy again | parita s Rebuy | Rebuy (Buy it again, shoppable order history) |
| TY doporučení | parita | Selleasy, ReConvert, Aftersell, Wiser, Zipify, Honeycomb |
| Prázdný košík | **neověřeno** | v listinzích nenalezeno výslovně |
| Co-occurrence FBT z objednávek | parita | Also Bought, FBT CBB, Wiser, Shopify related |
| Segmentové cílení | parita | Zipify (customer tags), LimeSpot Max, ReConvert |
| Holdout měření | vzácné | Rebuy (placený balíček), Candy Rack přes Intelligems |
| Flat cena bez meteringu + bez cizích reklam | odlišující kombinace | flat mají jen užší aplikace |
| CZ/SK admin a podpora | ne unikátní | Candy Rack (CZ admin, Praha), Essential Upsell (CZ admin) |

Rizika:
- Candy Rack je česká firma s BFS a rozsahem, který kryje popup, swap a Shopify recs. Won se proti němu musí odlišit cenou (free tarif, flat), holdoutem, cart-level logikou a vertikálou, ne funkcemi.
- Aftersell PP nefunguje s wallety. Jestli Won bude dělat PP, nebo jen TY, je otevřené rozhodnutí. PP má stejná omezení platebních metod pro všechny aplikace (Shopify docs).
- Popup může snížit CVR (recenze Honeycomb). Holdout to u Won zachytí, což lze prodávat jako výhodu.

## 4. Cenové kotvy

Typický CZ/SK supplement obchod s 200–500 objednávkami měsíčně:
- $0: Shopify S&D (jen PDP, ručně), free tarify Selleasy/Wiser/ReConvert do 50 objednávek, Bundler, Zoorix s brandingem.
- $9–20: Selleasy $9, iCart $19–29, Wiser $19–49, FBT CBB $19.99, Also Bought $19.99 flat, In Cart Upsell $9.99–19.99 flat.
- $30–60: Candy Rack $39.99 (51–200) / $59.99 (201–500), UpCart $29.99–34.99, Honeycomb $54.99, Kaching Bundles $29.99–59.99.
- $80+: Aftersell Complete $79.99 (500 obj.), Rebuy podle recenzí stovky $ až $999, ReConvert Scale $199, Glood Plus $299.99.
- Závěr: za rozsah „popup + košík + PDP + FBT + TY“ se v SMB běžně platí **$20–60/měs.**, pro 200–500 objednávek. Candy Rack drží horní hranici SMB pásma. Flat cena kolem $19–29 za Pro by byla pod Candy Rackem a na úrovni Also Bought, se širším rozsahem.

## 5. Zdroje

Listingy (hodnocení, počty recenzí, ceník, BFS, funkce), vše čteno 28. 9. 2026:
- https://apps.shopify.com/candyrack
- https://apps.shopify.com/rebuy
- https://apps.shopify.com/reconvert-upsell-cross-sell
- https://apps.shopify.com/aftersell
- https://apps.shopify.com/upsell-cross-sell-kit-1 (Selleasy)
- https://apps.shopify.com/frequently-bought-together
- https://apps.shopify.com/also-bought
- https://apps.shopify.com/in-cart-upsell
- https://apps.shopify.com/upsell-funnel-engine-upsells (UFE)
- https://apps.shopify.com/icart
- https://apps.shopify.com/upcart-cart-builder
- https://apps.shopify.com/bundle-deals (Kaching Bundles)
- https://apps.shopify.com/cart-upsell (Kaching Cart Drawer)
- https://apps.shopify.com/fast-bundle-product-bundles
- https://apps.shopify.com/bundler-product-bundles
- https://apps.shopify.com/recommended-products-wiser
- https://apps.shopify.com/limespot
- https://apps.shopify.com/recommendation-kit (Glood)
- https://apps.shopify.com/zoorix
- https://apps.shopify.com/vitals
- https://apps.shopify.com/honeycomb-upsell-funnels
- https://apps.shopify.com/zipify-oneclickupsell
- https://apps.shopify.com/search-and-discovery
- https://apps.shopify.com/reroute
- https://apps.shopify.com/essential-post-purchase-upsell
- https://apps.shopify.com/essential-cart-drawer
- https://apps.shopify.com/candy-cart
- https://apps.shopify.com/nosto-personalization-for-shopify
- https://apps.shopify.com/visely
- https://apps.shopify.com/monk-cart-upsell-cross-sell (404)

Recenze 1–2★ (stížnosti, počty): `https://apps.shopify.com/<slug>/reviews?ratings[]=1&ratings[]=2&sort_by=newest`, strany 1–2 pro každý slug výše.

Ceníky a dokumentace mimo listing:
- Candy Rack, všechny tarify a výměna za větší položku: https://www.digismoothie.com/apps/candy-rack
- Candy Rack, umístění a ATC popup: https://help.digismoothie.com/en/articles/5595517-learn-more-about-placements-in-candy-rack
- Candy Rack, true upsells (výměna rodiče): https://www.digismoothie.com/blog/candy-rack-true-upsells (**neověřeno** přímým čtením, obsah z výsledku vyhledávání)
- Rebuy, ceník ($25 za balíček, Platform One $534, Monetize): https://www.rebuyengine.com/pricing
- Rebuy, A/B test i bez widgetu: https://help.rebuyengine.com/en/articles/8053750-rebuy-s-a-b-testing
- Rebuy, Buy it again: https://help.rebuyengine.com/en/articles/6128112-create-a-shoppable-order-history-on-the-customer-account-page (**neověřeno** přímým čtením)
- Aftersell, ceník, stropy, Rokt Thanks: https://www.aftersell.com/pricing
- Upsell.com / ReConvert, ceník: https://www.upsell.com/pricing (Growth uveden jako „Free“, listing uvádí $9.99; rozpor)
- Shopify, related a complementary, limit 10: https://help.shopify.com/en/manual/online-store/search-and-discovery/product-recommendations

## 6. Candy Rack detailně (čteno 29. 9. 2026)

Zdroj: https://apps.shopify.com/candyrack, https://www.digismoothie.com/apps/candy-rack

- **Rozsah je Companion + Won Discounts dohromady:** 8 ploch (PDP embed, ATC popup, vlastní slide cart,
  popup při kliknutí na checkout, checkout jen Plus, stránka po platbě, Děkujeme + Stav objednávky),
  množstevní slevy až 10 úrovní, dárky zdarma, doprava zdarma, slevy, BOGO, záruky, pojištění zásilky,
  balení jako dárek, announcement bar, progress bar.
- **Doporučení:** Candy Rack AI, Google Gemini nebo Shopify product recommendations; ruční výběr
  produktů a kolekcí. AI píše i popisy nabídek.
- **Měření:** dashboard zobrazení, prodeje, AOV po nabídce / produktu / ploše. A/B test jen přes
  Intelligems (samostatná aplikace) a jen pro nabídky před checkoutem.
- **Košík:** vlastní slide cart (nahrazuje drawer tématu).
- **Ceník:** všechny tarify mají stejné funkce, liší se jen počtem objednávek obchodu: $29.99 (0–50),
  $39.99 (51–200), $59.99 (201–500), $79.99 (501–1 000), $99.99 (1 001–2 000), $199.99, $299.99,
  $399.99, Enterprise. Free jen dev/trial obchody. 8 dní trial, 60 dní money-back.
- **Jazyky:** 13 včetně češtiny. Vývojář Digismoothie, Praha, na trhu od 2018.

## 7. Co si obchodníci skutečně kupují — doplnění 1. 10. 2026

### Metodika a otázky

Cíl: posoudit samostatný doporučovací Companion po změně ceny a odstranění závislosti
na Won Discounts. Standardní kvalitativní průzkum, čteno 1. 10. 2026. Čtyři otázky:
(1) jakou práci obchodníci řeší, (2) proč zůstávají, (3) co již poskytuje levná/bezplatná
alternativa, (4) čím lze obhájit $10/$30 a co musí ověřit vlastní klienti.

Použity přímé URL oficiálních listingů, jejich prvních dostupných stránek jednotlivých recenzí,
dokumentace a dvou materiálů dodavatele. Celkem 14 zdrojových stránek v evidenci níže;
nejde o 14 nezávislých studií. Nevybíral jsem jen nespokojené zákazníky. Větší váhu pro
hypotézy retence mají konkrétní výpovědi s delším používáním. Délka používání z App Storu
ale není ověřená délka placeného předplatného. Shopify Magic souhrny nejsou vlastní důkaz.

Pokusy o URL recenzí s `?sort_by=newest` pro Candy Rack, Selleasy, Also Bought a FBT
selhaly; použity dostupné `/reviews` bez tohoto parametru. Nelze tvrdit, že jde o kompletní
nejnovější nebo náhodný vzorek. Nedostupné byly také `https://www.logbase.io/selleasy` a
pokus o článek `https://help.digismoothie.com/en/articles/11983230-learn-more-about-the-a-b-testing-integration-with-intelligems`;
žádný závěr na nich nestojí. Některé výsledky webového nástroje jsou cache s odlišným počtem
recenzí než listing, proto se počty nesčítají ani nepoužívají jako ukazatel růstu.

Označení: **fakt nabídky** = co dodavatel zveřejňuje, nikoli test aplikace;
**výpověď** = tvrzení konkrétního obchodníka, ne nezávisle ověřený výsledek;
**inference** = náš závěr k dalšímu ověření. Bez rozhovorů, přístupu k analytice obchodů
nebo kontrolovaného experimentu tento průzkum neměří ochotu klientů platit ani kauzální uplift.

### A. Důvod koupě: správný doplněk ve správné chvíli

Nejkonkrétnější motiv ve vzorku není počet modelů AI. Celestial Fire Glass v recenzi
Also Bought z 24. 3. 2026 popisuje ruční propojení vhodného příslušenství. MAJAMAS EARTH
23. 5. 2025, s téměř osmi lety používání podle App Storu, chce hromadné přiřazení podobným
produktům s různým potiskem. To je pracovní problém: správa vztahů napříč katalogem.
[Jednotlivé recenze Also Bought](https://apps.shopify.com/also-bought/reviews).

**Inference:** Companion má srozumitelnější nabídku jako nástroj pro správné doplňky,
varianty a větší balení než jako neurčitý automat na růst. Merchant musí snadno ověřit,
že doporučovaný výrobek pasuje. Pro katalog příslušenství může být správná kompatibilita
cennější než pravděpodobnost společného nákupu. Příchuť, rozměr nebo model nelze ignorovat
jen proto, že dva produkty sdílejí kolekci. Praktický onboarding proto začíná několika
skutečnými nákupy, ne rozsáhlou tabulkou vah algoritmu.

Doplňování nemusí vyžadovat slevu. Historická dodavatelská studie Docking Drawer
(23. 5. 2022) popisuje nabídku produktových materiálů a katalogů; merchant uvádí snadné
nastavení a přizpůsobení obchodní nabídky svému použití. Jde o příklad úlohy, nikoli
současný cenový důkaz nebo ověřený přírůstek tržeb. [Case study](https://www.digismoothie.com/blog/candy-rack-docking-drawer-case-study).

### B. Důvod zůstat: předvídatelné chování a pomoc při problému

CosmoGrill (8. 7. 2026, přibližně dva roky používání) oceňuje bezproblémový provoz
Candy Rack a rychlou pomoc při novém umístění nabídky. ChokeSports (13. 5. 2026, přes
pět let) zmiňuje analytiku, přizpůsobení a podporu. To podporuje hypotézu dlouhodobé
užitečnosti; jejich tvrzení o návratnosti není kontrolovaný experiment.
[Recenze Candy Rack](https://apps.shopify.com/candyrack/reviews).

Ette Tete (27. 7. 2026, téměř čtyři roky) u Selleasy popisuje jednoduché nastavení
a pomoc s problémy. The Book About You (7. 7. 2026, deset měsíců) uvádí, že po změně
košíku na drawer zmizel widget a podpora jej opravila. Pozitivní recenze tak může současně
ukazovat náklad na individuální integraci. [Recenze Selleasy](https://apps.shopify.com/upsell-cross-sell-kit-1/reviews).

**Inference:** Dawn/Horizon beta je rozumné omezení závazku. Musí být snadné poznat,
zda je nabídka správně zapojená, proč se nezobrazuje a jak se bezpečně vypíná. Nestačí
se cenově podbízet aplikaci, jejíž součástí je lidská instalace a řešení konfliktů.
Dobré preview, diagnostika a hromadné operace mají přímý vztah k nákladům podpory.
Provozní metrikou má být i počet případů, které vyžadovaly zásah do tématu.

### C. Bezplatný základ a skutečná cenová konkurence

Shopify Search & Discovery je zdarma. Jeho celkové hodnocení míchá vyhledávání, filtry
a doporučování; nelze je použít jako známku kvality samotných doporučení.
[Listing](https://apps.shopify.com/search-and-discovery).

Oficiální dokumentace už zahrnuje automatická související doporučení, ruční výběr až
deseti produktů, hromadné úpravy přes metapole a filtrování podle dostupnosti a košíku.
Zobrazení závisí na podpoře tématu. Pouhé „umíme ručně vybrat produkt“ ani „nenabízíme,
co už je v košíku“ proto není samostatné odlišení.
[Dokumentace Shopify](https://help.shopify.com/en/manual/online-store/storefront-search/search-and-discovery-recommendations).

Ověřené veřejné nabídky k datu čtení:

| Produkt | Cena zveřejněná dodavatelem | Co znamená pro nový Companion |
|---|---|---|
| [Candy Rack](https://apps.shopify.com/candyrack) | $29.99 do 50 objednávek, $39.99 do 200, $59.99 do 500; 8 dní trial | Basic je levnější vstup, Pro není levnější pro každý malý obchod |
| [Selleasy](https://apps.shopify.com/upsell-cross-sell-kit-1) | Zdarma do 50 objednávek, pak $9 do 500, $19 do 1 000, $29 nad 1 000; placené tarify 30 dní trial | Pro $30 nelze prodávat tvrzením, že je nejlevnější; Basic soupeří s $9 nabídkou |
| [Also Bought](https://apps.shopify.com/also-bought) | $19.99 flat, bez limitu objednávek/provozu, 14 dní trial | Zavedená alternativa zaměřená přímo na doporučování; Pro musí nabídnout něco navíc |
| [Frequently Bought Together](https://apps.shopify.com/frequently-bought-together) | Free do 3 ručních sad; $14.99 do 50 objednávek, $19.99 do 500, $39.99 nad 500; 14 dní trial | Companion bez tvorby slev není plná náhrada slevového bundle nástroje |

Ceny v tabulce jsou měsíční, v USD. Ověření nabídky neznamená instalaci ani test účtování.
**Inference:** nový pricing odstraňuje trvalou bezplatnou podporu, ale obchodní životaschopnost
sám nepotvrzuje. Je nutné sledovat poměr Basic/Pro, čas podpory a udržení po trialu.
Při 100 platících obchodech je hrubé MRR $1 000–3 000 podle mixu, nikoli automaticky $3 000.
Trial je vhodný pro ověření relevance, vzhledu a pracovního postupu. Čtrnáct dní není
slib dostatečného vzorku pro změření přírůstku na malém obchodě.

### D. Samostatná doporučení bez správy slev

Odpojení Won Discounts je smysluplná hranice odpovědnosti: Companion vybírá z toho,
co merchant skutečně prodává, a usnadňuje nákup. Zároveň mění srovnání s konkurencí.
Candy Rack se veřejně prezentuje jako konsolidovaný nástroj a uvádí podporu 24/7;
nekupuje se pouze algoritmus doporučování. [Stránka dodavatele](https://www.digismoothie.com/apps/candy-rack).
Jeho dokumentace rozlišuje více ploch i jejich odlišné nákupní chování. Stejný widget
na dvou místech proto není automaticky stejná funkce.
[Dokumentace ploch](https://help.digismoothie.com/en/articles/5595517-learn-more-about-placements-in-candy-rack).

U FBT Cigar & Ash (26. 6. 2026, sedm dní používání) výslovně hledal související produkty
se slevou. PC Traders (1. 8. 2026, přes osm let) a Douvalls Beauty (17. 8. 2026, asi tři
roky) uvádějí obchodní přínos; Glorio (7. 8. 2026, dva měsíce) odchod kvůli ceně.
[Recenze FBT](https://apps.shopify.com/frequently-bought-together/reviews).

**Inference:** část zákazníků chce správné doporučení bez dalšího slevového systému;
část chce právě tvorbu slevových balíčků. Pro druhou skupinu Companion nebude úplná
náhrada a nesmí tvrdit „stejná funkčnost levněji“. Pokud merchant musí dál platit jiný
bundle nástroj, počítá celkovou cenu svého řešení. Pro první skupinu je naopak výhoda,
že nemusí přesouvat existující cenotvorbu nebo instalovat další Won aplikaci.

### E. Co měření může a nemůže prodat

Nový benchmark Digismoothie popisuje pozorovací data z 3 199 obchodů za leden až srpen
2026 a pracuje s událostmi nabídek. Nejde o randomizované porovnání s vypnutou aplikací.
Je užitečný jako doklad rozdílných definic a velikostí vzorků; jeho označení přírůstku
nelze převzít jako kauzální důkaz. [Metodika benchmarku](https://www.digismoothie.com/blog/upsell-benchmarks).

**Inference:** důvěryhodný holdout může být odlišení, ale není prokázáno, že je hlavním
důvodem koupě za $30. Merchant může v prvních týdnech ocenit spíše správné nabídky a méně
ruční práce. Proto nelze zamknout veškerou srozumitelnou zpětnou vazbu do vyššího tarifu
a současně v levném tarifu požadovat důvěru naslepo. Základní zobrazení fungování a
historické společné nákupy mají jiný účel než experimentální vyhodnocení přínosu.
Pokud se výsledek ještě nedá určit, dashboard má ukázat stav sběru dat, nikoli vítězství.

### Evidence: 14 stránek a síla závěrů

Všechny stránky čteny 1. 10. 2026. U průběžných listingů/dokumentace není pevné datum
publikace; data jednotlivých recenzí jsou uvedena výše. Nezávislost hodnotíme podle
původu tvrzení, nikoli počtu URL.

| Zdroj / vydavatel | Typ a status | Použití a omezení |
|---|---|---|
| [Candy Rack listing](https://apps.shopify.com/candyrack), Digismoothie/App Store | Potvrzená veřejná nabídka | Ceník a rozsah, ne test funkčnosti |
| [Candy Rack recenze](https://apps.shopify.com/candyrack/reviews), obchodníci/App Store | Výpovědi | Dlouhodobá užitečnost a podpora, ne kauzální návratnost |
| [Candy Rack web](https://www.digismoothie.com/apps/candy-rack), Digismoothie | Tvrzení dodavatele | Pozicování a podpora, marketingový zájem |
| [Candy Rack plochy](https://help.digismoothie.com/en/articles/5595517-learn-more-about-placements-in-candy-rack), Digismoothie | Dokumentovaná nabídka | Odlišné nákupní toky, bez vlastní instalace |
| [Docking Drawer](https://www.digismoothie.com/blog/candy-rack-docking-drawer-case-study), Digismoothie, 23. 5. 2022 | Vybraná case study | Konkrétní práce zákazníka, zastaralé ceny nepoužity |
| [Upsell benchmark](https://www.digismoothie.com/blog/upsell-benchmarks), Digismoothie, data 1–8/2026 | Pozorovací data dodavatele | Definice výsledku; žádný náš důkaz kauzality |
| [Selleasy listing](https://apps.shopify.com/upsell-cross-sell-kit-1), Logbase/App Store | Potvrzená veřejná nabídka | Cena, trial a deklarovaná pomoc s nastavením |
| [Selleasy recenze](https://apps.shopify.com/upsell-cross-sell-kit-1/reviews), obchodníci/App Store | Výpovědi | Praktická závislost na podpoře, ne míra poruchovosti |
| [Also Bought listing](https://apps.shopify.com/also-bought), CBB/App Store | Potvrzená veřejná nabídka | Flat cenová alternativa |
| [Also Bought recenze](https://apps.shopify.com/also-bought/reviews), obchodníci/App Store | Výpovědi | Správa kompatibilních doplňků a potřeba hromadných operací |
| [FBT listing](https://apps.shopify.com/frequently-bought-together), CBB/App Store | Potvrzená veřejná nabídka | Cenové stupně a odlišný bundle produkt |
| [FBT recenze](https://apps.shopify.com/frequently-bought-together/reviews), obchodníci/App Store | Výpovědi | Retence, cena a poptávka po slevách; výběrové zkreslení |
| [Search & Discovery listing](https://apps.shopify.com/search-and-discovery), Shopify | Potvrzená bezplatná nabídka | Nulová cenová alternativa; hodnocení míchá více funkcí |
| [Doporučení Shopify](https://help.shopify.com/en/manual/online-store/storefront-search/search-and-discovery-recommendations), Shopify | Oficiální dokumentace | Nativní výchozí funkce, nikoli test konkrétního tématu |

### Nabídka a tarify — potvrzené převzetí funkcí, obchodní hypotéza

**Poziční věta:** „Doporučte doplňky, které k nákupu opravdu patří, nebo nabídněte větší
balení. Zachovejte svůj košík i způsob nacenění.“ Podle této věty se dá kontrolovat rozsah:
přináší funkce lepší výběr, snadnější správu nebo bezpečnější přidání? Pokud ne, musí mít
zvlášť přesvědčivý důvod. Samotné kopírování každé konkurenční plochy hodnotu nedokládá.

**Rozhodnutí Ondřeje 2026-10-01:** Basic za $10 přebírá funkce původního Free,
Pro za $30 přebírá původní Pro; před nimi 14 dní zdarma. Platí novější změny rozsahu,
takže se nevrací zrušená závislost na Won Discounts. Zbývá přiřadit dosud nezařazené
funkce; trial podle navazujícího rozhodnutí zpřístupní Pro.
Již určené přiřazení se znovu neotevírá. Doplňky A → B/C vybírá merchant; analytika
může navrhnout přidání D ke schválení, nejde o zákaznický bundle builder.

Obchodní interpretace zůstává hypotézou: Basic poskytuje původní ruční vztahy, větší
balení a základní vzhled; Pro může prodávat úsporu správy a pokročilé datové funkce.
Bezpečnost, dostupnost, správnost ceny a respektování zákazníka nesmějí být předmětem
příplatku. Schválené přiřazení funkcí samo neověřuje důvod upgradu ani ochotu platit.

Nový směr také mění akviziční cíl. Nemá smysl přesvědčovat všechny spokojené uživatele
komplexních funnelů. Vhodnější pracovní segment je obchod s opakovanými vztahy mezi
hlavním výrobkem a příslušenstvím nebo variantami, který nechce měnit košík a cenotvorbu.
To je hypotéza k výběru pilotů; z veřejných zdrojů neznáme velikost takového segmentu.

### Co ověřit u vlastních klientů

Doporučený malý kvalitativní pilot: 5–8 obchodů, se skutečnými příklady z katalogu
(a pokud je zpřístupní, objednávek), nikoli dotaz „líbí se vám nápad?“. Nikdo nebyl v rámci
průzkumu kontaktován. Otázky pro vlastníka obchodu:

1. Ukaž poslední situaci, kdy zákazník zapomněl vhodný doplněk nebo zvolil malé balení.
2. Jak vztahy dnes spravuješ, kdo to dělá a kolik času tomu věnuje?
3. Co v Search & Discovery nebo současné aplikaci konkrétně nejde?
4. Co bys kvůli Companionu přestal platit nebo dělat ručně?
5. Po ukázce reálného nastavení: který z tarifů bys zvolil a co mu chybí k zaplacení?

Zapsat čas k prvnímu správnému doporučení, čas hromadné změny vztahů, potřebné zásahy
podpory, důvod volby tarifu a skutečné pokračování po trialu. To jsou praktičtější signály
než počet pochval demoverze. Pro zjištění přínosu běží zvlášť měření s kontrolní skupinou;
nelze podmínit uživatelskou validaci tím, že malý obchod za dva týdny nasbírá dost objednávek.

### Jistota a mezery

**Celková jistota: střední pro opakující se pracovní problémy, nízká pro poptávku po Companionu.**
Nejsilnější evidence jsou zveřejněné ceny, nativní bezplatné funkce a konkrétní víceleté
zkušenosti. Nejslabší jsou tvrzení o návratnosti a přenos zkušeností jiných obchodů na naše
klienty. Více recenzí o podpoře neznamená, že známe náklady na zákazníka nebo příčinu všech
závad. Pozitivní i negativní recenze jsou samovýběr a nezávisle neověřená svědectví.

Část trhu výslovně chce slevové balíčky; jiná může chtít jednoduché doporučování. Velikost
obou skupin ani jejich ochota měnit aplikaci není změřena. Nemáme vlastní instalace
konkurentů, rozhovory s klienty, zákaznicky ověřenou hodnotu Basic/Pro, platební konverzi ani skutečné
náklady podpory. Další krok je pilot výše, nikoli další funkce přidaná jen podle konkurence.
