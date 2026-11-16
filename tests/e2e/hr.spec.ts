/**
 * HR: personnel card, competence matrix, cards and reminders (ADR 0025).
 * Runs on desktop and phone viewports against the seeded demo data.
 */
import { expect, test, type Page } from "@playwright/test";
import { acceptDialogs, authFile, isMobile, navigate, unique } from "./helpers";

const PDF = { name: "todistus.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n") };

async function openCard(page: Page, name: string) {
  await page.goto("/c/sk-infra-demo/workforce");
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name.split(" ").reverse().join(" "));
}

test.describe("HR admin", () => {
  test.use({ storageState: authFile("hr") });

  test("competence matrix shows the latest assessment and separates 'not assessed'", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await navigate(page, testInfo, "Henkilöstö");
    await page.getByRole("link", { name: "Osaamismatriisi" }).click();
    const matrix = page.getByTestId("competence-matrix");
    await expect(matrix).toBeVisible();
    const row = matrix.getByRole("row", { name: /Tyyppi Timo/ });
    await expect(row.locator('[data-level="3"]').first()).toBeVisible();
    await expect(row.locator('[data-level="none"]').first()).toBeVisible();
    // Self-assessment (3) is not used in the matrix: drawings reading shows the supervisor's 2.
    await expect(row.locator('[data-level="2"]').first()).toBeVisible();
    await row.getByRole("link", { name: "Tyyppi Timo" }).click();
    await expect(page.getByTestId("competence-table")).toBeVisible();
  });

  test("cards: validity with text and colour, filter, add card with reminder and attachment", async ({ page }, testInfo) => {
    acceptDialogs(page);
    await page.goto("/c/sk-infra-demo/workforce/qualifications");
    await expect(page.getByTestId("all-qualifications").getByText("Vanhenee kuukauden sisällä").first()).toBeVisible();
    await expect(page.getByTestId("all-qualifications").getByText("Vanhentunut").first()).toBeVisible();
    await page.getByTestId("qualification-filters").getByLabel("Tila").selectOption("EXPIRED");
    await page.getByRole("button", { name: "Suodata" }).click();
    await expect(page.locator('[data-validity="VALID"]')).toHaveCount(0);
    await expect(page.locator('[data-validity="EXPIRED"]').first()).toBeVisible();

    await openCard(page, "Tyyppi Timo");
    await page.getByRole("link", { name: "Pätevyydet" }).click();
    const name = unique(testInfo, "Tieturva");
    await page.getByTestId("add-qualification").locator("summary").click();
    const form = page.getByTestId("add-qualification");
    await form.getByLabel("Kortin tai pätevyyden nimi").fill(name);
    await form.getByLabel("Viimeinen voimassaolopäivä").fill("2031-05-31");
    await form.getByRole("button", { name: "Tallenna" }).click();
    const item = page.getByTestId("qualification-list").locator("li", { hasText: name });
    await expect(item.getByText("Voimassa", { exact: true })).toBeVisible();
    await expect(item.getByTestId("reminder-info")).toContainText("30.4.2031");
    // Attach the card image (PDF accepted, checked by content).
    await item.getByText("Liitä tiedosto").click();
    await item.locator('input[type="file"]').setInputFiles(PDF);
    await item.getByRole("button", { name: "Lisää tiedosto" }).click();
    await expect(item.getByRole("link", { name: /todistus\.pdf/ })).toBeVisible();
  });

  test("settings: reminder address and mail status; run reminders now", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/workforce/settings");
    await expect(page.getByTestId("mail-status")).toBeVisible();
    await expect(page.getByLabel("Ylläpidon sähköpostiosoite")).toHaveValue("henkilosto@skinfra.example.com");
    await page.getByRole("button", { name: "Lähetä erääntyneet muistutukset nyt" }).click();
    await expect(page.getByTestId("reminder-run-result")).toBeVisible();
    await expect(page.getByTestId("area-list")).toContainText("Kaivannot ja luiskat");
  });

  test("summary lists expiring cards, open actions and items", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/workforce/overview");
    await expect(page.getByTestId("overview-expiring")).toContainText("Tyyppi Timo");
    await expect(page.getByTestId("overview-actions")).toContainText("Piirustustenluvun koulutus");
    await expect(page.getByTestId("overview-inspections")).toContainText("Valjaat");
    await expect(page.getByTestId("overview-gaps")).toContainText("Tyyppi Timo");
  });
});

test.describe("supervisor", () => {
  test.use({ storageState: authFile("supervisor") });

  test("sees the subordinate's emergency contact and assesses competence, not clothing", async ({ page }) => {
    await openCard(page, "Tyyppi Timo");
    await expect(page.getByText("Tiina Tyyppi")).toBeVisible();
    await expect(page.getByRole("link", { name: "Varusteet" })).toHaveCount(0);
    await page.getByRole("link", { name: "Osaaminen" }).click();
    await expect(page.getByTestId("assessment-history").locator('[data-status="DRAFT"]').first()).toBeVisible();
    await page.getByTestId("new-assessment").locator("summary").click();
    const form = page.getByTestId("new-assessment");
    await form.getByLabel("Osaamisalue").selectOption({ label: "Mittaus · Koneohjaus" });
    await form.getByLabel("Osaamistaso").selectOption("2");
    await form.getByLabel("Käytännön havainnot ja perustelut").fill("Käyttää koneohjausta ohjattuna.");
    await form.getByRole("button", { name: "Julkaise" }).click();
    await expect(page.getByTestId("assessment-history")).toContainText("Käyttää koneohjausta ohjattuna.");
  });
});

test.describe("employee (own card)", () => {
  test.use({ storageState: authFile("employee") });

  test("opens the own card, sees published assessments only, comments and acknowledges", async ({ page }, testInfo) => {
    await page.goto("/c/sk-infra-demo/dashboard");
    await navigate(page, testInfo, "Oma kortti");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Timo Tyyppi");
    await page.getByRole("link", { name: "Osaaminen" }).click();
    const history = page.getByTestId("assessment-history");
    await expect(history.locator('[data-kind="SUPERVISOR"][data-status="DRAFT"]')).toHaveCount(0);
    await expect(history).toContainText("Noudattaa työmaan turvallisuusohjeita");
    await expect(page.getByTestId("new-assessment")).toHaveCount(0);
    const comment = page.getByTestId("assessment-comment").first();
    await comment.locator("summary").click();
    await comment.getByLabel("Oma kommenttini").fill(`Kiitos palautteesta (${testInfo.project.name})`);
    await comment.getByRole("button", { name: "Tallenna kommentti" }).click();
    await expect(history).toContainText(`Kiitos palautteesta (${testInfo.project.name})`);

    await page.getByRole("link", { name: "Pätevyydet" }).click();
    const ack = page.getByRole("button", { name: "Kuittaa perehdytys" });
    if (await ack.count()) {
      await ack.first().click();
      await expect(page.getByText(/Työntekijä kuitannut/).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Myönnä käyttölupa" })).toHaveCount(0);

    await page.getByRole("link", { name: "Varusteet" }).click();
    await expect(page.getByTestId("clothing-history")).toContainText("Huomiotakki");
    await expect(page.getByTestId("issue-clothing")).toHaveCount(0);
    if (isMobile(testInfo)) await expect(page.getByTestId("company-items")).toBeVisible();
  });

  test("the register is not available; the employee lands on the own card", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/workforce");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Timo Tyyppi");
    await page.goto("/c/sk-infra-demo/workforce/qualifications");
    await expect(page.getByTestId("all-qualifications")).not.toContainText("Esimerkki Antti");
  });
});

test.describe("client", () => {
  test.use({ storageState: authFile("client") });

  test("never reaches HR pages", async ({ page }) => {
    await page.goto("/c/sk-infra-demo/workforce/matrix");
    await expect(page).toHaveURL(/\/portal/);
  });
});
