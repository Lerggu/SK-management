# SK Management — V1 Foundation: pysäytysraportti

Päivämäärä: 2026-10-04 · Haara: `claude/dazzling-edison-zzskak` · Tila: **V1 valmis, V2:ta ei ole aloitettu** (odottaa omistajan hyväksyntää).

## 1. Toteutettu, §35 hyväksymiskriteerien mukaan

| # | Kriteeri (§35) | Toteutus | Todennettu testeillä |
|---|---|---|---|
| 1 | Käyttäjä voi kirjautua | Auth.js v5 + Microsoft Entra ID -provider (aktivoituu ympäristömuuttujilla), tietokantaistunnot, vain kutsutut käyttäjät. Kehityskirjautuminen, joka on kovakoodatusti pois päältä kun `NODE_ENV=production`. Kirjautumisten rajoitus (rate limit). | E2E `auth.spec` (työpöytä + mobiili), unit `env.test` (tuotantoesto), integraatio kutsu → kirjautuminen → jäsenyys aktiivinen |
| 2 | Valtuutettu käyttäjä voi luoda/valita yrityksen | Yritysvalinta `/c`, yrityksen luonti konsernin OWNER/ADMIN-käyttäjälle (luo 10 roolia malleista, luoja = CEO), yrityksen vaihto valikosta (työpöytä) ja Lisää-paneelista (mobiili) | E2E `company.spec`, integraatio `companies.test` |
| 3 | Yritysten eristys palvelinpuolella | Yritys URL:ssa ja jäsenyys tarkistetaan jokaisessa pyynnössä. Repositoriot lisäävät `company_id`:n jokaiseen kyselyyn. Komposiittivierasavaimet. Toisen yrityksen tieto → 404. | Eristystestisarja: 61 palvelumetodia, jokaisella oma tapaus + metatesti. E2E: Purent-käyttäjä → SK Infran URL → 404. |
| 4 | Projektin ja työmaan luonti | Projektit (numero, asiakas tekstinä, tila, päivät), työmaat (osoite, koordinaatit), projektin henkilöt projektiroolilla, arkistointi | Integraatio `projects.test`, E2E `projects.spec` |
| 5 | Henkilöstön CRUD oikeuksin | Henkilöt + hinnat erillisessä taulussa erillisillä oikeuksilla, voimassaolojaksot (edellinen jakso päättyy automaattisesti, päällekkäisyys estetään) | Integraatio `workforce.test`, matriisi, E2E `workforce.spec` |
| 6 | Kaluston CRUD oikeuksin | Kalustotyypit, kalusto (omistajayritys, projekti/työmaa, käyttötunnit, seuraava tarkastus), hinnat erillisin oikeuksin | Integraatio `equipment.test`, matriisi, E2E `equipment.spec` |
| 7 | Dokumentit: metatiedot ja versiot | Dokumentti (yritys- tai projekti/työmaatason), versiot joita ei koskaan ylikirjoiteta (CURRENT/SUPERSEDED, SHA-256), hyväksyntä (luonnos → odottaa → hyväksytty/hylätty, hyväksytty on lopullinen), linkit henkilöihin, kalustoon, projekteihin ja työmaihin, S3/MinIO-tallennus, valtuutettu lataus | Integraatio `documents.test` + DB-triggeritestit, E2E `documents.spec` (kaksi versiota) |
| 8 | Audit-tapahtumat kriittisistä muutoksista | Append-only `audit_events` (DB-triggeri estää UPDATE/DELETE/TRUNCATE), kirjoitetaan samassa transaktiossa, arkaluonteiset kentät peitetty, muutosloki-näkymä | Integraatio (jokaisen moduulin audit-tarkistukset), DB-testi append-only, unit `mask.test` |
| 9 | Responsiivinen navigointi mobiilissa/työpöydällä | Työpöydällä sivupalkki. Mobiilissa alapalkki (4 kohdetta + Lisää-paneeli, jossa yritys, kieli ja uloskirjautuminen). Kosketuskohteet ≥ 44 px. Natiivit valintalistat, numeronäppäimistö ja desimaalipilkku. | E2E ajetaan kahdella näkymäkoolla (1366×900 ja Pixel 7), 44 px -tarkistus |
| 10 | Automaattitestit eristyksestä ja oikeuksista | Eristystestisarja + taulukko roolit × toiminnot (190 riviä) + "asiakas ei näe hintoja" | ks. kohta 3 |
| 11 | Seed/demodata | Kuvitteellinen data: SK Group Demo → SK Infra Demo ja Purent Demo, Nordic Data Center Demo, työmaat, henkilöt, kalusto, hinnat, dokumentit. Luodaan palveluiden kautta, joten myös auditoidaan. | `pnpm test:migrations` ajaa seedin tyhjään kantaan |
| 12 | README: asennus, migraatiot, testaus | `README.md` + ADR:t `docs/adr/0001–0009` | — |

Lisäksi omistajan vaatimukset:
- **Suomi oletuskielenä, englanti saatavilla** (next-intl). Ei kovakoodattuja UI-tekstejä. Testi varmistaa, että kaikki validointi-, oikeus- ja audit-avaimet on käännetty molemmille kielille.
- **Monen yrityksen arkkitehtuuri** heti alusta. **Resurssilla on aina omistajayritys.** Yritysten välinen käyttö mallinnetaan myöhemmin varauksena (ADR 0008).
- **Takt- ja logistiikkavalmius:** `sites`-taululla on `UNIQUE(company_id, project_id, id)`, joten hierarkian tasot Building → Takt Area → Work Package → Activity lisätään rikkomatta mitään. Henkilöt ja kalusto ovat varattavia resursseja: pysyvä id, omistaja, tila, arkistointi.
- **AI ja integraatiot:** vain rajapinnat (`src/platform/ai`, `src/platform/integrations`), ei toteutuksia eikä keksittyjä integraatioita.

### Ehdotettu rooli × oikeus -matriisi (V1)

🔒 = arkaluonteinen (kustannus/hinta). Asiakas (CLI) ja aliurakoitsija (SUB) eivät voi koskaan saada 🔒-oikeuksia. Tämä on estetty kolmella tasolla: palvelu hylkää muutoksen, resolveri poistaa oikeudet vaikka kanta olisi väärin konfiguroitu, eikä ulkoinen käyttäjä näe yrityksen sisäisiä dokumentteja.

| Oikeus | CEO | PD | PM | SM | SUP | LOG | HSE | EMP | SUB | CLI |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| *Projektinäkyvyys* | KAIKKI | KAIKKI | osoitetut | osoitetut | osoitetut | osoitetut | osoitetut | osoitetut | osoitetut | osoitetut |
| `company.manage` | ✓ |  |  |  |  |  |  |  |  |  |
| `company.members.manage` | ✓ |  |  |  |  |  |  |  |  |  |
| `company.roles.manage` | ✓ |  |  |  |  |  |  |  |  |  |
| `audit.view` | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `project.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `project.members.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `employee.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `employee.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `employee.rates.view` 🔒 | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `employee.rates.manage` 🔒 | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `equipment.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `equipment.manage` | ✓ | ✓ |  | ✓ |  | ✓ |  |  |  |  |
| `equipment.rates.view` 🔒 | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `equipment.rates.manage` 🔒 | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `documents.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `documents.manage` | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |  |  |
| `documents.approve` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |

Tehokkaat oikeudet = yritysroolien unioni ∪ projektirooli (projektikohtaisissa toiminnoissa). Projektirooli ei voi antaa yritystason oikeuksia (henkilöstö, kalusto, hallinta). Matriisi on muokattavissa yrityskohtaisesti (Asetukset → Roolit ja oikeudet), ja muutokset auditoidaan.

## 2. Tietokantaskeeman yhteenveto

PostgreSQL 16, Prisma 6. Migraatiot: `v1_foundation` (taulut), `v1_integrity` (triggerit, check-rajoitteet, osittainen uniikki-indeksi), `v1_permissions` (oikeusluettelo).

| Alue | Taulut |
|---|---|
| Identiteetti | `organizations`, `companies`, `users`, `user_identities`, `accounts`, `sessions`, `organization_memberships`, `company_memberships`, `membership_roles`, `roles` (yrityskohtaiset, `project_access` = ALL/ASSIGNED), `permissions`, `role_permissions`, `project_memberships` |
| Projektit | `projects` (asiakas tekstinä V6:een asti), `sites` |
| Henkilöstö | `employees`, `employee_rates` (COST/BILLING, HOUR/DAY, voimassaolojakso) |
| Kalusto | `equipment_types`, `equipment` (omistaja, nykyinen projekti/työmaa, käyttötunnit, seuraava tarkastus), `equipment_rates` |
| Dokumentit | `documents`, `document_versions` (muuttumaton sisältö, CURRENT/SUPERSEDED, SHA-256, hyväksyntätila), `document_links` (polymorfinen) |
| Järjestelmä | `audit_events` (append-only) |

Konventiot: UUIDv7-avaimet, `timestamptz` UTC:nä (näytetään Helsingin aikaa), `created_at/by` ja `updated_at/by`, arkistointi `archived_at`:lla, raha `numeric(14,2)` + valuutta (EUR). Komposiittivierasavaimet estävät yritysten väliset viittaukset tietokantatasolla, esim. `sites(company_id, project_id) → projects(company_id, id)` ja `equipment(company_id, current_project_id, current_site_id) → sites(company_id, project_id, id)`. Lisärajoitteet on lueteltu: [ADR 0004](adr/0004-database-integrity.md).

## 3. Testitulokset (todelliset ajot 2026-10-04)

| Ajo | Tulos |
|---|---|
| `pnpm test:unit` (Vitest) | **9 tiedostoa, 42 testiä — kaikki läpi** |
| `pnpm test:integration` (Vitest, oikea PostgreSQL 16) | **8 tiedostoa, 354 testiä — kaikki läpi** (sis. eristystestisarja 126 testiä ja oikeusmatriisi 193 testiä) |
| `pnpm test:migrations` | Läpi: tyhjä kanta → migraatiot → ei driftiä (2 tarkistusta) → seed (2 yritystä, 18 oikeutta, 106 audit-tapahtumaa) |
| `pnpm test:e2e` (Playwright, työpöytä + mobiili) | **30 testiä — kaikki läpi** (4 kirjautumisen alustusta + 13 skenaariota × 2 näkymäkokoa) |
| `pnpm lint`, `pnpm typecheck` | Ei virheitä |
| `pnpm depcruise` | Ei kerrosrikkomuksia (156 moduulia, 586 riippuvuutta) |
| `pnpm build` | Tuotantobuild onnistuu |
| `pnpm audit --prod --audit-level high` | Ei tunnettuja haavoittuvuuksia |

Negatiiviset tarkistukset tehtiin myös: eristyksen metatesti kaatuu, kun yksi tapaus poistetaan, ja dependency-cruiser havaitsee tarkoituksella lisätyt kerrosrikkomukset.

Huom: GitHub Actions -työnkulku (`.github/workflows/ci.yml`) on kirjoitettu, mutta sitä ei ole vielä ajettu GitHubissa. Yllä olevat tulokset ovat paikallisista ajoista samoilla komennoilla.

## 4. Tietoturva ja yritysten eristys

- **Eristys:** URL-yritys tarkistetaan jäsenyyttä vasten jokaisessa pyynnössä (sivut, server actionit, API, lataukset). `company_id` lisätään kaikkiin kyselyihin. Komposiittivierasavaimet. Yritysten välinen pääsy → 404. Testattu kaikille 61 palvelumetodille ja lisäksi E2E-tasolla.
- **Valtuutus:** toimintokohtaiset oikeudet palvelukerroksessa (ei pelkkä UI). Näkymätön kohde → 404, puuttuva oikeus → 403. Hinnat poistetaan vastauksista ilman oikeutta (avain puuttuu kokonaan).
- **Tunnistautuminen:** tietokantaistunnot (httpOnly, SameSite=Lax, Secure HTTPS:llä), vain kutsutut käyttäjät, kehityskirjautuminen estetty tuotannossa.
- **Audit:** append-only DB-triggerillä, samassa transaktiossa, arkaluonteiset arvot peitetty.
- **Syöte ja tiedostot:** Zod-validointi palveluissa, Prisma (ei SQL-injektiota), Reactin escaping (XSS). Tiedostojen sallittujen päätteiden lista (HTML/SVG/JS estetty), kokoraja, SHA-256. Lataukset aina liitteenä ja `nosniff`.
- **CSRF:** server actionien Origin-tarkistus (Next.js). API:n kirjoitukset vaativat JSON-sisällön ja saman originin.
- **Otsakkeet:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. `X-Powered-By` poistettu.
- **Kerrokset:** `app/` ei voi käyttää Prismaa suoraan, domain-moduulit eivät voi käyttää toimittajien SDK:ita (pakotettu CI:ssä).
- **Riippuvuudet:** tuotantoriippuvuuksien auditointi CI:ssä.

## 5. Tunnetut rajoitukset

1. **Rate limit ja istuntojen hallinta** ovat muistinvaraisia (yksi palvelininstanssi). Vaihdetaan Redis/Postgres-säilöön ennen skaalausta.
2. **Postgresin row-level security** ei ole käytössä V1:ssä ([ADR 0005](adr/0005-row-level-security-deferred.md)). Suunniteltu ennen V7:n portaaleja.
3. **Entra ID -kirjautumista ei ole testattu oikeaa tenanttia vasten**, koska tunnuksia ei ole. Koodi ja konfiguraatio ovat valmiina, ja E2E käyttää kehityskirjautumista.
4. **Kutsusähköpostia ei lähetetä:** kutsu luo käyttäjän ja jäsenyyden, ja käyttäjä kirjautuu Microsoft-tilillään. Sähköposti/Teams-ilmoitukset tulevat myöhemmin adapterien kautta.
5. Jos tietokantatransaktio epäonnistuu tiedoston tallennuksen jälkeen, objekti jää orvoksi tallennukseen (siihen ei viitata). Siivousajo tulee myöhemmin.
6. Asiakas/aliurakoitsija näkee **kaikki** osoitetun projektin dokumentit. Dokumenttikohtainen näkyvyys (sisäinen/ulkoinen) tulee portaalien kanssa V7:ssä.
7. Dokumenttien luonti API:n kautta (multipart) ei ole V1:ssä; dokumentteja luodaan käyttöliittymässä. API v1 kattaa projektit, työmaat, henkilöt, kaluston, dokumenttien luvun ja muutoslokin.
8. Upstream MinIO ei enää julkaise Docker-imageja. Paikallisesti käytetään `pgsty/minio`-imagea (vaihdettavissa `MINIO_IMAGE`-muuttujalla).
9. Offline-tilaa, PWA-asennusta, QR-koodeja ja globaalia hakua ei ole V1:ssä.
10. Huomio dokumenteista: `docs/specs/SK_MANAGEMENT_CLAUDE_MASTER.md` oli tyhjä (1 tavu), ja täydellinen versio oli repositorion juuressa. Siirsin sen `docs/specs/`-kansioon ja poistin juuresta identtisen kaksoiskappaleen `SK_management_master.md`.

## 6. Järjestelmän ajaminen

```bash
pnpm install
cp .env.example .env    # aseta AUTH_SECRET (openssl rand -base64 32)
docker compose -f docker/docker-compose.yml up -d
pnpm db:deploy && pnpm db:seed
pnpm dev                # http://localhost:3000 → Kehityskirjautuminen
```

Testit: `pnpm check` (lint, tyypit, kerrokset, unit- ja integraatiotestit), `pnpm test:migrations`, `pnpm test:e2e`. Tarkemmin: [README](../README.md).

## 7. Näkymät (Playwright-kuvakaappaukset)

Kuvat ovat kansioissa `docs/screenshots/desktop/` ja `docs/screenshots/mobile/`:
- `sign-in.png`: kirjautuminen (Microsoft + kehityskirjautuminen)
- `dashboard.png`: etusivu: tunnusluvut, pikatoiminnot, tulevat tarkastukset, viimeisimmät muutokset
- `projects.png`, `project-detail.png`: projektilista ja projekti: tiedot, työmaat, henkilöt, dokumentit, kalusto
- `workforce.png`, `employee-detail.png`: henkilöstö ja henkilö: hinnat (vain oikeudella), linkitetyt dokumentit
- `equipment.png`: kalusto, sijainti ja tarkastuspäivät (myöhässä olevat merkitty)
- `documents.png`, `document-versions.png`: dokumentit ja versiohistoria: VOIMASSA/KORVATTU, SHA-256, hyväksyntä
- `settings-roles.png`: roolit × oikeudet (arkaluonteiset merkitty, ulkoisilta roolilta lukittu)
- `settings-audit.png`: muuttumaton muutosloki, jossa muutokset ja peitetyt arvot

## 8. Ehdotettu V2-suunnitelma (Site Execution & Project Finance Foundation, §36)

**Odottaa hyväksyntää — ei aloitettu.**

1. **Tunnit (time tracking):** `timesheets` ja `timesheet_entries` (henkilö, projekti, työmaa, päivä, alku/loppu tai määrä, ylityöluokka, muistiinpano). Työnkulku DRAFT → SUBMITTED → APPROVED → EXPORTED. Hyväksytyt lukitaan, ja korjaukset tehdään auditoituina korjausriveinä. Mobiilin nopea syöttö (oletuksena oma päivä ja projekti).
2. **Työmaan päivänäkymä ja työmaapäiväkirja:** `daily_reports` ja `daily_report_entries` (miehitys, tunnit, tehdyt työt, kalusto, valokuvat, viivästykset, ohjeet). Luonnos muodostetaan rakenteisesta datasta. Työnjohtaja tarkistaa ja allekirjoittaa, jonka jälkeen raportti lukitaan.
3. **Projektin budjetti ja kustannusseuranta:** `budgets`, `budget_lines`, `cost_entries`. Hyväksytyt tunnit × hinta voimassa kyseisenä päivänä → toteutunut työkustannus. Budjetti vs. toteuma -näkymä. Laskentakaavat keskitetysti ja deterministisesti testattuina.
4. **Hyväksyntätyönkulut:** yleinen hyväksyntämalli (tunnit, päiväkirjat), uudet oikeudet `timesheet.submit`, `timesheet.approve`, `diary.sign`, `finance.view` ja `finance.manage`. Oikeudet lisätään migraatiolla, ja oikeusmatriisi esitetään omistajalle ennen käyttöönottoa.
5. **Projektin kojelauta:** budjetti, toteuma, tunnit ja avoimet hyväksynnät.
6. **Ennen V2:ta suositeltavat tekniset korjaukset:** jaettu rate limit -säilö, orpojen tiedostojen siivous, CI:n ensimmäinen ajo GitHubissa.

Migraatiovaikutus: vain uusia tauluja ja oikeuksia. Olemassa oleviin V1-tauluihin ei tule rikkovia muutoksia.
