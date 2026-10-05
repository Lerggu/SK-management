# SK Management — V6 Commercial: pysäytysraportti

- Päivämäärä: 2026-10-05
- Haara: `claude/dazzling-edison-zzskak`
- Tila: **V6 valmis. V7:ää ei ole aloitettu**, koska se odottaa omistajan hyväksyntää.

Taustamateriaali:
- Suunnitelma ja omistajan päätökset: [V6_PLAN.md](V6_PLAN.md)
- CRM, tarjoukset ja lisätyöt: [ADR 0018](adr/0018-quotes-and-variations.md)
- Laskutusaihiot, tiedostovienti, sisäinen laskutus ja ennuste: [ADR 0019](adr/0019-invoicing-and-forecast.md)

## 1. Toteutettu, hyväksymiskriteerien mukaan

§40 luettelee sisällön mutta ei omia hyväksymiskriteerejä, joten käytin suunnitelmassa ehdotettuja.

| # | Kriteeri | Toteutus | Todennettu |
|---|---|---|---|
| 1 | Lähetettyä tai hyväksyttyä tarjousversiota ei voi muuttaa huomaamatta | Tietokantatriggeri lukitsee version sisällön, kun versio on lähetetty hyväksyttäväksi. Rivejä voi muuttaa vain luonnoksessa. Muutos tehdään uutena versiona, ja uuden version hyväksyntä korvaa edellisen. | `commercial.test` (palvelu ja suora tietokantapäivitys), E2E |
| 2 | Lisätyöt kulkevat §21:n mukaisen elinkaaren läpi, ja hyväksytty mutta laskuttamaton arvo näkyy | Elinkaari luonnoksesta laskutettuun. Hinnoittelu lukittuu tarkastuksen alkaessa. Asiakkaan hyväksyntä vaatii viitteen tai asiakirjan. Laskuttamaton arvo näkyy myyntinäkymässä ja projektin sopimussivulla. | `commercial.test`, E2E |
| 3 | Laskutusaihiot syntyvät vain hyväksytystä aineistosta, ja jokainen rivi on jäljitettävissä lähteeseensä | Lähteet: hyväksytyt tunnit × laskutushinta × tuntilajin kerroin, allekirjoitetun päiväkirjan kalustotunnit, laskutusvalmiit lisätyöt ja erääntyneet maksuerät. Sama lähde laskutetaan vain kerran (osittainen uniikki-indeksi). Rivi ilman hintaa raportoidaan, sitä ei arvata. | `commercial.test`, eristystestit, E2E |
| 4 | Ennuste ja EAC lasketaan keskitetyillä, testatuilla kaavoilla | `forecast()`: EAC = toteuma + jäljellä oleva arvio. Ennustettu liikevaihto = sopimukset + hyväksytyt lisätyöt. Lisäksi kate, ero budjettiin, laskutettu ja laskuttamatta. | `rules.test`, `commercial.test` |
| 5 | Laskutusaineisto viedään tiedostona, ja vienti kirjataan muutoslokiin ja on toistettavissa | Vienti on muuttumaton tiedosto (CSV tai JSON) SHA-256-tarkisteineen. Tiedoston voi ladata uudelleen täsmälleen samana. Uudelleenvienti merkitään viennille ja kirjataan muutoslokiin. | `commercial.test`, E2E (lataus ja tarkisteen vertailu) |

### Omistajan päätökset (toteutettu)

| # | Päätös | Toteutus |
|---|---|---|
| 1 | Tiedostovienti | CSV on UTF-8 BOM:lla, puolipisteillä ja desimaalipilkulla, joten se avautuu suoraan suomalaisessa Excelissä. JSON sisältää lisäksi viennin tiedot. Jokaisella rivillä on aihion ja lähteen tunniste. Kirjanpidon integraatiosta on vain rajapinta (`AccountingExportAdapter`). Laskutettu-tila kirjataan käsin laskun numerolla. |
| 2 | Sisäinen laskutus omistajan laskutushinnalla | Omistava yhtiö laskuttaa toisen konserniyhtiön hyväksytyt varaukset omista resursseistaan: varatut tunnit × omistajan laskutushinta varauspäivänä. Varaava yhtiö näkee vain summan ja sen perusteen. Se ei näe omistajan kustannushintoja eikä pääse omistajan vientitiedostoihin. |
| 3 | Projektijohtaja hyväksyy | Projektijohtaja hyväksyy tarjoukset ja lisätyöt (sisäinen hyväksyntä ennen asiakasta). Toimitusjohtajalla on sama oikeus, kuten V3–V5:ssä. Projektipäällikkö valmistelee mutta ei hyväksy. Laatija tai lähettäjä ei voi hyväksyä omaansa (palvelu ja tietokantatriggeri). Euromääräistä rajaa ei ole, koska sitä ei päätetty. |

### Muut toimitetut ominaisuudet
- **CRM**
  - Asiakkaat ja yhteyshenkilöt.
  - Myyntimahdollisuudet vaiheittain (liidi → kvalifioitu → tarjouspyyntö → tarjottu → neuvottelu → voitettu tai hävitty) ja painotettu myyntiputki.
  - Projektiin tulee asiakaslinkki. Vanha asiakkaan nimi tekstinä säilyy, joten muutos on taaksepäin yhteensopiva.
- **Tarjoukset**
  - Rivit lajeittain: työ, kalusto, nostot, kuljetukset, materiaalit, matkat, majoitus, alihankinta ja muut.
  - Hinnoitteluun lasketaan yleiskulut, riskivaraus ja kate myyntihinnasta.
  - Tarjous kulkee: lähetys asiakkaalle → voitettu tai hävitty. Voitettu tarjous luo sopimuksen projektille ja päivittää myyntimahdollisuuden.
- **Sopimukset:** sopimusarvo, maksuerät ja sulkeminen.
- **Navigaatio:** uudet kohdat "Myynti" ja "Laskutus" sekä projektisivun "Sopimus ja ennuste".

### V6 rooli × oikeus -matriisi (generoitu koodista `ROLE_TEMPLATES`)

| Oikeus | Toimitusjohtaja | Projektijohtaja | Projektipäällikkö | Työmaapäällikkö | Työnjohtaja | Logistiikkakoordinaattori | HSE-asiantuntija | Työntekijä | Aliurakoitsija | Asiakas | Nostovastaava |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `crm.view` | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |
| `crm.manage` | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |
| `commercial.view` | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |
| `commercial.manage` | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |
| `commercial.approve` | ✓ | ✓ |   |   |   |   |   |   |   |   |   |
| `invoice.manage` | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |

- **Arkaluonteisuus:** `commercial.*` ja `invoice.manage` on merkitty arkaluonteisiksi, joten ulkoiset roolit eivät voi saada niitä edes virheellisellä roolimäärityksellä.
- **CRM on yrityskohtainen:** `crm.*`-oikeuksia ei voi antaa projektiroolin kautta.
- **Migraatio `v6_permissions`** lisää oikeudet mallipohjaisiin rooleihin ja kirjoittaa audit-tapahtuman jokaiselle yritykselle. Mitään ei poisteta.

## 2. Tietokantaskeeman muutokset

Migraatiot: `v6_commercial` (12 taulua), `v6_integrity` (triggerit, CHECK-rajoitteet, osittaiset uniikki-indeksit) ja `v6_permissions`.

| Taulu | Eheys |
|---|---|
| `customers`, `contacts` | Nimi uniikki yrityksessä |
| `opportunities` | Todennäköisyys 0–100, arvo ≥ 0 |
| `quotes`, `quote_versions`, `quote_lines` | Versio lukittuu lähetyksessä; siirtymät valvotaan; hyväksyjä ei ole laatija eikä lähettäjä; yksi avoin ja yksi voimassa oleva versio; ei poistoja |
| `contracts`, `contract_milestones` | Arvo ≥ 0, maksuerä > 0 |
| `variations` | §21-siirtymät; hinnoittelu lukittuu tarkastuksen alkaessa; sisäinen hyväksyjä ei ole laatija eikä lähettäjä; ei poistoja |
| `invoice_candidates` | Sisältö muuttumaton; `amount = round(quantity × unit_price, 2)`; yksi voimassa oleva aihio per lähde; sisäisellä aihiolla eri laskutettava yhtiö; ei poistoja |
| `invoice_export_batches` | Vain lisäys (append-only), SHA-256-muodon tarkistus |
| `cost_forecasts` | Vain lisäys (append-only); viimeisin arvio per kustannuslaji on voimassa |

Muutokset V1–V5-tauluihin:
- `projects.customer_id` (nullable).

Kaikki uudet viittaukset ovat yhdistelmävierasavaimia (`company_id`, …).

## 3. Testitulokset (todelliset ajot 2026-10-05)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, tyypit, kerrokset, unit + integraatio) | **34 tiedostoa, 1390 testiä läpi** |
| ↳ yksikkötestit | 110 testiä. Uusi: `commercial/rules.test` (10): tarjous- ja lisätyöhinnoittelu, EAC, painotettu myyntiputki, CSV ja laskutushinnat. |
| ↳ integraatiotestit (oikea PostgreSQL 16) | 1280 testiä. Mukana eristystestisarja (486: 49 uutta V6-metodia), oikeusmatriisi (707, joista 12 uutta toimintoriviä × 11 roolia) ja `commercial.test` (6). |
| `pnpm depcruise` | Ei kerrosrikkomuksia (269 moduulia, 1398 riippuvuutta) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä → seed (2 yritystä, 47 oikeutta, 348 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **97 läpi, 1 ohitettu.** Ohitettu testi on V2:n palkkavienti, joka ajetaan tarkoituksella vain työpöydällä. Uusi `commercial.spec` sisältää 5 skenaariota × 2 näkymäkokoa. |
| `pnpm build` | Tuotantobuild onnistuu |

**Testauksen aikana korjattua:**
1. **Myyntisivu kaatui palvelinvirheeseen** käyttäjällä, jolla ei ole CRM-oikeutta, eikä palauttanut 404:ää. Löytyi E2E-testistä, ja korjattu.
2. **Laskutusaihion yksikäsitteisyys** muutettiin osittaiseksi indeksiksi. Mitätöidyn aihion lähteen voi nyt laskuttaa uudelleen esimerkiksi hinnan korjauksen jälkeen, mutta kahta voimassa olevaa aihiota samasta lähteestä ei voi syntyä.

Huom: tässä ympäristössä E2E vaatii `PW_CHROMIUM=/opt/pw-browsers/chromium`. GitHub Actionsin tulosta en ole tarkistanut tässä istunnossa.

## 4. Tietoturva ja yritysten eristys
- **Eristys:** kaikki 49 uutta palvelumetodia testataan toista yritystä vastaan. Vieras id johtaa 404:ään tai hylkäykseen, ja ristiviittaukset estetään myös tietokannassa.
- **Hinnat ja katteet:** näkyvät vain toimitusjohtajalle, projektijohtajalle ja projektipäällikölle (omat projektit). Työmaapäällikkö saa laskutusnäkymästä 403:n, ja asiakas saa myynti- ja laskutussivuilta 404:n (E2E).
- **Henkilötiedot:** yhteyshenkilön tiedoista muutoslokiin tallennetaan vain nimi.
- **Vientitiedostot:** ladattavissa vain laskutusoikeudella ja vain niiden projektien osalta, joihin käyttäjällä on oikeus. Lataus on yksityinen eikä välimuistiin tallennettava, ja tiedoston tarkiste on otsakkeessa.
- **Konsernin sisäinen laskutus:** varaava yhtiö näkee vain summat. Omistajan kustannushinnat eivät näy (testattu).
- **Muutosloki:** kaikki V6-muutokset kirjataan samassa transaktiossa.
- **Seed:** vain kuvitteellista dataa (`example.com`-osoitteet ja kuvitteelliset Y-tunnukset).

## 5. Tunnetut rajoitukset
1. **Laskuja ei luoda järjestelmässä** (päätös 1). Laskutettu-tila kirjataan käsin, eikä kirjanpitointegraatiota ole.
2. **Tarjouksesta ei tehdä PDF-tulostetta.** Tarjous lähetetään asiakkaalle muualta, ja järjestelmään kirjataan lähetys ja lopputulos.
3. **Sisäisen laskutuksen tunnit ovat varauksen kesto.** Monipäiväinen varaus sisältää yöt (sama rajoitus kuin V4:ssä). Toteutuneisiin tunteihin perustuva sisäinen laskutus vaatisi päätöksen.
4. **Valuutta:** kaikki on euroissa. Monivaluuttainen vienti estetään, mutta valuuttamuunnosta ei tehdä.
5. **Tuloutus** (earned/recognized revenue) ei ole mukana, koska tuloutusperiaatetta ei ole päätetty (§22: "as configured"). Ennuste näyttää laskutetun ja laskuttamattoman.
6. **Ennusteen toteuma** näkyy vain talousoikeudella. Ilman sitä toteuma on 0, ja siitä kerrotaan näkymässä.
7. **V1–V5:n rajoitukset ovat edelleen voimassa:**
   - rate limit on muistinvarainen;
   - RLS ei ole käytössä;
   - Entra ID:tä ei ole testattu oikeaa tenanttia vasten.

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev     # http://localhost:3000 → Kehityskirjautuminen
```

Demodata V6:lle (SK Infra Demo):
- **Asiakkaat:** kolme asiakasta yhteyshenkilöineen.
- **Myyntiputki:** kolme myyntimahdollisuutta.
- **Tarjoukset**
  - Voitettu tarjous: siitä syntyi sopimus SOP-NDC-001 kahdella maksuerällä.
  - Data Hall B:n tarjous odottaa projektijohtajan hyväksyntää.
- **Lisätyöt:** asiakkaan hyväksymä, sisäisessä tarkastuksessa ja laskutusvalmis.
- **Ennuste ja laskutus:** jäljellä olevat kustannusarviot ja muodostetut laskutusaihiot.

Kokeile demotunnuksilla:
- `pm@skinfra.example.com`: "Myynti", "Laskutus" ja NDC-001 → "Sopimus ja ennuste".
- `pd@skinfra.example.com`: hyväksy Data Hall B:n tarjous ja lisätyö LT 2.

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`. Uudet V6-näkymät:
- `sales.png`: myynnin tunnusluvut, myyntiputki vaiheittain, myyntimahdollisuudet ja asiakkaat
- `sales-quotes.png`, `sales-quote.png`: tarjouslista sekä tarjouksen hinnoittelu, rivit ja hyväksyntä
- `project-commercial.png`: ennuste (EAC), lisätyöt ja sopimukset maksuerineen
- `variation.png`: lisätyön elinkaari ja sisäinen hyväksyntä
- `billing.png`: laskutusaihiot, vienti, vientitiedostot SHA-256-tarkisteineen ja sisäinen laskutus

## 8. Ehdotettu V7-suunnitelma (HSE & Portals, §41)

**Odottaa hyväksyntää. Ei aloitettu.** §41 luettelee: täydet HSE-työnkulut, asiakasportaali, aliurakoitsijaportaali, ulkoisten käyttäjien oikeusrajat sekä erillinen tietoturvatestaus ennen julkaisua. Laadin `docs/V7_PLAN.md`:n, kun saan luvan.
1. **HSE:** turvallisuushavainnot, poikkeamat ja läheltä piti -tilanteet, TR-/MVR-mittaukset, perehdytykset, tarkastukset ja korjaavat toimenpiteet tahtitehtäviin ja työmaihin linkitettyinä.
2. **Asiakasportaali:** asiakas näkee oman projektinsa etenemän, hyväksytyt dokumentit ja lisätyöt hyväksyttäväksi, mutta ei koskaan kustannuksia.
3. **Aliurakoitsijaportaali:** aliurakoitsija näkee omat tehtävänsä, perehdytyksensä ja dokumenttinsa.
4. **Ulkoisten käyttäjien oikeusrajat ja rivitason tietoturva (RLS):** CLAUDE.md:n mukaan RLS toteutetaan lisäsuojana ennen V7:ää, koska portaalit tuovat ulkoiset käyttäjät järjestelmään.
5. **Erillinen tietoturvatestaus** ennen julkaisua (§41): portaalien murtautumistyyppiset testit, oikeusrajojen negatiivitestit ja riippuvuuksien haavoittuvuusskannaus.

Avoimet päätökset omistajalle ennen V7:ää:
1. Kirjautuvatko ulkoiset käyttäjät (asiakas, aliurakoitsija) Entra ID:llä (B2B-vieras) vai sähköpostilinkillä?
2. Saako asiakas hyväksyä lisätyön portaalissa sähköisesti, ja korvaako se V6:n viitteen tai asiakirjan?
3. Mitkä HSE-mittarit raportoidaan (esim. TR-mittaus, MVR, tapaturmataajuus) ja kuka käsittelee poikkeamat?
