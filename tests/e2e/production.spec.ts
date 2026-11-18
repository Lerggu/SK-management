/**
 * Production control, phase 1 (ADR 0026): one menu item for takt and
 * logistics, task types with resource needs, and staffing a task from
 * rule-based candidates. Desktop and phone viewports.
 */
import { expect, test } from "@playwright/test";
import { authFile, navigate, unique } from "./helpers";

test.describe("logistics coordinator", () => {
  test.use({ storageState: authFile("logistics") });

  test("takt and logistics are under 'Tuotannonohjaus'", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await navigate(page, testInfo, "Tahtiaikataulu");
    const tabs = page.getByRole("navigation", { name: "Tuotannonohjaus" });
    await expect(tabs.getByRole("link", { name: "Tahtiaikataulu" })).toBeVisible();
    await tabs.getByRole("link", { name: "Logistiikka" }).click();
    await expect(page).toHaveURL(/\/logistics/);
    await tabs.getByRole("link", { name: "Tehtävätyypit" }).click();
    await expect(page.getByTestId("task-type-Nosto")).toContainText("Taakankiinnittäjä");
  });

  test("a task with a task type shows its resource needs; a candidate is booked", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/logistics");
    const title = unique(testInfo, "Purku");
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Tehtävätyyppi").selectOption({ label: "Kuorman purku" });
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const need = page.getByTestId("staffing-needs").locator('[data-need="Purkaja"]');
    await expect(need).toHaveAttribute("data-missing", "2");
    await need.getByTestId("candidates").getByRole("button", { name: "Varaa" }).first().click();
    await expect(page.getByTestId("staffing-needs").locator('[data-need="Purkaja"]')).toHaveAttribute("data-missing", "1");
    await expect(page.getByTestId("readiness")).toHaveAttribute("data-readiness", "MISSING");
  });
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("has no production control", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/portal");
    await expect(page.getByRole("link", { name: "Tuotannonohjaus" })).toHaveCount(0);
  });
});

test.describe("production calendar", () => {
  test.use({ storageState: authFile("logistics") });

  test("tasks on the timeline with status colours; tap a resource, then the task, to book it", async ({ page }, testInfo) => {
    const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" });
    await page.goto("/c/sk-infra-demo/logistics");
    const title = unique(testInfo, "Kalenteri");
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Alkaa").fill(`${day}T09:00`);
    await form.getByLabel("Päättyy").fill(`${day}T11:00`);
    await form.getByLabel("Tehtävätyyppi").selectOption({ label: "Asennustyö" });
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await page.goto(`/c/sk-infra-demo/logistics/calendar?zoom=day&date=${day}`);
    const bar = page.locator(`[data-task="${title}"]`);
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-phase", "PLANNED");
    await expect(page.getByText("Myöhässä", { exact: true })).toBeVisible(); // legend
    const panel = page.getByTestId("resource-panel");
    await panel.getByRole("button", { name: "Henkilöt" }).click();
    await panel.locator("[data-resource]").first().click();
    await expect(page.getByTestId("selected-resource")).toBeVisible();
    await bar.click();
    await expect(page.getByRole("status").filter({ hasText: "varattu tehtävään" })).toBeVisible();
    await page.goto(`/c/sk-infra-demo/logistics/calendar?zoom=day&date=${day}&view=resources`);
    await expect(page.locator("[data-resource-row]").getByText(title).first()).toBeVisible();
  });
});

test.describe("deviations", () => {
  test.use({ storageState: authFile("logistics") });

  test("report a deviation from the task, it blinks in the calendar, the approver resolves it", async ({ page }, testInfo) => {
    const day = new Date(Date.now() + 4 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" });
    await page.goto("/c/sk-infra-demo/logistics");
    const title = unique(testInfo, "Poikkeama");
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Alkaa").fill(`${day}T10:00`);
    await form.getByLabel("Päättyy").fill(`${day}T12:00`);
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await page.getByRole("link", { name: "Ilmoita poikkeama" }).click();
    const report = page.getByTestId("deviation-form");
    await report.getByText("Kalusto rikki").click();
    await report.getByLabel("Kommentti (valinnainen)").fill("Trukin akku tyhjä");
    await report.getByRole("button", { name: "Lähetä poikkeama" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Poikkeama lähetetty" })).toBeVisible();

    await page.goto(`/c/sk-infra-demo/logistics/calendar?zoom=day&date=${day}`);
    await expect(page.locator(`[data-task="${title}"]`)).toHaveAttribute("data-phase", "DEVIATION");

    await page.locator(`[data-task="${title}"]`).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const item = page.getByTestId("deviation-list").locator('[data-deviation="EQUIPMENT_FAULT"]');
    await expect(item).toHaveAttribute("data-status", "OPEN");
    await item.getByLabel("Ratkaisu").fill("Akku vaihdettu");
    await item.getByRole("button", { name: "Merkitse ratkaistuksi" }).click();
    await expect(page.getByTestId("deviation-list").locator('[data-deviation="EQUIPMENT_FAULT"]')).toHaveAttribute("data-status", "RESOLVED");
  });
});

test.describe("AI suggestions and risks (phase 4)", () => {
  test.use({ storageState: authFile("logistics") });

  test("AI proposes resources for a task and the coordinator accepts them", async ({ page }, testInfo) => {
    const day = new Date(Date.now() + 5 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" });
    await page.goto("/c/sk-infra-demo/logistics");
    const title = unique(testInfo, "AI-purku");
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Alkaa").fill(`${day}T13:00`);
    await form.getByLabel("Päättyy").fill(`${day}T15:00`);
    await form.getByLabel("Tehtävätyyppi").selectOption({ label: "Kuorman purku" });
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    const ai = page.getByTestId("ai-suggestion");
    await ai.getByRole("button", { name: "Pyydä AI-ehdotus" }).click();
    await expect(ai.getByTestId("ai-picks").locator("[data-pick]").first()).toBeVisible();
    await page.goto(`/c/sk-infra-demo/logistics/calendar?zoom=day&date=${day}`);
    await expect(page.locator(`[data-task="${title}"] [data-ai-suggested]`)).toBeVisible();
    await page.locator(`[data-task="${title}"]`).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await page.getByTestId("ai-suggestion").getByRole("button", { name: "Hyväksy ehdotus" }).click();
    await expect(page.getByTestId("staffing-needs").locator('[data-need="Purkaja"]')).toHaveAttribute("data-missing", "0");
  });

  test("risks tab lists rule-detected risks and runs the AI analysis", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/logistics");
    const title = unique(testInfo, "Riski");
    const day = new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" });
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Alkaa").fill(`${day}T07:00`);
    await form.getByLabel("Päättyy").fill(`${day}T09:00`);
    await form.getByLabel("Tehtävätyyppi").selectOption({ label: "Nosto" });
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await page.goto("/c/sk-infra-demo/logistics");
    await page.getByRole("navigation", { name: "Tuotannonohjaus" }).getByRole("link", { name: "Riskit" }).click();
    await expect(page).toHaveURL(/\/logistics\/risks/);
    const select = page.getByLabel("Projekti");
    if (await select.count()) {
      // Find the project of the task just created.
      const count = await select.locator("option").count();
      for (let i = 0; i < count; i++) {
        await select.selectOption({ index: i });
        await page.getByRole("button", { name: "Näytä" }).click();
        if (await page.locator('[data-risk="RESOURCE_SHORTAGE"]', { hasText: title }).count()) break;
      }
    }
    await expect(page.locator('[data-risk="RESOURCE_SHORTAGE"]', { hasText: title })).toHaveAttribute("data-severity", "CRITICAL");
    const analysis = page.getByTestId("risk-analysis");
    await analysis.getByRole("button", { name: "Analysoi AI:lla" }).click();
    await expect(analysis.locator('[data-status="SUCCEEDED"]')).toBeVisible();
    await expect(analysis.getByTestId("risk-recommendations")).toBeVisible();
  });
});
