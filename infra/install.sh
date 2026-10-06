#!/usr/bin/env bash
# SK Management – one-command Azure installation (ADR 0024, docs/DEPLOY_AZURE.md).
# Run in Azure Cloud Shell (Bash), signed in to the company's own directory:
#
#   bash infra/install.sh
#
# What it does (safe to re-run: existing resources and secrets are reused):
#   1. checks the signed-in account and registers the needed resource providers
#   2. creates the Microsoft Entra app registration for user sign-in + a client secret
#   3. creates all Azure resources from infra/main.bicep
#   4. stores the secrets in Key Vault (values are never printed)
#   5. prepares the database (sk_owner, sk_app, schema ownership)
#   6. prints the six GitHub repository variables for the deploy workflow
set -euo pipefail

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
ask() { local prompt=$1 default=$2 reply; read -r -p "$prompt [$default]: " reply; echo "${reply:-$default}"; }
retry() { local n=0; until "$@"; do n=$((n + 1)); [ $n -ge 12 ] && return 1; echo "  …odotetaan oikeuksien voimaantuloa ($n/12)"; sleep 15; done; }

cd "$(dirname "$0")/.."

# ── 1. Account check ─────────────────────────────────────────────────
say "Kirjautunut tili"
az account show --query "{kayttaja:user.name, tilaus:name, tenant:tenantId}" -o table
TENANT_ID=$(az account show --query tenantId -o tsv)
DOMAINS=$(az rest --method get --url "https://graph.microsoft.com/v1.0/organization" --query "value[0].verifiedDomains[].name" -o tsv | tr '\n' ' ')
echo "Hakemiston verkkotunnukset: $DOMAINS"
[ "$(ask 'Onko tämä SK-Infran hakemisto ja oikea tilaus? (k/e)' e)" = "k" ] || { echo "Keskeytetty. Vaihda tiliä/tilausta: az account set --subscription <nimi>"; exit 1; }

LOCATION=$(ask "Azure-alue" "swedencentral")
RG=$(ask "Resurssiryhmä" "rg-sk-management")
APP=$(ask "Sovelluksen nimi (osoite https://<nimi>.azurewebsites.net)" "skinfra-management")
OWNER_EMAIL=$(ask "Ensimmäisen pääkäyttäjän Microsoft-sähköposti" "$(az account show --query user.name -o tsv)")
OWNER_NAME=$(ask "Pääkäyttäjän nimi" "Markku Lehkonen")
ORG_NAME=$(ask "Konsernin nimi" "SK Group")
COMPANIES=$(ask "Yritykset (Nimi|tunnus|Y-tunnus;…)" "Sk-Infra Oy|sk-infra|2657617-1;Purent Oy|purent|3194746-7")
# A re-run keeps the sender set by infra/enable-email.sh.
CURRENT_FROM=$(az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='MAIL_FROM'].value | [0]" -o tsv 2>/dev/null || true)
MAIL_FROM=$(ask "Sähköpostin lähettäjä" "${CURRENT_FROM:-SK Management <$OWNER_EMAIL>}")
GITHUB_SUBJECT=$(ask "GitHub OIDC subject" "repo:Lerggu@284750201/SK-management@1393773590:environment:production")
URL="https://$APP.azurewebsites.net"
REDIRECT="$URL/api/auth/callback/microsoft-entra-id"

say "Rekisteröidään Azure-palveluntarjoajat (kerran tilausta kohden)"
for ns in Microsoft.Web Microsoft.DBforPostgreSQL Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.Storage Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait -o none && echo "  $ns ok"
done

say "Resurssiryhmä $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

# ── 2. Entra app registration ────────────────────────────────────────
say "Microsoft-kirjautumisen sovellusrekisteröinti"
APP_ID=$(az ad app list --display-name "SK Management" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "SK Management" --sign-in-audience AzureADMyOrg --web-redirect-uris "$REDIRECT" --query appId -o tsv)
  echo "  luotu: $APP_ID"
else
  az ad app update --id "$APP_ID" --web-redirect-uris "$REDIRECT"
  echo "  käytetään olemassa olevaa: $APP_ID"
fi
az ad sp show --id "$APP_ID" -o none 2>/dev/null || az ad sp create --id "$APP_ID" -o none
# Microsoft Graph User.Read (delegated) + organisation-wide consent.
az ad app permission add --id "$APP_ID" --api 00000003-0000-0000-c000-000000000000 --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope -o none 2>/dev/null || true
retry az ad app permission admin-consent --id "$APP_ID" -o none || echo "  (hyväksyntä ei onnistunut – käyttäjä hyväksyy ensimmäisellä kirjautumisella)"

# ── 3. Passwords (reuse from an earlier run) ─────────────────────────
KV=$(az keyvault list -g "$RG" --query "[0].name" -o tsv 2>/dev/null || true)
PG_ADMIN_PW=""; APP_DB_PW=""
if [ -n "$KV" ]; then
  PG_ADMIN_PW=$(az keyvault secret show --vault-name "$KV" --name pg-admin-password --query value -o tsv 2>/dev/null || true)
  APP_DB_PW=$(az keyvault secret show --vault-name "$KV" --name database-url --query value -o tsv 2>/dev/null | sed -E 's#^postgresql://sk_owner:([^@]+)@.*#\1#' || true)
fi
[ -n "$PG_ADMIN_PW" ] || PG_ADMIN_PW=$(openssl rand -base64 30 | tr -d '/+=')
[ -n "$APP_DB_PW" ] || APP_DB_PW=$(openssl rand -base64 30 | tr -d '/+=')
# Keep e-mail and AI switched on when their secrets already exist.
ENABLE_SMTP=false; ENABLE_AI=false
if [ -n "$KV" ]; then
  az keyvault secret show --vault-name "$KV" --name smtp-url -o none 2>/dev/null && ENABLE_SMTP=true
  az keyvault secret show --vault-name "$KV" --name anthropic-api-key -o none 2>/dev/null && ENABLE_AI=true
fi

# ── 4. Azure resources ───────────────────────────────────────────────
say "Luodaan Azure-resurssit (5–15 min)"
ADMIN_ID=$(az ad signed-in-user show --query id -o tsv)
az deployment group create -g "$RG" -n main -f infra/main.bicep \
  -p webAppName="$APP" keyVaultAdminObjectId="$ADMIN_ID" entraClientId="$APP_ID" entraTenantId="$TENANT_ID" \
     githubOidcSubject="$GITHUB_SUBJECT" mailFrom="$MAIL_FROM" enableSmtp="$ENABLE_SMTP" enableAi="$ENABLE_AI" \
     bootstrapOwnerEmail="$OWNER_EMAIL" bootstrapOwnerName="$OWNER_NAME" bootstrapOrgName="$ORG_NAME" \
     bootstrapOrgSlug="sk-group" bootstrapCompanies="$COMPANIES" \
     pgAdminPassword="$PG_ADMIN_PW" appDbPassword="$APP_DB_PW" \
  --query properties.outputs -o json > outputs.json
out() { jq -r ".$1.value" outputs.json; }
KV=$(out keyVaultName); PGHOST=$(out postgresHost)
echo "  valmis: $(out webAppUrl)"

# ── 5. Key Vault secrets (never printed) ─────────────────────────────
say "Salaisuudet Key Vaultiin ($KV)"
kv_set() { retry az keyvault secret set --vault-name "$KV" --name "$1" --value "$2" -o none; }
kv_set pg-admin-password "$PG_ADMIN_PW"
if ! az keyvault secret show --vault-name "$KV" --name auth-secret -o none 2>/dev/null; then kv_set auth-secret "$(openssl rand -base64 32)"; fi
kv_set entra-client-secret "$(az ad app credential reset --id "$APP_ID" --append --display-name "sk-management-$(date +%Y%m%d)" --years 2 --query password -o tsv)"
az keyvault secret list --vault-name "$KV" --query "[].name" -o tsv | sed 's/^/  /'

# ── 6. Database roles ────────────────────────────────────────────────
say "Tietokannan käyttäjät"
PSQL_ADMIN="host=$PGHOST user=skadmin sslmode=require password=$PG_ADMIN_PW"
if [ -z "$(psql "$PSQL_ADMIN dbname=postgres" -tAc "select 1 from pg_roles where rolname='sk_owner'")" ]; then
  psql "$PSQL_ADMIN dbname=postgres" -v ON_ERROR_STOP=1 -q \
    -c "CREATE ROLE sk_owner LOGIN PASSWORD '$APP_DB_PW'" \
    -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sk_app') THEN CREATE ROLE sk_app NOLOGIN; END IF; END\$\$" \
    -c "GRANT sk_app TO sk_owner WITH ADMIN OPTION" \
    -c "GRANT sk_owner TO CURRENT_USER"
  psql "$PSQL_ADMIN dbname=postgres" -q -c "CREATE DATABASE sk_management OWNER sk_owner" || true
  psql "$PSQL_ADMIN dbname=sk_management" -v ON_ERROR_STOP=1 -q -c "ALTER SCHEMA public OWNER TO sk_owner"
  psql "$PSQL_ADMIN dbname=postgres" -q -c "REVOKE sk_owner FROM CURRENT_USER"
  echo "  luotu: sk_owner, sk_app, sk_management"
else
  psql "$PSQL_ADMIN dbname=postgres" -v ON_ERROR_STOP=1 -q -c "ALTER ROLE sk_owner PASSWORD '$APP_DB_PW'"
  echo "  olemassa: sk_owner (salasana päivitetty)"
fi

# ── 7. GitHub variables ──────────────────────────────────────────────
say "Valmis. Lisää GitHubiin (Settings → Secrets and variables → Actions → Variables):"
echo "  AZURE_CLIENT_ID=$(out deployClientId)"
echo "  AZURE_TENANT_ID=$(out tenantId)"
echo "  AZURE_SUBSCRIPTION_ID=$(out subscriptionId)"
echo "  AZURE_RESOURCE_GROUP=$(out resourceGroup)"
echo "  AZURE_ACR_NAME=$(out acrName)"
echo "  AZURE_WEBAPP_NAME=$(out webAppName)"
echo
echo "Sitten: Actions → Deploy (Azure) → Run workflow (main). Sovellus: $URL"
