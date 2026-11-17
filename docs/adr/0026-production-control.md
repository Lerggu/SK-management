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

## Consequences
- **Visible HR facts.** Candidates show only fit reasons ("Kortti puuttuu", "Osaaminen alle vaatimuksen"), never card details or assessment texts.
- **Own resources only.** Group-shared resources (V4) are not yet candidates. They can still be booked through the bookings page.
- **The AI phase builds on this.** Phase 4 sends the same structured needs and fit facts (without personal data) to the AI provider. The rules here remain the safety gate for anything the AI proposes.
