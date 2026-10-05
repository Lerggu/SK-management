// SK Management on Azure (ADR 0024, docs/DEPLOY_AZURE.md).
// Deploy into an empty resource group:
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.parameters.json \
//     -p pgAdminPassword=<...> appDbPassword=<...>
//
// Creates: App Service (Linux container) with a system-assigned identity,
// PostgreSQL 16 Flexible Server, Blob Storage (no shared keys), Container
// Registry, Key Vault (RBAC) and a user-assigned identity that GitHub Actions
// uses for deployments through OIDC (no stored credentials).

@description('Azure region. Sweden Central / North Europe; use a Finnish region if available to you.')
param location string = resourceGroup().location

@description('Short lowercase prefix for resource names.')
@maxLength(6)
param prefix string = 'skm'

@description('Web app name: the address becomes https://<name>.azurewebsites.net')
param webAppName string = '${prefix}-app-${uniqueString(resourceGroup().id)}'

@description('PostgreSQL server administrator login (used only for infra/db-bootstrap.sql).')
param pgAdminLogin string = 'skadmin'

@secure()
@description('PostgreSQL server administrator password.')
param pgAdminPassword string

@secure()
@description('Password of the application login sk_owner (the same value is given to infra/db-bootstrap.sql).')
param appDbPassword string

@description('Object id of the IT administrator who sets the Key Vault secrets.')
param keyVaultAdminObjectId string

@description('GitHub repository allowed to deploy, as owner/name.')
param githubRepository string = 'Lerggu/SK-management'

@description('Application (client) id of the Microsoft Entra app registration for user sign-in.')
param entraClientId string

@description('Directory (tenant) id of the Microsoft 365 organization whose users sign in. Defaults to the subscription\'s tenant.')
param entraTenantId string = tenant().tenantId

@description('Sender address of e-mails, e.g. "SK Management <sk-management@company.fi>".')
param mailFrom string = 'SK Management <no-reply@example.com>'

@description('Set to true once the Key Vault secret smtp-url exists.')
param enableSmtp bool = false

@description('Set to true once the Key Vault secret anthropic-api-key exists.')
param enableAi bool = false

@description('One-time bootstrap: group organization and first owner (see docs/DEPLOY_AZURE.md). Leave empty to skip.')
param bootstrapOwnerEmail string = ''
param bootstrapOwnerName string = ''
param bootstrapOrgName string = ''
param bootstrapOrgSlug string = ''
@description('"SK Infra Oy|sk-infra|1234567-8;Purent Oy|purent"')
param bootstrapCompanies string = ''

param appServiceSku string = 'B1'
param postgresSku string = 'Standard_B1ms'
param postgresTier string = 'Burstable'
param postgresStorageGb int = 32

var suffix = uniqueString(resourceGroup().id)
var dbName = 'sk_management'
var imageName = 'sk-management'

// Built-in role definition ids.
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  // Contributor, scoped to the registry only: lets the deploy identity push images.
  // (The AcrPush role id is not available in every subscription.)
  registryContributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
  blobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  kvSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  websiteContributor: 'de139f84-1756-47ae-9be6-808fbbe84772'
  reader: 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
}

// ── Container registry ───────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${prefix}acr${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

// ── Blob storage for documents and photos ────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${prefix}st${suffix}'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'documents'
  properties: { publicAccess: 'None' }
}

// ── PostgreSQL 16 ────────────────────────────────────────────────────
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${prefix}-pg-${suffix}'
  location: location
  sku: { name: postgresSku, tier: postgresTier }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: postgresStorageGb, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

// Only Azure-internal traffic (App Service, Cloud Shell); TLS is required by default.
resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// btree_gist is used by booking-overlap constraints (V4).
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'azure.extensions'
  properties: { value: 'BTREE_GIST', source: 'user-override' }
}

// ── Key Vault ────────────────────────────────────────────────────────
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${prefix}kv${suffix}'
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

resource dbUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: 'postgresql://sk_owner:${uriComponent(appDbPassword)}@${pg.properties.fullyQualifiedDomainName}:5432/${dbName}?sslmode=require'
  }
}

resource kvAdmin 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, keyVaultAdminObjectId, roles.kvSecretsOfficer)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsOfficer)
    principalId: keyVaultAdminObjectId
  }
}

// ── App Service ──────────────────────────────────────────────────────
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${prefix}-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}

var kvRef = 'VaultName=${kv.name};SecretName='
var baseSettings = [
  { name: 'WEBSITES_PORT', value: '8080' }
  { name: 'DATABASE_URL', value: '@Microsoft.KeyVault(${kvRef}database-url)' }
  { name: 'AUTH_SECRET', value: '@Microsoft.KeyVault(${kvRef}auth-secret)' }
  { name: 'AUTH_URL', value: 'https://${webAppName}.azurewebsites.net' }
  { name: 'AUTH_TRUST_HOST', value: 'true' }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: entraClientId }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', value: '@Microsoft.KeyVault(${kvRef}entra-client-secret)' }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_ISSUER', value: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0' }
  { name: 'STORAGE_PROVIDER', value: 'azure' }
  { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
  { name: 'AZURE_STORAGE_CONTAINER', value: documents.name }
  { name: 'MAIL_FROM', value: mailFrom }
  { name: 'BOOTSTRAP_OWNER_EMAIL', value: bootstrapOwnerEmail }
  { name: 'BOOTSTRAP_OWNER_NAME', value: bootstrapOwnerName }
  { name: 'BOOTSTRAP_ORG_NAME', value: bootstrapOrgName }
  { name: 'BOOTSTRAP_ORG_SLUG', value: bootstrapOrgSlug }
  { name: 'BOOTSTRAP_COMPANIES', value: bootstrapCompanies }
]
var smtpSettings = enableSmtp ? [{ name: 'SMTP_URL', value: '@Microsoft.KeyVault(${kvRef}smtp-url)' }] : []
var aiSettings = enableAi ? [{ name: 'SK_ANTHROPIC_API_KEY', value: '@Microsoft.KeyVault(${kvRef}anthropic-api-key)' }] : []

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      // Replaced by the deploy workflow with the image of each release.
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${imageName}:latest'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      healthCheckPath: '/api/health'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: concat(baseSettings, smtpSettings, aiSettings)
    }
  }
}

resource webAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, web.id, roles.acrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, web.id, roles.blobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.blobDataContributor)
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, web.id, roles.kvSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser)
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── GitHub Actions deployment identity (OIDC, no secrets) ────────────
resource deployer 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-deploy-${suffix}'
  location: location
}

resource deployerGithub 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployer
  name: 'github-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:production'
    audiences: ['api://AzureADTokenExchange']
  }
}

resource deployerRegistry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, deployer.id, roles.registryContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.registryContributor)
    principalId: deployer.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerWeb 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: web
  name: guid(web.id, deployer.id, roles.websiteContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.websiteContributor)
    principalId: deployer.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Lets `az login` in the workflow see the subscription; grants no write access.
resource deployerReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deployer.id, roles.reader)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.reader)
    principalId: deployer.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output webAppName string = web.name
output webAppUrl string = 'https://${web.properties.defaultHostName}'
output entraRedirectUri string = 'https://${web.properties.defaultHostName}/api/auth/callback/microsoft-entra-id'
output acrName string = acr.name
output keyVaultName string = kv.name
output postgresHost string = pg.properties.fullyQualifiedDomainName
output deployClientId string = deployer.properties.clientId
output tenantId string = tenant().tenantId
output subscriptionId string = subscription().subscriptionId
output resourceGroup string = resourceGroup().name
