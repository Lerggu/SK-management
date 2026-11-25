/**
 * Role journey: Logistiikkakoordinaattori (Logistics Coordinator), Jari Kuvitteellinen.
 * Logistics board and gate schedule, booking and receiving a delivery, a lift
 * request and its approval, the production calendar and staffing (also the
 * AI suggestion), an equipment booking, the site map (object, task on a gate),
 * and reporting and acknowledging a deviation.
 * Runs on the steel mill demo (scripts/demo-steel-theme.py).
 */
import { expect, test } from "@playwright/test";
import { seedDate } from "../e2e/helpers";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const SITE = "NSM-001 · Sulatto (EAF)";
const SITE_NAME = "Sulatto (EAF)";
const PROJECT = "NSM-001 · Nordic Steel Mill Demo";
const SEEDED_DELIVERY = "Uunin kuoriosat 4 kpl";

/** yyyy-mm-dd in Helsinki, `days` from today. */
function helsinkiDay(days = 0) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Helsinki" });
}

test("logistics", async ({ browser }, testInfo) => {
  const page = await openAs(browser, testInfo, "logistics");
  const j = new Journey(page, testInfo, "logistics");
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const material = `Valokaaren elektrodit J${stamp}`;
  const liftTitle = `Kuonakauhan nosto J${stamp}`;
  const objectCode = `N${stamp}`.slice(0, 12);
  const deviationComment = `Nosturin rajakytkin vikaantui J${stamp}`;
  const bookingNote = `Kaapelikelavaunu sulatolle J${stamp}`;
  // The day the demo data was seeded (falls back to today), so seeded deliveries are on the board.
  const boardDay = seedDate() ?? helsinkiDay();
  const bookingDay = helsinkiDay(j.mobile ? 21 : 20);
  const liftStart = j.mobile ? "14:00" : "13:00";
  const liftEnd = j.mobile ? "15:00" : "14:00";
  let requestUrl: string | null = null;
  const h1 = () => page.getByRole("heading", { level: 1 });
  const tabs = () => page.getByRole("navigation", { name: "Tuotannonohjaus" });

  /** Opens production control from the visible menu (bottom bar on phones, sidebar on desktop). */
  async function openProduction(): Promise<string | void> {
    if (j.mobile) {
      const bar = page.getByTestId("mobile-nav");
      const link = bar.getByRole("link", { name: "Tuotannonohjaus", exact: true });
      if (await link.count()) {
        await link.click(T);
        await tabs().getByRole("link", { name: "Logistiikka", exact: true }).click(T);
        return;
      }
      await page.getByTestId("mobile-more").click(T);
      await page.getByRole("dialog").getByRole("link", { name: "Logistiikka", exact: true }).click(T);
      return "Logistiikka löytyi vasta Lisää-valikon kautta";
    }
    const aside = page.locator("aside");
    const link = aside.getByRole("link", { name: "Logistiikka", exact: true });
    if (!(await link.isVisible())) await aside.getByRole("button", { name: "Tuotannonohjaus" }).click(T);
    await link.click(T);
  }

  /** Switches the production control tab. */
  async function tab(name: string) {
    await tabs().getByRole("link", { name, exact: true }).click(T);
    await expect(h1()).toBeVisible(T);
  }

  /** Chooses the site and the day on the logistics board (GET picker). */
  async function pickBoardSite() {
    const picker = page.getByTestId("site-day-picker");
    await picker.getByLabel("Työmaa").selectOption({ label: SITE }, T);
    const date = picker.locator('input[name="date"]');
    if (await date.count()) await date.fill(boardDay, T);
    await picker.getByRole("button", { name: "Näytä" }).click(T);
    await expect(page).toHaveURL(/site=/, T);
  }

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(h1()).toBeVisible(T);
  });

  await j.step("Avaa logistiikkataulu valikosta", async () => {
    const note = await openProduction();
    await expect(h1()).toHaveText("Logistiikkataulu", T);
    return note;
  });

  await j.step("Valitse Sulatto ja katso porttiaikataulu", async () => {
    await pickBoardSite();
    await expect(page.getByText(SITE).first()).toBeVisible(T);
    const timeline = page.getByTestId("gate-timeline");
    await expect(timeline.locator('[data-gate="Portti 1 (pohjoinen)"]')).toBeVisible(T);
    await expect(timeline).toContainText(SEEDED_DELIVERY, T);
  });

  await j.step("Varaa toimitukselle porttiaika", async () => {
    const form = page.getByTestId("delivery-form");
    const timeline = page.getByTestId("gate-timeline");
    const times = j.mobile ? ["16:30", "17:00", "17:30"] : ["15:00", "15:30", "16:00"];
    let tried = 0;
    for (const time of times) {
      tried++;
      await form.getByLabel("Portti").selectOption({ label: "Portti 1 (pohjoinen)" }, T);
      await form.getByLabel("Alkaa klo").fill(time, T);
      await form.getByLabel("Toimittaja").fill("Teräs Demo AB", T);
      await form.getByLabel("Materiaali").fill(material, T);
      await form.getByLabel("Määrä").fill("12 lavaa", T);
      await form.getByLabel("Paino (kg)").fill("9600", T);
      await form.getByRole("button", { name: "Aikatauluta" }).click(T);
      const ok = await timeline
        .getByText(material)
        .first()
        .waitFor({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (ok) return tried > 1 ? `Ensimmäinen aika oli varattu; toimitus meni ${tried}. yrityksellä (${time})` : undefined;
    }
    throw new Error(`Toimitusta ei saatu aikataulutettua (${times.join(", ")})`);
  });

  await j.step("Vastaanota toimitus porttinäkymässä", async () => {
    await page.getByRole("link", { name: "Porttinäkymä" }).click(T);
    await expect(h1()).toHaveText("Porttinäkymä", T);
    const card = page.getByTestId("gate-list").locator("li").filter({ hasText: material });
    await card.getByRole("button", { name: "Saapui portille" }).click(T);
    await expect(card).toHaveAttribute("data-status", "ARRIVED_GATE", T);
    await card.getByRole("button", { name: "Kirjaa sisään" }).click(T);
    await expect(card).toHaveAttribute("data-status", "CHECKED_IN", T);
  });

  await j.step("Kirjaa toimitus varastoon", async () => {
    const card = page.getByTestId("gate-list").locator("li").filter({ hasText: material });
    await card.getByRole("link").first().click(T);
    await expect(h1()).toHaveText(material, T);
    await page.getByTestId("delivery-actions").getByRole("button", { name: "Varastoon" }).click(T);
    await expect(page.getByText("Varastossa", { exact: true }).first()).toBeVisible(T);
  });

  await j.step("Tee nostopyyntö logistiikkatauluun", async () => {
    await page.getByRole("link", { name: "Logistiikkataulu" }).first().click(T);
    await expect(h1()).toHaveText("Logistiikkataulu", T);
    await pickBoardSite();
    const form = page.getByTestId("request-form");
    await form.getByLabel("Palvelu").selectOption({ label: "Nosto" }, T);
    await form.getByLabel("Otsikko").fill(liftTitle, T);
    await form.getByLabel("Alkaa").fill(`${boardDay}T${liftStart}`, T);
    await form.getByLabel("Arvioitu lopetus").fill(`${boardDay}T${liftEnd}`, T);
    await form.getByLabel("Kiireellisyys").selectOption({ label: "Korkea" }, T);
    await form.getByLabel("Raskain kappale (kg)").fill("3200", T);
    await form.getByLabel("Kuorman kuvaus").fill("Kuonakauha, tyhjä", T);
    await form.getByLabel("Tehtävätyyppi").selectOption({ label: "Nosto" }, T);
    await form.getByLabel("Nostosäde (m)").fill("14", T);
    await form.getByLabel("Riggerit (hlö)").fill("2", T);
    await form.getByLabel("Nostoapuvälineet").fill("Nostopalkki 10 t, sakkelit 4 kpl", T);
    await form.getByLabel("Puhelin").fill("+358 40 555 0199", T);
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click(T);
    await expect(h1()).toHaveText(liftTitle, T);
    await expect(page.getByText("Pyydetty", { exact: true }).first()).toBeVisible(T);
    requestUrl = page.url();
  });

  await j.step("Hyväksy nostopyyntö", async () => {
    await page.getByTestId("request-actions").getByRole("button", { name: "Hyväksy", exact: true }).click(T);
    await expect(page.getByText("Hyväksytty", { exact: true }).first()).toBeVisible(T);
  });

  await j.step("Katso tehtävä tuotantokalenterissa", async () => {
    await tab("Kalenteri");
    await expect(h1()).toHaveText("Tuotantokalenteri", T);
    await page.getByRole("group", { name: "Mittakaava" }).getByRole("link", { name: "Viikko", exact: true }).click(T);
    await expect(page).toHaveURL(/zoom=week/, T);
    await expect(page.locator(`[data-task="${liftTitle}"]`)).toBeVisible(T);
  });

  await j.step("Varaa henkilö tehtävään kalenterista", async () => {
    const panel = page.getByTestId("resource-panel");
    await panel.getByRole("button", { name: "Henkilöt", exact: true }).click(T);
    await panel.locator("[data-resource]").first().click(T);
    await expect(page.getByTestId("selected-resource")).toBeVisible(T);
    await page.locator(`[data-task="${liftTitle}"]`).click(T);
    const chooser = page.getByRole("dialog", { name: "Valitse tehtävän rooli" });
    const ok = page.getByRole("status").filter({ hasText: "varattu tehtävään" });
    const failed = page.locator('p[role="alert"]');
    await expect(ok.or(failed).or(chooser).first()).toBeVisible(T);
    if (await chooser.isVisible()) {
      await chooser.getByRole("listitem").first().getByRole("button").click(T);
      await expect(ok.or(failed).first()).toBeVisible(T);
    }
    if (await failed.count()) {
      const text = (await failed.first().textContent())?.trim();
      await page.getByRole("button", { name: "Poista valinta" }).click(T).catch(() => {});
      return `Varaus kalenterista ei onnistunut: ${text}`;
    }
  });

  await j.step("Pyydä ja hyväksy AI-miehitysehdotus", async () => {
    await page.locator(`[data-task="${liftTitle}"]`).click(T);
    await expect(h1()).toHaveText(liftTitle, T);
    const ai = page.getByTestId("ai-suggestion");
    await expect(ai).toBeVisible(T);
    if (await ai.getByText("Tekoäly ei ole käytössä tässä ympäristössä.").count()) return "Tekoäly ei ole käytössä tässä ympäristössä";
    await ai.getByRole("button", { name: /Pyydä (AI-ehdotus|uusi ehdotus)/ }).click(T);
    await expect(ai.locator("[data-status]").first()).toBeVisible({ timeout: 20_000 });
    const accept = ai.getByRole("button", { name: "Hyväksy ehdotus" });
    if (!(await accept.count())) return "AI ei antanut hyväksyttävää ehdotusta";
    await accept.click(T);
    await expect(page.getByTestId("readiness")).toBeVisible(T);
  });

  await j.step("Varaa kalustoa projektille", async () => {
    await tab("Resurssivaraukset");
    await expect(h1()).toHaveText("Resurssivaraukset", T);
    const project = page.getByLabel("Projekti");
    if (await project.count()) {
      await project.selectOption({ label: PROJECT }, T);
      await page.getByRole("button", { name: "Näytä" }).click(T);
    }
    const form = page.getByTestId("booking-form");
    await form.getByLabel(/EQ-005 Cable drum trailer/).check(T);
    await form.getByLabel("Alkaa").fill(`${bookingDay}T07:00`, T);
    await form.getByLabel("Päättyy").fill(`${bookingDay}T15:00`, T);
    await form.getByLabel("Lisätiedot").fill(bookingNote, T);
    await form.getByRole("button", { name: "Varaa" }).click(T);
    const row = page.getByTestId("my-bookings").locator("li").filter({ hasText: bookingNote });
    await expect(row).toBeVisible(T);
    const status = await row.getAttribute("data-status");
    if (status !== "APPROVED") return `Oma kalustovaraus jäi tilaan ${status}`;
  });

  await j.step("Avaa aluekartta", async () => {
    await tab("Aluekartta");
    await expect(h1()).toHaveText("Aluekartta", T);
    const controls = page.getByTestId("map-controls");
    await controls.getByLabel("Työmaa").selectOption({ label: SITE_NAME }, T);
    await controls.getByRole("button", { name: "Näytä" }).click(T);
    const map = page.getByTestId("site-map");
    await expect(map).toBeVisible(T);
    await expect(map.getByRole("button", { name: /^Portti P1 / })).toBeVisible(T);
  });

  await j.step("Lisää nosturi aluekartalle", async () => {
    const form = page.getByTestId("map-new-object");
    await form.getByLabel("Tyyppi").selectOption({ label: "Nosturi" }, T);
    await form.getByLabel("Tunnus").fill(objectCode, T);
    await form.getByLabel("Nimi").fill("Siirrettävä ajoneuvonosturi", T);
    await form.getByRole("button", { name: "Sijoita kartalle" }).click(T);
    await expect(page.getByTestId("map-mode")).toBeVisible(T);
    const map = page.getByTestId("site-map");
    const box = await map.boundingBox();
    if (!box) throw new Error("Aluekartta ei näy");
    await map.click({ position: { x: box.width * (j.mobile ? 0.22 : 0.25), y: box.height * 0.4 }, ...T });
    await expect(page.getByTestId("map-message")).toContainText(`Kohde ${objectCode} Siirrettävä ajoneuvonosturi lisätty.`, T);
    await expect(map.getByRole("button", { name: new RegExp(`^Nosturi ${objectCode} `) })).toBeVisible(T);
  });

  await j.step("Sijoita nostotehtävä porttiin P3", async () => {
    const task = page.getByTestId("site-map-panel").locator("[data-map-task]").filter({ hasText: liftTitle });
    await task.click(T);
    await expect(page.getByTestId("map-mode")).toContainText(liftTitle, T);
    await page.getByTestId("site-map").getByRole("button", { name: /^Portti P3 / }).click(T);
    await expect(page.getByTestId("map-message")).toContainText("sijoitettu kohteeseen P3", T);
  });

  await j.step("Ilmoita poikkeama nostotehtävästä", async () => {
    const open = page.getByTestId("map-task-panel").getByRole("link", { name: "Avaa tehtävä" });
    let note: string | undefined;
    if (await open.isVisible()) await open.click(T);
    else if (requestUrl) {
      await page.goto(requestUrl);
      note = "Tehtävän avaus kartalta ei näkynyt; avattu suoraan";
    } else throw new Error("Nostopyyntöä ei luotu");
    await expect(h1()).toHaveText(liftTitle, T);
    await page.getByRole("link", { name: "Ilmoita poikkeama" }).click(T);
    const form = page.getByTestId("deviation-form");
    await form.getByText("Kalusto rikki").click(T);
    await form.getByLabel("Kommentti (valinnainen)").fill(deviationComment, T);
    await form.getByRole("button", { name: "Lähetä poikkeama" }).click(T);
    await expect(page.getByRole("status").filter({ hasText: "Poikkeama lähetetty" })).toBeVisible(T);
    return note;
  });

  await j.step("Kuittaa avoin poikkeama", async () => {
    await tab("Poikkeamat");
    await expect(h1()).toHaveText("Poikkeamat", T);
    const item = page.getByTestId("deviation-list").locator("li").filter({ hasText: deviationComment });
    await expect(item).toHaveAttribute("data-status", "OPEN", T);
    await item.getByRole("button", { name: "Kuittaa", exact: true }).click(T);
    await expect(item).toHaveAttribute("data-status", "ACKNOWLEDGED", T);
  });

  await j.step("Katso logistiikkariskit", async () => {
    await tab("Riskit");
    await expect(h1()).toHaveText("Logistiikkariskit", T);
    const project = page.getByLabel("Projekti");
    if (await project.count()) {
      await project.selectOption({ label: PROJECT }, T);
      await page.getByRole("button", { name: "Näytä" }).click(T);
    }
    await expect(page.getByTestId("risk-facts").or(page.getByText("Ei havaittuja riskejä.")).first()).toBeVisible(T);
  });

  j.write();
});
