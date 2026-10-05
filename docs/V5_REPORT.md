# SK Management — V5 Lifting & Material Flow: pysäytysraportti

- Päivämäärä: 2026-10-05
- Haara: `claude/dazzling-edison-zzskak`
- Tila: **V5 valmis. V6:ta ei ole aloitettu**, koska se odottaa omistajan hyväksyntää.

Taustamateriaali:
- Suunnitelma ja omistajan päätökset: [V5_PLAN.md](V5_PLAN.md)
- Nostosuunnitelmat, hyväksyntä ja nostoapuvälineet: [ADR 0016](adr/0016-lift-plans.md)
- Materiaalierät, kaapelikelat ja QR-tarrat: [ADR 0017](adr/0017-material-and-cable-drums.md)

## 1. Toteutettu, hyväksymiskriteerien mukaan

§39 ei listaa omia hyväksymiskriteerejä, joten käytin suunnitelmassa ehdotettuja.

| # | Kriteeri | Toteutus | Todennettu |
|---|---|---|---|
| 1 | Nostoa ei voi tehdä ilman hyväksyttyä nostosuunnitelmaa | Tietokantatriggeri `lift_plans_guard` estää noston kirjaamisen tehdyksi ilman hyväksyttyä versiota. Triggeri `logistics_requests_lift_gate` estää V4:n LIFT-pyynnön siirron tiloihin aikataulutettu, käynnissä tai valmis ilman hyväksyttyä suunnitelmaa. Palvelu estää noston myös, kun muutosversio odottaa tai kun tarkistukset eivät mene läpi noston päivänä. | `lifting.test` (palvelu ja suora tietokantapäivitys), E2E |
| 2 | Erääntyneet ja ylikuormitetut apuvälineet tunnistetaan | Puhtaat tarkistukset `lifting/rules.ts` (9 koodia, joista 7 estää ja 2 varoittaa). Erääntynyt tai puuttuva tarkastus, käyttökuorma (WLL) alle kuorman, kapasiteetin ylitys ja nosturin tila estävät lähettämisen ja hyväksynnän. Apuvälinerekisteri merkitsee erääntyneet. | `rules.test` (9), `lifting.test`, E2E |
| 3 | Materiaali- ja kelaliikkeet jäljitettävissä takt-tehtävään | Materiaalierä kulkee toimitus → varasto → työkohde → asennettu. Jokainen siirto kirjataan muuttumattomaan lokiin tehtävän ja sijainnin kanssa. Kaapelivedot kirjataan metreinä tehtävälle. Tahtitehtävän sivulla näkyvät sen nostot, erät, kelat ja vedetyt metrit yhteensä. | `lifting.test`, E2E (tehtäväsivu) |
| 4 | QR-skannaus toimii puhelimella | Skannausnäkymä käyttää kameraa (BarcodeDetector) ja tarjoaa tunnuksen kirjoittamisen varavaihtoehdoksi. Jokainen skannaus ratkaistaan palvelimella. QR-tarrat ovat A4-PDF:iä (3 × 7 tarraa). | `lifting.test`, E2E mobiili (Pixel 7) + työpöytä |

### Omistajan päätökset (toteutettu)

| # | Päätös | Toteutus |
|---|---|---|
| 1 | Nostosuunnitelman hyväksyy nostoista vastaava henkilö | Uusi roolipohja **Nostovastaava** (ASSIGNED), jolla on oikeus `lift.plan.approve`. Toimitusjohtajalla ja projektijohtajalla on sama oikeus, jottei hyväksyntä jumiudu. Laatija tai lähettäjä ei voi hyväksyä omaa suunnitelmaansa (palvelu ja tietokantatriggeri). Varoitukset on kuitattava. |
| 2 | Kaapelikelan pituus seurataan metreinä jokaisesta vedosta | Muuttumaton vetoloki (metrit, tehtävä, päivä, henkilö). Jäljellä oleva pituus päivittyy vain tietokantatriggerillä. CHECK-rajoite estää negatiivisen pituuden myös rinnakkaisissa kirjauksissa. Kela tyhjenee automaattisesti nollassa. |
| 3 | QR-tarrat tulostetaan järjestelmästä PDF:nä | `platform/labels` tuottaa PDF:n palvelimella ilman ulkoista palvelua. QR-koodi sisältää vain sisäisen URL-osoitteen ja läpinäkymättömän tunnisteen, ja avaaminen vaatii kirjautumisen ja yrityksen jäsenyyden. |

### Muut toimitetut ominaisuudet
- **Nostosuunnitelma**
  - Kuorma ja sen paino, nostovälineiden paino, painopiste ja nosturi (yrityksen nosturit ja kurottajat).
  - Säde ja kapasiteetti säteellä; kokonaiskuorma ja käyttöaste lasketaan.
  - Apuvälineet, nostoalue, turvaetäisyys ja riskiarvio (V1-asiakirja).
- **Versiointi**
  - Hyväksytty versio lukitaan, ja muutos tehdään uutena versiona perusteluineen.
  - Uuden version hyväksyntä korvaa edellisen samassa transaktiossa.
  - Hylkäys vaatii perustelun. Lähetetyn version voi palauttaa luonnokseksi.
- **Nostoryhmä:** nostomiehet ja nosturinkuljettajat varataan V4:n varauksilla (`resource_bookings.lift_plan_id`), joten päällekkäisyys- ja pätevyysristiriidat tunnistetaan kuten ennenkin.
- **Logistiikkaintegraatio:** hyväksyntä siirtää hyväksytyn LIFT-pyynnön tilaan aikataulutettu, ja nosto kirjataan valmiiksi pyynnön kanssa.
- **Rekisterit ja tarrat**
  - Nostoapuvälinerekisteri: yrityskohtainen tunnus, tyyppi, käyttökuorma, tarkastus, käytössä tai poistettu käytöstä, sekä arkistointi.
  - Kaapelikelat: valmistaja, kaapelityyppi, alku- ja jäljellä oleva pituus, paino, mitat, sijainti, tehtävävaraus, toimitus, vastaanottopäivä, tarkastus ja palautus toimittajalle.
  - QR-tarra yksittäiselle kohteelle tai koko työmaan keloille, erille tai apuvälineille.
- **Navigaatio:** uudet kohdat "Nostot" ja "Materiaalit". Lomakkeiden yleisvirheet (esim. "tarkistukset eivät mene läpi") näytetään nyt lomakkeessa eikä pelkkänä yleisilmoituksena.

### V5 rooli × oikeus -matriisi (generoitu koodista `ROLE_TEMPLATES`)

| Oikeus | Toimitusjohtaja | Projektijohtaja | Projektipäällikkö | Työmaapäällikkö | Työnjohtaja | Logistiikkakoordinaattori | HSE-asiantuntija | Työntekijä | Aliurakoitsija | Asiakas | Nostovastaava |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `lift.request` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |   |   | ✓ |
| `lift.plan.manage` | ✓ | ✓ |   | ✓ |   | ✓ |   |   |   |   | ✓ |
| `lift.plan.approve` | ✓ | ✓ |   |   |   |   |   |   |   |   | ✓ |
| `material.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   | ✓ |
| `material.manage` | ✓ | ✓ |   | ✓ | ✓ | ✓ |   |   |   |   |   |

Nostovastaavan kaikki oikeudet: `project.view`, `employee.view`, `equipment.view`, `documents.view`, `timesheet.submit`, `diary.view`, `takt.view`, `logistics.view`, `logistics.request`, `lift.request`, `lift.plan.manage`, `lift.plan.approve`, `material.view`.

- Ulkoiset roolit (aliurakoitsija, asiakas) eivät saa V5-oikeuksia.
- **Migraatio `v5_permissions`:**
  - lisää oikeudet olemassa olevien yritysten mallipohjaisiin rooleihin;
  - luo Nostovastaava-roolin jokaiseen olemassa olevaan yritykseen (nimi yrityksen kielellä);
  - kirjoittaa audit-tapahtuman jokaiselle yritykselle.
  - Mitään ei poisteta.

## 2. Tietokantaskeeman muutokset

Migraatiot: `v5_lifting` (taulut), `v5_integrity` (triggerit ja rajoitteet), `v5_lift_gate` (V4:n LIFT-pyyntöjen esto) ja `v5_permissions`.

| Taulu | Sisältö | Eheys |
|---|---|---|
| `lifting_accessories` | Tunnus (uniikki yrityksessä), tyyppi, käyttökuorma (WLL), tarkastus, tila | WLL > 0 |
| `lift_plans` | Työmaa, LIFT-pyyntö, tahtitehtävä, aika, tila, toteutus | Valmis vain hyväksytyllä versiolla; valmis tai peruttu on lopullinen; ei poistoja |
| `lift_plan_versions` | Suunnitelman sisältö, lähetys ja päätös | Hyväksytty ja korvattu lukittu; enintään 1 hyväksytty ja 1 avoin per suunnitelma; hyväksyjä ≠ lähettäjä; ei poistoja |
| `lift_plan_accessories` | Version apuvälineet ja määrät | Muutettavissa vain luonnoksessa |
| `material_batches` | Erä, määrä, tila, toimitus, tehtävä, sijainti | Määrä > 0, yhdistelmävierasavaimet työmaahan |
| `material_movements` | Muuttumaton siirtoloki | UPDATE ja DELETE estetty |
| `cable_drums` | Kela ja metrit | 0 ≤ jäljellä ≤ alkupituus; pituutta ei voi muuttaa suoraan |
| `cable_pulls` | Muuttumaton vetoloki metreinä | Pituus > 0; UPDATE ja DELETE estetty |

Muutokset V1–V4-tauluihin:
- `resource_bookings.lift_plan_id` (nullable).
- `deliveries`: uusi uniikki avain `(company_id, site_id, id)` työmaakohtaisia viittauksia varten.
- `logistics_requests`: uusi LIFT-triggeri.

Muutokset ovat taaksepäin yhteensopivia. Kaikki viittaukset ovat yhdistelmävierasavaimia (`company_id`, `site_id`), joten yritysten tai työmaiden välinen ristiviittaus on mahdoton tietokantatasolla.

## 3. Testitulokset (todelliset ajot 2026-10-05)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, tyypit, kerrokset, unit + integraatio) | **32 tiedostoa, 1144 testiä läpi** |
| ↳ yksikkötestit | 18 tiedostoa, 100 testiä. Uusi: `lifting/rules.test` (9 testiä). |
| ↳ integraatiotestit (oikea PostgreSQL 16) | 1044 testiä. Mukana eristystestisarja (388: 33 uutta V5-metodia), oikeusmatriisi (575: 11. sarake Nostovastaavalle ja 11 uutta toimintoriviä) ja `lifting.test` (10). |
| `pnpm depcruise` | Ei kerrosrikkomuksia (249 moduulia, 1224 riippuvuutta) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä → seed (2 yritystä, 41 oikeutta, 302 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **86 läpi, 1 ohitettu.** Ohitettu testi on V2:n palkkavienti, joka ajetaan tarkoituksella vain työpöydällä. Uusi `lifting.spec` sisältää 7 skenaariota × 2 näkymäkokoa. |
| `pnpm build` | Tuotantobuild onnistuu |

**Ensimmäinen koko E2E-ajo:** 84 läpi ja 2 epäonnistui. Molemmat olivat kuvakaappaustestejä, jotka avasivat materiaalisivun ilman työmaavalintaa. Testi korjattiin, ja koko sarja ajettiin uudelleen.

**Testit löysivät ja korjasivat:**
1. **Lomakkeiden yleisvirheet** (esim. "tarkistukset eivät mene läpi", "omaa suunnitelmaa ei voi hyväksyä") näkyivät vain yleisenä "Tarkista lomake" -ilmoituksena. Nyt lomake näyttää varsinaisen syyn.
2. **Demodatan nosturin tarkastuspäivä oli kiinteä** (2026-10-20), joten demodata olisi rikkoutunut sen jälkeen, koska nostotarkistus estää erääntyneen nosturin. Päivä lasketaan nyt seed-päivästä.

Huom: tässä ympäristössä E2E vaatii `PW_CHROMIUM=/opt/pw-browsers/chromium`. GitHub Actionsin tulosta en ole tarkistanut tässä istunnossa.

## 4. Tietoturva ja yritysten eristys
- **Eristys:** kaikki 33 uutta palvelumetodia on rekisteröity, ja jokaisella on eristystapaus.
  - Toisen yrityksen kelat, erät, apuvälineet, suunnitelmat ja tehtävät palauttavat 404:n tai hylkäyksen.
  - Sama koskee QR-tunnisteita, kirjoitettuja koodeja ja tarra-PDF:iä.
- **QR-koodi** sisältää vain sisäisen polun ja UUIDv7-tunnisteen, ei mitään tietoja. Avaaminen vaatii istunnon ja jäsenyyden, ja näkymätön kohde palauttaa 404:n.
- **Tarra-PDF:n välimuisti:** palautetaan `Cache-Control: private, no-store`.
- **Hyväksyntä:** oman suunnitelman hyväksyntä on estetty sekä palvelussa että tietokannassa. Varoitusten kuittaus ja korvattu versio kirjataan muutoslokiin.
- **Muutosloki:** kaikki muutokset (19 uutta audit-toimintoa) kirjoitetaan samassa transaktiossa. Siirto- ja vetolokit ovat lisäksi muuttumattomia.
- **Seed:** vain kuvitteellista dataa (esim. "Ville Vinssi", "Kaapelitehdas Demo Oy").

## 5. Tunnetut rajoitukset
1. **Nosturin kapasiteetti syötetään käsin** kuormitustaulukosta. Kuormitustaulukkotietokantaa ei ole.
2. **WLL-tarkistus on konservatiivinen yksinkertaistus.** Jokaisen apuvälinerivin yhteenlaskettu käyttökuorma kattaa koko kuorman. Kulmakertoimet ja kuorman jakautuminen jäävät suunnittelijan vastuulle.
3. **Kameraskannaus vaatii selaimen BarcodeDetector-tuen**, eli Chromium-pohjaisen Androidin. iOS Safarissa käytetään tunnuksen kirjoittamista. Kameraa ei voi testata automaattisesti, joten E2E testaa käsin kirjoitetun tunnuksen ja QR-osoitteen.
4. **Kelaa ei voi siirtää toiselle työmaalle.** Kela on työmaakohtainen; siirto tehdään palauttamalla ja kirjaamalla uudelleen.
5. **Erän määrää ei voi jakaa** (esim. puolet asennettu). Osittaisessa käytössä erä jaetaan kahdeksi eräksi.
6. **Nostosuunnitelmasta ei tehdä PDF-tulostetta.** Suunnitelma on järjestelmässä, ja QR-tarrat ovat ainoa PDF.
7. **V1–V4:n rajoitukset ovat edelleen voimassa:**
   - rate limit on muistinvarainen;
   - RLS ei ole käytössä;
   - Entra ID:tä ei ole testattu oikeaa tenanttia vasten;
   - yritysten välinen laskutus puuttuu (V6).

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev     # http://localhost:3000 → Kehityskirjautuminen
```

Demodata V5:lle (Data Hall A):
- **Nostosuunnitelmat**
  - Hyväksytty suunnitelma odottavalle nostopyynnölle, ja nosturinkuljettaja on varattu.
  - Muuntajan nosto odottaa hyväksyntää: käyttöaste on 92 %, ja riskiarvio puuttuu.
- **Nostoapuvälineet:** 5 kappaletta, joista yhden tarkastus on erääntynyt.
- **Kaapelikelat:** 4 kappaletta, joista kahdesta on kirjattu vetoja tehtäville.
- **Materiaalierät:** 3 erää eri vaiheissa.

Kokeile demotunnuksilla:
- `lifting@skinfra.example.com` (Nostovastaava): hyväksy muuntajan nosto.
- `supervisor@` puhelimella: "Materiaalit" → "Skannaa QR", ja kirjoita tunnus `KK-0001`.

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`. Uudet V5-näkymät:
- `lifting-list.png`: tulevat ja tehdyt nostot sekä uusi nosto
- `lifting-plan-submitted.png`: hyväksyntää odottava suunnitelma, tarkistukset ja varoitukset
- `lifting-plan-approved.png`: hyväksytty ja lukittu suunnitelma, nostoryhmä ja versiohistoria
- `lifting-accessories.png`: apuvälinerekisteri ja erääntyneet tarkastukset
- `materials.png`: kelat (jäljellä olevan pituuden palkki) ja materiaalierät
- `materials-drum.png`: kelan metrit, vedon kirjaus ja vetoloki
- `materials-batch.png`: erän siirtohistoria toimituksesta asennukseen
- `scan.png`: mobiiliskannaus (kamera ja tunnuksen kirjoitus)

## 8. Ehdotettu V6-suunnitelma (Commercial, §40)

**Odottaa hyväksyntää. Ei aloitettu.** §40 luettelee: CRM, myyntimahdollisuudet, tarjoukset ja tarjousversiot, sopimukset, lisä- ja muutostyöt, laskutusaihiot, taloudellinen ennuste (EAC) sekä integraatioiden vientirajapinnat.

1. **CRM ja myynti**
   - Asiakkaat ja yhteyshenkilöt korvaavat projektin tekstimuotoisen asiakasnimen (taaksepäin yhteensopiva siirto).
   - Myyntimahdollisuudet tiloineen ja todennäköisyyksineen.
2. **Tarjoukset ja tarjousversiot:** hyväksytty versio lukitaan V3/V5-mallin mukaisesti. Hyväksytty tarjous muuttuu sopimukseksi ja V2:n budjetin pohjaksi.
3. **Sopimukset sekä lisä- ja muutostyöt:** muutostyö on hinnoiteltu, hyväksyttävä ja versioitu, ja se päivittää sopimussummaa ja ennustetta.
4. **Laskutusaihiot**
   - Lähteet: hyväksytyt tunnit (V2), kustannukset (V2), varaukset ja kalustoajat (V4/V5) sekä sopimuksen maksuerät.
   - Laskutushinnat ovat yrityskohtaisia ja voimassaoloaikaan sidottuja (V1).
   - Konsernin sisäinen laskutus varauksista: omistus ja kustannukset pysyvät yrityskohtaisina.
5. **Ennuste (EAC):** toteuma + jäljellä oleva arvio, ja kate projektin ja sopimuksen tasolla, V2:n laskentasääntöjen jatkona.
6. **Vientirajapinnat:** vain rajapinnat ja tiedostovienti (CSV/JSON), ei keksittyjä integraatioita, kuten V1:ssä sovittiin.
7. **Uudet oikeudet** (esim. `crm.view`, `crm.manage`, `quote.approve`, `invoice.manage`, `forecast.view`). Hinta- ja katetiedot ovat arkaluonteisia, eivätkä asiakas- ja aliurakoitsijaroolit saa niitä.

Avoimet päätökset omistajalle ennen V6:ta:
1. Mihin taloushallintojärjestelmään laskutusaihiot viedään (esim. Netvisor, Procountor, Fennoa), vai riittääkö V6:ssa tiedostovienti?
2. Millä hinnalla sisäinen laskutus tehdään: omistavan yrityksen laskutushinnalla vai erillisellä konsernin sisäisellä hinnalla?
3. Kuka hyväksyy tarjoukset ja lisätyöt, ja onko euromääräistä rajaa (esim. yli 50 000 € projektijohtaja)?
