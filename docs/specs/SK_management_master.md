# SK Management – Master

## Tavoite
SK Management on SK Infran yritys-, projekti-, tuotanto-, logistiikka- ja resurssienhallintajärjestelmä erityisesti datakeskus-, 110 kV/HV-kaapelointi-, sähkö- ja verkkoinfra-, teollisuus-, nosto-, haalaus- ja työmaalogistiikkaprojekteihin.

Arkkitehtuuri on multi-company / multi-project, jotta sama alusta voi myöhemmin palvella SK Infraa, Purentia ja muita yrityksiä eriytetyillä käyttöoikeuksilla ja taloustiedoilla.

## Prosessi
CRM → tarjous → sopimus → projekti → tahtiaikataulu → henkilöstö → kalusto → logistiikka → materiaalit → toteuma → lisätyöt → laskutus → projektin tulos.

## Moduulit
1. Management Dashboard – liikevaihto, tilauskanta, tarjouskanta, laskuttamaton työ, kate- ja kassavirtaennuste, henkilöstö, kaluston käyttöaste, projektit ja HSE.
2. CRM & Sales – asiakkaat, kontaktit, liidit ja pipeline: Lead → Qualified → RFQ → Tender → Negotiation → Won/Lost.
3. Tarjouslaskenta – työvoima, kalusto, nostot, kuljetukset, materiaalit, matkat, majoitus, alihankinta, yleiskulut, riskivara ja kate.
4. Project Control Center – sopimusarvo, etenemä, liikevaihto, kustannukset, kate, aikataulu ja laskuttamaton työ.
5. Takt Planning – Project → Building → Area → Takt Area → Work Package → Activity → Takt. Työvaiheet etenevät tahtijunana.
6. Look-ahead – 2 viikon tuotanto-, 6 viikon resurssi- ja 12 viikon hankinta/henkilöstö/kalustonäkymä.
7. Logistics Control – nosturit, kurottajat, pyöräkuormaajat, kaivinkoneet, trukit, kuljetukset, rigging-tiimit, logistiikkahenkilöstö, varastot ja purkupaikat.
8. Logistics Booking – urakoitsijoiden palvelu- ja resurssivaraukset, konfliktien tarkistus tahtiaikataulua vasten.
9. Lifting & Rigging – Lift Request, nostettava kohde, paino, mitat, reitti, aika, nosturi, rigging crew, apuvälineet ja Lift Plan.
10. Delivery Management – toimittaja → kuljetus → portti → purku → varasto → sisäinen siirto → asennus.
11. Material Flow – materiaalien ja kaapelirumpujen QR-seuranta.
12. Workforce Management – projektit, rotaatiot, tunnit, pätevyydet, kulkuluvat, majoitus, matkustus, kustannus- ja laskutushinta.
13. Competence Management – pätevyydet ja automaattiset vanhenemisvaroitukset.
14. Equipment Management – sijainti, projekti, käyttötunnit, kustannus, laskutus, huolto, tarkastus, käyttöaste ja kannattavuus.
15. Daily Site Management – mobiilinäkymä päivän henkilöstöön, tehtäviin, toimituksiin, nostoihin, kalustoon ja turvallisuuteen.
16. Digital Site Diary – automaattinen työmaapäiväkirja ja AI-raportointi.
17. Time Tracking – tunnit projektille, work packagelle, tahtialueelle ja tehtävälle.
18. Variations – Draft → Submitted → Approved → Executed → Invoiced; lisätyöt kuvineen, resursseineen ja hinnoitteluineen.
19. Cost Control – Budget vs Actual vs Forecast.
20. Project Forecast / EAC – lopullinen liikevaihto, kustannus, kate ja valmistumispäivä.
21. HSE – Safety Observation, Near Miss, Incident, Toolbox Talk, Risk Assessment, Permit to Work, Lift Plan ja Inspection.
22. Document Control – sopimukset, piirustukset, RAMS, nostosuunnitelmat, sähkösuunnitelmat, tarkastukset ja revisiohallinta.
23. AI Project Controller – etenemä-, kustannus-, kate-, aikataulu- ja laskutuspoikkeamien analyysi.
24. AI Logistics Controller – Takt + resources + deliveries + workforce + equipment + materials; riskit ja korjausehdotukset ihmisen hyväksyttäväksi.
25. Resource Optimization – tyhjäkäynnin, päällekkäisyyksien ja resurssien jakomahdollisuuksien tunnistus.
26. Site Map – myöhemmin karttanäkymä kalustosta, toimituksista, materiaaleista, työryhmistä ja alueista.
27. Client Portal – rajattu etenemä-, HSE-, aikataulu-, dokumentti-, KPI- ja hyväksyntänäkymä.
28. Subcontractor Portal – tehtävät, henkilöstö, tunnit, logistiikkavaraukset, toimitukset ja dokumentit.
29. Roles – CEO, Project Director, Project Manager, Site Manager, Supervisor, Logistics Coordinator, HSE, Employee, Subcontractor, Client.
30. Multi-company – Group → Company → Project → Site → Takt Area; yrityskohtainen talous ja käyttöoikeudet, mutta mahdollisuus jakaa resursseja.
31. Mobile First – tunnit, kuvat, päiväkirjat, lisätyöt, HSE, logistiikka, nostopyynnöt, toimitukset ja QR.
32. Integrations – Microsoft 365/Outlook, SharePoint/OneDrive, taloushallinto, palkanlaskenta, GPS, sää, kartat ja Power BI.

## Tietomallin ydin
organizations, companies, users, employees, customers, contacts, opportunities, quotes, contracts, projects, sites, buildings, takt_areas, work_packages, activities, takt_cycles, resource_requirements, resource_bookings, equipment, equipment_types, equipment_inspections, maintenance, logistics_requests, deliveries, transport_orders, storage_locations, materials, material_batches, cable_drums, lift_requests, lift_plans, rigging_crews, timesheets, daily_reports, budgets, cost_entries, purchase_orders, invoices, variations, variation_approvals, hse_observations, incidents, risk_assessments, permits, documents, document_revisions, competences, employee_competences.

## Päävalikko
Dashboard | Projects | Takt | Logistics | Workforce | Equipment | Materials | Lifting | Sales | Finance | HSE | Documents | AI

## Rakentamisjärjestys
V1: yritykset, käyttäjät, projektit, henkilöstö, kalusto ja dokumentit.
V2: päiväkirjat, tunnit, kustannukset ja projektitalous.
V3: Takt + look-ahead.
V4: Logistics Control + resurssivaraukset + toimitukset.
V5: Lift & Rigging + materiaalivirrat.
V6: tarjoukset, lisätyöt ja laskutusaineisto.
V7: HSE + asiakas- ja alihankkijaportaalit.
V8: AI Project Controller + AI Logistics Controller + optimointi.

## Tekninen periaate
Käyttöliittymä ↔ API/liiketoimintalogiikka ↔ tietokanta. AI erillisenä palvelukerroksena, jotta järjestelmä ei ole sidottu yhteen AI-malliin tai rakentamistyökaluun.

## Ohjausperiaate
TAKT määrää mitä pitää tapahtua → LOGISTICS varmistaa tavaran → RESOURCES varmistaa ihmiset ja koneet → EXECUTION kertoo toteuman → FINANCE kertoo kustannukset ja laskutuksen → AI tunnistaa poikkeamat ja ehdottaa korjaavia toimia.

Tavoite: SK Management toimii sekä SK Infran ERP-/projektinhallintajärjestelmänä että suurten datakeskus- ja teollisuustyömaiden tuotannon, logistiikan ja resurssien ohjausalustana, joka voidaan myöhemmin tuotteistaa kaupalliseksi ratkaisuksi.
