# SK Management — V3 Takt & Look-ahead: pysäytysraportti

- Päivämäärä: 2026-10-05
- Haara: `claude/dazzling-edison-zzskak`
- Tila: **V3 valmis. V4:ää ei ole aloitettu**, koska se odottaa omistajan hyväksyntää.

Taustamateriaali:
- Suunnitelma ja omistajan päätökset: [V3_PLAN.md](V3_PLAN.md)
- Versiointi, baseline ja valmiustila: [ADR 0012](adr/0012-takt-plan-versioning.md)
- Aikataulujen tuonti: [ADR 0013](adr/0013-schedule-import.md)

## 1. Toteutettu, §37 hyväksymiskriteerien mukaan

| # | Kriteeri (§37) | Toteutus | Todennettu |
|---|---|---|---|
| 1 | Baselinea ei voi ylikirjoittaa huomaamatta | Hyväksytty versio (BASELINE) ja korvattu versio (SUPERSEDED) ovat jäädytettyjä. Lukituksen varmistavat DB-triggerit `takt_plan_versions_guard` ja `takt_assignments_guard`. Ainoa sallittu muutos on BASELINE → SUPERSEDED. Hyväksynnän tekee projektipäällikkö omissa projekteissaan sekä projektijohtaja ja toimitusjohtaja kaikissa projekteissa. Jokainen siirtymä kirjautuu muutoslokiin. | Integraatio `takt.test`: suora SQL-päivitys baselineen kaatuu, ja vanhan baselinen ajoitukset säilyvät. E2E: suunnitelma → ehdotus → hyväksyntä. |
| 2 | Aikataulumuutokset versioidaan | Muutos tehdään luonnokseen, joka kopioidaan baselinesta ja jolle annetaan syy. Luonnos voidaan ehdottaa, palauttaa ja hyväksyä. Hyväksytty versio korvaa edellisen baselinen, joka säilyy. Versioita voi verrata keskenään: siirtyneet, lisätyt ja poistetut tehtävät näkyvät työpäivinä, samoin valmistumisen muutos. Tuonti kohdistuu aina luonnokseen. | Integraatio: v1 → v2 → vertailu (3 siirtynyttä, valmistuminen +2) → v2 baselineksi. E2E: tuonti → vertailu "0 siirtynyt, 4 lisätty". |
| 3 | Estynyt- ja valmiustilat toimivat | Tilat NOT_READY, READY, IN_PROGRESS, BLOCKED ja COMPLETE päätellään seuraavista: edeltäjät (FS: valmis, SS: aloitettu), avoimet rajoitteet (suunnitelmat, materiaali, työvoima, kalusto, lupa, alue, muu), manuaalinen esto sekä se, onko suunniteltu aloitus jo ohitettu. Estolle kirjataan viivästyksen syy ja korjaava toimenpide. Riippuvuuskehät estetään. | Unit `engine.test` (kaikki tilat). Integraatio: rajoite → BLOCKED → kuittaus → READY → 40 % → IN_PROGRESS → 100 % → COMPLETE, jolloin seuraaja muuttuu tilaan READY. E2E: yhden napautuksen edistymiskirjaus. |
| 4 | Look-ahead tuottaa resurssitarpeet | Baselinen hyväksyntä generoi muuttumattomat `resource_requirements`-rivit (ammatti × miehitys, kalustotyyppi × määrä, päivämääräväli). Look-ahead (2, 6 tai 12 viikkoa) näyttää viikoittain huippukysynnän ja henkilö- tai yksikköpäivät. Kysyntää verrataan yrityksen omaan kapasiteettiin, ja vajeet korostetaan. Nostot erotellaan, ja suodattimena on projekti. | Integraatio: 7 hengen tarve, 3 hengen kapasiteetti → vaje 4; nosturitarve ja kapasiteetti 0 → 1. E2E: look-ahead-näkymä. |

### Omistajan päätökset (toteutettu)
1. **Tahti on yksi työpäivä.** Tahdin pituus tallennetaan suunnitelmakohtaisesti. Työkalenterissa on ma–pe ja Suomen pyhäpäivät, myös pääsiäisestä lasketut liikkuvat pyhät sekä juhannus- ja jouluaatto. Kalenteria muokataan kohdassa Asetukset → Työkalenteri.
2. **Projektipäällikkö hyväksyy baselinen** omissa projekteissaan. Projektijohtaja ja toimitusjohtaja voivat hyväksyä kaikissa projekteissa.
3. **MS Project- ja P6-tuonti on mukana.**
   - Tuetut tiedostot: MS Project XML (.xml) ja Primavera P6 XER (.xer).
   - Tuonnissa on kaksi vaihetta: esikatselu (kohdistus, yhdistykset ja kohdistamattomat tehtävät) ja vahvistus, joka tuo tehtävät luonnosversioon.
   - Alkuperäinen tiedosto tallennetaan SHA-256-tiivisteen kanssa, ja sen voi ladata myöhemmin.
   - Puuttuvat takt-alueet ja työpaketit luodaan, ja riippuvuudet viiveineen tuodaan.

### Muut toimitetut ominaisuudet
- **Tahtirakenne** (projekti → Tahti): rakennukset ja ulkoalueet, takt-alueet sekä työpaketit. Työpaketille määritellään ammatti, väri, miehitys, kesto ja kalusto.
- **Tahtijunan generointi:** jokainen työpaketti kulkee jokaisen alueen läpi. Tahtiaika on pisin kesto, ja vaunujen väliin voi lisätä puskurin. Samalla luodaan FS-riippuvuudet.
- **Työpaketin siirto** ± tahtia. Yksittäisen tehtävän ajoitusta voi muokata luonnoksessa.
- **Tahtitaulu**
  - Rivit ovat takt-alueita ja sarakkeet työpäiviä. Siru on värjätty työpaketin mukaan, ja reunus kertoo tilan. Tämä päivä korostetaan.
  - Työpöydällä taulu näkyy ensin. Mobiilissa ensin näkyy "Tämä viikko" -lista, jossa on 25/50/75/100 % -pikapainikkeet ja isot kosketusalueet.
- **Tehtäväsivu:** suunniteltu aika (baseline ja luonnos), toteuma, edistymishistoria, rajoitteet, riippuvuudet, esto, tiedot ja ajoitus.
- **Linkitys V2:n työmaapäiväkirjaan:** päiväkirja näyttää työmaan päivän tahtiedistymisen.
- **Navigaatio:** uusi kohta "Tahti". Projektisivulla on Tahti-painike.

### V3 rooli × oikeus -matriisi (generoitu koodista `ROLE_TEMPLATES`)

Ulkoiset roolit (SUB, CLI) eivät saa tahtioikeuksia. Työkalenterin muokkaus vaatii olemassa olevan oikeuden `company.manage`, joka on vain toimitusjohtajalla.

| Oikeus | CEO | PD | PM | SM | SUP | LOG | HSE | EMP | SUB | CLI |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `takt.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `takt.manage` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `takt.progress.update` | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `takt.baseline.approve` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |

Migraatio `v3_permissions` lisää oikeudet olemassa olevien yritysten mallipohjaisiin rooleihin. Migraatio vain lisää oikeuksia eikä poista mitään. Jokaiselle yritykselle kirjoitetaan audit-tapahtuma `role.permissions_migration`.

## 2. Tietokantaskeeman muutokset

V3 lisää vain uusia tauluja. V1–V2-tauluihin ei tehty rikkovia muutoksia. Migraatiot:
- `v3_takt`: taulut;
- `v3_integrity`: triggerit, check-rajoitteet ja osittaiset uniikki-indeksit;
- `v3_permissions`: oikeudet.

| Taulu | Sisältö |
|---|---|
| `work_calendars`, `calendar_holidays` | Yrityksen työkalenteri: työpäivät (ISO-viikonpäivät) ja pyhäpäivät. Yhdellä yrityksellä on yksi oletuskalenteri. |
| `buildings` | Työmaan rakennus tai ulkoalue |
| `takt_areas` | Takt-alue rakennuksessa (tunnus on uniikki rakennuksessa) |
| `work_packages` | Projektin työpaketti eli tahtijunan vaunu: ammatti, väri, miehitys, kesto, kalusto |
| `takt_plans` | Työmaan tahtisuunnitelma: kalenteri ja tahdin pituus |
| `takt_plan_versions` | Versio: tila, aloituspäivä, syy, ehdottaja, hyväksyjä, palautuksen syy |
| `takt_assignments` | Tehtävän sijainti versiossa (aloitustahti, kesto tahteina) |
| `takt_activities` | Työpaketti × takt-alue: miehitys ja kalustotarve, toteuma, edistyminen, esto, viivästyksen syy, korjaava toimenpide |
| `activity_dependencies` | Riippuvuudet FS, SS, FF ja SF sekä viive |
| `activity_constraints` | Rajoitteet: tyyppi, kuvaus, määräpäivä, avoin tai kuitattu |
| `activity_progress` | Edistymishistoria (append-only) |
| `resource_requirements` | Baselinen resurssitarpeet (muuttumattomat), pohja V4–V5:n varauksille |
| `schedule_imports` | Aikataulutuonnit: tiedosto, SHA-256, esikatselu, tila, tulosversio |

Eheys on varmistettu tietokantatasolla:
- **Komposiittivierasavaimet kaikkialla.** Esimerkiksi tehtävä → takt-alue (sama yritys ja työmaa) ja tehtävä → suunnitelma (sama yritys, projekti ja työmaa).
- **Triggerit:** baselinen lukitus, luonnoksen ajoitukset, muuttumattomat resurssitarpeet, append-only-edistyminen ja tehtävien poistoesto.
- **Osittaiset uniikki-indeksit:** yksi baseline ja yksi avoin versio suunnitelmaa kohti.

## 3. Testitulokset (todelliset ajot 2026-10-05)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, tyypit, kerrokset, unit + integraatio) | **27 tiedostoa, 780 testiä läpi** |
| ↳ yksikkötestit | 15 tiedostoa, 81 testiä. Uudet: `calendar.test`, `engine.test`, `import.test`. |
| ↳ integraatiotestit (oikea PostgreSQL 16) | 699 testiä. Mukana eristystestisarja (282: 45 uutta V3-metodia, kullekin eristystapaus ja rekisteritarkistus), oikeusmatriisi (353, joista 70 uutta riviä) ja `takt.test` (12). |
| `pnpm depcruise` | Ei kerrosrikkomuksia (211 moduulia, 952 riippuvuutta) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä → seed (2 yritystä, 31 oikeutta, 244 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **55 läpi, 1 ohitettu.** Ohitettu testi on V2:n palkkavienti, joka ajetaan tarkoituksella vain työpöydällä. Uusi `takt.spec` sisältää 5 skenaariota × 2 näkymäkokoa. |
| `pnpm build` | Tuotantobuild onnistuu |

**E2E-testi löysi ja korjasi virheen:**
- *Ongelma:* lomakekenttien id:t olivat muotoa `f-<nimi>`, joten samalla sivulla olevilla lomakkeilla oli päällekkäisiä id:itä. Silloin kentän label saattoi osoittaa toisen lomakkeen kenttään. Tämä on saavutettavuusvirhe, ja se koski myös V1–V2-sivuja.
- *Korjaus:* id:t ovat nyt yksilöllisiä (`React.useId`), ja V2:n tuntipikanapit etsivät kentän omasta lomakkeestaan.
- *Varmistus:* koko E2E-sarja ajettiin korjauksen jälkeen uudelleen.

Huom: tässä ympäristössä E2E vaatii `PW_CHROMIUM=/opt/pw-browsers/chromium`. GitHub Actionsin tulosta en ole tarkistanut tässä istunnossa.

## 4. Tietoturva ja yritysten eristys

- **Eristys**
  - Kaikki 45 V3-palvelumetodia kulkevat `RequestContext`in ja yrityskohtaisen repositorion kautta.
  - Toisen yrityksen id polussa tai syötteessä johtaa 404:ään tai hylkäykseen. Esimerkkejä: B:n suunnitelmaan A:n tehtävä, B:n tuontiin A:n rakennus, B:n riippuvuuteen A:n tehtävä.
  - Metatesti kaatuu, jos jokin metodi jää ilman tapausta.
- **Näkyvyys:** tahtinäkyvyys on projektikohtainen. Jos käyttäjällä ei ole pääsyä projektiin tai oikeutta `takt.view`, tuloksena on 404. Jos oikeus puuttuu, tuloksena on 403. Look-ahead laskee kysynnän vain projekteista, jotka käyttäjä näkee.
- **Tuonti**
  - XML-entiteettejä ei käsitellä, joten entiteettilaajennus ja ulkoiset resurssit on estetty (testattu).
  - Tiedostotyyppi tunnistetaan sisällöstä tai päätteestä.
  - Kokoraja ja latausten rate limit ovat samat kuin dokumenteilla.
  - Alkuperäinen tiedosto ladataan aina liitteenä, `nosniff`-otsakkeella ja ilman välimuistia.
- **Muutosloki:** kaikki rakenne-, versio-, edistymis-, rajoite-, riippuvuus-, tuonti- ja kalenterimuutokset kirjataan samassa transaktiossa.

## 5. Tunnetut rajoitukset

1. **Tahtitaulussa ei ole vedä ja pudota -siirtoa.** Muokkaus tehdään lomakkeilla: tahdin numero ja kesto, työpaketin siirto ± tahtia sekä tahtijunan generointi.
2. **Osa rajoitteista kuitataan käsin.**
   - Työvoima- ja kalustorajoitteita ei kuitata automaattisesti look-aheadin perusteella.
   - Suunnitelmarajoite ei ole linkitetty dokumentin hyväksyntään.
   - Automaattiset tarkistukset sopivat V4:ään varausten kanssa.
3. **Look-aheadin kapasiteetti on yksinkertaistettu.**
   - Kapasiteetti lasketaan yrityksen aktiivisista henkilöistä ammattinimikkeen mukaan (vertailu tekstinä) ja kalustosta tyypin mukaan.
   - Poissaoloja, varauksia tai muiden projektien sitoumuksia ei huomioida, koska ne kuuluvat V4–V5:een.
   - Materiaaleja, toimitusikkunoita ja logistiikkaresursseja ei vielä lasketa (V4).
4. **Nosto tunnistetaan kalustotyypin luokasta** (nosturi tai nostoapuväline). Nostosuunnitelmat kuuluvat V5:een.
5. **Tuonnin rajoitukset**
   - MS Projectin `.mpp`-tiedostoa ei tueta (vie se XML:ksi).
   - Tiedoston kalenterit ja resurssit ohitetaan, ja käytössä on suunnitelman työkalenteri.
   - XER-tiedostosta luetaan vain ensimmäinen projekti.
   - Viiveet pyöristetään päiviksi (8 h päivä).
   - Saman alueen ja työpaketin tehtävät yhdistetään yhdeksi tahtitehtäväksi.
6. **Yksi tehtävä työpaketti × alue -paria kohti suunnitelmassa.** Rajoitus pitää tahtiruudukon selkeänä.
7. **Myöhästyminen arvioidaan baselinea vasten.** Edistymistä ei voi kirjata tulevalle päivälle, ja korjaus tehdään uutena kirjauksena (append-only).
8. **Päiväkirjan tahtiedistyminen näytetään sellaisenaan.** Sitä ei jäädytetä allekirjoitetun päiväkirjan tilannekuvaan.
9. **V1–V2:n rajoitukset ovat edelleen voimassa:**
   - rate limit on muistinvarainen;
   - RLS ei ole käytössä (ADR 0005);
   - Entra ID:tä ei ole testattu oikeaa tenanttia vasten;
   - orpoja tallennusobjekteja ei siivota.

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev     # http://localhost:3000 → Kehityskirjautuminen
```

Demodata V3:lle:
- Data Hall A:lla on suunnitelma "Data Hall A – sähkötahti": 6 aluetta ja 5 työpakettia.
- Versio 1 on baseline, jossa on edistyminen, rajoitteet ja yksi estynyt tehtävä.
- Versio 2 on luonnos, jossa kaapelinvetoa on siirretty kaksi päivää.

Kokeile demotunnuksilla:
- `pm@skinfra.example.com`: taulu, vertailu, look-ahead ja tuonti. Tuontiin sopivat näytetiedostot `tests/fixtures/schedules/data-hall-b.xml` ja `.xer`.
- `supervisor@skinfra.example.com`: edistymisen kirjaus puhelimella.

Tarkemmin: [README](../README.md).

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`. Uudet V3-näkymät:
- `takt-plans.png`: tahtisuunnitelmat
- `takt-board.png`: tahtitaulu, versiot ja luonnostyökalut sekä "Tämä viikko" -lista pikapainikkeineen
- `takt-activity.png`: estynyt tehtävä: syy, korjaava toimenpide, rajoitteet, riippuvuudet ja ajoitus
- `takt-compare.png`: luonnos vs. baseline: siirtyneet tehtävät ja valmistumisen muutos
- `takt-lookahead.png`: 6 viikon resurssitarve ja vajeet
- `takt-import-preview.png`: MS Project -tuonnin esikatselu
- `settings-calendar.png`: työkalenteri ja pyhäpäivät

## 8. Ehdotettu V4-suunnitelma (Logistics, §38)

**Odottaa hyväksyntää. Ei aloitettu.**

1. **Resurssipoolit ja varaukset**
   - Taulu `resource_bookings`: resurssi (henkilö, porukka tai kalusto), omistajayritys, varaava yritys, projekti, työmaa, takt-tehtävä tai resurssitarve, aika, tila, pyytäjä ja hyväksyjä.
   - Yritysten välinen käyttö on varaus. Omistajuus ei muutu (omistajan vaatimus 4).
2. **Konfliktien tunnistus**
   - Tunnistettavat tilanteet: päällekkäiset varaukset, resurssi ei käytettävissä, pätevyys ei vastaa tarvetta, tarkastus tai huolto osuu varaukselle, työaikasäännöt.
   - Konfliktit näytetään, mutta niitä ei ratkaista automaattisesti.
3. **Logistiikkapyynnöt**
   - Kentät §11 mukaan.
   - Tilat: DRAFT → REQUESTED → REVIEW → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETE / CANCELLED.
   - Jokainen pyyntö linkitetään takt-alueeseen ja tehtävään.
4. **Toimitukset ja toimitusikkunat**
   - Portit, purkupaikat ja varastopaikat.
   - Toimituksen elinkaari PLANNED → … → INSTALLED (§12).
   - Logistiikkataulu sekä mobiilin portti- ja purkunäkymä.
5. **Look-ahead täydentyy:** varatut resurssit ja vapaa kapasiteetti, toimitusikkunat sekä materiaalivalmius rajoitteeksi.
6. **Uudet oikeudet:** `logistics.request`, `logistics.approve`, `booking.manage` ja `delivery.manage`. Ne lisätään migraatiolla, ja matriisi esitetään ennen käyttöönottoa.

Avoimet päätökset omistajalle ennen V4:ää:
1. Kuka hyväksyy logistiikkapyynnöt: logistiikkakoordinaattori, työmaapäällikkö vai molemmat?
2. Sallitaanko yritysten väliset varaukset jo V4:ssä (esim. Purentin kalusto SK Infran työmaalle) vai vasta myöhemmin?
3. Tarvitaanko toimitusikkunoille kiinteä pituus (esim. 30 tai 60 min)?
