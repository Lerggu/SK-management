#!/usr/bin/env bash
# SK Management – turn on outbound e-mail with Azure Communication Services (ADR 0024).
# Run in Azure Cloud Shell (Bash) after infra/install.sh:
#
#   bash infra/enable-email.sh
#
# What it does (safe to re-run: existing resources are reused):
#   1. creates an Email Communication Service with an Azure-managed sender domain
#      (DoNotReply@<id>.azurecomm.net) and a Communication Service linked to it
#   2. creates an Entra app for SMTP authentication with the least role on that service
#   3. stores the SMTP address in Key Vault as `smtp-url` (never printed)
#   4. points the web app's SMTP_URL / MAIL_FROM at it and restarts the app
#   5. optionally sends a test message
# A company domain (e.g. skinfra.fi) can be added later: docs/DEPLOY_AZURE.md §9.
set -euo pipefail

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
ask() { local prompt=$1 default=$2 reply; read -r -p "$prompt [$default]: " reply; echo "${reply:-$default}"; }
retry() { local n=0; until "$@"; do n=$((n + 1)); [ $n -ge 12 ] && return 1; echo "  …odotetaan oikeuksien voimaantuloa ($n/12)"; sleep 15; done; }
urlenc() { jq -rn --arg v "$1" '$v|@uri'; }

RG=$(ask "Resurssiryhmä" "rg-sk-management")
APP=$(ask "Sovelluksen nimi" "skinfra-management")
KV=$(az keyvault list -g "$RG" --query "[0].name" -o tsv)
[ -n "$KV" ] || { echo "Key Vaultia ei löydy ryhmästä $RG – aja ensin infra/install.sh"; exit 1; }
TENANT_ID=$(az account show --query tenantId -o tsv)
ACS="$APP-acs"; ECS="$APP-email"

say "Valmistellaan (kerran tilausta kohden)"
az config set extension.use_dynamic_install=yes_without_prompt -o none 2>/dev/null || true
az extension add -n communication -y -o none 2>/dev/null || az extension update -n communication -o none 2>/dev/null || true
az provider register --namespace Microsoft.Communication --wait -o none && echo "  Microsoft.Communication ok"

# ── 1. Email service, sender domain, communication service ───────────
say "Sähköpostipalvelu $ECS"
az communication email show -n "$ECS" -g "$RG" -o none 2>/dev/null \
  || az communication email create -n "$ECS" -g "$RG" -l global --data-location Europe -o none
az communication email domain show -n AzureManagedDomain --email-service-name "$ECS" -g "$RG" -o none 2>/dev/null \
  || az communication email domain create -n AzureManagedDomain --email-service-name "$ECS" -g "$RG" -l global --domain-management AzureManaged -o none
DOMAIN_ID=$(az communication email domain show -n AzureManagedDomain --email-service-name "$ECS" -g "$RG" --query id -o tsv)
SENDER_DOMAIN=$(az communication email domain show -n AzureManagedDomain --email-service-name "$ECS" -g "$RG" --query mailFromSenderDomain -o tsv)
echo "  lähettäjä: DoNotReply@$SENDER_DOMAIN"

say "Viestintäpalvelu $ACS"
if az communication show -n "$ACS" -g "$RG" -o none 2>/dev/null; then
  az communication update -n "$ACS" -g "$RG" --linked-domains "$DOMAIN_ID" -o none
else
  az communication create -n "$ACS" -g "$RG" -l global --data-location Europe --linked-domains "$DOMAIN_ID" -o none
fi
ACS_ID=$(az communication show -n "$ACS" -g "$RG" --query id -o tsv)

# ── 2. SMTP identity ─────────────────────────────────────────────────
say "SMTP-tunnus"
SMTP_APP=$(az ad app list --display-name "SK Management SMTP" --query "[0].appId" -o tsv)
[ -n "$SMTP_APP" ] || SMTP_APP=$(az ad app create --display-name "SK Management SMTP" --sign-in-audience AzureADMyOrg --query appId -o tsv)
az ad sp show --id "$SMTP_APP" -o none 2>/dev/null || az ad sp create --id "$SMTP_APP" -o none
SP_ID=$(az ad sp show --id "$SMTP_APP" --query id -o tsv)
ROLE="Communication and Email Service Owner"
[ -n "$(az role definition list --name "$ROLE" --query "[0].id" -o tsv)" ] || ROLE="Contributor"
retry az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal \
  --role "$ROLE" --scope "$ACS_ID" -o none
SMTP_USER="$ACS-smtp"
az communication smtp-username show -g "$RG" --comm-service-name "$ACS" -n sk-management -o none 2>/dev/null \
  || retry az communication smtp-username create -g "$RG" --comm-service-name "$ACS" -n sk-management \
       --username "$SMTP_USER" --entra-application-id "$SMTP_APP" --tenant-id "$TENANT_ID" -o none
SMTP_USER=$(az communication smtp-username show -g "$RG" --comm-service-name "$ACS" -n sk-management --query username -o tsv)
SMTP_SECRET=$(az ad app credential reset --id "$SMTP_APP" --append --display-name "smtp-$(date +%Y%m%d)" --years 2 --query password -o tsv)
echo "  käyttäjä: $SMTP_USER"

# ── 3. Key Vault ─────────────────────────────────────────────────────
say "Salaisuus Key Vaultiin ($KV)"
retry az keyvault secret set --vault-name "$KV" --name smtp-url \
  --value "smtp://$(urlenc "$SMTP_USER"):$(urlenc "$SMTP_SECRET")@smtp.azurecomm.net:587" -o none
echo "  smtp-url tallennettu"

# ── 4. Web app settings ──────────────────────────────────────────────
MAIL_FROM="SK Management <DoNotReply@$SENDER_DOMAIN>"
say "Sovelluksen asetukset ($APP)"
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  "SMTP_URL=@Microsoft.KeyVault(VaultName=$KV;SecretName=smtp-url)" "MAIL_FROM=$MAIL_FROM"
az webapp restart -g "$RG" -n "$APP" -o none
echo "  SMTP_URL ja MAIL_FROM asetettu, sovellus käynnistetty uudelleen"

# ── 5. Test message ──────────────────────────────────────────────────
SEND_TEST='
import os, smtplib
from email.message import EmailMessage
m = EmailMessage()
m["From"], m["To"], m["Subject"] = "SK Management <" + os.environ["FROM"] + ">", os.environ["TO"], "SK Management: sähköposti toimii"
m.set_content("Tämä on SK Managementin testiviesti. Sähköpostin lähetys on nyt käytössä.")
with smtplib.SMTP("smtp.azurecomm.net", 587, timeout=30) as s:
    s.starttls()
    s.login(os.environ["SMTP_USER"], os.environ["SMTP_SECRET"])
    s.send_message(m)
'
TO=$(ask "Testiviestin vastaanottaja" "$(az account show --query user.name -o tsv)")
if [ "$(ask "Lähetetäänkö testiviesti osoitteeseen $TO? (k/e)" k)" = "k" ]; then
  say "Lähetetään testiviesti osoitteeseen $TO (oikeuksien voimaantulo voi kestää muutaman minuutin)"
  export SMTP_USER SMTP_SECRET TO FROM="DoNotReply@$SENDER_DOMAIN"
  retry python3 -c "$SEND_TEST"
  echo "  lähetetty – tarkista myös roskaposti"
fi

say "Valmis. Sähköposti on käytössä: $MAIL_FROM"
