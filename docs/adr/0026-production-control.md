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
  4. AI suggestions and §27 risk detection.

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

## Consequences
- **Visible HR facts.** Candidates show only fit reasons ("Kortti puuttuu", "Osaaminen alle vaatimuksen"), never card details or assessment texts.
- **Own resources only.** Group-shared resources (V4) are not yet candidates. They can still be booked through the bookings page.
- **The AI phase builds on this.** Phase 4 sends the same structured needs and fit facts (without personal data) to the AI provider. The rules here remain the safety gate for anything the AI proposes.
