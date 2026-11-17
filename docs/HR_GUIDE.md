# Henkilöstökortti ja osaamismatriisi – käyttöohje

Tekninen kuvaus: [ADR 0025](adr/0025-hr-competence.md).

## Kuka näkee mitä

| Rooli | Mitä näkee ja tekee |
|---|---|
| **Henkilöstöhallinto** (rooli *Henkilöstöhallinto* tai toimitusjohtaja) | Kaikki tiedot ja asetukset: osaamisalueet, korttityypit, tehtävien vaatimukset, muistutusosoite, työvaatteet ja tavarat. Voi hallita kaikkia arviointeja. |
| **Esihenkilö** | Omien alaistensa ja heidän alaistensa työtehtävien kannalta tarpeelliset tiedot ja hätäyhteyshenkilö. Tekee osaamisarvioinnit, kirjaa perehdytykset, myöntää käyttöluvat ja tarkistaa työntekijän itse lisäämät kortit. Ei näe työvaatteita eikä tavaroita. |
| **Projektijohto, projektipäällikkö, työmaapäällikkö, HSE** | Osaamismatriisi, kortit, koulutukset, perehdytykset, käyttöluvat ja kielitaito työryhmien suunnittelua varten. Ei näe hätäyhteyshenkilöä, luonnoksia, vaatteita eikä tavaroita. |
| **Työntekijä** | Oma kortti (*Oma kortti* valikossa). Voi päivittää puhelinnumeron, hätäyhteyshenkilön, asiointikielen ja vaatekoot, tehdä itsearvion, kommentoida esihenkilön julkaistua arviota, lisätä omia kortteja ja liitteitä sekä kuitata perehdytykset ja tavaroiden vastaanoton. Esihenkilön arvioita, tarkistuksia ja käyttölupia hän ei voi muuttaa. |
| **Asiakas ja aliurakoitsija** | Ei pääsyä henkilöstötietoihin. |

Esihenkilö määritetään henkilöstökortin kohdassa *Työsuhde ja organisaatio → Esihenkilö*. Samassa kohdassa korttiin liitetään työntekijän käyttäjätunnus, jotta hän näkee oman korttinsa.

## Käyttöönotto (henkilöstöhallinto)
1. Avaa **Henkilöstö → Asetukset**.
2. Paina **Lisää ehdotetut osaamisalueet** ja **Lisää ehdotetut korttityypit**. Lisää, muokkaa tai poista käytöstä niitä tarpeen mukaan. Merkitse tärkeimmät osaamisalueet, niin ne näkyvät matriisissa.
3. Anna **ylläpidon sähköpostiosoite**, jolle muistutukset lähetetään kortin omistajan lisäksi.
4. Lisää **tehtävät ja vaatimukset**, esimerkiksi *Sähköasentaja (työmaa)*: työturvallisuuskortti, osaaminen vähintään tasolla 3 ja työmaaperehdytys.
5. Täydennä jokaisen henkilön kortille esihenkilö, tiimi, toimipiste, tehtävä ja käyttäjätunnus.

## Osaamisen arviointi
- **Asteikko:**
  - Ei arvioitu;
  - 1 Tarvitsee perehdytyksen;
  - 2 Osaa ohjattuna;
  - 3 Osaa itsenäisesti;
  - 4 Osaa vaativat tehtävät ja voi opastaa muita.
- **Luonnos ja julkaisu.** Esihenkilö voi tallentaa arvion luonnoksena tai julkaista sen. Julkaistua arviota ei voi muuttaa. Uusi arvio tehdään uutena, ja vanhat jäävät historiaan.
- **Matriisi.** Osaamismatriisi näyttää viimeisimmän julkaistun esihenkilön arvion päivämäärineen. Viiva katkoviivaruudussa tarkoittaa, ettei osaamista ole arvioitu, mikä on eri asia kuin matala taso.
- **Itsearvio.** Työntekijän itsearvio näkyy kortilla esihenkilön arvion rinnalla, mutta matriisi ei käytä sitä.

## Kortit, pätevyydet ja muistutukset
- **Tila.** Voimassaolo näkyy tekstinä ja värinä:
  - *Voimassa* (vihreä);
  - *Vanhenee kuukauden sisällä* (keltainen);
  - *Vanhentunut* (punainen);
  - *Ei vanhenemispäivää* (sininen).
- **Muistutuksen ajankohta.** Kun kohta *Lähetä sähköpostimuistutus…* on valittuna, muistutus lähtee kuukautta ennen viimeistä voimassaolopäivää kortin omistajalle ja ylläpidon osoitteeseen. Jos vastaavaa päivää ei ole, käytetään kuukauden viimeistä päivää (esim. 31.3. → 28.2.).
- **Kerran per vastaanottaja.** Muistutus lähetetään vain kerran kullekin vastaanottajalle. Lähetyksen tila näkyy kortilla (Lähetetty, Odottaa, Epäonnistui, Osoite puuttuu).
- **Uusiminen.** Kun kortti uusitaan (**Uusi kortti**) tai sen päättymispäivää muutetaan, alkaa uusi muistutusjakso.
- **Varoitus.** Kortilla näkyy huomautus, jos muistutus on valittu mutta sähköpostiosoite puuttuu tai sähköpostin lähetys ei ole käytössä.
- **Koulutukset.** Määräaikaisissa koulutuksissa on sama muistutustoiminto.

Muistutukset lähetetään automaattisesti tunnin välein, vaikka kukaan ei käyttäisi sovellusta. Henkilöstöhallinto voi ajaa ne myös heti asetussivulta.

### Mitä sähköposti tarvitsee
Lähetys vaatii palvelulle SMTP-asetuksen. Ilman sitä muistutuksia ei merkitä lähetetyiksi, vaan ne jäävät odottamaan. Azure-ympäristössä sähköpostin saa käyttöön Cloud Shellissä yhdellä komennolla:
```
bash infra/enable-email.sh
```
Komento ottaa käyttöön Azure Communication Services -sähköpostin ja asettaa sovellukselle `SMTP_URL`- ja `MAIL_FROM`-asetukset. Tarkemmat ohjeet ovat tiedostossa [DEPLOY_AZURE.md](DEPLOY_AZURE.md), kohta 9.

## Yhteenveto ja haku
**Henkilöstö → Yhteenveto** näyttää:
- puuttuvat ja vanhenevat pätevyydet;
- tulevat ja myöhässä olevat arvioinnit;
- sovitut koulutukset ja avoimet kehitystoimenpiteet;
- keskeneräiset perehdytykset;
- puutteet tehtävien vaatimuksiin;
- henkilöstöhallinnolle lisäksi palautettavat tavarat ja erääntyvät tarkastukset.

**Henkilöt**-välilehden *Haku ja suodatus* rajaa henkilöt tehtävän, tiimin, toimipisteen, osaamisen ja tason, kielen ja kielitaidon tai voimassa olevan kortin mukaan.

## Henkilönumero ja henkilötunnus
- **Henkilönumero** on yrityksen oma tunniste henkilölle, esim. palkanlaskennan numero.
- **Henkilötunnus** on oma kenttänsä henkilökortilla ([ADR 0028](adr/0028-personal-identity-code.md)):
  - se tallennetaan salattuna, ja sen muoto ja tarkistemerkki tarkistetaan;
  - sen näkevät ja voivat muuttaa vain toimitusjohtaja ja henkilöstöhallinto;
  - kortilla se näkyy peitettynä, ja koko tunnuksen saa esiin Näytä-painikkeella;
  - jokainen näyttäminen kirjataan muutoslokiin.

## Tiimit
- **Missä:** Henkilöstö → Tiimit ([ADR 0029](adr/0029-teams.md)).
- **Tiimin luonti:** anna tiimille nimi, vetäjä, väri ja kuvaus, ja lisää sitten jäsenet.
- **Jäsenyys:** henkilö kuuluu yhteen tiimiin kerrallaan, joten lisääminen toiseen tiimiin siirtää hänet. Vetäjä on aina tiimin jäsen.
- **Henkilökortilla** tiimi valitaan listasta.
- **Rotaatiokalenterissa** koko tiimin voi raahata kalenteriin kerralla, ja henkilölistan voi rajata tiimin mukaan.

## Rotaatio
**Henkilöstö → Rotaatio** on henkilöstön rotaatiosuunnitelma kalenterina ([ADR 0027](adr/0027-workforce-rotation.md)).
- **Tilat:** töissä (työmaa), vapaalla, lomalla, sairaana, koulutuksessa ja muu syy.
- **Merkitseminen:**
  - raahaa henkilö sivupaneelista oikean rivin päivään, tai napauta henkilöä ja sitten päivää (puhelimella);
  - valitse avautuvassa ikkunassa tila, työmaa ja jakso (alkaen–asti);
  - nimen napautus kalenterissa muuttaa tai tyhjentää merkinnän.
- **Näkymät:**
  - *Työmaat* näyttää, ketkä ovat millä työmaalla, sekä päivittäisen henkilömäärän;
  - *Henkilöt* näyttää jokaisen henkilön tilan päiväkohtaisesti ja työpäivät jaksolla.
- **Rotaatiorytmi:** merkitsee valituille henkilöille toistuvan rytmin, esim. 10 päivää töissä ja 4 vapaalla. Lomia, sairauspoissaoloja ja muita poissaoloja ei korvata.
- **Kuka näkee mitä:**
  - suunnittelevat toimitusjohtaja, projektijohtaja, projektipäällikkö, työmaapäällikkö ja henkilöstöhallinto;
  - työnjohtaja ja logistiikkakoordinaattori katsovat;
  - sairauspoissaolo ja muu syy näkyvät katsojille vain merkinnällä "Poissa".
- **Yhteys logistiikkaan:** logistiikan resursoinnissa poissa oleva henkilö saa varoituksen "Poissa rotaation mukaan".

## Liitteet
- **Tiedostot.** Sallitut tiedostot ovat JPG, PNG, WEBP ja PDF, enintään 20 Mt. Tiedoston sisältö tarkistetaan.
- **Säilytys.** Liitteet säilytetään suojatussa tallennustilassa.
- **Näkyvyys.** Liitteet näkyvät vain niille, joilla on oikeus kyseiseen osioon. Esimerkiksi kortin kuva näkyy niille, jotka näkevät kortit, ja oma muu dokumentti vain työntekijälle ja henkilöstöhallinnolle.
- **Toiminnot.** Liitteitä voi esikatsella, ladata, nimetä uudelleen ja poistaa oikeuksien mukaan.
