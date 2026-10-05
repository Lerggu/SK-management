import { expect, test } from "@playwright/test";
import { acceptDialogs, authFile, isMobile, openLogisticsBoard, unique } from "./helpers";

test.describe("logistics coordinator", () => {
  test.use({ storageState: authFile("logistics") });

  test("schedules a delivery into a free 30-minute gate slot; a taken slot is refused", async ({ page }, testInfo) => {
    await openLogisticsBoard(page);
    const timeline = page.getByTestId("gate-timeline");
    await expect(timeline).toContainText("Kaapelirummut 4 kpl");
    const material = unique(testInfo, "E2E-materiaali");
    const time = isMobile(testInfo) ? "14:00" : "13:00";
    const form = page.getByTestId("delivery-form");
    await form.getByLabel("Portti").selectOption({ label: "Portti 1 (pohjoinen)" });
    await form.getByLabel("Alkaa klo").fill(time);
    await form.getByLabel("Toimittaja").fill("E2E Toimittaja Oy");
    await form.getByLabel("Materiaali").fill(material);
    await form.getByRole("button", { name: "Aikatauluta" }).click();
    await expect(timeline).toContainText(material);

    await form.getByLabel("Alkaa klo").fill(time);
    await form.getByLabel("Toimittaja").fill("Toinen Oy");
    await form.getByLabel("Materiaali").fill("Päällekkäinen");
    await form.getByRole("button", { name: "Aikatauluta" }).click();
    await expect(form.getByText("Portin aikaikkuna on jo varattu")).toBeVisible();
  });

  test("creates and approves a logistics request linked to a takt activity", async ({ page }, testInfo) => {
    await openLogisticsBoard(page);
    const title = unique(testInfo, "E2E-nosto");
    const form = page.getByTestId("request-form");
    await form.getByLabel("Palvelu").selectOption({ label: "Nosto" });
    await form.getByLabel("Otsikko").fill(title);
    await form.getByLabel("Takt-tehtävä").selectOption({ index: 1 });
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText("Pyydetty")).toBeVisible();
    await page.getByTestId("request-actions").getByRole("button", { name: "Hyväksy", exact: true }).click();
    await expect(page.getByText("Hyväksytty", { exact: true })).toBeVisible();
  });
});

test.describe("gate", () => {
  test.use({ storageState: authFile("supervisor") });

  test("supervisor records the delivery status with one tap", async ({ page }) => {
    await openLogisticsBoard(page);
    await page.getByRole("link", { name: "Porttinäkymä" }).click();
    const card = page.getByTestId("gate-list").locator("li").filter({ hasText: "Kaapelirummut 4 kpl" });
    const before = await card.getAttribute("data-status");
    await card.getByRole("button").first().click();
    await expect(card).not.toHaveAttribute("data-status", before!);
  });

  test("supervisor can request but not approve", async ({ page }, testInfo) => {
    await openLogisticsBoard(page);
    const form = page.getByTestId("request-form");
    await form.getByLabel("Otsikko").fill(unique(testInfo, "E2E-pyyntö"));
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click();
    await expect(page.getByText("Pyydetty")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hyväksy", exact: true })).toHaveCount(0);
  });
});

test.describe("resource bookings", () => {
  test.use({ storageState: authFile("pm") });

  test("project manager sees conflicts and books an own resource", async ({ page }, testInfo) => {
    acceptDialogs(page);
    await page.goto("/c/sk-infra-demo/logistics/bookings");
    await expect(page.getByTestId("my-bookings").locator('[data-conflict="OVERLAP"]').first()).toBeVisible();
    const form = page.getByTestId("booking-form");
    await form.getByLabel(/EQ-003 Excavator 22 t/).check();
    // Before the excavator's next inspection (2026-12-01), so there is no conflict.
    const day = isMobile(testInfo) ? "2026-11-24" : "2026-11-23";
    await form.getByLabel("Alkaa").fill(`${day}T07:00`);
    await form.getByLabel("Päättyy").fill(`${day}T15:00`);
    await form.getByRole("button", { name: "Varaa" }).click();
    const row = page.getByTestId("my-bookings").locator("li").filter({ hasText: "EQ-003" }).filter({ hasText: `${Number(day.slice(8))}.11.` });
    await expect(row).toHaveAttribute("data-status", "APPROVED");
  });
});

test.describe("cross-company booking", () => {
  test.use({ storageState: authFile("purentCeo") });

  test("Purent approves SK Infra's request for its forklift", async ({ page }, testInfo) => {
    await page.goto("/c/purent-demo/logistics/bookings");
    const row = page.getByTestId("incoming-bookings").locator("li").filter({ hasText: "Forklift 2.5 t" });
    await expect(row).toContainText("SK Infra Demo");
    if (!isMobile(testInfo)) {
      await row.getByRole("button", { name: "Hyväksy" }).click();
      await expect(row).toHaveAttribute("data-status", "APPROVED");
    }
  });
});

test.describe("external roles", () => {
  test.use({ storageState: authFile("client") });

  test("client has no logistics access", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await expect(page.getByRole("link", { name: "Logistiikka" })).toHaveCount(0);
    await page.goto("/c/sk-infra-demo/logistics");
    await expect(page.getByText("Ei työmaita, joihin sinulla on logistiikkaoikeus.")).toBeVisible();
  });
});
