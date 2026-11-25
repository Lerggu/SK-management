/**
 * Journey: Aliurakoitsija (Subcontractor, external) — Aliurakka Demo Oy.
 * Mostly on the phone, in the portal only: own reports, shared documents,
 * safety observation, work permit request, and a check that no cost or price
 * data is visible.
 */
import { expect, test, type Page } from "@playwright/test";
import { COMPANY, Journey, openAs, lbl } from "./journey";

const T = { timeout: 8000 };
// Minimal JPEG header; the server checks the type by file name.
const photo = { name: "havainto.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) };

/** Cost/price words and money amounts that a subcontractor must never see. */
const PRICE_PATTERNS: RegExp[] = [
  /€/,
  /\bEUR\b/,
  /\b(hinta|hinnat|hinnoittelu|kustannus\w*|tuntihinta\w*|laskutus\w*|laskutushinta|kate|katteet|alv|budjetti|ennuste)\b/i,
  // Money-like amounts with a thousands group (file sizes such as "0,04" are not flagged).
  /\b\d{1,3}(?:[\s ]\d{3})+,\d{2}\b/,
];

async function priceFindings(page: Page, where: string): Promise<string[]> {
  const text = await page.locator("main").innerText(T).catch(() => "");
  const out: string[] = [];
  for (const re of PRICE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const i = m.index ?? 0;
      out.push(`${where}: "${text.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, " ").trim()}"`);
    }
  }
  return out;
}

test("subcontractor", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "subcontractor");
  const j = new Journey(page, testInfo, "subcontractor");
  const h1 = page.getByRole("heading", { level: 1 });
  const main = page.locator("main");
  const stamp = Date.now().toString(36);
  const obsTitle = `Suojalasit puuttuvat hiontapisteeltä ${stamp}`;
  const permitWork = `Nosturiradan palkkien pultitus ${stamp}`;

  /** Visible menu: bottom bar (or "Lisää") on phones, sidebar on desktop. */
  const menu = async (label: string) => {
    if (j.mobile) {
      const link = page.getByTestId("mobile-nav").getByRole("link", { name: label, exact: true });
      if (await link.count()) await link.click(T);
      else {
        await page.getByTestId("mobile-more").click(T);
        await page.getByRole("dialog").getByRole("link", { name: label, exact: true }).click(T);
      }
    } else {
      await page.locator("aside").getByRole("link", { name: label, exact: true }).click(T);
    }
    await expect(h1).toBeVisible(T);
  };
  /** Back to the project portal with the page's own back link. */
  const backToPortal = async () => {
    await main.getByRole("link", { name: "Portaali", exact: true }).first().click(T);
    await expect(page).toHaveURL(/\/portal\/[^/?]+/, T);
    await expect(h1).toBeVisible(T);
  };

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(page).toHaveURL(/\/portal/, T);
    await expect(h1).toBeVisible(T);
  });

  await j.step("Avaa portaali valikosta", async () => {
    await menu("Portaali");
    await expect(page).toHaveURL(/\/portal\/[^/?]+/, T);
    await expect(h1).toContainText(/NSM-001|NDC-001/, T);
    if (!(await h1.innerText()).includes("NSM-001")) return "Projekti ei ole terästehtaan teemassa (NDC-001 näkyy, demo-steel-theme ei ajettu?)";
  });

  await j.step("Tarkista, että olen aliurakoitsijaportaalissa", async () => {
    await expect(page.getByText("Aliurakoitsijaportaali").first()).toBeVisible(T);
    await expect(page.getByTestId("portal-quick")).toBeVisible(T);
  });

  await j.step("Etsi omat tehtävät ja töiden kuittaus", async () => {
    const tasks = await main.getByRole("heading", { name: /tehtäv/i }).count();
    const ack = await main.getByRole("button", { name: /kuittaa|valmis|tehty/i }).count();
    if (tasks === 0 && ack === 0) return "Portaalissa ei ole omien tehtävien listaa eikä töiden kuittausta – en löydä, mitä minun pitää tehdä ja milloin";
  });

  await j.step("Etsi aikataulu", async () => {
    const schedule = main.getByRole("heading", { name: "Aikataulu ja eteneminen" });
    if ((await schedule.count()) === 0) return "Aliurakoitsija ei näe aikataulua portaalissa (näkyy vain asiakkaalle) – en tiedä, milloin työni alkavat";
    await expect(schedule).toBeVisible(T);
  });

  await j.step("Katso omat ilmoitukset ja työluvat", async () => {
    await expect(main.getByRole("heading", { name: "Omat ilmoitukset ja työluvat" })).toBeVisible(T);
    await expect(main.getByRole("link", { name: /Kannakkeiden hitsaus/ })).toBeVisible(T);
    await expect(main.getByRole("link", { name: /heilahti noston aikana/ })).toBeVisible(T);
  });

  await j.step("Avaa hyväksytty työlupa", async () => {
    await main.getByRole("link", { name: /Kannakkeiden hitsaus/ }).click(T);
    await expect(h1).toContainText(/Työlupa #\d+ · Tulityö/, T);
    await expect(main.getByText("Hyväksytty").first()).toBeVisible(T);
    await expect(main.getByText("Palovartija nimetty")).toBeVisible(T);
    await backToPortal();
  });

  await j.step("Avaa jaettu sähkökaavio", async () => {
    const docs = main.getByRole("heading", { name: "Jaetut dokumentit" });
    await docs.scrollIntoViewIfNeeded(T);
    await main.getByRole("link", { name: /110 kV kytkinlaitoksen pääkaavio/ }).click(T);
    await expect(h1).toHaveText("110 kV kytkinlaitoksen pääkaavio", T);
    const current = page.getByTestId("current-version");
    await expect(current).toContainText("Hyväksytty", T);
    await expect(main.getByRole("link", { name: /Lataa/ }).first()).toBeVisible(T);
    // Revision B is still pending approval: externals see only revision A.
    const pendingVisible = await main.getByText("Odottaa hyväksyntää").count();
    await backToPortal();
    if (pendingVisible > 0) return "Hyväksymätön revisio näkyy aliurakoitsijalle";
  });

  await j.step("Avaa jaettu RAMS", async () => {
    await main.getByRole("link", { name: /RAMS –/ }).click(T);
    await expect(h1).toContainText("RAMS", T);
    await expect(page.getByTestId("current-version")).toContainText("Hyväksytty", T);
    await backToPortal();
  });

  await j.step("Toimita RAMS portaalista", async () => {
    const form = page.getByTestId("deliver-form");
    if ((await form.count()) === 0) return "Portaalissa ei ole tapaa toimittaa dokumenttia (esim. RAMS, pätevyystodistus) – joudun lähettämään sen sähköpostilla";
    const title = `RAMS palkkien pultitus ${stamp}`;
    await form.getByLabel(lbl("Dokumentin nimi")).fill(title, T);
    await form.getByLabel(lbl("Tiedosto")).setInputFiles({ name: "rams.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 journey") }, T);
    await form.getByRole("button", { name: "Lähetä dokumentti" }).click(T);
    await expect(page.getByText("Kiitos! Dokumentti on toimitettu hyväksyttäväksi.")).toBeVisible(T);
    await expect(page.getByTestId("own-deliveries")).toContainText(title, T);
    await expect(page.getByTestId("own-deliveries")).toContainText("Odottaa hyväksyntää", T);
  });

  await j.step("Kokeile Uusi dokumentti -sivua", async () => {
    // No menu entry for documents in the portal: a direct URL is the only way.
    await page.goto(`${COMPANY}/documents`);
    await expect(h1).toBeVisible(T);
    const newLink = main.getByRole("link", { name: "Uusi dokumentti" });
    if ((await newLink.count()) === 0) return "Dokumentit-sivulla ei ole Uusi dokumentti -painiketta";
    await newLink.click(T);
    await expect(h1).toHaveText("Uusi dokumentti", T);
    const form = main.getByLabel("Otsikko");
    if ((await form.count()) === 0) return "Uusi dokumentti -painike näkyy, mutta sivulla ei ole lomaketta (aliurakoitsija ei voi toimittaa dokumentteja) – painike on harhaanjohtava";
    return "Uusi dokumentti -lomake avautui aliurakoitsijalle, vaikka palvelu estää ulkoisten dokumentit";
  });

  await j.step("Palaa portaaliin", async () => {
    await menu("Portaali");
    await expect(page).toHaveURL(/\/portal\/[^/?]+/, T);
  });

  await j.step("Ilmoita turvallisuushavainto kuvan kanssa", async () => {
    await page.getByTestId("portal-quick").getByRole("link", { name: "Turvallisuushavainto" }).click(T);
    await expect(h1).toHaveText("Turvallisuushavainto", T);
    const form = page.getByTestId("observation-form");
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(obsTitle, T);
    await form.getByLabel("Aihe").selectOption({ label: "Suojaimet" }, T);
    await form.getByLabel("Vakavuus").selectOption({ label: "Kohtalainen" }, T);
    const site = form.getByLabel("Työmaa");
    let note: string | undefined;
    if (await site.count()) {
      const labels = await site.locator("option").allInnerTexts();
      const pick = labels.find((l) => /Sulatto/.test(l)) ?? labels.find((l) => l !== "Ei valittu");
      if (pick) await site.selectOption({ label: pick }, T);
      if (!pick || !/Sulatto/.test(pick)) note = "Työmaata Sulatto (EAF) ei löytynyt valinnoista";
    }
    await form.getByLabel("Paikka").fill("Sulatto, linja 3", T);
    await form.getByLabel(lbl("Kuvaus")).fill("Hiontapisteellä ei ole suojalaseja saatavilla.", T);
    await form.getByLabel(lbl("Kuva")).setInputFiles(photo, T);
    await form.getByRole("button", { name: "Lähetä ilmoitus" }).click(T);
    await expect(page.getByText("Kiitos! Ilmoitus on vastaanotettu.")).toBeVisible(T);
    return note;
  });

  await j.step("Näe havainto omissa ilmoituksissa", async () => {
    await expect(main.getByRole("link", { name: new RegExp(stamp) })).toBeVisible(T);
  });

  await j.step("Pyydä työlupa korkealla työskentelyyn", async () => {
    await page.getByTestId("portal-quick").getByRole("link", { name: "Pyydä työlupa" }).click(T);
    await expect(h1).toHaveText("Työlupapyyntö", T);
    const form = page.getByTestId("permit-form");
    await form.getByLabel("Työluvan tyyppi").selectOption({ label: "Korkealla työskentely" }, T);
    await form.getByLabel("Urakoitsija").fill("Aliurakka Demo Oy", T);
    await form.getByLabel(lbl("Työn kuvaus")).fill(permitWork, T);
    await form.getByLabel("Paikka").fill("Sulatto, linja 5, +12 m", T);
    await form.getByLabel("Varotoimet").fill("Henkilönostin, valjaat, alue eristetty", T);
    await form.getByRole("button", { name: "Pyydä työlupa" }).click(T);
    await expect(page.getByText("Kiitos! Ilmoitus on vastaanotettu.")).toBeVisible(T);
    await expect(main.getByRole("link", { name: new RegExp(permitWork) })).toBeVisible(T);
  });

  await j.step("Tarkista, ettei muiden ilmoituksia näy", async () => {
    await expect(main.getByText(/Teräspalkkien välissä kulkuväylä tukossa|Kaapelikelojen välissä kulkuväylä tukossa/)).toHaveCount(0, T);
    await expect(main.getByText(/Kaatuminen telineeltä|Viiltohaava kaapelin kuorinnassa/)).toHaveCount(0, T);
  });

  await j.step("Tarkista, ettei kustannuksia tai hintoja näy", async () => {
    const findings: string[] = [];
    findings.push(...(await priceFindings(page, "portaali")));
    // Safety figures and variations are client-only sections.
    if (await main.getByRole("heading", { name: /Hyväksyttävät muutostyöt|Työturvallisuus/ }).count()) findings.push("portaali: asiakkaan osio (muutostyöt / tunnusluvut) näkyy");
    const docLinks = main.getByRole("heading", { name: "Jaetut dokumentit" }).locator("xpath=following::a[contains(@href,'/documents/')]");
    const hrefs = (await docLinks.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""))).filter(Boolean).slice(0, 5);
    const portalUrl = page.url();
    for (const href of hrefs) {
      await page.goto(href);
      await expect(h1).toBeVisible(T);
      findings.push(...(await priceFindings(page, `dokumentti ${(await h1.innerText()).slice(0, 40)}`)));
    }
    await page.goto(portalUrl);
    await expect(h1).toBeVisible(T);
    if (findings.length) return `Mahdollisia hinta- tai kustannustietoja: ${findings.slice(0, 6).join(" | ")}`;
  });

  await j.step("Sisäiset sivut eivät aukea", async () => {
    // Deliberate direct URLs: an external user must be kept in the portal.
    const leaked: string[] = [];
    for (const path of ["projects", "billing", "equipment"]) {
      await page.goto(`${COMPANY}/${path}`);
      await page.waitForURL(/\/portal/, T).catch(() => {});
      if (!/\/portal/.test(page.url())) leaked.push(path);
    }
    await expect(h1).toBeVisible(T);
    if (leaked.length) return `Sisäinen sivu aukesi aliurakoitsijalle: ${leaked.join(", ")}`;
  });

  j.write();
});
