# V6 — Commercial: plan

- Approved by the owner: 2026-10-05 ("saa aloittaa V6"; decisions below, recommendations accepted)

- Scope: Build Master §21 (variations), §22 (financial project control), §31 (integration adapters), §40 (V6). Functional master: CRM & Sales (pipeline), quote calculation, and "V6: quotes, variations and invoicing data".
- Out of scope:
  - statutory accounting (§22);
  - real ERP/accounting integrations (interfaces only);
  - portals and HSE (V7);
  - AI suggestions (V8).

## Build (§40)
CRM, opportunities, quotes and quote versions, contracts, variations, invoice candidates, financial forecasting/EAC, and integration export interfaces.

Proposed acceptance criteria:
1. A quote version that has been sent or approved cannot be changed silently. A change is a new version.
2. A variation follows the §21 lifecycle. Approved-but-uninvoiced value is visible on the dashboard.
3. Invoice candidates come only from approved data (hours, equipment time, variations, milestones), and every line is traceable to its source.
4. Forecast and EAC use centralized, tested formulas.
5. Billing data is exported as files. Each export is audited and repeatable.

## Owner decisions (2026-10-05)
| # | Decision |
|---|---|
| 1 | Invoicing data is exported **as files**: no accounting/ERP integration in V6, only the adapter interface (§31). |
| 2 | Internal invoicing within the group uses the **owning company's billing rate**. |
| 3 | Quotes and variations are approved by the **Project Director**. |

## Proposed details (recommendations)
- **File export (decision 1)**
  - Formats: CSV (UTF-8, semicolon separator and decimal comma for Finnish Excel) and JSON. Every row carries the source id.
  - Each export is an immutable batch with SHA-256, following the V2 payroll export pattern. A row is exported once; re-exporting needs an explicit "include already exported" choice and is audited.
  - An `AccountingExportAdapter` interface is defined, with no implementation and no fabricated integration.
- **Internal invoicing (decision 2)**
  - Approved cross-company bookings (V4/V5) become internal invoice candidates from the **owning company** to the **booking company**.
  - Price: the owner's BILLING rate valid on the booking day × booked hours.
  - Ownership, costs and billing stay company-specific. The booking company sees only the amount and its basis, never the owner's cost rates.
- **Approval (decision 3)**
  - New permission `commercial.approve`, held by the Project Director and the CEO (as in V3–V5, the CEO holds every permission so approval never stalls).
  - The Project Manager prepares quotes and variations (`commercial.manage`) but cannot approve.
  - No euro threshold, because none was decided; it can be added later as configuration.
  - The person who prepared a version cannot approve it, following the V5 lift plan pattern.
- **CRM**
  - `customers` and `contacts` belong to a company, with fictional seed data only.
  - Opportunities: Lead → Qualified → RFQ → Tender → Negotiation → Won / Lost.
  - Projects get a nullable `customer_id`; the existing customer name text stays (non-breaking).
- **Quotes**
  - Quote lines by category: labour, equipment, lifts, transport, materials, travel, accommodation, subcontract, overheads, risk reserve and margin.
  - Versions: DRAFT → SUBMITTED → APPROVED → SENT → WON / LOST. Approved and later versions are locked by a DB trigger.
  - A won quote becomes a contract, and can seed a V2 budget version.
- **Contracts and variations**
  - Contract value, payment milestones and retention as text.
  - Variations follow the §21 lifecycle, tracking cause, client reference, documents, cost and sales price.
- **Invoice candidates**
  - Sources: approved hours (V2) and equipment bookings (V4/V5) priced with the V1 billing rates, executed variations and contract milestones.
  - Status: OPEN → EXPORTED → INVOICED (marked manually), with a link to the export batch.
- **Forecast/EAC**
  - Extends `finance/calculations.ts`: committed, actual, forecast cost, forecast revenue, invoiced, unbilled, margin € / %, and EAC.
  - All formulas are unit tested.
- **Permissions (migration)**
  - `crm.view`, `crm.manage`, `commercial.view`, `commercial.manage`, `commercial.approve`, `invoice.manage`.
  - Implementation note: forecasts are covered by `commercial.view`, so no separate `forecast.view` was added.
  - Prices, margins and costs are sensitive: Client and Subcontractor never receive them.

## Migration impact
- New tables, plus a nullable `customer_id` on projects.
- New permissions are granted to existing template roles by migration, with an audit event per company.
- V1–V5 tables are not changed in a breaking way.
