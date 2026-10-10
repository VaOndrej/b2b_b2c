// "Na webu teď" of a running sale (feedback 9 Oct 2026, 4th round): what a customer sees for THIS sale — from the
// sale's own display level and badge text, the "Sale badge" block in the theme and the pieces left — with the
// reason when a piece that is switched on does not show.

import assert from "node:assert/strict";
import { test } from "node:test";

import { outletBadgeText, outletWebLine } from "../../app/components/model/outlet-web.ts";
import { translator } from "../../app/i18n/index.ts";

const { t } = translator("cs");
type Display = "silent" | "strike" | "strike_badge" | "strike_badge_left";
const run = (display: Display, patch: Partial<{ showBadge: boolean; left: number; message: string }> = {}) => ({ showBadge: true, left: 12, message: "", display, ...patch });

test("each display level says what shows; a badge that is on but cannot show says why", () => {
  assert.deepEqual(outletWebLine(run("silent"), "in_theme", t), { text: "jen nižší cena, bez přeškrtnutí a bez štítku", missing: null });
  assert.deepEqual(outletWebLine(run("strike"), "missing", t), { text: "přeškrtnutá cena", missing: null });
  assert.deepEqual(outletWebLine(run("strike_badge"), "in_theme", t), { text: "přeškrtnutá cena · štítek „Výprodej“", missing: null });
  assert.deepEqual(outletWebLine(run("strike_badge_left"), "in_theme", t), { text: "přeškrtnutá cena · štítek „Výprodej“ · „Zbývá 12 ks“", missing: null });
  // "Zbývá X ks" is on, yet nothing is left: said, not silently absent.
  assert.match(outletWebLine(run("strike_badge_left", { left: 0 }), "in_theme", t).text, /„Zbývá X ks“ se neukáže, nezbývá žádný kus$/);
  // The block is not in the product template: no badge and no "Zbývá", with the button that adds it.
  assert.deepEqual(outletWebLine(run("strike_badge_left"), "missing", t), { text: "přeškrtnutá cena · štítek se neukáže, v šabloně produktu chybí prvek „Sale badge“", missing: "block" });
  // Hidden for this sale by the merchant (a sale from before the levels were per sale).
  assert.deepEqual(outletWebLine(run("strike_badge_left", { showBadge: false }), "in_theme", t), { text: "přeškrtnutá cena · štítek je u této varianty skrytý", missing: null });
  // The theme could not be read: the badge is promised with that caveat.
  assert.match(outletWebLine(run("strike_badge"), "unknown", t).text, /nepodařilo se ověřit/);
});

test("the sale's own badge text is what is shown; {left} in it is the pieces left and replaces the separate „Zbývá“", () => {
  assert.equal(outletBadgeText("", 5, "Výprodej"), "Výprodej");
  assert.equal(outletBadgeText("  Doprodej, zbývá {left} ks ", 5, "Výprodej"), "Doprodej, zbývá 5 ks");
  assert.deepEqual(outletWebLine(run("strike_badge_left", { message: "Doprodej, zbývá {left} ks" }), "in_theme", t), { text: "přeškrtnutá cena · štítek „Doprodej, zbývá 12 ks“", missing: null });
  assert.deepEqual(outletWebLine(run("strike_badge_left", { message: "Poslední kusy" }), "in_theme", t), { text: "přeškrtnutá cena · štítek „Poslední kusy“ · „Zbývá 12 ks“", missing: null });
});
