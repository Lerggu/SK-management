# ADR 0019 — Invoice candidates, file export, internal invoicing and forecast

- Status: Accepted (V6, owner decisions 1 and 2)

## Invoice candidates (acceptance 3)
`invoice_candidates` are billable lines generated only from approved data. Each one records its source, quantity, unit price, amount, period date and customer or bill-to company.

| Source | Basis |
|---|---|
| LABOR | Approved or payroll-exported hours × the employee's hourly BILLING rate on the day × work-class multiplier (V2) |
| EQUIPMENT | Equipment hours in signed site diaries × the equipment's hourly BILLING rate (actual use, as for V2 costs) |
| VARIATION | Variations ready to invoice, at their sales price |
| MILESTONE | Contract milestones due by the chosen date |
| INTERNAL_BOOKING | See internal invoicing below |

- **A line without a billing rate is reported as unpriced and not created.** A price is never guessed.
- **Nothing is billed twice.** The partial unique index `invoice_candidates_one_per_source` allows one non-void candidate per (company, source type, source).
  - A voided candidate frees its source, so it can be regenerated, for example after a rate correction.
- **The trigger `invoice_candidates_guard`:**
  - keeps the content immutable;
  - allows OPEN → EXPORTED | VOID and EXPORTED → INVOICED;
  - allows an explicit re-export to move the batch;
  - blocks deletes.
- **CHECK constraints:**
  - `amount = round(quantity × unit_price, 2)`;
  - internal candidates must have a bill-to company other than the owning company.

## File export (decision 1)
- An export batch (`invoice_export_batches`) stores the file itself, its SHA-256, the row count, the total and the currency. The table is append-only.
- **Formats**
  - **CSV:** UTF-8 with BOM, semicolon separator, decimal comma and CRLF line endings, so it opens directly in Finnish Excel.
  - **JSON:** batch metadata plus rows.
  - Every row carries the candidate id, source type and source id, so an accounting import can match and de-duplicate.
- **Export rules**
  - Open candidates are exported once.
  - Including already exported rows is an explicit re-export: flagged on the batch, and audited.
  - One currency per file.
- **Download** returns the stored bytes with `X-Content-SHA256`, private and no-store.
  - A member limited to some projects can download only batches made of those projects.
- **"Invoiced" is marked manually** with the invoice number from the accounting system.
- `AccountingExportAdapter` remains an interface in `platform/integrations` (§31). No accounting system is integrated in V6.

## Internal invoicing within the group (decision 2: the owner's billing rate)
- **What is billed:** approved V4/V5 bookings where another group company booked this company's employee or equipment.
- **Price:** booked hours × the owner company's hourly BILLING rate valid on the booking day.
- **Where it lives:** in the owner company, with `bill_to_company_id` set to the booking company and no project, because the project belongs to the other company.
- **What each company sees**
  - The booking company sees only the amount and its basis (`incomingInternal`), never the owner's cost rates.
  - The booking company cannot read the owner's export files.
- **Known simplification:** booked hours are the booking span, so a multi-day booking includes nights (as noted in V4).

## Forecast / EAC (Build Master §22, acceptance 4)
- **`cost_forecasts`** holds the estimate to complete (ETC) per cost category.
  - The table is append-only; the latest row per category counts, so earlier estimates stay as history.
- **Formulas** (`forecast()` in `commercial/rules.ts`, unit tested):

| Figure | Formula |
|---|---|
| EAC | actual cost (V2 project control) + Σ latest ETC |
| Budget variance | active budget − EAC |
| Forecast revenue | contract values + approved variations |
| Forecast margin € / % | forecast revenue − EAC, and its share of revenue |
| Invoiced | exported and invoiced candidates |
| Unbilled | open candidates |
| Remaining to bill | forecast revenue − invoiced − unbilled (not below 0) |

- Actual cost is shown only to members with `finance.view`. Without it, the forecast shows actual cost as 0 and says so.

## Permissions

| Permission | Purpose | Sensitive |
|---|---|---|
| `crm.view`, `crm.manage` | CRM | no |
| `commercial.view` | quotes, contracts, variations, forecast | yes |
| `commercial.manage` | prepare | yes |
| `commercial.approve` | approve quotes and variations | yes |
| `invoice.manage` | invoicing | yes |

- **Holders**
  - Project Director: all six.
  - CEO: all permissions.
  - Project Manager: all except `commercial.approve`.
  - Other templates: none.
- Sensitive permissions are stripped from external roles by `resolvePermissions`.
