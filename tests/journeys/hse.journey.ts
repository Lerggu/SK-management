/**
 * Journey: Työturvallisuuspäällikkö (HSE), Riikka Harjoitus.
 * Walks the HSE work on the steel mill demo site: key figures, observations,
 * near misses, an incident with investigation, corrective actions, permits,
 * a risk assessment, an MVR measurement, a toolbox talk and orientations.
 */
import { expect, test } from "@playwright/test";
import { COMPANY, Journey, openAs, lbl } from "./journey";

const T = { timeout: 8000 };
const PROJECT = "NSM-001 · Nordic Steel Mill Demo";
const SITE = "Sulatto (EAF)";

test("hse", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const page = await openAs(browser, testInfo, "hse");
  const j = new Journey(page, testInfo, "hse");
  const stamp = Date.now();
  const h1 = () => page.getByRole("heading", { level: 1 });
  const dueIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  /** Opens a menu item as a person would: sidebar on desktop, bottom bar or "Lisää" on the phone. */
  const openMenu = async (label: string, group?: string): Promise<string | void> => {
    if (j.mobile) {
      const bar = page.getByTestId("mobile-nav").getByRole("link", { name: label, exact: true });
      if (await bar.count()) {
        await bar.click(T);
        return;
      }
      await page.getByTestId("mobile-more").click(T);
      await page.getByRole("dialog").getByRole("link", { name: label, exact: true }).click(T);
      return `"${label}" löytyi puhelimella vasta Lisää-valikon kautta`;
    }
    const nav = page.getByRole("navigation", { name: "Päävalikko" });
    if (group) {
      const btn = nav.getByRole("button", { name: group, exact: true });
      if ((await btn.getAttribute("aria-expanded", T)) !== "true") await btn.click(T);
    }
    await nav.getByRole("link", { name: label, exact: true }).click(T);
  };

  /** Back to the HSE register from a detail page (the page's own back link). */
  const backToHse = async () => {
    await page.getByRole("main").getByRole("link", { name: "Työturvallisuus", exact: true }).click(T);
    await expect(h1()).toHaveText("Työturvallisuus", T);
  };

  const selectSite = async (form: import("@playwright/test").Locator) => {
    const site = form.getByLabel(lbl("Työmaa"));
    if (await site.count()) await site.selectOption({ label: SITE }, T);
  };

  const obsTitle = `Kypärä puuttui nosturiradalla ${stamp}`;
  const obsAction = `Kypäräpakko muistutus aamupalaverissa ${stamp}`;
  const nearMissTitle = `Palkki heilahti ilman taglinea ${stamp}`;
  const incTitle = `Käsi puristui palkin ja tuen väliin ${stamp}`;
  const incAction = `Puristumisvaaran merkintä ja ohjeistus ${stamp}`;
  const permitWork = `Uunin kuoriosien hitsaus ${stamp}`;
  const riskTitle = `Nosturiradan palkkien asennus +12 m ${stamp}`;
  const hazard = `Putoaminen +12 m tasolta ${stamp}`;
  const mvrNote = `MVR-kierros sulatto ${stamp}`;
  const talkTopic = `Perehdytys: tulityöt sulatossa ${stamp}`;

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(h1()).toBeVisible(T);
  });

  await j.step("Avaa Työturvallisuus valikosta", async () => {
    const note = await openMenu("Työturvallisuus");
    await expect(h1()).toHaveText("Työturvallisuus", T);
    return note;
  });

  await j.step("Valitse projekti NSM-001", async () => {
    const picker = page.getByTestId("project-picker");
    await picker.getByLabel("Projekti").selectOption({ label: PROJECT }, T);
    await picker.getByRole("button", { name: "Näytä" }).click(T);
    await expect(page).toHaveURL(/[?&]project=/, T);
  });

  await j.step("Tarkista tunnusluvut", async () => {
    await expect(page.getByRole("heading", { name: "Tunnusluvut" })).toBeVisible(T);
    await expect(page.getByTestId("metric-ltif")).toBeVisible(T);
    await expect(page.getByTestId("metric-mvr")).toContainText("%", T);
    await expect(page.getByTestId("metric-actions")).toBeVisible(T);
  });

  await j.step("Avaa vakava tapaturma ja tarkista tutkinnan tila", async () => {
    const urgent = page.getByTestId("hse-urgent");
    await expect(urgent).toContainText("Vakavat tapaturmat käsittelyssä", T);
    await urgent.getByRole("link", { name: /Kaatuminen telineeltä/ }).click(T);
    await expect(h1()).toContainText("Kaatuminen telineeltä", T);
    await expect(page.getByTestId("incident-severity")).toHaveText("Poissaoloon johtanut", T);
    await expect(page.getByRole("heading", { name: "Loukkaantuneet (henkilötiedot)" })).toBeVisible(T);
    await expect(page.getByText("Sulkeminen odottaa korjaavien toimenpiteiden hyväksyntää", { exact: false })).toBeVisible(T);
    await backToHse();
  });

  await j.step("Kirjaa turvallisuushavainto", async () => {
    await page.getByTestId("hse-quick").getByRole("link", { name: "Turvallisuushavainto", exact: true }).click(T);
    await expect(h1()).toHaveText("Turvallisuushavainto", T);
    const form = page.getByTestId("observation-form");
    await form.getByLabel("Aihe").selectOption({ label: "Suojaimet" }, T);
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(obsTitle, T);
    await form.getByLabel("Vakavuus").selectOption({ label: "Kohtalainen" }, T);
    await selectSite(form);
    await form.getByLabel("Paikka").fill("Sulatto, linja 3", T);
    await form.getByLabel("Kuvaus").fill("Asentaja nosturiradalla ilman kypärää, ohjattu hakemaan suojain.", T);
    await form.getByRole("button", { name: "Lähetä ilmoitus" }).click(T);
    await expect(h1()).toContainText(obsTitle, T);
  });

  await j.step("Käsittele havainto", async () => {
    const form = page.getByTestId("triage-form");
    await form.getByLabel("Vakavuus").selectOption({ label: "Kohtalainen" }, T);
    await form.getByRole("button", { name: "Käsittele" }).click(T);
    await expect(page.getByText("Käsitelty", { exact: true }).first()).toBeVisible(T);
  });

  await j.step("Lisää havainnolle toimenpide vastuuhenkilöineen", async () => {
    await page.getByText("Lisää korjaava toimenpide", { exact: true }).click(T);
    const form = page.getByTestId("action-form");
    await form.getByLabel("Toimenpide").fill(obsAction, T);
    await form.getByLabel("Vastuuhenkilö").selectOption({ index: 1 }, T);
    await form.getByLabel("Määräaika").fill(dueIn(3), T);
    await form.getByRole("button", { name: "Luo" }).click(T);
    await expect(page.getByTestId("hse-actions")).toContainText(obsAction, T);
    await backToHse();
  });

  await j.step("Kirjaa läheltä piti -tilanne", async () => {
    await page.getByTestId("hse-quick").getByRole("link", { name: "Läheltä piti", exact: true }).click(T);
    await expect(h1()).toHaveText("Läheltä piti -ilmoitus", T);
    const form = page.getByTestId("observation-form");
    await expect(form.getByLabel("Ilmoituksen tyyppi")).toHaveValue("NEAR_MISS", T);
    await form.getByLabel("Aihe").selectOption({ label: "Nostot" }, T);
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(nearMissTitle, T);
    await form.getByLabel("Vakavuus").selectOption({ label: "Vakava" }, T);
    await selectSite(form);
    await form.getByRole("button", { name: "Lähetä ilmoitus" }).click(T);
    await expect(h1()).toContainText(nearMissTitle, T);
    await backToHse();
  });

  await j.step("Ilmoita tapaturma", async () => {
    await page.getByTestId("hse-quick").getByRole("link", { name: "Tapaturma", exact: true }).click(T);
    await expect(h1()).toHaveText("Tapaturmailmoitus", T);
    const form = page.getByTestId("incident-form");
    await form.getByLabel("Tapahtuman tyyppi").selectOption({ label: "Henkilövahinko" }, T);
    await form.getByLabel("Vakavuus").selectOption({ label: "Lääkärihoito" }, T);
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(incTitle, T);
    await selectSite(form);
    await form.getByLabel("Paikka").fill("Sulatto, linja 2", T);
    await form.getByLabel("Kuvaus").fill("Palkkia sovitettaessa käsi jäi palkin ja tuen väliin.", T);
    await form.getByLabel("Välittömät toimenpiteet").fill("Ensiapu, kuljetus työterveyteen, työ keskeytetty", T);
    await form.getByRole("button", { name: "Lähetä tapaturmailmoitus" }).click(T);
    await expect(h1()).toContainText(incTitle, T);
  });

  await j.step("Käsittele tapaturma", async () => {
    const form = page.getByTestId("incident-triage-form");
    await form.getByRole("button", { name: "Käsittele" }).click(T);
    await expect(page.getByRole("button", { name: "Aloita tutkinta" })).toBeVisible(T);
  });

  await j.step("Kirjaa loukkaantunut henkilö", async () => {
    const form = page.getByTestId("person-form");
    const name = `Testi Asentaja ${stamp}`;
    await form.getByLabel("Nimi").fill(name, T);
    await form.getByLabel("Työnantaja").fill("Teräs Demo AB", T);
    await form.getByLabel("Vamman sijainti").fill("Vasen käsi", T);
    await form.getByLabel("Poissaolopäivät").fill("0", T);
    await form.getByLabel("Vamman kuvaus").fill("Ruhje (fiktiivinen)", T);
    await form.getByRole("button", { name: "Lisää henkilö" }).click(T);
    await expect(page.getByTestId("incident-persons")).toContainText(name, T);
  });

  await j.step("Aloita tutkinta ja kirjaa juurisyy", async () => {
    await page.getByRole("button", { name: "Aloita tutkinta" }).click(T);
    const form = page.getByTestId("investigation-form");
    await form.getByLabel("Juurisyy").fill("Puristumisvaaraa ei ollut tunnistettu työn suunnittelussa", T);
    await form.getByLabel("Poissaolopäivät").fill("0", T);
    await form.getByRole("button", { name: "Tallenna tutkinta" }).click(T);
    await expect(form.getByRole("status")).toBeVisible(T);
  });

  await j.step("Lisää tapaturmalle korjaava toimenpide", async () => {
    await page.getByText("Lisää korjaava toimenpide", { exact: true }).click(T);
    const form = page.getByTestId("action-form");
    await form.getByLabel("Toimenpide").fill(incAction, T);
    await form.getByLabel("Vastuuhenkilö").selectOption({ index: 1 }, T);
    await form.getByLabel("Määräaika").fill(dueIn(5), T);
    await form.getByRole("button", { name: "Luo" }).click(T);
    await expect(page.getByTestId("hse-actions")).toContainText(incAction, T);
    // Closing now waits for the project manager's approval of the action.
    await expect(page.getByText("Sulkeminen odottaa korjaavien toimenpiteiden hyväksyntää", { exact: false })).toBeVisible(T);
    await backToHse();
  });

  await j.step("Pyydä tulityölupa", async () => {
    await page.getByTestId("hse-quick").getByRole("link", { name: "Pyydä työlupa", exact: true }).click(T);
    await expect(h1()).toHaveText("Työlupapyyntö", T);
    const form = page.getByTestId("permit-form");
    await form.getByLabel("Työluvan tyyppi").selectOption({ label: "Tulityö" }, T);
    await form.getByLabel("Urakoitsija").fill("Teräs Demo AB", T);
    await form.getByLabel("Työ" + "n kuvaus", { exact: true }).fill(permitWork, T);
    await selectSite(form);
    await form.getByLabel("Paikka").fill("Sulatto, linja 4", T);
    await form.getByLabel("Varotoimet").fill("Sammutin, palovartija 1 h työn jälkeen", T);
    await form.getByRole("button", { name: "Pyydä työlupa" }).click(T);
    await expect(h1()).toContainText("Työlupa #", T);
    await expect(page.getByText(permitWork)).toBeVisible(T);
    // Own request: the four-eyes rule blocks self-approval.
    await expect(page.getByText("Et voi hyväksyä itse laatimaasi.")).toBeVisible(T);
    await backToHse();
  });

  await j.step("Tarkista hyväksyntää odottava työlupa", async () => {
    await page.getByRole("link", { name: /Hyllyasennus nostimelta/ }).first().click(T);
    await expect(h1()).toContainText("Korkealla työskentely", T);
    await expect(page.getByRole("button", { name: "Hyväksy työlupa" })).toBeVisible(T);
    await expect(page.getByRole("button", { name: "Hylkää" })).toBeVisible(T);
    // The demo permit is left undecided for the other roles' journeys.
    await backToHse();
  });

  await j.step("Luo riskiarvio", async () => {
    await page.getByText("Uusi riskiarvio", { exact: true }).click(T);
    const form = page.getByTestId("risk-form");
    await form.getByLabel("Työ / riskiarvion nimi").fill(riskTitle, T);
    await selectSite(form);
    await form.getByLabel("Työn kuvaus").fill("Palkit nostetaan ajoneuvonosturilla, asennus henkilönostimesta.", T);
    await form.getByRole("button", { name: "Luo" }).click(T);
    await expect(h1()).toHaveText(riskTitle, T);
  });

  await j.step("Lisää riskiarvioon vaara", async () => {
    const form = page.getByTestId("risk-item-form");
    await form.getByLabel(lbl("Vaara")).fill(hazard, T);
    await form.getByLabel(lbl("Todennäköisyys 1–5")).selectOption("4", T);
    await form.getByLabel(lbl("Seuraus 1–5")).selectOption("5", T);
    await form.getByLabel(lbl("Jäännös: todennäköisyys")).selectOption("2", T);
    await form.getByLabel(lbl("Jäännös: seuraus")).selectOption("5", T);
    await form.getByLabel("Hallintakeinot").fill("Valjaat ja kiinnityspisteet, nostimen tarkastus, alue eristetty", T);
    await form.getByRole("button", { name: "Lisää vaara" }).click(T);
    await expect(page.getByTestId("risk-items")).toContainText(hazard, T);
    // Self-approval is blocked: another HSE/PM approves.
    await expect(page.getByText("Et voi hyväksyä itse laatimaasi.")).toBeVisible(T);
    await backToHse();
  });

  await j.step("Kirjaa MVR-mittaus", async () => {
    await page.getByText("Uusi tarkastus (MVR/TR)", { exact: true }).click(T);
    const form = page.getByTestId("inspection-form");
    await form.getByLabel("Tarkastus").selectOption({ label: "MVR-mittaus" }, T);
    await form.getByLabel("Kunnossa (kpl)").fill("46", T);
    await form.getByLabel("Puutteita (kpl)").fill("4", T);
    await selectSite(form);
    await form.getByLabel("Huomiot").fill(mvrNote, T);
    await form.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(h1()).toContainText("MVR-mittaus", T);
    await expect(page.getByText(mvrNote)).toBeVisible(T);
    await backToHse();
  });

  await j.step("Kirjaa työmaakokous ja perehdytys", async () => {
    await page.getByText("Kirjaa työmaakokous", { exact: true }).click(T);
    const form = page.getByTestId("toolbox-form");
    await form.getByLabel("Aihe").fill(talkTopic, T);
    await form.getByLabel("Osallistujia").fill("12", T);
    await form.getByLabel("Pitäjä").fill("Riikka Harjoitus", T);
    await form.getByRole("button", { name: "Tallenna" }).click(T);
    await expect(page.getByTestId("toolbox-list")).toContainText(talkTopic, T);
  });

  await j.step("Merkitse toimenpide tehdyksi ja hyväksy", async () => {
    const row = page.getByTestId("hse-actions").locator("li").filter({ hasText: obsAction });
    await row.getByRole("button", { name: "Merkitse tehdyksi" }).click(T);
    await expect(row).toContainText("Tehty – odottaa hyväksyntää", T);
    await row.getByRole("button", { name: "Hyväksy", exact: true }).click(T);
    // Verified actions drop off the open list.
    await expect(row).toHaveCount(0, T);
  });

  await j.step("Katso perehdytysten tilanne", async () => {
    const note = await openMenu("HR-yleiskuva", "Henkilöstö");
    await expect(h1()).toHaveText("Henkilöstön yhteenveto", T);
    await expect(page.getByRole("heading", { name: /Keskeneräiset ja uusittavat perehdytykset/ })).toBeVisible(T);
    return note;
  });

  j.write();
});
