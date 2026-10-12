// Generates Tabulka A of ../../matice-pred-review.md. Arguments: the numbers of the findings already repaired.
// node matice-a.mjs [fixed,comma,separated]  → markdown on stdout
const fixed = new Set((process.argv[2] ?? "").split(",").filter(Boolean).map(Number));

const COLS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "§17", "§18b", "§18g", "§18h", "§18i", "§19a", "§19b", "§19c", "§19f"];

// row: [name, screenshot, applicable columns, { column: finding }]
const T = ["P1", "P2", "P10", "§19a", "§19f"]; // a page with view tiles
const ROWS = [
  ["Přehled, prázdný obchod", "overview-off-pro", ["P2", "P10", "§17", "§18b", "§18h", "§19a", "§19b"], {}],
  ["Přehled, naplněný", "overview-free", ["P2", "P7", "P10", "§17", "§18b", "§18h", "§19a", "§19b"], { P7: 2 }],
  ["Přehled, chyba zápisu", "overview-failed", ["P2", "P7", "P10", "§17", "§19a", "§19b"], { P7: 2 }],
  ["Průvodce, kroky 1 až 3", "onboarding-3", ["P10", "§17", "§18b", "§18g", "§19a"], {}],
  ["Průvodce, kroky 4 a 5", "onboarding-4", ["P10", "§17", "§18b", "§19a"], { "§19a": 1 }],
  ["Slevy a kódy, seznam", "discounts", ["P4", "P10", "§17", "§18b", "§18g", "§19a", "§19f"], { P4: 3 }],
  ["Slevy a kódy, prázdný", "discounts-empty", ["P10", "§17", "§18b", "§19a", "§19f"], {}],
  ["Editor slevy", "rule-editor-new-code", ["P5", "P8", "P10", "§17", "§18g", "§18i", "§19a", "§19b", "§19f"], { P5: 4 }],
  ["Editor slevy, kódy a dávky", "rule-editor-batch", ["P8", "P10", "§17", "§18h", "§18i", "§19b"], { "§18i": 5 }],
  ["Množstevní slevy · Pro celý obchod", "tiers-free", [...T, "§17", "§18i"], {}],
  ["Množstevní slevy · Tabulka na webu", "tiers-free--view-table", [...T, "P8", "P9", "§17", "§18g", "§18h", "§18i", "§19c"], { "§18i": 7, "§18h": 8, P8: 8 }],
  ["Množstevní slevy · Výjimky", "tiers-exceptions--view-exceptions", [...T, "P4", "§17", "§18h", "§18i", "§19b"], {}],
  ["Množstevní slevy, prázdný", "tiers-empty", [...T, "§18b"], { "§19a": 6 }],
  ["Milníky · Stupně", "rewards-pro", [...T, "P4", "§17", "§18i"], {}],
  ["Milníky · Milníky na webu", "rewards-free--view-web", [...T, "P9", "§17", "§19c"], { "§19a": 9, P9: 19 }],
  ["Milníky · Vzhled a vlastní CSS", "rewards-pro--view-look", [...T, "P8", "§17", "§18h", "§18i"], { "§18i": 7, "§18h": 8 }],
  ["Milníky, prázdný", "rewards-empty", [...T, "§18b"], { "§19a": 6 }],
  ["Výprodej · Výprodeje", "outlet-pro", [...T, "P4", "P6", "P7", "P9", "§17", "§18g", "§19c"], { "§19a": 10 }],
  ["Výprodej · Nový výprodej", "outlet-pro--view-new", [...T, "P5", "P6", "P9", "§18g", "§18i", "§19c"], {}],
  ["Výprodej · Štítek na webu", "outlet-pro--view-web", [...T, "P8", "P9", "§17", "§18h", "§18i", "§19c"], { "§19a": 10 }],
  ["Výprodej · Pravidla výprodeje", "outlet-pro--view-info", [...T, "P4", "P6", "§17", "§18i"], {}],
  ["Výprodej, Free", "outlet-free", [...T, "§18h", "§19b"], {}],
  ["Kampaně · Kampaně", "campaigns-pro", [...T, "P4", "§17", "§18b"], { P4: 11 }],
  ["Kampaně · Nová kampaň", "campaigns-pro--view-form", [...T, "P5", "§18i"], { P5: 13 }],
  ["Kampaně · Kampaň na webu", "campaigns-pro--view-places", [...T, "P9", "§17", "§18i", "§19c"], { "§19a": 12 }],
  ["Kampaně, Free", "campaigns-free", [...T, "§18h", "§19b"], {}],
  ["Ochrana marže · Hranice", "margin-pro", [...T, "§17", "§18i"], {}],
  ["Ochrana marže · Nákupní ceny", "margin-pro--view-costs", [...T, "P3", "§17", "§18g", "§18i"], { P3: 15 }],
  ["Ochrana marže · Podle kolekcí", "margin-pro--view-collections", [...T, "P4", "§17", "§18i", "§19b"], { "§19a": 14 }],
  ["Ochrana marže · Podle produktů", "margin-pro--view-products", [...T, "P4", "§17", "§18b", "§18i", "§19b"], {}],
  ["Ochrana marže · Snížené slevy", "margin-pro--view-impact", [...T, "P3", "§17", "§18i", "§19b"], {}],
  ["Ochrana marže, vypnutá", "margin-off", [...T, "§17", "§18h", "§19b"], {}],
  ["Vyzkoušet košík · Časté kombinace", "try-cart-warnings", ["P4", "P7", "P8", "P10", "§17", "§19a", "§19f"], { P8: 16 }],
  ["Vyzkoušet košík · Košík a výsledek", "try-cart-warnings", ["P3", "P7", "P8", "P10", "§17", "§18i"], { P7: 17 }],
  ["Vyzkoušet košík, Free", "try-cart-free", ["P10", "§18h", "§19b"], {}],
  ["Překlady", "translations-pro", ["P8", "P10", "§17", "§18g", "§18i", "§19a", "§19b", "§19f"], {}],
  ["Přehledy, Pro", "analytics-pro", ["P10", "§17", "§18b"], {}],
  ["Přehledy, Free", "analytics-free", ["P10", "§17", "§18h", "§19b"], { "§18h": 18 }],
  ["Nastavení", "settings-pro", ["P8", "P10", "§17", "§18i", "§19a", "§19f"], {}],
  ["Nastavení · Tarif", "plan-free", ["P10", "§17", "§18h", "§19b"], {}],
];

const cell = (applies, finding) => (finding !== undefined ? (fixed.has(finding) ? `platí (byl ${finding})` : `**neplatí (${finding})**`) : applies ? "platí" : "—");
console.log(`| Obrazovka nebo pohled | Screenshot | ${COLS.join(" | ")} |`);
console.log(`|---|---|${COLS.map(() => "---").join("|")}|`);
for (const [name, shot, applies, findings] of ROWS) {
  console.log(`| ${name} | \`${shot}\` | ${COLS.map((c) => cell(applies.includes(c), findings[c])).join(" | ")} |`);
}
