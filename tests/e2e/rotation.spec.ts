/**
 * Workforce rotation calendar (ADR 0027): a manager places a person on a
 * site by tapping the person and a day (works the same on phones), sets the
 * period in the dialog and sees it in both views; a viewer has no editing.
 */
import { expect, test } from "@playwright/test";
import { authFile, isMobile } from "./helpers";

const ROTATION = "/c/sk-infra-demo/workforce/rotation";

test.describe("rotation planner", () => {
  test.use({ storageState: authFile("pm") });

  test("tap a person, then a day on a site row; set the period; see it in the people view", async ({ page }, testInfo) => {
    // A week far enough ahead that parallel runs (desktop/mobile) use different days.
    const date = isMobile(testInfo) ? "2027-03-08" : "2027-03-01";
    await page.goto(`${ROTATION}?date=${date}&weeks=1`);
    await expect(page.getByRole("link", { name: "Rotaatio" })).toHaveAttribute("aria-current", /.+/);
    const panel = page.getByTestId("people-panel");
    const person = panel.locator("[data-panel-person]").first();
    const name = (await person.getAttribute("data-panel-person"))!;
    await person.click();
    await expect(page.getByTestId("selected-person")).toBeVisible();

    const siteRow = page.locator("[data-row]").first();
    const rowName = (await siteRow.getAttribute("data-row"))!;
    await page.locator(`[data-cell="${rowName}|${date}"]`).click();
    const dialog = page.getByTestId("rotation-dialog");
    await expect(dialog).toBeVisible();
    const until = `${date.slice(0, 8)}${String(Number(date.slice(8)) + 2).padStart(2, "0")}`;
    await dialog.getByLabel("Asti").fill(until);
    await dialog.getByRole("button", { name: "Tallenna" }).click();
    await expect(page.getByRole("status").filter({ hasText: "merkintä tallennettu" })).toBeVisible();
    await expect(page.locator(`[data-cell="${rowName}|${until}"]`).locator(`[data-person="${name}"]`)).toBeVisible();

    await page.getByRole("button", { name: "Henkilöt", exact: true }).click();
    const row = page.locator(`[data-person-row="${name}"]`);
    await expect(row.locator(`[data-day="${date}"]`)).toHaveAttribute("data-status", "WORK");

    // Mark the next day as vacation from the people view, then clear it.
    const next = `${date.slice(0, 8)}${String(Number(date.slice(8)) + 3).padStart(2, "0")}`;
    await row.locator(`[data-day="${next}"]`).click();
    await dialog.getByRole("button", { name: "Lomalla" }).click();
    await dialog.getByRole("button", { name: "Tallenna" }).click();
    await expect(row.locator(`[data-day="${next}"]`)).toHaveAttribute("data-status", "VACATION");
    await row.locator(`[data-day="${next}"]`).click();
    await dialog.getByRole("button", { name: "Tyhjennä jakso" }).click();
    await expect(row.locator(`[data-day="${next}"]`)).toHaveAttribute("data-status", "");
  });
});

test.describe("rotation viewer", () => {
  test.use({ storageState: authFile("logistics") });

  test("sees the calendar read-only", async ({ page }) => {
    await page.goto(`${ROTATION}?weeks=1`);
    await expect(page.getByTestId("rotation-grid")).toBeVisible();
    await expect(page.getByTestId("people-panel")).toHaveCount(0);
    await expect(page.getByText("Katselutila")).toBeVisible();
  });
});
