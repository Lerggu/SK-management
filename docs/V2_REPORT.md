# SK Management — V2 Site Execution & Project Finance Foundation: pysäytysraportti

Päivämäärä: 2026-10-04 · Haara: `claude/dazzling-edison-zzskak` · Tila: **V2 valmis. V3:a ei ole aloitettu**, koska se odottaa omistajan hyväksyntää.

Suunnitelma ja omistajan päätökset: [V2_PLAN.md](V2_PLAN.md). Laskentasäännöt: [ADR 0010](adr/0010-time-and-cost-calculation.md). Päiväkirjan lukitus: [ADR 0011](adr/0011-site-diary-locking.md).

## 1. Toteutettu, §36 hyväksymiskriteerien mukaan

| # | Kriteeri (§36) | Toteutus | Todennettu testeillä |
|---|---|---|---|
| 1 | Hyväksytyt tunnit kirjautuvat projektin toteutuneeksi työkustannukseksi | Työkustannus = tunnit × henkilön tuntikohtainen kustannushinta, joka on voimassa työpäivänä × kerroin (NORMAL 1,0, OVERTIME_50 1,5, OVERTIME_100 2,0, TRAVEL 1,0). Laskenta on keskitetty tiedostoon `finance/calculations.ts`. Se käyttää vain desimaalilukuja, ja jokainen rivi pyöristetään senteiksi (half-up). Rivit, joilla ei ole voimassa olevaa tuntihintaa, näytetään hinnoittelemattomina. Hintaa ei koskaan arvata. | Unit `calculations.test` (8 testiä). Integraatio `finance.test`: hyväksytyt tunnit → 440 €, luonnos ja lähetetty eivät vaikuta. Seedin tarkistus: 7 251,50 € vastaa käsin laskettua summaa. |
| 2 | Työmaapäiväkirjan voi tarkistaa ja viimeistellä | Päiväkirja on työmaa- ja päiväkohtainen. Siihen kuuluvat sää, miehitys tuntikirjauksista, kaluston tunnit, tehdyt työt, viivästykset, ohjeet ja kuvat/PDF:t. Työnjohtaja allekirjoittaa päiväkirjan, jolloin miehitys jäädytetään ja päiväkirja lukitaan. Lukituksen varmistaa DB-triggeri. Allekirjoituksen jälkeiset lisäykset ovat auditoituja lisäyksiä (addendum). Allekirjoitetun päiväkirjan kalustotunnit lasketaan kalustokustannukseksi (tunnit × kaluston tuntikohtainen kustannushinta). | Integraatio `diary.test`: allekirjoitus, lukitus, triggeri estää suoran UPDATE/DELETE-operaation, lisäys, jäädytetty miehitys, kalustokustannus. E2E `diary.spec` (työpöytä ja mobiili). |
| 3 | Budjetti vs. toteuma näkyy | Budjetilla on versiot (versio 1 = alkuperäinen). Luonnosta voi muokata. Aktivointi korvaa edellisen version, ja projektilla voi olla vain yksi aktiivinen budjetti (osittainen uniikki-indeksi). Kustannuksia voi kirjata käsin: materiaalit, aliurakat ja muut. Projektin talousnäkymässä näkyvät kategoriakohtainen budjetti/toteuma/erotus, tunnit, hinnoittelemattomat tunnit, avoimet hyväksynnät ja allekirjoittamattomat päiväkirjat. | Integraatio `finance.test`: versiot, aktivointi, lukitus ja vertailu. E2E `finance.spec`: PM näkee näkymän ja kirjaa kustannuksen, työmaapäällikkö saa 404. |
| 4 | Korjaukset auditoidaan | Hyväksyttyä tuntia ei voi muuttaa. Vain siirtymä APPROVED → EXPORTED on sallittu, ja sen varmistaa DB-triggeri. Korjaus tehdään erillisenä korjausrivinä (± tunnit), joka viittaa alkuperäiseen riviin ja kulkee saman hyväksynnän kautta. Kaikki tila- ja korjausmuutokset kirjoitetaan audit-lokiin samassa transaktiossa. Myös budjettirivien muutokset ja kustannusten arkistointi auditoidaan. | Integraatio `timesheets.test` ja `finance.test`: korjaus → audit-tapahtuma → kustannus muuttuu. Triggeritestit. |

### Toimitetut ominaisuudet
- **Tunnit** (`/c/[yritys]/time`)
  - Oma viikkonäkymä (ma–su) ja nopeat tuntipainikkeet mobiiliin.
  - Lähtöaika ja loppuaika tai suoraan tuntimäärä, työaikaluokka ja muistiinpano.
  - Työnjohtaja voi kirjata tunnit koko porukalle yhdellä lomakkeella.
  - Viikko lähetetään hyväksyttäväksi yhdellä painikkeella.
- **Hyväksyntä** (`/time/approvals`)
  - Työmaapäällikkö ja PM hyväksyvät tunnit osoitetuissa projekteissa, PD ja CEO kaikissa projekteissa.
  - Omia tunteja ei voi hyväksyä.
  - Hylkäykselle annetaan syy.
- **Palkka-aineiston vienti** (`/time/export`)
  - Hyväksytyt tunnit ladataan CSV:nä, ja vientierä merkitsee rivit tilaan EXPORTED.
  - Palkkajärjestelmäintegraatiota ei ole keksitty.
- **Työmaapäiväkirja**
  - Päiväkirja avataan projektin sivulta painikkeella "Päiväkirja tänään: {työmaa}".
  - Kuvat ja PDF:t tallennetaan S3/MinIO-tallennukseen, ja ne ladataan valtuutetusti.
- **Talous** (`/projects/[id]/finance`): budjettiversiot ja -rivit, kustannukset sekä budjetti vs. toteuma.
- **Etusivun "Tänään"-osio** näyttää nopean tuntikirjauksen ja päivän päiväkirjat.
- **Seed**
  - Linkitetyt henkilöt ja käyttäjät (työntekijä, työnjohtaja ja työmaapäällikkö).
  - Hyväksytyt ja lähetetyt tunnit.
  - Allekirjoitettu ja avoin päiväkirja.
  - 660 000 €:n aktiivinen budjetti ja kustannuksia.
  - Kaikki data on kuvitteellista.

### V2 rooli × oikeus -matriisi (generoitu koodista `ROLE_TEMPLATES`)

🔒 = arkaluonteinen. Ulkoiset roolit (SUB, CLI) eivät saa V2-oikeuksia lainkaan. `timesheet.export` on yritystason oikeus, eikä sitä voi antaa projektiroolin kautta.

| Oikeus | CEO | PD | PM | SM | SUP | LOG | HSE | EMP | SUB | CLI |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `timesheet.submit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `timesheet.manage` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `timesheet.approve` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `timesheet.export` | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `diary.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `diary.manage` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `diary.sign` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `finance.view` 🔒 | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `finance.manage` 🔒 | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |

Migraatio `v2_permissions` lisää oikeudet olemassa olevien yritysten mallipohjaisiin rooleihin (`template_key`) tämän matriisin mukaan. Se kirjoittaa jokaiselle yritykselle audit-tapahtuman `role.permissions_migration`. Migraatio vain lisää oikeuksia: se ei poista mitään yrityskohtaisesti muokatuista rooleista.

## 2. Tietokantaskeeman muutokset

V2 lisää vain uusia tauluja. V1-tauluihin ei tehty rikkovia muutoksia. Migraatiot:
- `v2_execution`: taulut.
- `v2_integrity`: triggerit, check-rajoitteet ja indeksit.
- `v2_permissions`: oikeudet ja roolimääritykset.

| Taulu | Sisältö |
|---|---|
| `time_entries` | henkilö, projekti, työmaa, päivä, alku/loppu, tunnit `numeric`, luokka, tila (DRAFT/SUBMITTED/APPROVED/REJECTED/EXPORTED), `correction_of_id` korjauksille, hyväksyjä/aika, hylkäyksen syy, vientierä |
| `daily_reports` | työmaa + päivä (uniikki), sää, tila DRAFT/SIGNED, allekirjoittaja/aika, jäädytetty miehitys (`attendance_snapshot`, JSON) |
| `daily_report_entries` | tyyppi (WORK, EQUIPMENT, DELAY, INSTRUCTION), teksti, kalusto ja tunnit, `is_addendum` |
| `daily_report_attachments` | tallennusavain, tiedostotyyppi, koko, SHA-256, kuvateksti, `is_addendum` |
| `budgets` | projekti, versionumero, tila DRAFT/ACTIVE/SUPERSEDED, valuutta |
| `budget_lines` | kategoria (LABOR, EQUIPMENT, MATERIALS, SUBCONTRACT, OTHER), kuvaus, summa `numeric(14,2)` |
| `cost_entries` | käsin kirjatut kustannukset: projekti/työmaa, kategoria, päivä, kuvaus, toimittaja, viite, summa + valuutta, arkistointi. Työ- ja kalustokustannusta ei tallenneta tänne, vaan se lasketaan hyväksytyistä tunneista ja allekirjoitettujen päiväkirjojen kalustotunneista. Näin toteuma ei voi erkaantua lähteestään. |

Eheys tietokantatasolla:
- Kaikissa uusissa tauluissa on `company_id` ja komposiittivierasavaimet, esim. `time_entries(company_id, project_id, site_id) → sites(...)`.
- Triggerit `time_entries_guard`, `daily_reports_guard`, `daily_report_children_guard`, `budgets_guard` ja `budget_lines_guard` estävät lukittujen rivien muutokset, vaikka sovelluskerros ohitettaisiin.
- `budgets_one_active_per_project` on osittainen uniikki-indeksi.
- Check-rajoitteet koskevat tuntimääriä ja summia.

## 3. Testitulokset (todelliset ajot 2026-10-04)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, tyypit, kerrokset, unit + integraatio) | **23 tiedostoa, 583 testiä läpi**: unit 56, integraatio 527. Integraatiotesteihin sisältyvät eristystestisarja (192) ja oikeusmatriisi (283). |
| `pnpm depcruise` | Ei kerrosrikkomuksia (180 moduulia, 736 riippuvuutta) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä → seed (2 yritystä, 27 oikeutta, 198 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **45 läpi, 1 ohitettu**. Palkkavienti ajetaan tarkoituksella vain työpöytäprojektissa, koska vienti kuluttaa seedin hyväksytyt tunnit. |
| `pnpm build` | Tuotantobuild onnistuu |

Uudet testit:
- Integraatio: `timesheets.test`, `diary.test` ja `finance.test`.
- Eristys: 33 uutta tapausta, yksi jokaiselle V2-palvelumetodille. Metatesti kaatuu, jos tapaus puuttuu.
- Oikeusmatriisi: 9 uutta riviä × 10 roolia.
- E2E: `time.spec`, `diary.spec` ja `finance.spec`.

Huom: tässä ympäristössä E2E vaatii `PW_CHROMIUM=/opt/pw-browsers/chromium`, koska esiasennettu selainversio poikkeaa Playwrightin odottamasta.

## 4. Tietoturva ja yritysten eristys

- **Eristys**
  - Kaikki V2-palvelumetodit (tunnit, päiväkirja, budjetti, kustannukset, talousyhteenveto) kulkevat `RequestContext`in ja yrityskohtaisten repositorioiden kautta.
  - Toisen yrityksen data → 404. Tämä on testattu jokaiselle metodille.
  - Komposiittivierasavaimet estävät ristiviittaukset kannassa.
- **Kustannustiedot**
  - `finance.*` on arkaluonteinen oikeus: ulkoiset roolit eivät voi saada sitä, ja resolveri poistaa sen.
  - Työmaapäällikkö ja työnjohtaja eivät näe talousnäkymää eivätkä hintoja (oikeusmatriisi todentaa, ja E2E todentaa työmaapäällikön osalta).
  - Tuntinäkymät eivät näytä hintoja.
- **Hyväksyntä:** omia tunteja ei voi hyväksyä, ja hyväksyjältä vaaditaan pääsy projektiin. ASSIGNED-roolit näkevät vain osoitetut projektit.
- **Lukitus:** hyväksytyt tunnit, allekirjoitetut päiväkirjat ja aktiiviset tai korvatut budjetit on suojattu DB-triggereillä, ei pelkästään sovelluslogiikalla.
- **Liitteet**
  - Vain kuvat ja PDF sallitaan, ja koolla on yläraja.
  - Tiedostosta tallennetaan SHA-256.
  - Lataus on valtuutettu ja lähetetään `nosniff`- ja `attachment`-otsakkeilla.
- **CSV-vienti:** vapaatekstisolut, jotka alkavat merkeillä `=`, `+`, `-` tai `@`, saavat eteensä heittomerkin, mikä estää kaavainjektion taulukkolaskennassa. Negatiiviset korjaustunnit säilyvät numeroina.

## 5. Tunnetut rajoitukset

1. **Yksi valuutta per projekti** (yrityksen oletus). Muun valuutan hinnat raportoidaan hinnoittelemattomina, koska valuuttamuunnosta ei ole.
2. **Vain tuntihinnat** (HOUR) huomioidaan. Päivähintaiset henkilöt ja kalusto näkyvät hinnoittelemattomina, kunnes päiväkustannuksen sääntö sovitaan.
3. **Ylityöluokka valitaan käsin.** Työehtosopimuksen mukaista automaattista ylityölaskentaa ei ole.
4. **Palkkavienti on CSV.** Integraatiota palkkajärjestelmään ei ole, eikä sellaista ole keksitty.
5. **Ennuste (EAC), laskutus ja sitoumukset** kuuluvat V6:een. V2 näyttää vain budjetin ja toteuman.
6. **Offline-tilaa ei ole.** Mobiilikirjaus vaatii yhteyden.
7. V1:n rajoitukset ovat edelleen voimassa:
   - Rate limit on muistinvarainen.
   - RLS ei ole käytössä (ADR 0005).
   - Entra ID:tä ei ole testattu oikeaa tenanttia vasten.
   - Orpoja tallennusobjekteja ei siivota.
   - CI:tä ei ole vielä ajettu GitHubissa.

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev     # http://localhost:3000 → Kehityskirjautuminen
```

V2-demokäyttäjät:
- `employee@skinfra.example.com`: tunnit.
- `supervisor@skinfra.example.com`: porukan tunnit ja päiväkirja.
- `site.manager@skinfra.example.com`: hyväksyntä.
- `pm@skinfra.example.com`: talous.
- `ceo@skinfra.example.com`: palkkavienti.

Tarkemmin: [README](../README.md).

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`. Uudet V2-näkymät:
- `time.png`: oma viikko, nopeat tuntipainikkeet, viikon lähetys
- `time-approvals.png`: hyväksyttävät tunnit henkilöittäin ja projekteittain
- `site-diary.png`: päiväkirja: sää, miehitys, kalusto, merkinnät, kuvat, allekirjoitus
- `project-finance.png`: budjetti vs. toteuma kategorioittain, tunnit, hinnoittelemattomat tunnit, avoimet hyväksynnät
- `dashboard.png`: päivitetty "Tänään"-osiolla

## 8. Ehdotettu V3-suunnitelma (Takt, §37)

**Odottaa hyväksyntää. Ei aloitettu.**

1. **Hierarkia:** `buildings` (rakennus/alue), `takt_areas`, `work_packages` ja `activities`. Taulut ripustetaan olemassa oleviin `sites(company_id, project_id, id)` -avaimiin komposiittivierasavaimilla, joten muutokset eivät riko mitään.
2. **Aikataulu ja baseline**
   - `schedules` ja `schedule_versions`. Baseline lukitaan DB-triggerillä samalla mallilla kuin päiväkirja ja budjetti.
   - Jokainen muutos on uusi versio, jolla on syy ja audit-merkintä. Baselinea ei voi ylikirjoittaa huomaamatta.
3. **Takt-taulu:** visuaalinen ruudukko (alueet × takt-jaksot). Työpöydällä vedä ja pudota, mobiilissa luku- ja tilapäivitysnäkymä.
4. **Riippuvuudet ja rajoitteet:** FS/SS-riippuvuudet ja rajoitteet (materiaali, suunnitelma, lupa, edeltävä työ, resurssi). Valmiustila READY/BLOCKED lasketaan rajoitteista.
5. **Edistyminen:** valmiusaste aktiviteeteittain. Linkitys V2:n päiväkirjaan, jolloin tehdyt työt voidaan merkitä aktiviteetille.
6. **Look-ahead 2/6/12 viikkoa:** resurssitarve (henkilöt ammateittain, kalusto tyypeittäin) aktiviteettien tarpeista. Tämä on pohja V4–V5:n resurssivarauksille.
7. **Uudet oikeudet:** `takt.view`, `takt.manage` ja `takt.baseline.approve`. Ne lisätään migraatiolla, ja matriisi esitetään ennen käyttöönottoa.

Avoimet päätökset omistajalle ennen V3:a:
- takt-jakson oletuspituus (päivä/viikko);
- kuka hyväksyy baselinen (PD vai PM);
- tarvitaanko MS Project- tai P6-tuonti V3:ssa vai myöhemmin. Tuonti olisi vain rajapinta, ilman keksittyä integraatiota.
