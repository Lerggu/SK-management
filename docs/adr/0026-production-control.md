# ADR 0026 — Production control: task types, resource needs and staffing

- Status: Accepted (owner, 2026-11-17).
  - The owner asked for logistics and takt scheduling to work together:
    - define a logistics task, schedule it and staff it according to what it is (installation, unloading, heaviest load);
    - AI suggests resources (e.g. riggers and a lift supervisor for every lift);
    - a scalable calendar with draggable resources;
    - colour-coded statuses with blinking red deviations, reported from the phone.
  - The owner approved the four-phase plan and asked for takt and logistics to share one menu item under a better name.
  - This starts the deferred *AI Logistics Controller* (Build Master §27).
- Phases:
  1. task types and resource rules, rule-based candidates (this ADR);
  2. the calendar;
  3. deviations from the phone;
  4. AI suggestions and §27 risk detection (done).

## Decision

### Navigation: "Tuotannonohjaus" (Production control)
- Takt schedule and logistics are one menu item with tabs: takt schedule, look-ahead, logistics, resource bookings and task types.
- The routes `/takt` and `/logistics` stay, so links and permissions are unchanged. The menu item is active on either.
- Users with only one of the two see only their tabs.

### Task types (`logistics_task_types`, `logistics_task_roles`)
- **Catalogue:** a company catalogue maintained with `logistics.approve`, i.e. the logistics coordinator, site manager, project director and CEO. No new permission was added.
- **Task type:** a name, a logistics service type and a calendar colour (fixed palette).
- **Resource needs:** each need is one of:
  - a **person** in a role (label, quantity) with an optional required card (HR qualification type), competence area and minimum level, and trade;
  - **equipment** of a type.
- **Weight range:** a need can carry a weight range and then applies only when the task's heaviest load is in that range (e.g. "Raskaan noston valvoja ≥ 5000 kg"). With an unknown weight, minimum-weight needs do not apply and the task is flagged.
- **Suggested types:** Nosto, Kuorman purku, Asennustyö, Sisäinen siirto and Jätehuolto. Their competence requirements are linked to the HR catalogue by name. The lift type has: nostotyönjohtaja, 2 × taakankiinnittäjä, merkinantaja and nostoalueen valvoja.
- **Linking:** a logistics request (the task) has an optional `task_type_id`. A booking can name the task and the need it staffs (`logistics_request_id`, `task_role_id`; a CHECK requires the task when a need is named).

### Staffing (`staffingService`)
- **Needs:** derived from the task type and the heaviest load. Assigned resources are the task's active bookings for that need.
- **Readiness:** "ready" when every need is staffed.
- **Candidates:** the company's own active people and equipment, ranked by pure rules (`production/rules.ts`).
  - **Blocking, never left to AI:**
    - a person without a valid required card, or inactive;
    - equipment of the wrong type or out of service.
  - **Warnings:** competence not assessed or below the level, a different trade, an inspection due before the end, or booked at the same time.
- **Facts used:** validity follows the HR rules (ADR 0025); competence is the latest published supervisor assessment.
- **Assigning:** creates a V4 booking for the task's time. The existing conflict rules, auto-approval and cross-company decisions apply unchanged. A blocking issue refuses the assignment.
- **Visibility:**
  - members who can view logistics see the needs;
  - candidates are shown, and assignment is allowed, only with `booking.manage`;
  - external parties have no access.

### Phase 2: production calendar (`/logistics/calendar`, tab "Kalenteri")
- **Time axis:**
  - day (06–22 Helsinki time, hourly), week, 2 weeks or month;
  - weeks start on Monday, and the daylight-saving change is handled (`production/calendar.ts`, unit tested).
- **Two views:**
  - *tasks*: logistics tasks grouped by site;
  - *resources*: own people and equipment with their bookings.
- **Task bars:**
  - a colour by phase, always with a text label in the legend and the tooltip;
  - the task type's colour dot;
  - the number of missing resources.
- **Phases:** planned, resources missing (approved but not fully staffed), ready to start, in progress, complete, and late (the end has passed). Reported deviations (phase 3) blink red; with reduced motion they are a steady red.
- **Assigning from the calendar:**
  - drag a resource from the side panel onto a task (desktop), or tap a resource and then a task (phone);
  - with several open needs of the same kind, a dialog asks which role;
  - the assignment goes through `staffingService.assign`, so the same hard rules and booking conflicts apply.
- **Access:**
  - the resource panel is shown only to members with `booking.manage` in some visible project;
  - external members have no access.

### Phase 3: deviations from the phone (`/logistics/deviations`, tab "Poikkeamat")
- **New tables:** migration `20261117120000_production_deviations` adds `logistics_deviations` and `logistics_deviation_photos`.
  - Both have composite foreign keys and RLS.
  - Deviations are never deleted (trigger).
  - CHECK constraints keep status and timestamps consistent.
- **Reporting:** any internal member who sees the task's logistics (`logistics.view`) reports.
  - The phone flow: choose one of today's tasks, or "Ilmoita poikkeama" on the task page; choose the type with a big button (load late, resource missing, equipment broken, weather, safety, other); optionally take a photo with the camera and add a short comment.
  - Photos are images only, checked by content (the HR file check).
- **Notification:** the project's logistics approvers are e-mailed right after the report is saved; a mail failure never loses the report.
  - Recipients are resolved by capability (`logistics.approve`), never by role names.
  - The sender is not notified.
  - The notification is audited with its recipient and sent counts.
- **Handling:** logistics approvers acknowledge and resolve a deviation, with an optional resolution text.
- **In the calendar:** open and acknowledged deviations make the task blink red until resolved. With reduced motion it is a steady red.
- **Visibility:** deviations show on the task page and as an open list on the deviations tab. External members have no access.

### Phase 4: AI suggestions and §27 risks
- **Run log:** both features use the V8 AI run log (`ai_runs`), with the same provider adapter, the 10 €/month company cap, cost metering and the `ai.run` audit event.
  - Migration `20261117150000_production_ai` adds two run kinds, `STAFFING` and `LOGISTICS_RISK`, and `ai_runs.logistics_request_id` (composite foreign key).
  - The provider port now accepts a custom result schema. The deterministic test provider answers with a rule-based answer labelled `[TEST]`.
- **Permission:** `ai.use` is still required.
  - The logistics coordinator and site manager templates now get `ai.use` (owner request). The migration grants it to existing companies' roles and audits the grant.
  - The capability is checked, never the role name.
- **AI staffing suggestion (task page, "AI-ehdotus"):**
  - Requires `booking.manage` and `ai.use`.
  - The model gets a pseudonymised view of the task (`production/ai.ts`):
    - needs as N1…, with the required card, competence and equipment type by catalogue name;
    - candidates as C1…, with only their trade and rule warnings;
    - no names, asset numbers or ids.
  - Candidates blocked by the rules are never offered, and at most 12 candidates per need are sent.
  - The answer is validated: picks for unknown needs, candidates not offered for that need, duplicates, or picks over the open quantity are dropped and counted.
  - The calendar marks tasks with a suggestion ("AI").
- **Accepting a suggestion:** a person accepts it. Each pick that still applies is booked through `staffingService.assign`, so the hard rules and booking conflicts are checked again, and picks that no longer fit are skipped.
  - `assign` now also refuses booking a need beyond its quantity, or the same resource twice on one task.
  - Acceptance is audited (`ai.staffing.accept`).
- **§27 risks (tab "Riskit"):** rule-detected facts for the next 14 days. All internal members with `logistics.view` see them.
  - Facts covered:
    - resource shortage (critical when the task starts within 48 h);
    - unapproved tasks starting soon;
    - late tasks;
    - open deviations;
    - late or unconfirmed deliveries;
    - takt activities served by logistics at risk.
  - With `booking.manage`, also:
    - double bookings of own resources touching the project;
    - idle capacity (counted by trade, never named) when there is a shortage.
  - "Analysoi AI:lla" sends the same facts (task titles, times and counts, no names) to the AI. It returns facts, forecasts and recommendations, and people accept or dismiss each recommendation.
  - Nothing is rescheduled automatically.

## Consequences
- **Visible HR facts.** Candidates show only fit reasons ("Kortti puuttuu", "Osaaminen alle vaatimuksen"), never card details or assessment texts.
- **Own resources only.** Group-shared resources (V4) are not yet candidates. They can still be booked through the bookings page.
- **The rules stay the safety gate.** Phase 4 sends only structured needs and fit facts (without personal data) to the AI provider. Anything the AI proposes still passes the rules here when a person accepts it.
- **Production needs a key.** Without `SK_ANTHROPIC_API_KEY`, AI is unavailable in production; the rule-based facts, candidates and calendar work without it.
