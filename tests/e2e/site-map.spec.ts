/**
 * Site map (ADR 0034), desktop and phone: the demo site plan with gates,
 * the crane blinking for its open deviation, adding an object by tapping the
 * map, placing a task, reporting a deviation on a gate, and read-only access
 * for a supervisor.
 */
import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

const MAP = "/c/sk-infra-demo/logistics/map";

test.describe("site map, logistics coordinator", () => {
  test.use({ storageState: authFile("logistics") });

  test("demo map, add an object, place a task, report a deviation", async ({ page }, testInfo) => {
    await page.goto(MAP);
    const map = page.getByTestId("site-map");
    await expect(map).toBeVisible();
    await expect(map.locator("img")).toHaveJSProperty("complete", true);
    await expect(map.getByRole("button", { name: /^Portti P1 / })).toBeVisible();
    const crane = map.getByRole("button", { name: /^Nosturi N1 .*avoin poikkeama$/ });
    await expect(crane).toHaveAttribute("data-blinking", "true");
    await expect(page.getByTestId("map-deviation-count")).toContainText("avoin poikkeama");

    // Add an object: fill the form, then tap the map.
    const code = unique(testInfo, "K").slice(-8);
    const form = page.getByTestId("map-new-object");
    await form.getByLabel("Tyyppi").selectOption({ label: "Muu kohde" });
    await form.getByLabel("Tunnus").fill(code);
    await form.getByLabel("Nimi").fill("Polttoainesäiliö");
    await form.getByRole("button", { name: "Sijoita kartalle" }).click();
    await expect(page.getByTestId("map-mode")).toBeVisible();
    const box = (await map.boundingBox())!;
    await map.click({ position: { x: box.width * (testInfo.project.name === "mobile" ? 0.12 : 0.15), y: box.height * 0.55 } });
    await expect(page.getByTestId("map-message")).toContainText(`Kohde ${code} Polttoainesäiliö lisätty.`);
    await expect(map.getByRole("button", { name: new RegExp(`^Muu kohde ${code} `) })).toBeVisible();

    // Place a task by tapping it and then gate P3.
    const task = page.getByTestId("map-placed-tasks").locator("[data-map-task]").first();
    const title = (await task.locator("span.font-medium").textContent())!;
    await task.click();
    await expect(page.getByTestId("map-mode")).toContainText(title);
    await map.getByRole("button", { name: /^Portti P3 / }).click();
    await expect(page.getByTestId("map-message")).toContainText(`sijoitettu kohteeseen P3`);

    // Report a deviation on gate P2; it starts blinking.
    await page.getByTestId("map-objects").getByRole("button", { name: /P2/ }).click();
    const panel = page.getByTestId("map-object-panel");
    await panel.getByTestId("map-report-deviation").click();
    await panel.getByRole("button", { name: "Sää" }).click();
    await panel.getByLabel("Kommentti").fill("Myrsky, portti suljettu tuulen takia");
    await panel.getByRole("button", { name: "Lähetä poikkeama" }).click();
    await expect(page.getByTestId("map-message")).toContainText("Poikkeama ilmoitettu");
    await expect(map.getByRole("button", { name: /^Portti P2 / })).toHaveAttribute("data-blinking", "true");

    // The deviation is on the deviations tab, linked to the object.
    await page.goto("/c/sk-infra-demo/logistics/deviations");
    await expect(page.getByText("Kartalla: P2 Portti 2 (itä)").first()).toBeVisible();
  });
});

test.describe("site map, supervisor", () => {
  test.use({ storageState: authFile("supervisor") });

  test("sees the map and can report, but cannot edit", async ({ page }) => {
    await page.goto(MAP);
    await expect(page.getByTestId("site-map")).toBeVisible();
    await expect(page.getByTestId("map-new-object")).toHaveCount(0);
    await expect(page.getByTestId("map-upload")).toHaveCount(0);
    await page.getByTestId("map-objects").getByRole("button", { name: /N1/ }).click();
    await expect(page.getByTestId("map-report-deviation")).toBeVisible();
    await expect(page.getByTestId("map-object-panel").getByRole("button", { name: "Muokkaa" })).toHaveCount(0);
  });
});
