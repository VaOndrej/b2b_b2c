/* won-cart.js — global quick-add for won product cards. Delegates clicks on any
   [data-won-add] button (card quick-add) and adds the variant via AJAX. Loaded
   once in <head> (wired by compose). Base-agnostic: announces cart:refresh so the
   host theme's drawer/count can update; the on-button "Added" state is the
   guaranteed feedback. The variant picker has its own richer handler. */
(function () {
  if (window.__wonCartBound) return;
  window.__wonCartBound = true;

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-won-add]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    var id = btn.getAttribute('data-variant-id');
    if (!id) return;
    var label = btn.querySelector('.won-pcard__add-label');
    var original = label ? label.textContent : '';
    btn.disabled = true;
    try {
      var res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(id), quantity: 1 }] })
      });
      if (!res.ok) throw new Error('add failed: ' + res.status);
      var data = await res.json();
      btn.classList.add('is-added');
      if (label && btn.dataset.addedLabel) label.textContent = btn.dataset.addedLabel;
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      document.dispatchEvent(new CustomEvent('won:cart:added', { bubbles: true, detail: { id: id, item: data } }));
      setTimeout(function () {
        btn.classList.remove('is-added');
        if (label) label.textContent = original;
        btn.disabled = false;
      }, 1600);
    } catch (err) {
      btn.disabled = false;
      if (label) { label.textContent = '!'; setTimeout(function () { label.textContent = original; }, 1600); }
    }
  });
})();
