# ADR 0036 — Lift and resource order details

- Status: Accepted (owner request 2026-11-25)

## Context
A logistics request (ADR 0015/0026) is how site staff order a lift or another resource. The crane supplier and the site still had to agree several things by phone, because the request did not record them:
- the lift radius;
- the heaviest piece to be lifted;
- the lifting accessories;
- extra crew, such as riggers or a signaller;
- who is responsible on site and how to reach them.

## Decision
- New optional columns on `logistics_requests` (migration `20261127090000_lift_order_details`):
  - `lift_radius_m` numeric(5,1), CHECK > 0;
  - `lifting_accessories` text;
  - `rigger_count` int, CHECK 0–50;
  - `extra_crew` text;
  - `contact_name`, `contact_phone`, `contact_email` text.
- The heaviest piece is the existing `weight_kg`. Staffing rules and AI suggestions already use it as the heaviest load. The request form now labels it "Raskain kappale (kg)".
- "Päättyy" in the request form is shown as "Arvioitu lopetus" (estimated end). The detail view shows start, estimated end and duration.
- The responsible person defaults to the signed-in user's name and e-mail. The phone is typed in. On the detail page the phone and e-mail are `tel:` and `mailto:` links.
- The fields apply to every service type. The lift-specific rows are shown on a lift, or on any request where they are filled.
- The contact details are business contact data. They are not sent to any AI feature: staffing and risk prompts use only the service type, task type, times and weight.
- No new permissions: creating a request still needs `logistics.request`, and reading it `logistics.view`. Audit records the new fields with the request's `logistics_request.create` event.

## Consequences
- A lift order carries what the crane company needs to choose the crane and crew.
- Requests have no edit form yet. A request with a wrong detail is cancelled and created again, as before.
