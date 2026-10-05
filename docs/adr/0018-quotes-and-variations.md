# ADR 0018 — CRM, quotes and variations

- Status: Accepted (V6, owner decision 3)

## CRM
- **`customers`**
  - Company-owned, and the name is unique per company.
  - `contacts` holds personal data, so the audit records the contact's name only.
- **`opportunities`**
  - Stages: LEAD → QUALIFIED → RFQ → TENDER → NEGOTIATION → WON | LOST, with an estimated value and a probability.
  - LOST requires a reason.
  - The weighted pipeline = Σ value × probability over open stages (`weightedPipeline`, unit tested).
- **`projects.customer_id`** is new and nullable.
  - The old `customer_name` text stays, so the change is non-breaking.
  - A won quote or a new contract fills `customer_id` when it is empty.
- **CRM is a company-level register**, gated by `crm.view` and `crm.manage`.
  - Both permissions are company-only and cannot be granted through a project role.

## Quotes
- **`quotes`** carries a per-company number, TAR-<year>-<nnn>.
- **`quote_versions`** holds the scope, overhead %, risk reserve %, margin % and validity, with the status DRAFT → SUBMITTED → APPROVED | REJECTED and APPROVED → SENT → WON | LOST.
  - APPROVED or SENT → SUPERSEDED when a revision is approved.
- **`quote_lines`** by category: labour, equipment, lifting, transport, materials, travel, accommodation, subcontract, other.
- **Pricing** (`priceQuote`, Decimal, every value rounded to cents):
  - base = Σ round(quantity × unit cost);
  - overhead = round(base × overhead %);
  - risk = round((base + overhead) × risk %);
  - price = round(cost / (1 − margin %)), so margin % is the share of the price.
- **Never changed silently** (acceptance 1). The trigger `quote_versions_guard`:
  - freezes every content column once a version leaves DRAFT;
  - enforces the transitions;
  - makes REJECTED, WON, LOST and SUPERSEDED final;
  - blocks deletes.
  - `quote_lines_guard` allows line changes only while the version is a DRAFT.
  - Partial unique indexes allow one open version (draft or submitted) and one live version (approved, sent or won) per quote.
  - A change is a new version that copies the lines and records the reason.
- **Approval (decision 3: the Project Director)**
  - `commercial.approve` is held by the Project Director and, as in V3–V5, the CEO.
  - The Project Manager prepares quotes (`commercial.manage`) but cannot approve them.
  - The author or submitter can never approve: the service checks it, and the trigger rejects `decided_by` equal to `created_by` or `submitted_by`.
- **Winning a quote**
  - Creates a contract on the chosen project; value = the quote price, number SOP-… unless one is given.
  - Moves the opportunity to WON.

## Contracts
- `contracts` (value, signed date, retention note, ACTIVE | CLOSED) and `contract_milestones` (title, amount, due date).
- Milestones feed invoice candidates when they fall due.

## Variations (Build Master §21)
- **Lifecycle:** DRAFT → INTERNAL_REVIEW → SUBMITTED_TO_CLIENT → APPROVED | REJECTED → EXECUTED → READY_TO_INVOICE → INVOICED.
- **Pricing:** labour, equipment, materials, subcontract and other cost, with markup %.
  - Sales price = round(Σ cost × (1 + markup %)) (`priceVariation`). It is always recomputed, never typed in.
- **Pricing is frozen once review starts** (trigger `variations_guard`), and variations are never deleted.
- **Decision 3 applied to variations:** the Project Director approves internally (INTERNAL_REVIEW → SUBMITTED_TO_CLIENT). The creator or submitter cannot approve, which the trigger also enforces.
- **Client approval needs evidence:** a client reference or a linked document (§21 "approval evidence").
- **INVOICED** is set when the variation's invoice candidate is marked invoiced.
- **Approved-but-uninvoiced value** (APPROVED, EXECUTED or READY_TO_INVOICE) is shown on the sales overview and on the project page (acceptance 2).
