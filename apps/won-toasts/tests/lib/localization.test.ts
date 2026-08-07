import assert from "node:assert/strict";
import { test } from "node:test";

import type { ToastMessages } from "@won/core/toasts/config.types";

import {
  mergeMessages,
  pruneMessages,
  updateAnnouncementTranslations,
} from "../../app/lib/localization";

// The Toasts page owns the default locale; the Languages page owns translations.
// mergeMessages must let each save its own slice WITHOUT dropping the other's —
// the bug we're guarding against is a full-replace clobbering translations.

test("saving the default locale keeps existing translations", () => {
  const base: ToastMessages = {
    added: { en: "Added to cart", cs: "Přidáno do košíku" },
  };
  // Toasts save: only touches `en`.
  const out = mergeMessages(base, { added: { en: "In your cart" } });
  assert.deepEqual(out, { added: { en: "In your cart", cs: "Přidáno do košíku" } });
});

test("saving a translation keeps the default copy", () => {
  const base: ToastMessages = { added: { en: "Added to cart" } };
  // Languages save: only touches `cs`.
  const out = mergeMessages(base, { added: { cs: "Přidáno do košíku" } });
  assert.deepEqual(out, { added: { en: "Added to cart", cs: "Přidáno do košíku" } });
});

test("clearing a cell removes just that locale", () => {
  const base: ToastMessages = { added: { en: "Added", cs: "Přidáno" } };
  const out = mergeMessages(base, { added: { cs: "  " } });
  assert.deepEqual(out, { added: { en: "Added" } });
});

test("removing a type's last locale drops the type entirely", () => {
  const base: ToastMessages = { removed: { en: "Removed" } };
  const out = mergeMessages(base, { removed: { en: "" } });
  assert.deepEqual(out, {});
});

test("untouched types are preserved verbatim", () => {
  const base: ToastMessages = {
    added: { en: "Added" },
    shipping: { en: "Free shipping!", de: "Kostenloser Versand!" },
  };
  const out = mergeMessages(base, { added: { cs: "Přidáno" } });
  assert.deepEqual(out, {
    added: { en: "Added", cs: "Přidáno" },
    shipping: { en: "Free shipping!", de: "Kostenloser Versand!" },
  });
});

// --- updateAnnouncementTranslations (the Languages save path for announcement) ---

test("announcement: adds a translation, keeps existing ones", () => {
  const out = updateAnnouncementTranslations(
    { fr: "Cadeau gratuit !" },
    { de: "Kostenloses Geschenk!" },
    "en",
    ["en", "fr", "de"],
  );
  assert.deepEqual(out, { fr: "Cadeau gratuit !", de: "Kostenloses Geschenk!" });
});

test("announcement: the default locale is never stored (it lives in `message`)", () => {
  // Even if a legacy rule had the default locale in its map, it's stripped.
  const out = updateAnnouncementTranslations(
    { en: "legacy default", cs: "Dárek zdarma!" },
    { en: "should be ignored" },
    "en",
    ["en", "cs"],
  );
  assert.deepEqual(out, { cs: "Dárek zdarma!" });
});

test("announcement: a blank edit clears that translation", () => {
  const out = updateAnnouncementTranslations(
    { cs: "Dárek zdarma!", de: "Geschenk!" },
    { cs: "   " },
    "en",
    ["en", "cs", "de"],
  );
  assert.deepEqual(out, { de: "Geschenk!" });
});

test("announcement: removed languages are dropped", () => {
  const out = updateAnnouncementTranslations(
    { cs: "Dárek!", de: "Geschenk!" },
    {},
    "en",
    ["en", "cs"], // de removed
  );
  assert.deepEqual(out, { cs: "Dárek!" });
});

test("announcement: empty map returns undefined (stored rule stays clean)", () => {
  const out = updateAnnouncementTranslations({ en: "only default" }, {}, "en", ["en"]);
  assert.equal(out, undefined);
});

test("pruneMessages drops translations for removed languages", () => {
  const base: ToastMessages = {
    added: { en: "Added", cs: "Přidáno", de: "Hinzugefügt" },
    shipping: { en: "Free shipping!", de: "Kostenloser Versand!" },
  };
  // Merchant keeps only en + cs (removed de).
  const out = pruneMessages(base, ["en", "cs"]);
  assert.deepEqual(out, {
    added: { en: "Added", cs: "Přidáno" },
    shipping: { en: "Free shipping!" },
  });
});
