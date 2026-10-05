# SK Management — V7 HSE & Portals: pysäytysraportti

- Päivämäärä: 2026-10-05
- Haara: `claude/dazzling-edison-zzskak`
- Tila: **V7 valmis. V8:aa ei ole aloitettu**, koska se odottaa omistajan hyväksyntää.

Taustamateriaali:
- Suunnitelma ja omistajan päätökset: [V7_PLAN.md](V7_PLAN.md)
- Ulkoinen pääsy, sähköpostilinkki, portaalit ja asiakkaan hyväksyntä: [ADR 0020](adr/0020-external-access-and-portals.md)
- HSE-työnkulut, henkilötiedot ja tunnusluvut: [ADR 0021](adr/0021-hse-workflows.md)

## 1. Toteutettu, hyväksymiskriteerien mukaan

§41 luettelee sisällön mutta ei omia hyväksymiskriteerejä, joten käytin suunnitelmassa ehdotettuja.

| # | Kriteeri | Toteutus | Todennettu |
|---|---|---|---|
| 1 | Työntekijä tai aliurakoitsija ilmoittaa havainnon, läheltä piti -tilanteen tai tapaturman puhelimella kuvan kanssa | Yksi lyhyt lomake. Kuva otetaan suoraan kameralla, ja isot pikapainikkeet ovat HSE-sivulla ja portaalissa. Kuvat ovat vain lisättäviä, ja ilmoitus tallentuu, vaikka kuva hylättäisiin. | `hse.test`, E2E (työpöytä + mobiili) |
| 2 | Vakava tapaturma kulkee käsittely → tutkinta → hyväksytyt toimenpiteet → sulkeminen, ja johto saa heti ilmoituksen | Tietokantatriggeri estää sulkemisen ilman tutkintaa ja juurisyytä sekä hyväksymättömillä toimenpiteillä. Ilmoitus lähtee projektijohtajalle, HSE:lle ja toimitusjohtajalle sähköpostina ilman henkilötietoja, ja kiireelliset näkyvät listana. | `hse.test` (palvelu ja suorat kantapäivitykset), E2E |
| 3 | Loukkaantuneen tiedot näkyvät vain HSE-henkilötieto-oikeudella ja maskataan muutoslokissa | Erillinen taulu ja oikeus `hse.personal.view`. Oikeus on arkaluonteinen, joten ulkoiset eivät voi saada sitä edes virheellisellä roolimäärityksellä. | `hse.test`, `resolve.test`, E2E (työmaapäällikkö ei näe) |
| 4 | Työlupaa tai riskiarviota ei voi hyväksyä sen laatija, ja hyväksytty riskiarvio on lukittu | Tarkistus sekä palvelussa että triggerissä. Riskiarvion vaarat lukittuvat hyväksynnässä. | `hse.test` |
| 5 | LTIF, ilmoitusaktiivisuus ja MVR-indeksi lasketaan keskitetyillä, testatuilla kaavoilla | `hse/rules.ts` | `rules.test` (10), `hse.test` |
| 6 | Asiakasportaali näyttää etenemän, HSE-koosteen, jaetut dokumentit ja hyväksyttävät muutostyöt, mutta ei mitään sisäistä | Aikataulun eteneminen tahtisuunnitelmasta. HSE vain koostelukuina. Dokumenteista vain jaetut ja hyväksytyt versiot. | `portal.test`, ulkoisten rajojen tietoturvasarja, E2E |
| 7 | Vain nimetty hyväksyjä voi hyväksyä, vain jäädytetyn version ja vain kerran | Jäädytetty versio sidotaan SHA-256-tunnisteeseen, ja päätös tallentuu nimellä, ajalla ja IP:llä. Triggeri estää muutokset. | `portal.test`, E2E |
| 8 | Aliurakoitsija näkee vain omat ilmoituksensa ja työlupansa sekä aliurakoitsijoille jaetut dokumentit | Omat tietueet ilman tutkintatuloksia, henkilökunnan nimiä ja nostosuunnitelmia. | `hse.test`, tietoturvasarja, E2E |
| 9 | Sähköpostilinkki on kertakäyttöinen ja vanhenee 15 minuutissa, pyyntöjä rajoitetaan, käyttäjiä ei voi päätellä vastauksesta, ja linkki toimii vain ulkoisille | Linkistä tallennetaan vain tiivisteet. Linkki käytetään vain vahvistuspainikkeella (POST), eikä istuntoa avata pelkällä avaamisella. Kelpoisuus tarkistetaan uudelleen linkkiä käytettäessä. | `portal.test` (4), E2E |
| 10 | Erillinen tietoturvasarja menee läpi, ja jokaisella uudella palvelumetodilla on eristystesti | Katso kohta 4 | `external-boundary.test`, eristystestit |

### Omistajan päätökset (toteutettu)

| # | Päätös | Toteutus |
|---|---|---|
| 1 | Ulkoiset kirjautuvat sähköpostilinkillä | Sisäiset käyttäjät kirjautuvat edelleen Entra ID:llä. Linkkiä ei lähetetä kenellekään, jolla on yksikin sisäinen rooli. SMTP otetaan käyttöön asetuksella `SMTP_URL`. Kehitysympäristössä posti menee `/dev/mailbox`-postilaatikkoon, joka on estetty tuotannossa. Entra B2B voidaan lisätä myöhemmin. |
| 2 | Asiakas hyväksyy muutostyöt portaalissa | Projektijohtajan sisäinen hyväksyntä julkaisee jäädytetyn version asiakkaalle, ja sen hyväksyy uusi **Asiakkaan hyväksyjä** -projektirooli. Sisäinen käyttäjä ei voi hyväksyä asiakkaan puolesta. Paperilla tai sähköpostilla saatu päätös kirjataan edelleen V6:n tapaan (kanava "kirjattu sisäisesti"). Hyväksyntä ei ole sähköinen allekirjoitus. |
| 3 | HSE-mittarit ja poikkeamien käsittely | Mittarit: LTIF, ilmoitusaktiivisuus, tapaturmat vakavuuksittain, avoimet ja myöhässä olevat toimenpiteet, työmaakokoukset ja MVR/TR-indeksi trendeineen. Käsittelyketju: ilmoittaja → työmaapäällikkö käsittelee → HSE tutkii ja sulkee vakavat → projektipäällikkö hyväksyy korjaavat toimenpiteet → vakavista ilmoitetaan heti. |

### Muut toimitetut ominaisuudet
- **HSE-tietueet:** työmaakokoukset, riskiarviot (todennäköisyys × seuraus ja jäännösriski), työluvat (tulityö, ahtaat tilat, kaivu, sähkö, korkealla työskentely, nostot) ja turvallisuustarkastukset.
- **Linkitys V5:een:** havainnot, tapaturmat, riskiarviot ja työluvat voi linkittää V5:n nostosuunnitelmiin.
- **Dokumenttien jakaminen ulkoisille:** asiakkaalle ja/tai aliurakoitsijoille vain hyväksytyt versiot. Jakamiseen tarvitaan dokumenttien hyväksyntäoikeus, ja se kirjataan muutoslokiin.
- **Navigaatio:** sisäisille uusi kohta "Työturvallisuus". Ulkoisilla on vain "Portaali", ja sisäiset sivut ohjaavat heidät portaaliin.

### V7 rooli × oikeus -matriisi (generoitu koodista `ROLE_TEMPLATES`)

| Oikeus | Toimitusjohtaja | Projektijohtaja | Projektipäällikkö | Työmaapäällikkö | Työnjohtaja | Logistiikkakoordinaattori | HSE-asiantuntija | Työntekijä | Aliurakoitsija | Asiakas | Nostovastaava | Asiakkaan hyväksyjä |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `hse.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |   | ✓ |   |
| `hse.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   | ✓ |   |
| `hse.manage` | ✓ | ✓ | ✓ | ✓ |   |   | ✓ |   |   |   |   |   |
| `hse.investigate` | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |
| `hse.action.approve` | ✓ | ✓ | ✓ |   |   |   |   |   |   |   |   |   |
| `hse.serious.notify` | ✓ | ✓ |   |   |   |   | ✓ |   |   |   |   |   |
| `hse.personal.view` | ✓ |   |   |   |   |   | ✓ |   |   |   |   |   |
| `permit.approve` | ✓ | ✓ |   | ✓ |   |   | ✓ |   |   |   |   |   |
| `portal.client` |   |   |   |   |   |   |   |   |   | ✓ |   | ✓ |
| `portal.subcontractor` |   |   |   |   |   |   |   |   | ✓ |   |   |   |
| `variation.client_approve` |   |   |   |   |   |   |   |   |   |   |   | ✓ |

- **Vain ulkoisille kuuluvat oikeudet** (`portal.*`, `variation.client_approve`) poistetaan oikeuksien laskennassa jokaiselta, jolla ei ole ulkoista yritysroolia. Tämä pätee myös toimitusjohtajaan. Niitä ei voi myöskään lisätä sisäiseen rooliin (`validation.externalOnly`).
- **`hse.personal.view` on arkaluonteinen**, joten ulkoiset eivät voi saada sitä.
- **Migraatio `v7_permissions`** lisää oikeudet mallipohjaisiin rooleihin, luo jokaiseen yritykseen Asiakkaan hyväksyjä -roolin ja kirjoittaa audit-tapahtuman. Mitään ei poisteta.

## 2. Tietokantaskeeman muutokset

Migraatiot: `v7_hse_portals` (13 taulua ja 2 saraketta), `v7_integrity` (triggerit, CHECK-rajoitteet ja osittainen uniikki-indeksi) ja `v7_permissions`.

| Taulu | Eheys |
|---|---|
| `hse_observations` | OPEN → TRIAGED → CLOSED. Suljettu on lopullinen. Ilmoittajaa, numeroa ja projektia ei voi vaihtaa. Ei poistoja. |
| `incidents`, `incident_persons` | REPORTED → TRIAGED → INVESTIGATING → CLOSED. Vakavaa ei voi sulkea ilman tutkintaa ja juurisyytä, eikä mitään tapaturmaa hyväksymättömillä toimenpiteillä. Poissaolopäivät ≥ 0. |
| `hse_actions` | Lähteen pitää olla samassa projektissa ja avoin. OPEN → DONE → VERIFIED. Hyväksytty on lopullinen. |
| `toolbox_talks`, `hse_inspections` | Osallistujia ≥ 0. Tarkastuksessa vähintään yksi kohta. |
| `risk_assessments`, `risk_assessment_items` | Laatija ei voi hyväksyä. Sisältö ja vaarat lukittuvat hyväksynnässä. Asteikot 1–5. |
| `work_permits` | Pyytäjä ei voi päättää omaansa. Lukittuu päätöksessä. Voimassaolon loppu on alun jälkeen. |
| `hse_photos` | Vain lisäys. Tietueen pitää olla samassa yrityksessä ja projektissa. |
| `variation_client_approvals` | Jäädytetty versio ja tunniste ovat muuttumattomia. Päätös tehdään kerran. Yksi odottava per muutostyö. Muutostyön pitää olla samassa projektissa. |
| `email_sign_in_tokens` | Vain tiiviste tallennetaan. Kertakäyttöinen (triggeri). Vanhenee luontiajan jälkeen. |
| `dev_mail_outbox` | Vain kehityskäyttöön (posti estetty tuotannossa) |

Muutokset V1–V6-tauluihin:
- `documents.shared_with_client` ja `documents.shared_with_subcontractors` (oletus false).
- CHECK-rajoite: yritystason dokumenttia ei voi jakaa.

Kaikki uudet viittaukset ovat yhdistelmävierasavaimia (`company_id`, …).

## 3. Testitulokset (todelliset ajot 2026-10-05)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, tyypit, kerrokset, unit + integraatio) | **39 tiedostoa, 2163 testiä läpi** |
| ↳ yksikkötestit | 126 testiä. Uudet: `hse/rules.test` (10): LTIF, ilmoitusaktiivisuus, MVR-indeksi, riskiluku, myöhästyneet ja tilakoneet. `resolve.test` (+4): ulkoiset rajat. `translate.test` (2). |
| ↳ integraatiotestit (oikea PostgreSQL 16) | 2037 testiä, joista uusina: |
| | `external-boundary.test` (373): tietoturvasarja |
| | eristystestit (574): 45 uutta V7-metodia |
| | oikeusmatriisi (987): 18 uutta riviä × 12 roolia ja uusi sarake |
| | `hse.test` (9), `portal.test` (6), `documents.test` (+1) |
| `pnpm depcruise` | Ei kerrosrikkomuksia (303 moduulia, 1628 riippuvuutta) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä → seed (2 yritystä, 58 oikeutta, 384 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **113 läpi, 1 ohitettu.** Ohitettu testi on V2:n palkkavienti, joka ajetaan tarkoituksella vain työpöydällä. Uusi `hse-portal.spec` sisältää 6 skenaariota × 2 näkymäkokoa, ja kuvakaappauksiin tuli V7-näkymät. |
| `pnpm build` | Tuotantobuild onnistuu |
| `pnpm audit --prod` | Ei tunnettuja haavoittuvuuksia |

**Testauksen aikana korjattua:**
1. **Nostosuunnitelmien nimet vuotivat** aliurakoitsijan HSE-näkymään. Löytyi tietoturvasarjasta, ja korjattu.
2. **Haavoittuvat riippuvuudet:** nodemailer 7 → 10 (13 auditointilöydöstä).
3. **Ulkoisten ohjaus portaaliin** muutti V1–V6:n asiakastestejä tietoisesti: sisäiset sivut ohjaavat nyt portaaliin eivätkä palauta 404:ää. E2E-testit päivitetty.
4. **Yksi E2E-ajo kaatui**, koska kehityspalvelin katkesi kesken ajon (ECONNREFUSED). Ajoin sarjan uudelleen, ja se meni kokonaan läpi. Lisäksi korjasin yhden testin ajoitusvirheen (odotus lähetyksen valmistumiseen).

Huom: tässä ympäristössä E2E vaatii `PW_CHROMIUM=/opt/pw-browsers/chromium`. GitHub Actionsin tulosta en ole tarkistanut tässä istunnossa.

## 4. Tietoturva ja yritysten eristys (§41: erillinen tietoturvatestaus)

**Tietoturvasarja `tests/integration/external-boundary.test.ts`**
- **Koeasetelma:** yrityksen sisäisissä tiedoissa on merkkijono "SECRET". Asiakas, Asiakkaan hyväksyjä ja Aliurakoitsija kutsuvat jokaista rekisteröityä palvelua.
- **Mitä se tarkistaa:**
  - yksikään vastaus ei saa sisältää sanaa "SECRET";
  - yksikään vastaus ei saa sisältää kustannus-, hinta-, katetta- tai henkilötietokenttää. Poikkeus on hyväksyjän näkemä myyntihinta, joka on se, mitä asiakas hyväksyy.
  - kirjoitukset hylätään, ellei niitä ole erikseen sallittu;
  - testi kaatuu, jos jotakin palvelua ei ole katettu.
- **Löydös ja korjaus:** aliurakoitsijan HSE-näkymä palautti projektin sisäisten nostosuunnitelmien nimet. Korjattu, ja testi estää paluun.
- **Lisäkiristykset:** dokumentin hyväksyntäyritys ulkoiselta hylätään ennen validointia. Omien tietueiden käsittelijöiden nimiä tai sähköposteja ei näytetä ulkoisille.

**Oikeusmatriisi**
- Uusi sarake: Asiakkaan hyväksyjä.
- 18 uutta toimintoriviä × 12 roolia.
- V7 muutti tietoisesti V1:n rivin "approve document": jakamaton dokumentti ei ole olemassa ulkoisille (404, ei 403).

**Sähköpostilinkki**
- Kertakäyttöinen, 15 minuuttia, vain tiivisteet tallennetaan.
- Käytetään POST-vahvistuksella, joten skannerit eivät kuluta linkkiä.
- Rajoitukset: 5 pyyntöä per osoite (hiljainen) ja 20 per IP.
- Sama vastaus tuntemattomalle, sisäiselle ja suljetulle osoitteelle.
- Kelpoisuus tarkistetaan uudelleen käytössä, ja istunto on 8 tuntia.

**Asiakkaan hyväksyntä**
- Väärä tunniste hylätään, eikä jäädytettyä versiota voi muuttaa kannassa.
- Päätös on lopullinen.
- Sisäinen käyttäjä saa portaalista 404:n.

**Eristys**
- Kaikki 45 uutta palvelumetodia on lisätty eristystesteihin.
- Toisen yrityksen hyväksyjä ei näe tai päätä toisen yrityksen muutostöitä.

**Henkilötiedot**
- Loukkaantuneen tiedot maskataan muutoslokissa.
- Vakavan tapaturman sähköposti ei sisällä nimiä eikä kuvausta.
- Seed käyttää vain kuvitteellista henkilöä.

**Riippuvuusskannaus (`pnpm audit`)**
- Tuotantoriippuvuuksissa ei ole tunnettuja haavoittuvuuksia sen jälkeen, kun nodemailer päivitettiin versioon 10 (versiossa 7 oli 13 löydöstä).
- Kehitysriippuvuuksissa on yksi "high": `braces` eslint-config-nextin kautta. Korjattua versiota ei ole, eikä se päädy ajonaikaiseen koodiin.

**Rivitason tietoturva (RLS) – ei toteutettu.**
- CLAUDE.md:n mukaan RLS oli suunniteltu lisäsuojaksi ennen V7:ää. Se vaatii jokaisen kyselyn ajamisen transaktiossa, jossa on `SET LOCAL app.company_id`, eli muutoksen koko tietokantakerrokseen.
- En tehnyt sitä ilman erillistä päätöstä.
- Nykyinen suoja:
  - yrityskohtaiset repositoriot;
  - yhdistelmävierasavaimet;
  - eristystestit kaikille metodeille;
  - uusi ulkoisten rajojen sarja.
- Ehdotan RLS:ää omaksi kovennustehtäväkseen ennen V8:aa (kohta 8).

## 5. Tunnetut rajoitukset
1. **Ei offline-tilaa.** Ilmoituslomake vaatii yhteyden, mutta lähetyksen voi toistaa.
2. **LTIF-tunnit** ovat vain oman henkilöstön hyväksyttyjä tunteja, koska aliurakoitsijoiden tunteja ei ole järjestelmässä. Luku on siksi yläraja.
3. **Asiakkaan hyväksyntä ei ole sähköinen allekirjoitus.** Allekirjoitetun asiakirjan voi liittää V6:n tapaan.
4. **Ulkoisten ohjaus portaaliin** tehdään yritysnäkymän layoutissa. Selaimen sisäisessä siirtymässä layout ei aja uudelleen, mutta palvelut tarkistavat oikeudet joka tapauksessa (tietoturvasarja).
5. **Rate limit on muistinvarainen** palvelinkohtaisesti, kuten V1:ssä. Ennen useaa instanssia tarvitaan jaettu tallennus.
6. **SMTP-lähetystä ei ole testattu oikeaa palvelinta vastaan.** Testeissä posti menee muistiin ja kehityksessä dev-postilaatikkoon.
7. **Ei RLS:ää** (kohta 4). Entra ID:tä ei ole testattu oikeaa tenanttia vasten (V1-rajoitus).

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev     # http://localhost:3000 → Kehityskirjautuminen
```

Demodata V7:lle (NDC-001):
- **Havainnot:** turvallisuushavainto ja aliurakoitsijan läheltä piti -ilmoitus korjaavine toimenpiteineen.
- **Tapaturmat:** suljettu ensiapu-tapaturma ja tutkinnassa oleva poissaoloon johtanut tapaturma. Sen kuvitteellinen henkilö näkyy vain HSE:lle, ja korjaava toimenpide odottaa projektipäällikön hyväksyntää.
- **Muut HSE-tietueet:** kaksi työmaakokousta, kolme MVR-mittausta (88 → 94 %), hyväksytty riskiarvio muuntajanostolle ja aliurakoitsijan työluvat (hyväksytty ja odottava).
- **Jaettu dokumentti:** 110 kV -pääkaavio, josta ulkoiset näkevät vain hyväksytyn revision A.
- **Portaalissa odottava muutostyö:** "UPS-tilan lisäpistorasiat".

Kokeile demotunnuksilla:
- `employee@skinfra.example.com` puhelimella: "Työturvallisuus" → "Turvallisuushavainto" kuvan kanssa.
- `hse@skinfra.example.com`: kiireelliset, tunnusluvut, tapaturman henkilötiedot.
- `client@example.com`: portaali → hyväksy muutostyö.
- `subcontractor@example.com`: portaali → tapaturma tai työlupa.
- Sähköpostilinkki: kirjautumissivulla "Asiakkaat ja aliurakoitsijat" → `subcontractor@example.com`, minkä jälkeen linkki löytyy osoitteesta `/dev/mailbox`.

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`. Uudet V7-näkymät:
- `hse.png`: kiireelliset tapaturmat, pikapainikkeet, tunnusluvut ja rekisterit
- `hse-incident.png`: tapaturman käsittelyketju, henkilötiedot (HSE) ja korjaavat toimenpiteet
- `hse-report.png`: mobiili-ilmoituslomake kuvalla
- `portal-client.png`: asiakkaan portaali (hyväksyttävät, aikataulu, HSE-kooste, dokumentit)
- `portal-approval.png`: jäädytetty muutostyö, hinta, SHA-256 ja päätös
- `portal-subcontractor.png`: aliurakoitsijan pikailmoitukset, omat ilmoitukset ja jaetut dokumentit

## 8. Ehdotettu V8-suunnitelma (AI & Optimization, §42)

**Odottaa hyväksyntää. Ei aloitettu.** §42 luettelee: AI Project Controller, AI Logistics Controller, resurssien optimointiehdotukset ja muut tekoälytoiminnot. V1:stä asti on olemassa vain rajapinnat (`platform/ai`), ei toteutuksia.
1. **Rivitason tietoturva (RLS)** kovennuksena ennen tekoälyä, koska tekoäly lukee laajasti dataa. Ehdotan tämän V8:n ensimmäiseksi vaiheeksi.
2. **AI Project Controller:** poikkeamien ja riskien tunnistus (tahtiviiveet, EAC-poikkeama, HSE-trendit) ehdotuksina, joita ihminen hyväksyy. Tekoäly ei koskaan hyväksy, allekirjoita eikä muuta tietoja itse (§19).
3. **AI Logistics Controller:** toimitus- ja nostoikkunoiden ehdotukset konfliktien ja tahtisuunnitelman perusteella.
4. **Resurssioptimointi:** miehistö- ja kalustoehdotukset look-aheadin vajeisiin, myös konsernin sisäisinä varauksina.
5. **Tietosuoja ja kustannukset:** mitä dataa mallille lähetetään (ei henkilötietoja eikä hintoja ilman oikeutta), lokitus ja kustannusraja.

Avoimet päätökset omistajalle ennen V8:aa:
1. Toteutetaanko RLS ensin V8:n osana vai erillisenä kovennuksena?
2. Mikä tekoälypalvelu ja malli (esim. Claude API), ja saako projektidataa lähettää sille? Missä datan tulee sijaita (EU)?
3. Mitkä tekoälyehdotukset ovat tärkeimmät ensin: projektin ohjaus, logistiikka vai resurssit?
