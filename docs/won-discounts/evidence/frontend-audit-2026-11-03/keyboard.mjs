// Tab through a few screens: what gets focus, is the focus visible, are clickable cards reachable.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.WON_PREVIEW_BASE_URL ?? "http://localhost:3411") + "/dev/preview/";
const browser = await chromium.launch();
for (const path of ["overview?state=live", "discounts?sync=ok", "tiers", "outlet"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // Clickable things that are not focusable: elements with onclick/cursor pointer but no tabindex and not a control.
  const unreachable = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.cursor !== "pointer") continue;
      if (el.closest("a,button,s-button,s-link,s-clickable,input,select,label,summary,[tabindex],[role=button],[role=tab],[role=link]")) continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;
      out.push((el.tagName + " " + (el.innerText || "").slice(0, 40)).replace(/\s+/g, " "));
    }
    return out.slice(0, 8);
  });
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        let a = document.activeElement;
        while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
        if (!a || a === document.body) return "body";
        const cs = getComputedStyle(a);
        const ring = cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" ? "ring" : cs.boxShadow !== "none" ? "shadow" : "NONE";
        const host = a.getRootNode().host;
        const label = ((host || a).innerText || a.getAttribute("aria-label") || "").trim().slice(0, 28).replace(/\s+/g, " ");
        return `${(host ? host.tagName + ">" : "") + a.tagName}[${ring}] ${label}`;
      }),
    );
  }
  console.log("\n==", path, "\n pointer-but-not-focusable:", unreachable, "\n tab order:\n  " + seen.join("\n  "));
  await page.close();
}
await browser.close();
