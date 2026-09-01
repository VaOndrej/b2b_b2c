import { chromium } from '@playwright/test';
const B = 'http://127.0.0.1:9292';
const b = await chromium.launch();
const out = {};

const page = async (w) => {
  const p = await b.newPage({ viewport: { width: w, height: w < 750 ? 844 : 1000 } });
  return p;
};

// ---------- HOMEPAGE ----------
for (const w of [1440, 390]) {
  const p = await page(w);
  await p.goto(B + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  out[`hp_${w}`] = await p.evaluate(() => {
    const vh = window.innerHeight;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const aboveFold = (el) => { const r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0; };
    const search = document.querySelector('input[type="search"], input[name="q"]');
    const searchBtn = document.querySelector('[aria-label*="earch" i], button[class*="search" i], a[href*="/search"]');
    const hero = document.querySelector('.won-hero, [data-testid="won-hero-carousel-section"], .won-hero--slider');
    const heroText = hero ? (hero.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
    const trust = [...document.querySelectorAll('.won-grid--stats, .won-marquee, [class*="trust"], .won-grid__stat')].filter(vis);
    const navLinks = [...document.querySelectorAll('header nav a, header a[href*="/collections"]')].map(a => a.textContent.trim()).filter(Boolean).slice(0, 12);
    const autoplay = !!document.querySelector('won-carousel[data-autoplay]');
    const imgsNoDim = [...document.querySelectorAll('img')].filter(i => !i.getAttribute('width') || !i.getAttribute('height')).length;
    const lcpish = document.querySelector('.won-hero img, .won-slide img');
    return {
      searchFieldVisible: !!(search && vis(search)),
      searchOnlyIcon: !search && !!searchBtn,
      heroAboveFold: !!(hero && aboveFold(hero)),
      heroText,
      heroAutoplay: autoplay,
      trustAboveFold: trust.some(aboveFold),
      trustCount: trust.length,
      navLinks,
      imgsTotal: document.querySelectorAll('img').length,
      imgsWithoutDimensions: imgsNoDim,
      heroImgLazy: lcpish ? lcpish.loading === 'lazy' : null,
      heroImgFetchPriority: lcpish ? (lcpish.getAttribute('fetchpriority') || 'none') : null,
      nonAnchorNav: [...document.querySelectorAll('header [onclick], header button[data-href]')].length,
    };
  });
  await p.close();
}

// ---------- PLP ----------
for (const w of [1440, 390]) {
  const p = await page(w);
  await p.goto(B + '/collections/automated-collection', { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  out[`plp_${w}`] = await p.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const h1 = document.querySelector('h1');
    const body = document.body.innerText;
    const cards = [...document.querySelectorAll('.won-pcard')];
    const card = cards[0];
    const el = (root, sel) => !!root?.querySelector(sel);
    const soldOutIdx = cards.findIndex(c => /sold out|vyprod/i.test(c.textContent));
    const facets = [...document.querySelectorAll('[class*="facet"], [class*="filter"]')].filter(vis);
    const counts = /\(\s*\d+\s*\)|\b\d+\s*$/m.test(body);
    return {
      h1: h1 ? h1.textContent.trim().slice(0, 40) : null,
      productCountShown: /\d+\s*(products?|produkt)/i.test(body),
      cards: cards.length,
      cardHas: card ? {
        image: el(card, 'img'), title: el(card, '.won-pcard__title'),
        price: el(card, '[class*="price"]'), rating: el(card, '[class*="rating"], .won-rating'),
        cta: el(card, '.won-pcard__add'), ppu: el(card, '.won-pcard__ppu'),
      } : null,
      soldOutPosition: soldOutIdx,
      filtersVisible: facets.length > 0,
      filterCounts: counts,
      appliedChips: !!document.querySelector('[class*="active-facet"], [class*="applied"], [class*="chip"]'),
      sortPresent: !!document.querySelector('select[name*="sort"], [class*="sort"]'),
      collectionDescription: !!document.querySelector('[class*="collection"] [class*="description"], .collection__description'),
      titleTag: document.title.slice(0, 60),
    };
  });
  await p.close();
}

// ---------- PDP ----------
for (const w of [1440, 390]) {
  const p = await page(w);
  await p.goto(B + '/products/the-collection-snowboard-liquid', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  out[`pdp_${w}`] = await p.evaluate(() => {
    const vh = window.innerHeight;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const aboveFold = (el) => { const r = el.getBoundingClientRect(); return r.top < vh; };
    const body = document.body.innerText;
    const form = document.querySelector('product-form-component, form[action*="/cart/add"]');
    const atc = form?.querySelector('button[name="add"], button[type="submit"]');
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).join(' ');
    const gallery = document.querySelectorAll('.product-media-container, [class*="gallery"] img');
    const variantInputs = document.querySelectorAll('variant-picker input, .variant-option input, fieldset input');
    const swatches = document.querySelectorAll('[class*="swatch"]');
    return {
      buySectionAboveFold: !!(form && aboveFold(form)),
      atcLabel: atc ? atc.textContent.trim().slice(0, 24) : null,
      atcAboveFold: !!(atc && aboveFold(atc)),
      galleryItems: gallery.length,
      breadcrumbs: !!document.querySelector('[class*="breadcrumb"], nav[aria-label*="readcrumb" i]'),
      ratingAboveFold: (() => { const r = document.querySelector('.won-rating, [class*="rating"]'); return !!(r && vis(r) && aboveFold(r)); })(),
      reviewsWithText: [...document.querySelectorAll('[class*="review"]')].some(r => (r.textContent || '').trim().length > 80),
      trustInBuySection: !!document.querySelector('.won-product-trust, [class*="trust"]'),
      shippingInfo: /doprav|shipping|odesíláme|delivery/i.test(body),
      returnsInfo: /vrácen|return|záruk/i.test(body),
      descriptionHasList: !!document.querySelector('[class*="description"] ul, .product-description ul, .rte ul'),
      stickyCta: !!document.querySelector('won-sticky-atc, [class*="sticky-atc"]'),
      variantInputs: variantInputs.length,
      swatches: swatches.length,
      ld: {
        product: /"@type"\s*:\s*"Product"/.test(ld),
        offer: /"@type"\s*:\s*"Offer"/.test(ld),
        aggregateRating: /aggregateRating/.test(ld),
        breadcrumbList: /BreadcrumbList/.test(ld),
        priceCurrency: /priceCurrency/.test(ld),
        returnPolicy: /MerchantReturnPolicy/.test(ld),
        shippingDetails: /shippingDetails|OfferShippingDetails/.test(ld),
      },
      titleTag: document.title.slice(0, 60),
      h1: document.querySelector('h1')?.textContent.trim().slice(0, 40),
    };
  });
  await p.close();
}

// ---------- SEARCH + CART ----------
{
  const p = await page(1440);
  await p.goto(B + '/search?q=protein', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  out.search = await p.evaluate(() => ({
    results: document.querySelectorAll('.won-pcard').length,
    hasFilters: !!document.querySelector('[class*="facet"], [class*="filter"]'),
    hasSort: !!document.querySelector('select[name*="sort"], [class*="sort"]'),
  }));
  await p.goto(B + '/search?q=zzzqqq', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  out.searchEmpty = await p.evaluate(() => ({
    results: document.querySelectorAll('.won-pcard').length,
    suggestsAlternatives: /popular|doporuč|zkuste|try|browse|kategor/i.test(document.body.innerText),
    text: document.body.innerText.replace(/\s+/g,' ').slice(0, 160),
  }));
  await p.goto(B + '/cart', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  out.cart = await p.evaluate(() => ({
    freeShippingBar: !!document.querySelector('.won-shipping-bar, [class*="shipping-bar"], [class*="threshold"]'),
    paymentIcons: document.querySelectorAll('footer img[alt*="ay" i], [class*="payment"] img, footer svg').length,
    saveForLater: /wishlist|save for later|uložit|oblíben/i.test(document.body.innerText),
  }));
  await p.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
