# SK Management Azureen – asennusohje IT-tuelle

Tämä ohje vie SK Managementin tuotantoon yrityksen Azure-tilaukselle. Arkkitehtuuri on kuvattu tiedostossa [ADR 0024](adr/0024-azure-hosting.md).

- **Kesto:** noin 1–2 tuntia.
- **Komennot ajetaan Azure Cloud Shellissä** (portal.azure.com → Cloud Shell → Bash). Siinä ovat valmiina `az`, `psql`, `git`, `gh` ja `openssl`.

> **Salaisuudet.** Salasanat ja avaimet tallennetaan vain Key Vaultiin tai salasananhallintaan. Niitä ei lähetetä sähköpostilla, Teamsissa tai chatissa, eikä niitä tallenneta GitHubiin.

## Mitä asennetaan

| Resurssi | Tarkoitus | Koko (pilotti) | Hinta-arvio |
|---|---|---|---|
| App Service (Linux, kontti) | sovellus | B1 | n. 12 €/kk |
| PostgreSQL 16 Flexible Server | tietokanta, varmuuskopiot 14 vrk | Burstable B1ms, 32 Gt | n. 15–20 €/kk |
| Storage account (Blob) | dokumentit ja kuvat, palautus 30 vrk | Standard LRS | alle 1 €/kk |
| Container Registry | sovelluksen konttikuvat | Basic | n. 5 €/kk |
| Key Vault | salaisuudet | Standard | alle 1 €/kk |
| Managed identity | julkaisu GitHubista ilman tallennettuja salasanoja | – | 0 € |

**Yhteensä noin 35–40 €/kk**, eli Azuren hinnastolla 2026 noin. Tarkista nykyhinnat Azure Pricing Calculatorista. Jos sovellus tuntuu hitaalta, App Servicen voi nostaa kokoon P0v3 (noin 60 €/kk) yhdellä asetuksella.

**Datan sijainti:** valitse Suomen Azure-alue, jos se on tilauksellenne saatavilla. Muuten valitse `swedencentral` (Ruotsi). Kaikki data pysyy EU:ssa.

---

## 1. Tilaus ja kulurajat (portaali)
1. Luo tilaus kohdassa **portal.azure.com → Subscriptions → Add**, joko Pay-As-You-Go tai yrityksen sopimus.
2. Aseta budjetti kohdassa **Cost Management → Budgets → Add**: 100 €/kk ja hälytykset 50 %:n, 80 %:n ja 100 %:n kohdalla.

## 2. Valmistelu Cloud Shellissä
```bash
az account set --subscription "<tilauksen nimi tai id>"
LOCATION=swedencentral                 # tai Suomen alue, jos saatavilla
RG=rg-sk-management
APP=sk-management-<yritys>             # verkko-osoitteen alkuosa, globaalisti yksilöllinen
az group create -n $RG -l $LOCATION

# Lähdekoodi (yksityinen repo): kirjaudu GitHubiin ja kloonaa
gh auth login
gh repo clone Lerggu/SK-management && cd SK-management
```

## 3. Microsoft-kirjautumisen sovellusrekisteröinti (Entra ID)
1. Avaa **Microsoft Entra admin center → App registrations → New registration**. Kirjaudu **yrityksen Microsoft 365 -ylläpitäjän tunnuksella**, jotta rekisteröinti syntyy yrityksen hakemistoon eikä henkilökohtaiseen hakemistoon. Tämä pätee, vaikka Azure-tilaus olisi tehty toisella tilillä.
2. Täytä tiedot:
   - **Name:** `SK Management`
   - **Supported account types:** *Accounts in this organizational directory only*
   - **Redirect URI (Web):** `https://<APP>.azurewebsites.net/api/auth/callback/microsoft-entra-id`
3. Kopioi talteen **Application (client) ID** ja **Directory (tenant) ID**.
4. Luo salaisuus kohdassa **Certificates & secrets → New client secret** (voimassa 24 kk). Kopioi sen **Value** talteen, sillä se näkyy vain kerran. Merkitse kalenteriin uusinta ennen vanhenemista.
5. Tarkista **API permissions**: `User.Read` (Delegated) riittää. Valitse lopuksi *Grant admin consent*.

Sovellus päästää sisään vain käyttäjät, jotka on kutsuttu SK Managementiin. Pelkkä yrityksen Microsoft-tili ei siis riitä.

## 4. Infrastruktuurin luonti
Muokkaa ensin tiedostoa `infra/main.parameters.json` (Cloud Shellin `code`-editorilla):

| Parametri | Arvo |
|---|---|
| `keyVaultAdminObjectId` | komennon `az ad signed-in-user show --query id -o tsv` tuloste |
| `entraClientId` | vaiheen 3 Application (client) ID |
| `entraTenantId` | vaiheen 3 rekisteröinnin **Directory (tenant) ID** (yrityksen Microsoft 365 -hakemisto) |
| `mailFrom` | lähettäjäosoite, esim. `SK Management <sk-management@skinfra.fi>` |
| `bootstrapOwnerEmail`, `bootstrapOwnerName` | ensimmäinen pääkäyttäjä: hänen Microsoft-tilinsä sähköposti ja nimi |
| `bootstrapCompanies` | yritykset muodossa `Nimi|tunnus|Y-tunnus;…`, esim. `SK Infra Oy|sk-infra|1234567-8;Purent Oy|purent` |

Aja sitten:
```bash
PG_ADMIN_PW=$(openssl rand -base64 30 | tr -d '/+=')
APP_DB_PW=$(openssl rand -base64 30 | tr -d '/+=')

az deployment group create -g $RG -f infra/main.bicep -p infra/main.parameters.json \
  -p webAppName=$APP pgAdminPassword="$PG_ADMIN_PW" appDbPassword="$APP_DB_PW" \
  --query properties.outputs -o json | tee outputs.json
```
Tuloste sisältää muun muassa `keyVaultName`, `postgresHost`, `acrName`, `deployClientId`, `tenantId` ja `subscriptionId`. Ne tarvitaan seuraavissa vaiheissa.

## 5. Salaisuudet Key Vaultiin
```bash
KV=$(jq -r .keyVaultName.value outputs.json)
az keyvault secret set --vault-name $KV --name auth-secret         --value "$(openssl rand -base64 32)" -o none
az keyvault secret set --vault-name $KV --name entra-client-secret --value "<vaiheen 3 client secret Value>" -o none
az keyvault secret set --vault-name $KV --name pg-admin-password   --value "$PG_ADMIN_PW" -o none   # talteen
```
Tietokannan yhteysosoite (`database-url`) syntyi Key Vaultiin jo vaiheessa 4.

## 6. Tietokannan alustus (kerran)
Komento luo sovelluksen tietokantakäyttäjän `sk_owner` ja rivitason tietoturvan roolin `sk_app`. Taulut syntyvät myöhemmin automaattisesti, kun sovellus käynnistyy.
```bash
PGHOST=$(jq -r .postgresHost.value outputs.json)
psql "host=$PGHOST dbname=postgres user=skadmin sslmode=require password=$PG_ADMIN_PW" \
  -v owner_password="$APP_DB_PW" -f infra/db-bootstrap.sql
```

## 7. GitHub-julkaisu
Tee GitHubissa (`Lerggu/SK-management` → Settings) seuraavat asetukset:
1. **Environments → New environment →** `production`. Halutessanne lisätkää *Required reviewers*, jolloin jokainen julkaisu hyväksytään erikseen.
2. **Secrets and variables → Actions → Variables** (Variables, ei Secrets). Lisää nämä muuttujat:

   | Muuttuja | Arvo (`outputs.json`) |
   |---|---|
   | `AZURE_CLIENT_ID` | `deployClientId` |
   | `AZURE_TENANT_ID` | `tenantId` |
   | `AZURE_SUBSCRIPTION_ID` | `subscriptionId` |
   | `AZURE_RESOURCE_GROUP` | `resourceGroup` |
   | `AZURE_ACR_NAME` | `acrName` |
   | `AZURE_WEBAPP_NAME` | `webAppName` |

3. Käynnistä ensimmäinen julkaisu: **Actions → Deploy (Azure) → Run workflow**. Työnkulku kääntää kontin, vie sen rekisteriin, käynnistää sovelluksen ja odottaa terveystarkistuksen (`/api/health`). Ensimmäinen ajo kestää noin 10 minuuttia.

Jatkossa julkaisu tapahtuu automaattisesti aina, kun muutos yhdistetään `main`-haaraan ja CI menee läpi.

## 8. Käyttöönotto
1. Avaa `https://<APP>.azurewebsites.net` ja kirjaudu pääkäyttäjänä painikkeella **Kirjaudu Microsoft-tilillä**.
2. Pääkäyttäjä kutsuu muut käyttäjät kohdassa **Asetukset → Käyttäjät** ja antaa heille roolit.
3. Kun sisäänkirjautuminen toimii, `BOOTSTRAP_*`-asetukset voi poistaa App Servicen asetuksista. Alustus ei tee mitään toista kertaa, joten poisto on vapaaehtoinen.

## 9. Valinnaiset lisäykset
- **Sähköposti** (ulkoisten käyttäjien kirjautumislinkit ja vakavien tapaturmien hälytykset). Vaihtoehtoja on kaksi:
  - **Microsoft 365:** luo jaettu postilaatikko tai lisenssöity tili ja salli sille *Authenticated SMTP*. Osoite on muotoa `smtp://tunnus%40yritys.fi:<salasana>@smtp.office365.com:587` (STARTTLS).
  - **Azure Communication Services Email**, jossa on SMTP-tunnistus.

  Tallenna osoite Key Vaultiin nimellä `smtp-url` ja aja vaihe 4 uudelleen parametrilla `-p enableSmtp=true`.
- **Tekoälyohjaaja:** luo API-avain osoitteessa console.anthropic.com → API Keys ja aseta sille kuukausiraja. Tallenna avain Key Vaultiin nimellä `anthropic-api-key` ja aja vaihe 4 uudelleen parametrilla `-p enableAi=true`.
- **Oma verkkotunnus**, esim. `sk.skinfra.fi`: App Service → Custom domains, ja maksuton hallittu varmenne. Päivitä silloin Entra-rekisteröinnin Redirect URI sekä `AUTH_URL`.

## 10. Ylläpito
| Asia | Miten |
|---|---|
| Varmuuskopiot | PostgreSQL palautettavissa mihin hetkeen tahansa 14 vrk ajalta (portaali → Restore); poistetut tiedostot palautettavissa 30 vrk |
| Lokit | App Service → Log stream / Diagnose and solve problems |
| Päivitykset | automaattisesti `main`-haarasta; migraatiot ajetaan sovelluksen käynnistyessä |
| Entra-salaisuuden uusinta | uusi client secret → `az keyvault secret set … entra-client-secret` → App Service → Restart |
| Kulut | Cost Management -budjetti ja hälytykset |

**Vianetsintä:** jos sovellus ei käynnisty, avaa App Service → Log stream. Yleisimmät syyt:
- Key Vaultista puuttuu salaisuus (`auth-secret` tai `entra-client-secret`);
- vaihe 6 on ajamatta;
- Redirect URI on kirjoitettu väärin.
