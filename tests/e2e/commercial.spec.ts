import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authFile, unique } from "./helpers";

const NDC = "/c/sk-infra-demo/projects";

async function openNdcCommercial(page: import("@playwright/test").Page) {
  await page.goto(NDC);
  await page.getByRole("link", { name: /NDC-001/ }).first().click();
  await page.getByRole("link", { name: "Sopimus ja ennuste" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sopimus ja ennuste");
}

test.describe("quotes", () => {
  test.use({ storageState: authFile("pm") });

  test("PM prepares and submits a quote; the Project Director approves; PM sends it", async ({ page, browser }, testInfo) => {
    await page.goto("/c/sk-infra-demo/sales/quotes");
    const title = unique(testInfo, "E2E-tarjous");
    const form = page.getByTestId("quote-form");
    await form.getByLabel("Asiakas").selectOption({ label: "Tuulipuisto Demo Oy" });
    await form.getByLabel("Tarjouksen kohde").fill(title);
    await form.getByRole("button", { name: "Luo tarjous" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);

    const line = page.getByTestId("quote-line-form");
    await line.getByLabel("Kuvaus").fill("Asennustyö");
    await line.getByLabel("Määrä").fill("100");
    await line.getByLabel("Yksikkökustannus").fill("50");
    await line.getByRole("button", { name: "Lisää rivi" }).click();
    await expect(page.getByTestId("quote-lines")).toContainText("Asennustyö");
    const draft = page.getByTestId("quote-draft-form");
    await draft.getByLabel("Kate (% hinnasta)").fill("20");
    await draft.getByRole("button", { name: "Tallenna" }).click();
    // 100 h × 50 € = 5 000 €; 20 % margin of the price → 6 250 €.
    await expect(page.getByTestId("quote-price")).toContainText("6 250,00");
    await page.getByRole("button", { name: "Lähetä hyväksyttäväksi" }).click();
    await expect(page.getByText(/Hyväksyttävänä/).first()).toBeVisible();
    await expect(page.getByTestId("quote-decision-form")).toHaveCount(0);
    const url = page.url();

    const pd = await browser.newContext({ storageState: authFile("pd"), ...testInfo.project.use });
    const pp = await pd.newPage();
    await pp.goto(url);
    await pp.getByTestId("quote-decision-form").getByRole("button", { name: "Hyväksy tarjous" }).click();
    await expect(pp.getByText(/v1 · Hyväksytty/)).toBeVisible();
    await pd.close();

    await page.reload();
    await page.getByRole("button", { name: "Merkitse lähetetyksi asiakkaalle" }).click();
    await expect(page.getByText(/v1 · Lähetetty/)).toBeVisible();
    await expect(page.getByTestId("quote-outcome-form")).toBeVisible();
  });
});

test.describe("variations", () => {
  test.use({ storageState: authFile("pm") });

  test("variation: priced by PM, approved internally by PD, approved by the client with a reference", async ({ page, browser }, testInfo) => {
    await openNdcCommercial(page);
    const title = unique(testInfo, "E2E-lisätyö");
    const form = page.getByTestId("variation-form");
    await form.getByLabel("Lisätyö").fill(title);
    await form.getByRole("button", { name: "Luo lisätyö" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    const d = page.getByTestId("variation-draft-form");
    await d.getByLabel("Työ (€)").fill("1000");
    await d.getByLabel("Materiaalit (€)").fill("500");
    await d.getByLabel("Lisä (%)").fill("10");
    await d.getByRole("button", { name: "Tallenna" }).click();
    await expect(page.getByTestId("variation-price")).toContainText("1 650,00");
    await page.getByRole("button", { name: "Lähetä sisäiseen tarkastukseen" }).click();
    await expect(page.getByText("Olet laatinut tai lähettänyt tämän lisätyön")).toHaveCount(0);
    const url = page.url();

    const pd = await browser.newContext({ storageState: authFile("pd"), ...testInfo.project.use });
    const pp = await pd.newPage();
    await pp.goto(url);
    await pp.getByTestId("variation-approve-form").getByRole("button", { name: "Hyväksy ja lähetä asiakkaalle" }).click();
    await expect(pp.getByTestId("variation-client-form")).toBeVisible();
    await pd.close();

    await page.reload();
    const client = page.getByTestId("variation-client-form");
    await client.getByRole("button", { name: "Asiakas hyväksyi" }).click();
    await expect(client.getByText("Anna asiakkaan viite tai liitä hyväksyntäasiakirja")).toBeVisible();
    await client.getByLabel("Asiakkaan viite / tilaus").fill("Sähköposti E2E");
    await client.getByRole("button", { name: "Asiakas hyväksyi" }).click();
    await expect(page.getByRole("button", { name: "Merkitse tehdyksi" })).toBeVisible();
    await page.getByRole("link", { name: "Sopimus ja ennuste" }).click();
    await expect(page.getByTestId("uninvoiced")).toContainText("Hyväksytty, laskuttamatta");
  });
});

test.describe("billing", () => {
  test.use({ storageState: authFile("pm") });

  test("generates invoice candidates and exports an immutable CSV with SHA-256", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/billing");
    const gen = page.getByTestId("generate-form");
    await gen.getByLabel("Projekti").selectOption({ index: 0 });
    await gen.getByRole("button", { name: "Muodosta" }).click();
    await expect(gen.getByRole("status")).toBeVisible();
    await expect(page.getByTestId("candidates").locator('tr[data-source="MILESTONE"]').first()).toBeVisible();
    const exp = page.getByTestId("export-form");
    await exp.getByLabel("Sisällytä jo viedyt (uudelleenvienti)").check();
    await exp.getByRole("button", { name: "Vie tiedostoksi" }).click();
    await expect(page).toHaveURL(/exported=/);
    const id = new URL(page.url()).searchParams.get("exported")!;
    const res = await page.request.get(`/c/sk-infra-demo/billing/exports/${id}`);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.body();
    expect(body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(body.toString("utf8")).toContain("candidateId;sourceType;sourceId;projectCode;customer");
    expect(createHash("sha256").update(body).digest("hex")).toBe(res.headers()["x-content-sha256"]);
  });
});

test.describe("sales", () => {
  test.use({ storageState: authFile("pm") });

  test("sales overview shows the weighted pipeline and uninvoiced variations", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/sales");
    await expect(page.getByTestId("sales-kpis")).toContainText("Painotettu myyntiputki");
    await expect(page.getByTestId("kpi-uninvoiced")).toBeVisible();
    await expect(page.getByTestId("pipeline")).toContainText("Tarjottu");
    await page.getByRole("link", { name: /^Nordic Hyperscale Demo Oy/ }).click();
    await expect(page.getByTestId("contacts")).toContainText("Hanna Hankinta");
  });
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("sees no sales, prices or billing (V7: kept in the portal)", async ({ page }) => {
    for (const path of ["/c/sk-infra-demo/sales", "/c/sk-infra-demo/billing", "/c/sk-infra-demo/sales/quotes"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/portal/);
    }
  });
});
