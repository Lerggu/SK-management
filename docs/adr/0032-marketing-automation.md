# ADR 0032 — Marketing automation: discovery agent, letter agent, call list

Status: accepted (owner request and decisions 2026-11-17)

## Context
The owner wants an automatic marketing and sales system for SK Infra.
- **Goal:** more sales and a better-known brand.
- **What we sell:**
  - electrical and other infrastructure construction (incl. 110 kV feeds);
  - site logistics management;
  - personnel and equipment;
  - large site packages delivered with partners.
- **Requested agents:**
  - one agent continuously finds data centre, industrial and 110 kV grid projects in Europe and fills a marketing register (where, when, who is responsible for what, budget, phase);
  - a second agent prepares targeted letters, and later calls, to the contact people.
- **Replies:** replies to the letters go directly to Janne and Markku.

## Owner decisions (2026-11-17)
1. **Approval first.** Letters are drafted automatically, but a person (`marketing.approve`) approves each one before it is sent. Automatic sending is a setting (`auto_send`, default off) that the owner can switch on once the quality has been verified.
2. **Calls are a call list, not robocalls.** Automated marketing calls to natural persons need prior consent (ePrivacy Directive art. 13; Finnish Act on Electronic Communications Services §200). The agent therefore prepares a project-specific call script and a call list. The salesperson calls with one tap and records the outcome.
3. **Sources:**
   - **EU public procurement (TED):** official search API.
   - **AI web search:** news, press releases, zoning and environmental permits, company pages.
   - **Finnish public procurement (Hilma):** the domain `hankintailmoitukset.fi`.
   - **Transmission system operators:** Fingrid and the Nordic and Baltic TSOs.
   - **Other similar sources.**

## Decision

### Module
`src/modules/marketing`, with these permissions (company-wide only):
- `marketing.view`;
- `marketing.manage`: settings, running the agents, editing the register and contacts;
- `marketing.approve`: approving and sending letters, and the call list.

**Access (owner decision 2026-11-18):** only the CEO and Project Manager templates get these permissions. They cannot be granted to other roles (including custom roles) or as personal extra permissions; the services enforce this when permissions are changed.

### Register
- **Tables:** `marketing_leads` (one project), `marketing_lead_sources` (every finding with its URL), `marketing_contacts`, `marketing_messages` (letter, call script, call outcome), `marketing_suppressions` (opt-out list), `marketing_runs` (every agent run with its AI cost) and `marketing_settings`.
- **Tenant isolation:** composite foreign keys and RLS, like every other table.
- **Duplicates:** a normalised `dedupe_key` (country + owner + title words) merges the same project found in several sources, and a source finding is stored once (`company, kind, external_id`).

### Discovery agent (scheduled, default every 24 h, off until enabled)
- **TED:**
  - The official `api.ted.europa.eu/v3/notices/search` API (anonymous).
  - Filtered by CPV codes for electrical installation, power lines, power plants and industrial buildings, the chosen countries, and contract or prior-information notices since the last run.
  - Notices are mapped deterministically: title, buyer, place, deadline, estimated value, buyer phone and link.
  - An AI batch scores fit (0–100), category and fitting services without web search.
- **Web search:**
  - One AI run per focus: data centres, industrial projects, 110 kV and grid projects (TSO domains), and Finnish procurement (`hankintailmoitukset.fi`).
  - Uses the Claude web search server tool, with a cap on searches per run.
  - The model must return a source URL for every project and contact. Results without a URL are dropped, so nothing is invented.
- **Merging:** results are merged into the register. A lead that is seen again updates `last_seen_at` and fills only empty fields; a person's edits are never overwritten.

### Letter agent
- **When:** for each lead at or above `min_score` that has a contact with an e-mail address and no letter yet.
- **What:** the AI drafts a letter and a call script in the contact's language (Finnish, Swedish or English by country).
  - The letter is aimed at the project: phase, scope, and why our services fit.
  - It contains only facts from the register and the company pitch in the settings.
- **Sending:**
  - After approval, or automatically when `auto_send` is on, mail goes through the platform mailer.
  - `Reply-To` is set to the members chosen in the settings (Janne and Markku), so replies reach them directly.
  - Every letter has a `List-Unsubscribe` header and a link to `/unsubscribe/<token>`. Unsubscribing suppresses the address for the company, and the agents never contact it again.
  - A daily send limit applies.

### Personal data (GDPR)
- **What is stored:** contacts are business contact data from public sources, and `source_url` records where each one was found. The legal basis is legitimate interest (B2B marketing relevant to the person's role).
- **Opt-out and deletion:** opt-out is honoured permanently, and contacts can be archived.
- **What goes to the AI:** the AI processes this public business data only, never internal personal data (employees, identity codes or rates). This is an owner-approved exception like the assistant (ADR 0031).
- **Audit:** every approval, send, opt-out and setting change is audited.

### Cost
- **Separate budget:** marketing agents have their own monthly AI budget in the settings (default 40 €), separate from the 10 € project controller cap, because web search is billed per search.
- **Enforcement:** a run is blocked once the month's runs have used the budget.

## Consequences
- **Opt-in for calls:** automated AI voice calls need a separate owner decision and prior consent from each person.
- **Hilma and TSO data:** these come through web search restricted to their domains, because there is no official open API integration in this release. A Hilma API key can be added later without changing the register.
- **Reply tracking:** replies go to people's mailboxes and are not read by the system. Salespeople mark a lead `REPLIED` or `INTERESTED`. An interested lead converts to a CRM opportunity in one step.
