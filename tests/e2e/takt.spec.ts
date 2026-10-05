import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { acceptDialogs, authFile, isMobile, unique } from "./helpers";

const PLAN = "Data Hall A – sähkötahti";

test.describe("takt planning: structure → train → baseline → import → compare", () => {
  test.use({ storageState: authFile("pm") });

  test("project manager plans a site end to end", async ({ page }, testInfo) => {
    acceptDialogs(page);
    const site = isMobile(testInfo) ? "Logistics Yard" : "110 kV Substation";
    const building = unique(testInfo, "E2E-rakennus");
    const planName = unique(testInfo, "E2E-tahti");

    await page.goto("/c/sk-infra-demo/projects");
    await page.getByRole("link", { name: /Nordic Data Center Demo/ }).click();
    await page.getByRole("main").getByRole("link", { name: "Tahti" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tahtirakenne");

    const bForm = page.getByTestId("building-form");
    await bForm.getByLabel("Työmaa").selectOption({ label: site });
    await bForm.getByLabel("Nimi").fill(building);
    await bForm.getByRole("button", { name: "Lisää rakennus/alue" }).click();
    const card = page.locator(`[data-testid="building"][data-name="${building}"]`);
    await expect(card).toBeVisible();
    for (const code of ["E1", "E2"]) {
      await card.getByTestId("area-form").getByLabel("Tunnus").fill(code);
      await card.getByTestId("area-form").getByLabel("Nimi").fill(`E2E alue ${code}`);
      await card.getByRole("button", { name: "Lisää takt-alue" }).click();
      await expect(card.getByText(`E2E alue ${code}`)).toBeVisible();
    }

    const pForm = page.getByTestId("plan-form");
    await pForm.getByLabel("Työmaa").selectOption({ label: site });
    await pForm.getByLabel("Suunnitelman nimi").fill(planName);
    await pForm.getByRole("button", { name: "Luo suunnitelma" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(planName);

    await page.getByRole("button", { name: "Generoi tahtijuna" }).click();
    // Every project work package flows through both areas.
    for (const area of ["E1", "E2"]) for (const wp of ["TE", "KH", "KA", "KY", "TS"]) await expect(page.getByTestId("takt-board").locator(`[data-area="${area}"] [data-chip="${wp}"]`)).toHaveCount(1);
    await page.getByRole("button", { name: "Ehdota hyväksyttäväksi" }).click();
    await page.getByRole("button", { name: "Hyväksy baselineksi" }).click();
    await expect(page.getByTestId("versions").locator('[data-version="1"]')).toContainText("Baseline");
    await expect(page.getByTestId("draft-tools")).toHaveCount(0);

    // MS Project XML import goes into a new draft; the baseline stays as approved.
    await page.getByRole("link", { name: "Tuo aikataulu" }).click();
    await page.getByLabel("Aikataulutiedosto").setInputFiles(join(__dirname, "../fixtures/schedules/data-hall-b.xml"));
    await page.getByRole("button", { name: "Lataa ja esikatsele" }).click();
    await expect(page.getByTestId("import-counts")).toContainText("6 tehtävää: 4 kohdistettu");
    await page.screenshot({ path: `docs/screenshots/${testInfo.project.name}/takt-import-preview.png`, fullPage: true, caret: "initial" });
    await page.getByRole("button", { name: "Tuo luonnosversioon" }).click();
    await expect(page.getByTestId("versions").locator('[data-version="2"]')).toContainText("Luonnos");
    await expect(page.getByTestId("takt-board")).toContainText("Zone B1");

    await page.getByRole("link", { name: "Vertaa baselineen" }).click();
    await expect(page.getByTestId("compare-summary")).toContainText("0 siirtynyt, 4 lisätty, 0 poistettu");
  });

  test("look-ahead shows weekly resource demand and shortages", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/takt");
    await page.getByRole("link", { name: "Look-ahead" }).click();
    await expect(page.getByTestId("lookahead-TRADE")).toContainText("Sähköasentaja");
    await page.getByRole("link", { name: "6 viikkoa (resurssit)" }).click();
    await expect(page).toHaveURL(/weeks=6/);
    await expect(page.getByTestId("shortage-count")).toContainText(/vajeella/);
  });
});

test.describe("site progress", () => {
  test.use({ storageState: authFile("supervisor") });

  test("supervisor records progress with one tap", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/takt");
    await page.getByRole("link", { name: new RegExp(PLAN) }).click();
    const card = page
      .getByTestId("week-list")
      .locator("li")
      .filter({ has: page.getByRole("button", { name: "100 %" }) })
      .first();
    const id = await card.getAttribute("data-activity");
    await card.getByRole("button", { name: "100 %" }).click();
    await expect(page.locator(`[data-activity="${id}"]`)).toHaveAttribute("data-status", "COMPLETE");
    await page.locator(`[data-activity="${id}"]`).getByRole("link").click();
    await expect(page.getByTestId("progress-pct")).toHaveText("100 %");
    await expect(page.getByTestId("progress-history")).toContainText("100 %");
  });
});

test.describe("read-only roles", () => {
  test.use({ storageState: authFile("employee") });

  test("employee sees the board but cannot edit or report progress", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/takt");
    await page.getByRole("link", { name: new RegExp(PLAN) }).click();
    await expect(page.getByTestId("takt-board")).toBeVisible();
    await expect(page.getByTestId("draft-tools")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "100 %" })).toHaveCount(0);
  });
});

test.describe("external roles", () => {
  test.use({ storageState: authFile("client") });

  test("client has no takt access", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await expect(page.getByRole("link", { name: "Tahti" })).toHaveCount(0);
    await page.goto("/c/sk-infra-demo/takt");
    await expect(page).toHaveURL(/\/portal/);
  });
});
