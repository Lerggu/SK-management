# Markkinointi – käyttöohje

Markkinointi löytyy valikosta **Markkinointi**. Pääsy on vain **toimitusjohtajalla ja projektipäälliköllä** (omistajan päätös). Oikeuksia ei voi antaa muille rooleille eikä henkilökohtaisina lisäoikeuksina.

## Käyttöönotto (kerran)
1. **Markkinointi → Asetukset**
   - Rastita **Vastaukset ohjataan näille henkilöille**: valitse Janne ja Markku. Kirjeiden vastaukset menevät suoraan heidän sähköpostiinsa.
   - Kirjoita **Allekirjoituksen nimi** (esim. *SK Infra myynti*) ja lyhyt **Myyntiviesti** – mitä kirjeissä halutaan korostaa.
   - Valitse **haettavat maat**, kirjeen **sopivuusraja** (oletus 60/100), **päivän lähetysraja** ja **tekoälybudjetti** (oletus 40 €/kk).
   - Rastita **Agentit käytössä** ja tallenna.
2. Paina **Rekisteri → Hae nyt** ensimmäisen kerran. Haku kestää muutaman minuutin; sen jälkeen agentti hakee automaattisesti asetetulla välillä (oletus kerran vuorokaudessa).

## Google-haku (suositeltava)
Agentti hakee myös Googlesta, kun hakupalvelun avain on asetettu. Googlen oma hakurajapinta ei ota uusia käyttäjiä, joten Googlen tulokset haetaan Serper-palvelun kautta (serper.dev, ilmaiset 2 500 hakua kokeiluun). Avain tallennetaan Key Vaultiin (`serper-api-key`) eikä sitä kirjoiteta mihinkään muualle. Asetuksissa näkyy, onko Google-haku käytössä.

**Seurattavat yritykset** (Asetukset): agentti hakee jokaisella ajolla näiden yritysten uusimmat hankeuutiset. Lisää ja poista nimiä vapaasti, yksi per rivi.

## Mitä agentit tekevät
- **Hakuagentti** käy läpi EU:n julkiset hankinnat (TED), verkon uutiset ja tiedotteet (datakeskukset, teollisuus), kantaverkko- ja verkkoyhtiöiden 110 kV hankkeet sekä Hilman. Jokainen hanke tallennetaan rekisteriin lähdelinkkeineen: sijainti, aikataulu, tilaaja, budjetti, vaihe, sopivuus ja sopivat palvelumme.
- **Myyntiagentti** laatii jokaiselle sopivalle hankkeelle kohdennetun kirjeen ja soittokäsikirjoituksen yhteyshenkilölle (suomi, ruotsi tai englanti maan mukaan).

## Päivittäinen käyttö (toimii puhelimella)
- **Hyväksyttävät**: lue kirje, muokkaa tarvittaessa, paina **Hyväksy ja lähetä**. Allekirjoitus, vastausosoitteet ja peruutuslinkki lisätään automaattisesti.
- **Soittolista**: kirjeen saaneet, joiden puhelinnumero tiedetään. Soita yhdellä napautuksella ja kirjaa tulos. *Tapaaminen sovittu* merkitsee hankkeen kiinnostuneeksi.
- **Hanke → Siirrä myyntimahdollisuudeksi**: luo asiakkaan ja myyntimahdollisuuden Myynti-osioon.
- Jos joku pyytää vastauksessa, ettei häneen oteta yhteyttä, lisää osoite **Asetukset → Älä ota yhteyttä -lista**.

## Hyvä tietää
- Automaattilähetys ilman hyväksyntää on asetus, joka kannattaa kytkeä päälle vasta, kun kirjeiden laatu on todettu.
- Tekoäly ei soita puheluita: laki edellyttää automaattisille markkinointipuheluille ennakkosuostumuksen.
- Yhteyshenkilöt kerätään vain julkisista lähteistä, ja lähde tallennetaan. Peruutuslinkin käyttäneisiin ei oteta enää yhteyttä.
