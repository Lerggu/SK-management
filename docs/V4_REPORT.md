# SK Management — V4 Logistics: pysäytysraportti

- Päivämäärä: 2026-10-05
- Haara: `claude/dazzling-edison-zzskak`
- Tila: **V4 valmis. V5:tä ei ole aloitettu**, koska se odottaa omistajan hyväksyntää.

Taustamateriaali:
- Suunnitelma ja omistajan päätökset: [V4_PLAN.md](V4_PLAN.md)
- Resurssivaraukset ja yritysten välinen käyttö: [ADR 0014](adr/0014-resource-bookings.md)
- Logistiikkapyynnöt, portit ja toimitukset: [ADR 0015](adr/0015-logistics-and-deliveries.md)

## 1. Toteutettu, §38 hyväksymiskriteerien mukaan

| # | Kriteeri (§38) | Toteutus | Todennettu |
|---|---|---|---|
| 1 | Ristiriitaiset varaukset tunnistetaan | Järjestelmä tunnistaa ristiriidat (lista alla). Ristiriitoja ei ratkaista automaattisesti: hyväksyntä vaatii erillisen kuittauksen, joka tallennetaan ja kirjataan muutoslokiin. Portin aikaikkuna ei voi olla kahdesti varattu, minkä tietokannan poissulkemisrajoite varmistaa. | Unit `rules.test`. Integraatio `logistics.test`: päällekkäisyys → kuittaus vaaditaan → hyväksyntä, sekä tarkastus, ei käytettävissä ja ammatti. E2E: ristiriita näkyy, varattu ikkuna hylätään. |
| 2 | Logistiikka on jäljitettävissä takt-tehtävään | Pyynnöt, toimitukset ja varaukset linkitetään tahtitehtävään, ja varaus voi viitata baselinen resurssitarpeeseen. Tehtävälle kohdistettu toimitus avaa materiaalirajoitteen. Rajoite kuittautuu, kun materiaali on työmaalla (varastossa, työkohteessa tai asennettu), joten myöhästyvä toimitus pitää tehtävän tilassa "ei valmis" tai "estynyt". Tehtäväsivu näyttää sen logistiikan. | Integraatio: toimitus → rajoite OPEN → STORED → CLEARED, ja tehtäväsivu listaa toimitukset ja pyynnöt. |
| 3 | Toimitusaikataulu toimii mobiilissa ja työpöydällä | Työpöydällä on logistiikkataulu: portit × 30 minuutin ikkunat, päivän toimitukset, pyynnöt ja varaukset. Mobiilissa on porttinäkymä, jossa päivän saapuvat toimitukset ja kaksi seuraavaa vaihetta isoina painikkeina. | E2E työpöydällä ja mobiilissa: toimituksen aikataulutus, portin tilan kirjaus yhdellä napautuksella. |

Tunnistettavat ristiriidat:
- päällekkäinen varaus samalle resurssille, myös toisen yrityksen tekemä;
- resurssi ei ole käytettävissä (henkilö ei aktiivinen tai kalusto huollossa tai pois käytöstä);
- kaluston tarkastus erääntyy ennen varauksen loppua;
- ammatti tai kalustotyyppi ei vastaa tahtitehtävän tarvetta.

### Omistajan päätökset (toteutettu)
1. **Logistiikkapyynnöt hyväksyy logistiikkakoordinaattori tai työmaapäällikkö.**
   - Kumman tahansa hyväksyntä riittää yksinään.
   - Projektijohtaja ja toimitusjohtaja voivat hyväksyä kaikissa projekteissa.
   - Projektipäällikkö ja työnjohtaja voivat tehdä pyyntöjä mutta eivät hyväksyä (testattu).
2. **Yritysten väliset varaukset sallitaan saman konsernin sisällä.**
   - Omistava yritys merkitsee resurssin jaettavaksi ("Jaettavissa konsernin yrityksille").
   - Varaava yritys näkee resurssista vain nimen, tyypin ja omistajan. Hintoja se ei näe.
   - Omistava yritys hyväksyy pyynnön. Omistajuus ei muutu, ja tapahtuma kirjautuu molempien yritysten muutoslokiin.
   - Konsernin ulkopuolinen yritys ei voi varata resurssia edes suoralla SQL:llä, minkä DB-triggeri estää.
3. **Toimitusikkuna on 30 minuuttia.**
   - Portilla on aukioloajat, ja yksi toimitus voi viedä useamman peräkkäisen ikkunan.
   - Ajat käsitellään Helsingin aikana, myös kesäajan vaihtuessa (testattu).

### Muut toimitetut ominaisuudet
- **Resurssivaraukset** (Logistiikka → Resurssivaraukset):
  - omat ja konsernin jaetut resurssit;
  - porukan varaus kerralla;
  - omien resurssien varauspyynnöt muilta konsernin yrityksiltä;
  - hyväksyntä, hylkäys ja peruutus.
- **Varaus tahtitehtävältä:** tehtäväsivulta voi varata resurssin suoraan baselinen resurssitarpeelle. Varauksen oletusaika on tehtävän suunniteltu aikaväli.
- **Look-ahead:** viikkosoluissa näkyy tarpeen ja kapasiteetin lisäksi "varattu" (hyväksytyt varaukset).
- **Logistiikkapyynnöt:** palvelutyyppi, aika, kuorma, paino, mitat, nouto, määränpää, tarvittava kalusto, kiireellisyys ja takt-tehtävä. Pyynnöllä on oma tilakulku (tilat alla).
- **Toimitukset:** toimittaja, kuljetusliike, ajoneuvo, materiaali, määrä, paino, purkupaikka, varastopaikka, pyyntö ja tehtävä, sekä elinkaari (tilat alla). Toimituksen voi siirtää ennen saapumista.
- **Portit ja varastot:** työmaakohtaiset portit (aukioloajat), purkupaikat ja varastopaikat.
- **Navigaatio:** uusi kohta "Logistiikka".

Pyynnön tilat: luonnos → pyydetty → käsittelyssä → hyväksytty → aikataulutettu → käynnissä → valmis, tai peruttu.

Toimituksen elinkaari: suunniteltu → vahvistettu → portilla → kirjattu sisään → purussa → varastossa → työkohteessa → asennettu, tai peruttu ennen saapumista.

### V4 rooli × oikeus -matriisi (generoitu koodista `ROLE_TEMPLATES`)

Ulkoiset roolit (SUB, CLI) eivät saa logistiikkaoikeuksia.

| Oikeus | CEO | PD | PM | SM | SUP | LOG | HSE | EMP | SUB | CLI |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `logistics.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `logistics.request` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| `logistics.approve` | ✓ | ✓ |  | ✓ |  | ✓ |  |  |  |  |
| `booking.manage` | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |
| `delivery.manage` | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |  |

Migraatio `v4_permissions` lisää oikeudet mallipohjaisiin rooleihin. Migraatio vain lisää oikeuksia eikä poista mitään. Jokaiselle yritykselle kirjoitetaan audit-tapahtuma.

## 2. Tietokantaskeeman muutokset

Migraatiot:
- `v4_logistics`: taulut ja kaksi uutta saraketta;
- `v4_integrity`: triggerit, check-rajoitteet ja btree_gist-poissulkemisrajoite;
- `v4_permissions`: oikeudet.

| Muutos | Sisältö |
|---|---|
| `employees.shareable_in_group`, `equipment.shareable_in_group` | Uusi sarake, oletus false. Ei rikkovaa muutosta. |
| `resource_bookings` | Varaava yritys (`company_id`) ja omistajayritys (`owner_company_id`), resurssi (henkilö tai kalusto), projekti, työmaa, takt-tehtävä, resurssitarve, aika, tila, päätös ja ristiriitojen kuittaus |
| `logistics_locations` | Portti (aukioloajat 30 min tarkkuudella), purkupaikka tai varastopaikka |
| `logistics_requests` | §11:n kentät, tila, hyväksyjä |
| `deliveries` | §12:n kentät, porttiaikaikkuna, tila, materiaalirajoitteen linkki |

Eheys tietokantatasolla:
- **Resurssin omistus:** komposiittivierasavain `(owner_company_id, resource) → resurssin yritys`.
- **Varaukset:** samaan konserniin rajaus, jaettavuusvaatimus, tilasiirtymät ja muuttumaton resurssi. Hyväksyttyä varausta ei voi siirtää, eikä varauksia poisteta.
- **Toimitukset:** porttiaikaikkuna ei voi olla päällekkäin (poissulkemisrajoite). Ikkunat ovat 30 minuutin tasaväleillä. Tila etenee vain eteenpäin, saapuneen toimituksen ikkuna jäädytetään, eikä toimituksia poisteta.
- **Pyynnöt:** tilasiirtymät ja poistoesto.

## 3. Testitulokset (todelliset ajot 2026-10-05)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, tyypit, kerrokset, unit + integraatio) | **30 tiedostoa, 897 testiä läpi** |
| ↳ yksikkötestit | 17 tiedostoa, 91 testiä. Uudet: `logistics/rules.test` ja `platform/i18n/time.test`. |
| ↳ integraatiotestit (oikea PostgreSQL 16) | 806 testiä. Mukana eristystestisarja (322: 20 uutta V4-metodia), oikeusmatriisi (413, joista 60 uutta riviä) ja `logistics.test` (7). |
| `pnpm depcruise` | Ei kerrosrikkomuksia (227 moduulia, 1066 riippuvuutta) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä → seed (2 yritystä, 36 oikeutta, 266 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **71 läpi, 1 ohitettu.** Ohitettu testi on V2:n palkkavienti, joka ajetaan tarkoituksella vain työpöydällä. Uusi `logistics.spec` sisältää 7 skenaariota × 2 näkymäkokoa. |
| `pnpm build` | Tuotantobuild onnistuu |

**Testit löysivät ja korjasivat:**
1. **Varauslistan projektisuodatin** ei tarkistanut, että projekti kuuluu omaan yritykseen. Dataa ei vuotanut, koska tulokset suodatetaan yrityksen mukaan, mutta vieras projekti-id palautti tyhjän listan eikä 404:ää. Löytyi eristystestistä, ja korjattu.
2. **E2E-varaus jäi tilaan "odottaa päätöstä"**, koska kaivinkoneen tarkastus erääntyi ennen varauspäivää. Ristiriidan tunnistus toimi oikein; testin päivämäärä korjattiin.
3. **Kehitystilan "1 Issue" -ilmoitus kuvakaappauksissa** johtui Playwrightin kenttiin lisäämästä tyylistä, ei sovelluksesta. Korjattu kuvakaappausasetuksella, ja lokissa ei ole enää hydraatiovaroituksia. Samalla korjattiin logon kokovaroitus.

Huom: tässä ympäristössä E2E vaatii `PW_CHROMIUM=/opt/pw-browsers/chromium`. GitHub Actionsin tulosta en ole tarkistanut tässä istunnossa.

## 4. Tietoturva ja yritysten eristys

- **Eristys**
  - Kaikki 20 V4-palvelumetodia testataan konsernin ulkopuolista yritystä vastaan: vieras id johtaa 404:ään tai hylkäykseen.
  - Jaettu resurssi ei näy konsernin ulkopuolelle, eikä sitä voi varata (testattu sekä palvelu- että tietokantatasolla).
- **Kaksi rajattua konsernin sisäistä lukua** (ADR 0014):
  - Jaettavien resurssien hakemisto: ei hintoja eikä yhteystietoja.
  - Saman resurssin varaukset ristiriitatarkistusta varten: vain aikavälit, ei toisen yrityksen projekteja.
- **Omistava yritys näkee varaavan yrityksen ja projektin**, jotta se tietää, minne resurssi menee. Varaava yritys näkee omistajasta vain nimen.
- **Muutosloki**
  - Yritysten väliset varaustapahtumat kirjataan molempien yritysten lokiin.
  - Kaikki pyyntö-, toimitus- ja paikkamuutokset kirjataan samassa transaktiossa.
- **Kuljettajan nimeä ei tallenneta.** Henkilötietoja ei kerätä tarpeettomasti, ja ajoneuvon rekisteritunnus riittää.

## 5. Tunnetut rajoitukset

1. **Liitteet puuttuvat logistiikkapyynnöiltä** (esim. kuormakuvat). Ne voidaan lisätä V5:ssä dokumenttilinkityksellä.
2. **Logistiikkataulun aikajanalla ovat vain toimitukset.** Varaukset ja pyynnöt näkyvät listoina samalla sivulla, eivät aikajanalla.
3. **Varausta ei voi luoda suoraan look-ahead-näkymästä.** Varaus tehdään tahtitehtävän sivulta resurssitarvetta vasten tai varaussivulta. Look-ahead näyttää varatun määrän.
4. **Työaikasääntöjä ei tarkisteta varauksissa**, koska sääntöjä ei ole konfiguroitu. Myöskään poissaoloja ei huomioida.
5. **Yritysten välinen laskutus puuttuu.** V4 kirjaa vain varatut ajat, ja laskutus tulee V6:ssa.
6. **Portin aukioloajat eivät seuraa työkalenteria:** pyhäpäivät eivät sulje porttia automaattisesti.
7. **Varauksen aika on yhtenäinen väli.** Monipäiväinen varaus kattaa myös yöt.
8. **V1–V3:n rajoitukset ovat edelleen voimassa:**
   - rate limit on muistinvarainen;
   - RLS ei ole käytössä;
   - Entra ID:tä ei ole testattu oikeaa tenanttia vasten;
   - tahtitaulussa ei ole vedä ja pudota -siirtoa.

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev     # http://localhost:3000 → Kehityskirjautuminen
```

Demodata V4:lle (Data Hall A):
- 2 porttia, purkualue ja 2 varastoa.
- Päivän toimitukset: yksi varastossa, yksi vahvistettu (linkitetty pyyntöön ja tehtävään) ja yksi suunniteltu.
- Odottava nostopyyntö.
- Varaukset: hyväksytty nosturivaraus, päällekkäinen nosturipyyntö (ristiriita), sähköasentajaporukka huomiselle ja Purentin jaettu trukki, joka odottaa Purentin hyväksyntää.

Kokeile demotunnuksilla:
- `logistics@skinfra.example.com`: logistiikkataulu, pyynnöt ja portit.
- `supervisor@`: porttinäkymä puhelimella.
- `pm@`: resurssivaraukset.
- `ceo@purent.example.com`: saapuneet varauspyynnöt.

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`. Uudet V4-näkymät:
- `logistics-board.png`: portit × 30 minuutin ikkunat, toimitukset, pyynnöt ja päivän varaukset
- `logistics-gate.png`: mobiilin porttinäkymä isoine tilapainikkeineen
- `logistics-bookings.png`: varaukset, ristiriidat ja uusi varaus (omat ja konsernin resurssit)
- `logistics-request.png`: logistiikkapyyntö, linkitetty tehtävä ja hyväksyntä

## 8. Ehdotettu V5-suunnitelma (Lifting & Material Flow, §39)

**Odottaa hyväksyntää. Ei aloitettu.**

1. **Nostopyynnöt ja nostosuunnitelmat**
   - Nosto on oma pyyntötyyppi, joka laajentaa V4:n logistiikkapyyntöä.
   - Nostosuunnitelmaan kuuluvat kuorma, paino, painopiste, nosturi ja kapasiteettitarkistus, ulottuma, nostoapuvälineet, alue ja turvaetäisyydet.
   - Nostosuunnitelman hyväksyy pätevä henkilö, ja hyväksytty suunnitelma lukitaan versioksi.
2. **Rigging-porukan allokointi:** riggerit ja nosturinkuljettajat V4:n varauksina, jolloin pätevyysristiriidat tunnistetaan.
3. **Nostoapuvälineet:** yksilöidyt välineet (raksit, sakkelit, nostopalkit), kuormitusraja ja tarkastus. Tarkastus erääntynyt tarkoittaa, ettei välinettä voi käyttää.
4. **Materiaalien seuranta:** materiaalierät ja liikkeet toimitus → varasto → työkohde → asennettu. Erä liitetään V4:n toimitukseen ja tahtitehtävään.
5. **Kaapelirummut:** yksilöllinen tunnus ja QR-koodi, valmistaja, kaapelityyppi, pituus, jäljellä oleva pituus ja sijainti. Jokainen veto kirjataan rummulle ja tehtävälle.
6. **QR-työnkulut mobiilissa:** skannaus avaa rummun, erän tai nostoapuvälineen, ja tilan voi kirjata yhdellä napautuksella.
7. **Uudet oikeudet:** `lift.request`, `lift.plan.approve`, `material.manage` ja `material.view`.

Avoimet päätökset omistajalle ennen V5:tä:
1. Kuka hyväksyy nostosuunnitelmat: nostoista vastaava henkilö, työmaapäällikkö vai HSE-asiantuntija?
2. Tarvitaanko kaapelirummuille pituusseuranta metreinä jokaisesta vedosta, vai riittääkö tila (täynnä / osittain / tyhjä)?
3. Tulostetaanko QR-tarrat järjestelmästä (PDF), vai käytetäänkö valmistajan omia koodeja?
