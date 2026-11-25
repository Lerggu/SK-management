/**
 * Role journey: Työnjohtaja (supervisor), mainly on the phone.
 * Crew hours, takt progress and a blocker, a lift order with lift details,
 * a deviation on the site map, a safety observation with a photo and the
 * site diary, on the steel mill demo site (scripts/demo-steel-theme.py).
 */
import { expect, test } from "@playwright/test";
import { navigate } from "../e2e/helpers";
import { COMPANY, Journey, openAs } from "./journey";

const T = { timeout: 8000 };
const PROJECT = "NSM-001";
const SITE = "Sulatto (EAF)";
const PLAN = "Sulatto – asennustahti";
// Two crew members from the demo seed (crew checkbox labels are "Sukunimi Etunimi").
const CREW = ["Esimerkki Antti", "Koe Ville"];
const photo = (name: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]) });

test("supervisor", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const page = await openAs(browser, testInfo, "supervisor");
  page.on("dialog", (d) => d.accept());
  const j = new Journey(page, testInfo, "supervisor");
  const tag = `${j.mobile ? "MOB" : "DSK"}-${Date.now().toString(36).slice(-5)}`;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  /** Production control: bottom bar "Tuotannonohjaus" on phones, sidebar "Tahtiaikataulu" on desktop, then a tab. */
  const production = async (tab?: string) => {
    if (j.mobile) {
      await page.getByTestId("mobile-nav").getByRole("link", { name: "Tuotannonohjaus", exact: true }).click(T);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(T);
    } else await navigate(page, testInfo, "Tahtiaikataulu");
    if (tab) {
      await page.getByRole("navigation", { name: "Tuotannonohjaus" }).getByRole("link", { name: tab, exact: true }).click(T);
      await expect(page.getByRole("navigation", { name: "Tuotannonohjaus" }).getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page", T);
    }
  };

  let activityId: string | null = null;
  let requestTitle = "";

  await j.step("Etusivu", async () => {
    await page.goto(`${COMPANY}/dashboard`);
    await expect(page.getByTestId("today")).toBeVisible(T);
  });

  await j.step("Kirjaa omat 8 h tunnit", async () => {
    await navigate(page, testInfo, "Tunnit");
    const own = page.locator("section").filter({ has: page.getByRole("heading", { name: "Kirjaa tunnit", level: 2 }) });
    await own.getByLabel("Projekti").selectOption({ label: `${PROJECT} › ${SITE}` }, T);
    await own.getByRole("button", { name: "8 h" }).click(T);
    await expect(own.getByLabel("Tunnit", { exact: true })).toHaveValue("8", T);
    await own.getByLabel("Muistiinpano").fill(`Oma ${tag}`, T);
    await own.getByRole("button", { name: "Kirjaa tunnit" }).click(T);
    await expect(page.getByTestId("week-entries")).toContainText(`Oma ${tag}`, T);
  });

  await j.step("Kirjaa työryhmälle 8 h", async () => {
    const crew = page.locator("section").filter({ has: page.getByRole("heading", { name: "Kirjaa työryhmälle", level: 2 }) });
    await crew.scrollIntoViewIfNeeded(T);
    for (const name of CREW) await crew.getByLabel(name, { exact: true }).check(T);
    await crew.getByLabel("Projekti").selectOption({ label: `${PROJECT} › ${SITE}` }, T);
    await crew.getByLabel("Tunnit", { exact: true }).fill("8", T);
    await crew.getByLabel("Muistiinpano").fill(`Ryhmä ${tag}`, T);
    await crew.getByRole("button", { name: "Kirjaa valituille" }).click(T);
    await expect(crew.getByRole("status")).toHaveText("Tallennettu", T);
    if (j.mobile) return "Työryhmän kirjaus on sivun alimpana omien tuntien ja viikkolistan alla; puhelimella pitkä vieritys";
  });

  await j.step("Tarkista työntekijän viikko", async () => {
    await page.getByLabel("Henkilö", { exact: true }).selectOption({ label: `${CREW[0]} (E-1001)` }, T);
    await page.getByRole("button", { name: "Avaa", exact: true }).click(T);
    await expect(page).toHaveURL(/employee=/, T);
    await expect(page.getByTestId("week-entries")).toContainText(`Ryhmä ${tag}`, T);
  });

  await j.step("Avaa tahtisuunnitelma", async () => {
    await production();
    await page.getByRole("link", { name: new RegExp(PLAN) }).first().click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PLAN, T);
    await expect(page.getByTestId("week-list")).toBeVisible(T);
  });

  await j.step("Pikakirjaa tehtävän valmiusaste", async () => {
    const cards = page.getByTestId("week-list").locator('li[data-activity]:not([data-status="COMPLETE"]):not([data-status="BLOCKED"])');
    await expect(cards.first()).toBeVisible(T);
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const pct = Number(((await card.locator("span.tabular-nums").first().textContent()) ?? "").replace(/\D/g, ""));
      const next = [25, 50, 75].find((v) => v > pct);
      if (next === undefined) continue;
      activityId = await card.getAttribute("data-activity");
      await card.getByRole("button", { name: `${next} %`, exact: true }).click(T);
      await expect(page.locator(`[data-activity="${activityId}"] span.tabular-nums`).first()).toHaveText(`${next} %`, T);
      return;
    }
    throw new Error("Tällä viikolla ei ole tehtävää, jonka valmiusaste on alle 75 %");
  });

  await j.step("Kirjaa edistyminen huomion kanssa", async () => {
    if (!activityId) throw new Error("Edellinen step ei löytänyt tehtävää");
    await page.locator(`[data-activity="${activityId}"]`).getByRole("link").first().click(T);
    await expect(page).toHaveURL(/\/activities\//, T);
    const form = page.getByTestId("progress-form");
    const current = Number(((await page.getByTestId("progress-pct").textContent()) ?? "").replace(/\D/g, ""));
    const next = [50, 75, 90].find((v) => v > current) ?? 90;
    await form.getByLabel("Valmiusaste (%)").selectOption({ label: `${next} %` }, T);
    await form.getByLabel("Huomio").fill(`Asennus etenee ${tag}`, T);
    await form.getByRole("button", { name: "Kirjaa edistyminen" }).click(T);
    await expect(page.getByTestId("progress-pct")).toHaveText(`${next} %`, T);
    await expect(page.getByTestId("progress-history")).toContainText(`Asennus etenee ${tag}`, T);
  });

  await j.step("Merkitse tehtävälle este", async () => {
    const reason = `Pultit puuttuvat ${tag}`;
    await page.getByLabel("Viivästyksen syy").fill(reason, T);
    await page.getByLabel("Korjaava toimenpide").fill("Lisätilaus tehty, toimitus huomenna", T);
    await page.getByRole("button", { name: "Merkitse estyneeksi" }).click(T);
    await expect(page.getByRole("alert").filter({ hasText: reason })).toContainText("Estynyt", T);
    await expect(page.getByRole("button", { name: "Poista esto" })).toBeVisible(T);
  });

  await j.step("Avaa työmaan logistiikka", async () => {
    await production("Logistiikka");
    const picker = page.getByTestId("site-day-picker");
    await picker.getByLabel("Työmaa").selectOption({ label: `${PROJECT} · ${SITE}` }, T);
    await picker.getByRole("button", { name: "Näytä" }).click(T);
    await expect(page).toHaveURL(/site=/, T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Logistiikkataulu", T);
  });

  await j.step("Tilaa nosto nostotiedoilla", async () => {
    requestTitle = `Uunin kuoriosan nosto ${tag}`;
    const form = page.getByTestId("request-form");
    await form.scrollIntoViewIfNeeded(T);
    await form.getByLabel("Palvelu").selectOption({ label: "Nosto" }, T);
    await form.getByLabel("Otsikko").fill(requestTitle, T);
    await form.getByLabel("Alkaa").fill(`${tomorrow}T09:00`, T);
    await form.getByLabel("Arvioitu lopetus").fill(`${tomorrow}T11:00`, T);
    await form.getByLabel("Raskain kappale (kg)").fill("8500", T);
    await form.getByLabel("Nostosäde (m)").fill("18", T);
    await form.getByLabel("Riggerit (hlö)").fill("2", T);
    await form.getByLabel("Muu lisämiehistö").fill("1 merkinantaja", T);
    await form.getByLabel("Nostoapuvälineet").fill("Nostopalkki 6 m, 4-haarainen ketjuraksi 10 t, taglinet", T);
    await expect(form.getByLabel("Nimi")).not.toHaveValue("", T);
    await form.getByLabel("Puhelin").fill("+358 40 000 0001", T);
    await form.getByRole("button", { name: "Tallenna pyyntö" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(requestTitle, T);
    if (j.mobile) return "Nostotilauslomake on logistiikkataulun alaosassa toimitusten ja aikajanan jälkeen; puhelimella paljon vieritystä";
  });

  await j.step("Tarkista nostotilauksen tiedot", async () => {
    await expect(page.getByText("Pyydetty").first()).toBeVisible(T);
    await expect(page.getByText("18 m", { exact: true })).toBeVisible(T);
    await expect(page.getByText("2 hlö", { exact: true })).toBeVisible(T);
    await expect(page.getByTestId("request-contact").getByRole("link", { name: "+358 40 000 0001" })).toHaveAttribute("href", "tel:+358400000001", T);
  });

  await j.step("Avaa aluekartta", async () => {
    await production("Aluekartta");
    const controls = page.getByTestId("map-controls");
    await controls.getByLabel("Työmaa").selectOption({ label: SITE }, T);
    await controls.getByRole("button", { name: "Näytä" }).click(T);
    await expect(page.getByTestId("site-map")).toBeVisible(T);
  });

  await j.step("Ilmoita poikkeama kartan kohteeseen", async () => {
    const target = page.getByTestId("map-objects").getByRole("button").filter({ hasText: "Purkualue A" });
    await target.click(T);
    const panel = page.getByTestId("map-object-panel");
    await panel.getByTestId("map-report-deviation").click(T);
    await panel.getByRole("button", { name: "Turvallisuus", exact: true }).click(T);
    await panel.getByLabel("Kommentti").fill(`Purkualueella kulkuväylä tukossa ${tag}`, T);
    await panel.getByRole("button", { name: "Lähetä poikkeama" }).click(T);
    await expect(page.getByTestId("map-message")).toContainText("Poikkeama ilmoitettu", T);
    await expect(target).toContainText("Poikkeama", T);
  });

  await j.step("Tee turvallisuushavainto kuvalla", async () => {
    await navigate(page, testInfo, "Työturvallisuus");
    await page.getByTestId("hse-quick").getByRole("link", { name: "Turvallisuushavainto" }).click(T);
    const form = page.getByTestId("observation-form");
    const title = `Suojakaide puuttuu ${tag}`;
    await form.getByLabel("Mitä havaitsit / tapahtui?").fill(title, T);
    await form.getByLabel("Aihe").selectOption({ label: "Korkealla työskentely" }, T);
    await form.getByLabel("Työmaa").selectOption({ label: SITE }, T);
    await form.getByLabel("Paikka").fill("Sulatto, linja 3, taso +12 m", T);
    await form.getByLabel("Kuva", { exact: true }).setInputFiles(photo("havainto.jpg"), T);
    await form.getByRole("button", { name: "Lähetä ilmoitus" }).click(T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title, T);
    await expect(page.getByTestId("hse-photos").getByRole("img")).toHaveCount(1, T);
  });

  await j.step("Avaa päivän työmaapäiväkirja", async () => {
    await navigate(page, testInfo, "Etusivu");
    await page.getByTestId("today").getByRole("button", { name: `${PROJECT} › ${SITE}` }).click(T);
    await expect(page).toHaveURL(/\/diary\//, T);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(SITE, T);
  });

  await j.step("Kirjaa sää ja päiväkirjamerkintä", async () => {
    const weather = page.getByLabel("Sää", { exact: true });
    if (await weather.count()) {
      await weather.fill("Pilvistä, +1 °C", T);
      await page.getByRole("button", { name: "Tallenna" }).first().click(T);
      await expect(page.getByText("Tallennettu").first()).toBeVisible(T);
    }
    const entry = `Nosturiradan palkit linjalla 3 asennettu ${tag}`;
    await page.getByLabel("Kuvaus").fill(entry, T);
    await page.getByRole("button", { name: /^(Lisää merkintä|Lisäys)$/ }).click(T);
    await expect(page.getByTestId("diary-entries")).toContainText(entry, T);
    if (!(await weather.count())) return "Päiväkirja oli jo allekirjoitettu, merkintä tehtiin lisäyksenä";
  });

  await j.step("Lisää kuva päiväkirjaan", async () => {
    const name = `paivakirja-${tag}.jpg`;
    await page.getByLabel("Lisää kuva").setInputFiles(photo(name), T);
    await page.getByLabel("Kuvateksti").fill("Linja 3, palkit paikallaan", T);
    await page.getByRole("button", { name: "Lataa kuva" }).click(T);
    await expect(page.getByText(name)).toBeVisible(T);
  });

  await j.step("Lähetä oma viikko hyväksyttäväksi", async () => {
    await navigate(page, testInfo, "Tunnit");
    const submit = page.getByRole("button", { name: "Lähetä viikko hyväksyttäväksi" });
    await submit.click(T);
    await expect(submit).toHaveCount(0, T);
    await expect(page.getByTestId("week-entries").locator('[data-status="SUBMITTED"]').first()).toBeVisible(T);
  });

  j.write();
});
