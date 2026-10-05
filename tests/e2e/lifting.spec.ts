import { expect, test } from "@playwright/test";
import { authFile, pickSite, unique } from "./helpers";

test.describe("lift plans", () => {
  test.use({ storageState: authFile("supervisor") });

  test("supervisor plans a lift; the lifting supervisor approves it; the author cannot", async ({ page, browser }, testInfo) => {
    await page.goto("/c/sk-infra-demo/lifting");
    await pickSite(page);
    const title = unique(testInfo, "E2E-nosto");
    const form = page.getByTestId("lift-form");
    await form.getByRole("textbox", { name: "Nosto", exact: true }).fill(title);
    await form.getByLabel("Takt-tehtävä").selectOption({ index: 1 });
    await form.getByRole("button", { name: "Luo nostosuunnitelma" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    // A new draft is incomplete: submitting is not offered until the checks pass.
    await expect(page.getByTestId("lift-issues").locator('[data-code="INCOMPLETE"]').first()).toBeVisible();

    const draft = page.getByTestId("lift-draft-form");
    await draft.getByLabel("Kuorma", { exact: true }).fill("Kaapelihyllynippu");
    await draft.getByLabel("Kuorman paino (kg)").fill("900");
    await draft.getByLabel("Nostovälineiden paino (kg)").fill("100");
    await draft.getByLabel("Nosturi").selectOption({ label: "EQ-001 Mobile crane 100 t" });
    await draft.getByLabel("Säde (m)").fill("20");
    await draft.getByLabel("Kapasiteetti säteellä (kg)").fill("8000");
    await draft.getByRole("button", { name: "Tallenna" }).click();
    await expect(page.getByTestId("lift-issues").locator('[data-code="INCOMPLETE"]')).toHaveCount(0);

    // An accessory with an overdue inspection is detected and blocks submitting.
    const acc = page.getByTestId("lift-accessory-form");
    await acc.getByLabel("Nostoapuväline").selectOption({ label: "KE-003 · Nostoketju 2-haarainen 3,15 t · WLL 3150 kg · Tarkastus erääntynyt" });
    await acc.getByRole("button", { name: "Lisää apuväline" }).click();
    await expect(page.getByTestId("lift-issues").locator('[data-code="ACCESSORY_INSPECTION_DUE"]')).toBeVisible();
    await page.getByTestId("lift-accessories").locator("li").filter({ hasText: "KE-003" }).getByRole("button", { name: "Poista" }).click();
    await expect(page.getByTestId("lift-accessories")).toHaveCount(0);
    await acc.getByLabel("Nostoapuväline").selectOption({ label: "NR-002 · Nostoraksi 4 t / 4 m · WLL 4000 kg" });
    await acc.getByRole("button", { name: "Lisää apuväline" }).click();
    await expect(page.getByTestId("lift-accessories")).toContainText("NR-002");

    await page.getByRole("button", { name: "Lähetä hyväksyttäväksi" }).click();
    await expect(page.getByText(/Hyväksyttävänä v1/).first()).toBeVisible();
    await expect(page.getByTestId("lift-decision-form")).toHaveCount(0);
    const url = page.url();

    const lifting = await browser.newContext({ storageState: authFile("lifting"), ...testInfo.project.use });
    const lp = await lifting.newPage();
    await lp.goto(url);
    const decision = lp.getByTestId("lift-decision-form");
    await decision.getByRole("button", { name: "Hyväksy nostosuunnitelma" }).click();
    await expect(decision.getByText("Kuittaa varoitukset ennen hyväksyntää")).toBeVisible();
    await decision.getByLabel("Olen lukenut varoitukset").check();
    await decision.getByRole("button", { name: "Hyväksy nostosuunnitelma" }).click();
    await expect(lp.getByTestId("lift-approved-by")).toContainText("Ville Vinssi");
    await expect(lp.getByTestId("lift-complete-form")).toBeVisible();
    await lifting.close();
  });

  test("the accessory register flags overdue inspections", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/lifting/accessories");
    await expect(page.getByTestId("accessories-due")).toBeVisible();
    await expect(page.getByRole("link", { name: /KE-003/ })).toContainText("Tarkastus erääntynyt");
  });
});

test.describe("materials and cable drums", () => {
  test.use({ storageState: authFile("supervisor") });

  test("records a cable pull in metres; a pull longer than the drum is refused", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/materials");
    await pickSite(page);
    await page.getByRole("link", { name: /KK-0003/ }).click();
    const remaining = page.getByTestId("drum-remaining");
    const before = Number((await remaining.textContent())!.split(" m")[0].replace(/\s/g, "").replace(",", "."));
    const form = page.getByTestId("pull-form");
    await form.getByLabel("Vedetty pituus (m)").fill("12,5");
    await form.getByRole("button", { name: "Tallenna veto" }).click();
    await expect(page.getByTestId("drum-pulls")).toContainText("12,5 m");
    await expect(remaining).toContainText(String(before - 12.5).replace(".", ","));
    await form.getByLabel("Vedetty pituus (m)").fill("99999");
    await form.getByRole("button", { name: "Tallenna veto" }).click();
    await expect(form.getByText("Veto on pidempi kuin kelalla jäljellä oleva kaapeli")).toBeVisible();
  });

  test("moves a material batch from storage to the workface", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/materials");
    await pickSite(page);
    const code = unique(testInfo, "ME");
    const form = page.getByTestId("batch-form");
    await form.getByLabel("Tunnus").fill(code);
    await form.getByLabel("Materiaali").fill("E2E-kannakkeet");
    await form.getByLabel("Määrä").fill("10");
    await form.getByRole("button", { name: "Lisää erä" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(code.toUpperCase());
    const move = page.getByTestId("batch-move-form");
    await move.getByLabel("Sijainti").selectOption({ label: "Kaapelivarasto" });
    await move.getByRole("button", { name: "Varastoon" }).click();
    await expect(page.getByTestId("batch-movements").locator("li")).toHaveCount(2);
    await move.getByLabel("Takt-tehtävä").selectOption({ index: 1 });
    await move.getByRole("button", { name: "Työkohteeseen" }).click();
    await expect(page.getByTestId("batch-movements").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("batch-movements")).toContainText("Työkohteessa");
  });

  test("QR: label sheet is a PDF; a typed code opens the drum on the phone", async ({ page }) => {
    const pdf = await page.request.get("/c/sk-infra-demo/materials/labels?kind=accessory");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await page.goto("/c/sk-infra-demo/materials");
    await page.getByTestId("open-scan").click();
    const form = page.getByTestId("scan-form");
    await form.getByLabel("Tunnus").fill("kk-0001");
    await form.getByRole("button", { name: "Avaa" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("KK-0001");
    // The QR target URL (opaque id) resolves the same way.
    const drumUrl = page.url();
    const id = drumUrl.split("/").pop()!;
    await page.goto(`/c/sk-infra-demo/scan/${id}`);
    await expect(page).toHaveURL(drumUrl);
  });

  test("the takt activity shows its cable pulls", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/materials");
    await pickSite(page);
    await page.getByRole("link", { name: /KK-0001/ }).click();
    await page.getByTestId("drum-pulls").getByRole("link").first().click();
    await expect(page.getByTestId("activity-trace")).toContainText("Kaapelia vedetty yhteensä");
    await expect(page.getByTestId("activity-trace")).toContainText("KK-0001");
  });
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("cannot open materials or scan codes", async ({ page }) => {
    const res = await page.goto("/c/sk-infra-demo/materials/labels?kind=drum&siteId=00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
    await page.goto("/c/sk-infra-demo/scan");
    const form = page.getByTestId("scan-form");
    await form.getByLabel("Tunnus").fill("KK-0001");
    await form.getByRole("button", { name: "Avaa" }).click();
    await expect(form.getByText("Koodia ei löytynyt tai sinulla ei ole siihen oikeutta")).toBeVisible();
  });
});
