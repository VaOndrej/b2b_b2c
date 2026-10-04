// Won Discounts — quantity price on product cards (MVP 7 BETA, contract M8), for themes whose card takes no app
// block. The embed prints {handle: text} for the products of this collection / search page (Liquid decides what
// a card may say: snippets/won-card-tier.liquid); this file only PLACES the text under the card's price.
// It reads nothing else and never touches the cart (SF-1). A card that already has the line (the card block) is
// left alone; a product the page did not list gets nothing.
(function (d) {
  var node = d.getElementById("won-discounts-cards");
  if (!node) return;
  var map;
  try {
    map = JSON.parse(node.textContent || "{}");
  } catch (e) {
    return;
  }
  var CARD = "product-card, .card-wrapper, .product-card, .grid__item, li, article";
  function handleOf(a) {
    var m = /\/products\/([^/?#]+)/.exec(a.getAttribute("href") || "");
    try {
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }
  function place() {
    var root = d.querySelector("main") || d.body;
    var links = root.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < links.length; i++) {
      var h = handleOf(links[i]);
      var text = h && Object.prototype.hasOwnProperty.call(map, h) ? map[h] : null;
      if (!text) continue;
      var card = links[i].closest(CARD);
      if (!card || card.querySelector("[data-won-discounts-card]")) continue;
      var line = d.createElement("p");
      line.className = "won-card-tier";
      line.setAttribute("data-won-discounts-card", h);
      line.textContent = text;
      var price = card.querySelector(".price, product-price, [class*='price']");
      if (price && price.parentNode) price.parentNode.insertBefore(line, price.nextSibling);
      else card.appendChild(line);
    }
  }
  place();
  // Filters and "load more" replace the grid: place again, at most once a frame.
  if (typeof MutationObserver === "function") {
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        place();
      });
    }).observe(d.querySelector("main") || d.body, { childList: true, subtree: true });
  }
})(document);
