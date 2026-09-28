import { test, expect } from "@playwright/test";
import { assertResponsiveSane } from "../support/responsive-invariants";

test.describe("Responsive meaningful hit areas", () => {
  test("a visible 44px label represents a hidden native radio", async ({
    page,
  }) => {
    await page.setContent(
      '<input id="choice" type="radio" style="position:absolute;opacity:0;width:1px;height:1px"><label for="choice" style="display:block;width:44px;height:44px">Pick</label>',
    );
    await assertResponsiveSane(page);
    await page.locator("label").click();
    await expect(page.locator("input")).toBeChecked();
  });
  test("a 20px label remains an undersized hit area", async ({ page }) => {
    await page.setContent(
      '<input id="choice" type="radio" style="display:none"><label for="choice" style="display:block;width:20px;height:20px">A</label>',
    );
    await expect(assertResponsiveSane(page)).rejects.toThrow(
      "control tap targets",
    );
  });
  test("controls inside a hidden panel are not measured", async ({ page }) => {
    await page.setContent(
      '<div style="display:none"><input id="choice" type="radio"><label for="choice" style="display:block;width:20px;height:20px">A</label><button style="width:20px;height:20px">B</button></div>',
    );
    await assertResponsiveSane(page);
  });
  test("separated tiny radio and label cannot pass via empty space", async ({
    page,
  }) => {
    await page.setContent(
      '<input id="choice" type="radio" style="position:absolute;left:8px;top:8px;width:20px;height:20px"><label for="choice" style="position:absolute;left:100px;top:100px;width:20px;height:20px">A</label>',
    );
    await expect(assertResponsiveSane(page)).rejects.toThrow(
      "control tap targets",
    );
  });
});
