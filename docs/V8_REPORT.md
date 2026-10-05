# SK Management — V8 AI & rivitason tietoturva: pysäytysraportti

- Päivä: 2026-10-05
- Haara: `claude/dazzling-edison-zzskak`
- Suunnitelma: [`docs/V8_PLAN.md`](V8_PLAN.md)
- ADR:t: [0022 RLS](adr/0022-row-level-security.md) ja [0023 tekoälyohjaaja](adr/0023-ai-project-controller.md)

Omistaja teki V8:sta seuraavat päätökset:
- RLS kuuluu V8:aan.
- Tekoälypalveluna on Clauden rajapinta, ja projektitietoja saa lähettää sinne.
- Kustannuskatto on 10 € kuukaudessa.
- Henkilötietoja ei lähetetä, ja tekoäly näkee vain sen, mitä käyttäjäkin näkee. Käyttöön tarvitaan oma oikeus.
- Ensimmäinen tekoälyominaisuus on projektin ohjaus.

AI-logistiikkaohjaaja (§27) ja resurssioptimointi jätettiin omistajan valinnan mukaisesti myöhempään vaiheeseen.

## 1. Toteutettu, hyväksymiskriteerien mukaan

| # | Kriteeri (V8_PLAN) | Toteutus | Todennus |
|---|---|---|---|
| 1 | RLS:n ollessa päällä kysely ilman yritysehtoa palauttaa vain oman yrityksen rivit, eikä toisen yrityksen riviä voi kirjoittaa | Rooli `sk_app`, `tenant_isolation`-politiikka kaikissa `company_id`-tauluissa sekä dokumentoidut konsernipoikkeukset. Kaikki rekisterin palvelut ajetaan yrityksen scopessa. | `rls.test.ts` (8 testiä), mukana metatesti: jokaisella `company_id`-taululla on RLS ja politiikka |
| 2 | Kaikki V1–V7-testit menevät läpi RLS:n kanssa | Muutokset: audit kirjoitetaan `createMany`-kutsulla, ja scope lisätään keskitetysti rekisterissä | 2254 / 2254 yksikkö- ja integraatiotestiä, 117 E2E-testiä |
| 3 | Tekoäly näkee vain käyttäjän sallitut tiedot, eikä henkilötietoja lähetetä | Tietotyökalut kutsuvat olemassa olevia palveluita käyttäjän omalla kontekstilla, ja työkalu tarjotaan vain, jos käyttäjällä on siihen oikeus. Tulosteissa ei ole nimiä, sähköposteja, käyttäjä-id:itä eikä hintoja. | `ai.test.ts`: työkalut suodattuvat oikeuksien mukaan, eikä tarjoajalle päädy nimeä, sähköpostia tai id:tä. `external-boundary.test.ts`: ulkoiset roolit eivät pääse tekoälyyn. |
| 4 | Jokainen ajo tallennetaan (malli, mallipohjan versio, työkalut, tulos, tokenit, kustannus) | `ai_runs`: append-only-trigger ja RLS | `ai.test.ts` sekä audit-tapahtuma `ai.run` |
| 5 | Vastaus erottelee FAKTAN, ENNUSTEEN ja AI-SUOSITUKSEN ja kertoo lähteet | `submit_result`-työkalun skeema ja Zod-validointi. Lähteiksi jätetään vain ajossa oikeasti dataa palauttaneet työkalut. | `ai.test.ts`: virheellinen vastaus hylätään, ja keksityt lähteet poistetaan |
| 6 | Suositukset vaativat ihmisen päätöksen, eikä tekoäly muuta dataa | `ai_recommendations`: PROPOSED → ACCEPTED/DISMISSED kerran. Työkalut vain lukevat. | `ai.test.ts` ja E2E |
| 7 | Kuukausikatto estää uudet ajot | Katto on yrityskohtainen (`companies.ai_monthly_budget_eur`, oletus 10 €). Kuukausi lasketaan Helsingin ajassa. Ajo jää käynnistämättä, jos kattoa on jäljellä alle 0,10 €. | `ai.test.ts`: BLOCKED_BUDGET, eikä tarjoajaa kutsuta |
| 8 | Toimii ilman avainta; avaimen kanssa yksi live-ajo | Ilman avainta (ei tuotannossa) käytetään selvästi merkittyä testitarjoajaa. Live-ajoa varten on `pnpm ai:verify`. | Toimii ilman avainta: testit ja E2E. **Live-ajo tehty 2026-10-05** (`pnpm ai:verify`, NDC-001, `claude-opus-5-5`): tila SUCCEEDED, 6 työkalukutsua, 9 781 tokenia, 0,092 €, 44 s (ks. kohta 5.1). |

### Tekoälyohjaaja käyttäjän näkökulmasta
Projektisivulla on painike **Tekoälyohjaaja**. Se näkyy, jos käyttäjällä on `ai.use`-oikeus (toimitusjohtaja, projektijohtaja tai projektipäällikkö). Sivulla voi:
- tehdä **projektikatsauksen**, joka käy läpi aikataulun, resurssien ennakoinnin, kustannusennusteen, lisätyöt ja työturvallisuuden;
- **kysyä** projektista vapaasti suomeksi tai englanniksi;
- hyväksyä tai hylätä **suosituksia**;
- selata **ajohistoriaa**, jossa näkyvät malli, kustannus ja jokaisen havainnon tyyppi ja lähteet;
- seurata **kuukausikattoa**. Käyttäjä, jolla on `company.manage`-oikeus, voi muuttaa sitä.

Sivulla kerrotaan aina, että vastaukset ovat suosituksia ja että projektitiedot lähetetään tekoälypalveluun ilman henkilötietoja.

### Tekninen ratkaisu (ADR 0023)
- **Tarjoajarajapinta `platform/ai`.** Domain-moduulit eivät tunne toimittajan SDK:ta, ja tämä on varmistettu dependency-cruiserilla.
- **Claude-adapteri** (`@anthropic-ai/sdk`):
  - malli `claude-opus-5-5`, adaptiivinen ajattelu ja `effort: medium`;
  - striimaus ja strict-työkalut;
  - promptin välimuisti;
  - **palvelinpuolen varamalli on päällä** (`fallbacks: "default"`), joten ylikuormitus ei kaada ajoa; vastanneen mallin nimi tallentuu ajoon;
  - kieltäytyminen ja katkennut vastaus käsitellään virheinä.
- **Hinta-arvio.** Kustannus arvioidaan listahinnoista (USD) ja muunnetaan euroiksi kertoimella `AI_EUR_PER_USD`, oletus 0,92.
- **Tietotyökalut:**
  - `project_overview`;
  - `schedule_status`: tahtiaikataulu, estyneet ja myöhässä olevat tehtävät sekä avoimet esteet;
  - `lookahead_shortages`: 6 viikon resurssivajeet;
  - `cost_forecast` ja `variations`: vaativat `commercial.view`-oikeuden;
  - `hse_metrics`: vain tunnusluvut.
- **Prompt-injektiot.** Järjestelmäprompti ohjeistaa käsittelemään työkalujen tuloksia datana eikä ohjeina. Työkalut ovat lukuoperaatioita.

## 2. Tietokantaskeeman muutokset

| Migraatio | Sisältö |
|---|---|
| `20261005180000_v8_rls` | Rooli `sk_app` ja sen oikeudet, funktiot `app_company_id()` ja `app_org_company_ids()` sekä RLS ja `tenant_isolation`-politiikka kaikkiin `company_id`-tauluihin. Konsernipoikkeukset: jaetut resurssit, varaukset omistajalle, sisäinen laskutus ja audit. |
| `20261005190000_v8_ai_controller` | Taulu `ai_runs`: append-only-trigger, CHECK-rajoitteet ja yhdistelmävierasavain projektiin. Taulu `ai_recommendations`: päätös tehdään kerran (CHECK), yhdistelmävierasavaimet. Sarake `companies.ai_monthly_budget_eur` (oletus 10). Molemmat uudet taulut ovat RLS:n alaisia. Oikeus `ai.use` annetaan CEO-, PD- ja PM-pohjarooleille, ja muutoksesta kirjataan audit-tapahtuma. |

Oikeuksia on nyt 59. Uudet enumit: `AiRunKind`, `AiRunStatus`, `AiSeverity` ja `AiRecommendationStatus`.

## 3. Testitulokset (todelliset ajot 2026-10-05)

| Ajo | Tulos |
|---|---|
| `pnpm check` (lint, typecheck, depcruise, yksikkö- ja integraatiotestit) | **42 testitiedostoa, 2254 / 2254 läpi** |
| – tenant-eristys (`tests/isolation`) | 584 tapausta. Jokaisella palvelumetodilla on tapaus, myös viidellä tekoälymetodilla. |
| – valtuutusmatriisi | 12 roolia; uudet rivit: tekoälyohjaajan avaaminen, katsauksen ajaminen ja kuukausikaton asettaminen |
| – ulkoisten rajojen suite | Asiakas, asiakkaan hyväksyjä ja aliurakoitsija: kaikki tekoälykutsut torjutaan, eikä tietoja vuoda |
| – `ai.test.ts` | 15 testiä |
| – `anthropic.test.ts` | 6 testiä: Claude-adapterin työkalusilmukka, pyynnön muoto, virheet ja työkalubudjetti, ajettuna offline-tilassa simuloidulla rajapinnalla |
| – `rls.test.ts` | 8 testiä |
| `pnpm test:migrations` | Tyhjä kanta → migraatiot → ei driftiä → seed onnistuu (59 oikeutta, 385 audit-tapahtumaa) |
| Playwright E2E (työpöytä ja Pixel 7) | **117 läpi, 1 ohitettu.** Ohitettu on aiempi tapaus: palkka-CSV:n lataus mobiilissa. Uutta `ai.spec.ts`: projektipäällikkö tekee katsauksen, kysyy ja hylkää suosituksen; työmaapäällikkö ei näe sivua (404). |
| `pnpm build` | OK; reitti `/c/[companySlug]/projects/[projectId]/ai` |
| `pnpm audit --prod` | Ei tunnettuja haavoittuvuuksia |

## 4. Tietoturva ja yritysten eristys
- **RLS** on kolmas eristyskerros scoped-repositorioiden ja yhdistelmävierasavainten jälkeen. Vaikka koodista unohtuisi yritysehto, tietokanta ei näytä eikä kirjoita toisen yrityksen rivejä. Metatesti varmistaa, että jokaisella tulevallakin `company_id`-taululla on politiikka.
- **Tekoäly** saa dataa vain käyttäjän omien palvelukutsujen kautta, joten se kulkee samojen oikeus-, eristys- ja RLS-tarkistusten läpi kuin käyttöliittymä. Henkilötietoja ei lähetetä.
- **`ai.use`** on merkitty sensitiiviseksi oikeudeksi, joten sitä ei voi antaa ulkoisille rooleille.
- **API-avain** luetaan vain ympäristömuuttujasta. Se ei ole koodissa eikä tietokannassa. Testit, CI ja E2E käyttävät aina testitarjoajaa, eivätkä ne kutsu verkkoa, vaikka avain olisi asetettu.
- **Chattiin liitetty avain:** keskustelussa aiemmin liitettyä avainta ei ole käytetty eikä tallennettu mihinkään. Sen mitätöintiä suositellaan edelleen.

## 5. Tunnetut rajoitukset
1. **Live-verifiointi tehty 2026-10-05.** `pnpm ai:verify` ajettiin seedattua kehityskantaa vasten (projekti NDC-001, käyttäjä `pm@skinfra.example.com`, avain `SK_ANTHROPIC_API_KEY`-ympäristömuuttujasta).
   - Tulos: tila SUCCEEDED, malli `claude-opus-5-5` (tarjoaja anthropic), 44,1 s.
   - Työkalut: `project_overview`, `schedule_status`, `cost_forecast`, `variations`, `hse_metrics`, `lookahead_shortages` (kaikki onnistuivat).
   - Kulutus: 9 781 tokenia, arvioitu kustannus 0,092 € (noin 1 % kuukausikatosta).
   - Vastaus: suomenkielinen yhteenveto ja 12 havaintoa (5 faktaa, 2 ennustetta, 4 AI-suositusta; 4 kriittistä). Keskeiset: sähkötahdin valmistuminen 2026-10-09 vaarassa (15/30 tehtävää valmiina, kaapelihyllyt estyneenä), 9 sähköasentajan vaje tällä viikolla, laskutus aloittamatta (laskuttamatonta 138 516 €), yksi poissaoloon johtanut tapaturma.
   - Arvio laadusta: havainnot ovat konkreettisia, perustuvat työkalujen palauttamiin lukuihin, ja jokaisella on lähdeviitteet. Tyypit (fakta/ennuste/suositus) on eroteltu oikein, ja suositukset ovat toimenpiteitä. Malli huomasi myös itse, että kustannusennuste (EAC 395 k€ vs. budjetti 660 k€) näyttää epäuskottavan hyvältä, ja suositteli ETC:n tarkistamista; tämä on hyvä kriittinen havainto. Pieniä puutteita: valmiusaste 58 % ei vastaa suoraan lukua 15/30 (todennäköisesti painotettu luku, mutta tätä ei selitetty), ja yhden turvallisuushavainnon lähteeksi on merkitty myös `lookahead_shortages`. Promptin hienosäätö ei ole välttämätöntä.
2. **Kuukausikaton tarkistus ei ole sarjallistettu.** Kaksi yhtäaikaista ajoa voi ylittää lähes täyden katon enintään yhden ajon verran (noin 0,1–0,3 €).
3. **Kustannus on arvio** listahinnoista ja kiinteästä USD/EUR-kertoimesta. Tarkka laskutus näkyy Anthropicin konsolissa.
4. **Ajo on synkroninen.** Katsaus kestää noin 10–60 sekuntia, ja sivu odottaa sen ajan; taustajonoa ei ole.
5. **Rajattu laajuus.** AI-logistiikkaohjaaja (§27) ja resurssioptimointi on rajattu pois omistajan päätöksellä. Myöskään tekoälylle ei ole REST-rajapintaa (`/api/v1`).

## 6. Järjestelmän ajaminen
```bash
docker compose -f docker/docker-compose.yml up -d
pnpm install && pnpm db:reset          # migraatiot + fiktiivinen demodata
pnpm dev                               # http://localhost:3000, dev-kirjautuminen
```
- **Tekoäly:** kirjaudu tunnuksella `pm@skinfra.example.com` ja avaa projekti NDC-001 → **Tekoälyohjaaja**. Ilman avainta sivu toimii testitilassa.
- **Oikea tekoäly:** lisää `SK_ANTHROPIC_API_KEY` ympäristön asetuksiin (`ANTHROPIC_API_KEY` on pilviympäristössä varattu) (pilviympäristössä Environment → Edit). Käynnistä sen jälkeen uusi istunto.

## 7. Näkymät
- `docs/screenshots/desktop/ai-controller.png` ja `docs/screenshots/mobile/ai-controller.png`: tekoälyohjaaja, jossa näkyvät kuukausikatto, katsaus- ja kysymyslomakkeet, avoimet suositukset Hyväksy- ja Hylkää-painikkeineen sekä ajohistoria. Havaintojen tyypit (Fakta, Ennuste, AI-suositus) ja lähteet näkyvät ajohistoriassa.

## 8. Ehdotus jatkoksi
V8 on Build Masterin viimeinen julkaisu. Ehdotan seuraavia vaiheita:
1. **Promptin hienosäätö** oikeiden vastausten perusteella tarvittaessa (live-verifiointi on tehty, ks. kohta 5.1).
2. **AI-logistiikkaohjaaja (§27)**, joka käyttää samaa tarjoajarajapintaa, tallennusta ja suositusten päätösprosessia. Tietolähteinä olisivat varauskonfliktit, toimitukset ja nostot.
3. **Resurssioptimointi:** ehdotukset varausten siirroista. Ne jäisivät aina ihmisen hyväksyttäviksi.
4. **Tuotantoon vienti:** RLS-roolin myöntäminen tuotannon tietokantakäyttäjälle, Entra ID -konfiguraatio, SMTP sekä avaimen hallinta salaisuuksien hallinnassa.

Odotan omistajan hyväksyntää ennen jatkotyötä.
