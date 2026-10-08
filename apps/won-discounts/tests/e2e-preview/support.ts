import type { Page } from "@playwright/test";

// Shared by the preview suite: the dev harness in a real browser (playwright.preview.config.ts).

export async function open(page: Page, path: string, width = 1440): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/dev/preview/${path}`, { waitUntil: "networkidle" });
  // The screen re-reads its form on native events once it is hydrated: Polaris fields are defined by then.
  await page.waitForFunction(() => customElements.get("s-page") !== undefined);
}

/** Type into a Polaris field the way the merchant does: the form listens for the native events. */
export async function typeInto(page: Page, name: string, value: string): Promise<void> {
  await page.evaluate(
    ([field, text]) => {
      const el = document.querySelector<HTMLElement & { value: string }>(`[name="${field}"]`);
      if (!el) throw new Error(`no field ${field}`);
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [name, value],
  );
}

export const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
