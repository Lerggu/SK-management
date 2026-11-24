# ADR 0033 — Order confirmations, invoices and credit notes

- Status: Accepted (owner request and decisions 2026-11-24)

## Context
The owner asked for a way to send an order confirmation or an invoice to a customer, or to any e-mail address, in the SK Infra style with the logo. A document must carry the product code, name, unit (kpl, m, h …), quantity, delivery time, unit price, total and the other usual details. On 2026-11-24 the owner supplied an order confirmation as the layout model and asked that rental terms or sales terms be attached depending on the deal.

Until now invoicing produced invoice candidates and file exports for the accounting system (ADR 0019), which gave the invoice numbers.

## Owner decisions (2026-11-24)
1. **SK Management numbers the invoices.** The accounting system receives copies; the two must not use the same series.
2. **Only SK Infra uses the feature.** It is switched on per company by setting up the billing details, so no company name is hard-coded.
3. **Layout** follows the supplied order confirmation model, with SK Infra's logo and colours.
4. **Terms:** rental terms or sales terms are attached per document. The terms are SK Infra's own; starting texts are provided and are to be reviewed by a lawyer.

## Decision

### Data
| Table | Purpose |
|---|---|
| `billing_settings` | Seller details, bank account, e-invoice address, domicile, logo, payment term, default VAT, the two number series, rental and sales terms. One row per company. |
| `sales_documents` | Order confirmation, invoice or credit note: buyer snapshot, delivery and reference fields, dates, VAT mode, chosen terms (copied, editable in the draft), and once issued the number, reference number, totals and the stored PDF (key, SHA-256, size). |
| `sales_document_lines` | Code, name, description, quantity, unit, unit price, discount %, VAT %, delivery time, amount. |
| `sales_document_sends` | Append-only log of every e-mail: recipient, copies, subject, time, sender. |

All four are company-scoped, under row-level security (ADR 0022), with composite foreign keys to customers, projects and the source document.

### Life cycle
- **Draft → Issued.** Issuing takes the next number of the series atomically (row lock on `billing_settings`), computes the totals, renders the PDF, stores it and locks the document. Drafts have no number, so an abandoned draft leaves no gap.
- **Series:** order confirmations have their own series; invoices and credit notes share one (partial unique indexes).
- **Sending** e-mails the stored PDF as an attachment (a draft is issued first). Re-sending sends the same bytes. Replies go to the sender and the billing e-mail. Every send is logged and audited.
- **Correcting:** an invoice is never voided or changed; it is corrected with a credit note (a copy with negated lines, which can be trimmed for a partial credit). An order confirmation can be voided with a reason.
- **Order → invoice** copies the buyer, references, delivery details and lines into a new invoice draft.

### Integrity in the database
- Trigger `sales_documents_guard`: an issued document is immutable except for the void decision and the send counters; documents are never deleted; a draft is archived, not voided.
- Trigger `sales_document_lines_guard`: lines change only while their document is a draft.
- Trigger `sales_document_sends_append_only`.
- CHECK constraints: an issued document has its number, totals and PDF; `amount = round(quantity × unit price × (1 − discount %), 2)`; gross = net + VAT; only order confirmations can be void; a credit note has a source; reasonable ranges.

### Calculation (`src/modules/sales/rules.ts`, unit tested)
- Line amount rounded to cents half-up; VAT per rate from the rounded sums; gross = net + VAT.
- Finnish VAT rates 25.5, 13.5, 10 and 0 %. **Reverse charge** for construction services (AVL 8 c §) charges no VAT, prints the statutory note and requires the buyer's business ID or VAT number.
- Finnish reference number (7-3-1 check digit) from the invoice number; bank **virtual barcode** version 4 (verified against the Finanssiala example).
- Business ID and IBAN check digits are validated in the settings.

### PDF (`src/platform/pdf/sales-document.ts`)
- pdf-lib with the standard Helvetica fonts; the SK Infra logo is drawn as vector paths (generated from `public/brand/sk-infra-logo-dark.svg`).
- Page header on every page: logo, title, number, date and page x/y. Billing and delivery address with the customer number on the left; delivery, payment and reference fields on the right; positioned lines with multi-line descriptions; VAT breakdown table; payment details on invoices; the chosen terms with bold numbered headings; four-column footer (address, e-invoice address or bank, contact details, VAT registration, domicile and business ID).
- Drafts carry a LUONNOS / DRAFT watermark. Finnish or English per document.

### Access
- `invoice.manage` (company-wide: CEO, Project Director, Project Manager) creates, issues and sends documents. External roles never hold it.
- `company.manage` changes the seller details, number series and terms.

### Mail
The mail adapter gained `cc` and `attachments` (SMTP via nodemailer). The development mailbox lists attachments by name and size.

## Known limitations
- No Finvoice e-invoice output yet; customers that require e-invoices receive the PDF by e-mail or the accounting system sends the e-invoice.
- Invoices are not yet generated from invoice candidates (ADR 0019); lines are typed or copied from an order confirmation.
- The PDF uses the standard fonts (WinAnsi); characters outside Latin-1 are replaced with "?".
- Payment tracking (paid/unpaid) stays in the accounting system.
