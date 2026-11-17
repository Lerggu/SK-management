# ADR 0029 — Teams

- Status: Accepted (owner request, 2026-11-18): "lisää mahdollisuus luoda henkilöistä tiimejä".

## Decision
- **New table `teams`** (migration `20261118150000_teams`) with name, description, colour (fixed palette) and an optional leader (an employee).
  - Isolation: composite foreign keys and RLS.
  - Names: one active team per name in a company, case-insensitive. An archived team's name can be reused.
- **Membership:** one team per person, through `employees.team_id`.
  - Adding a person to a team moves them from their previous team.
  - The leader is always a member: setting a leader adds them.
  - Removing the leader clears the leader.
- **Cached name:** the earlier free-text `employees.team` stays as a cached copy of the team name, kept in sync by the team service (create, rename, move, archive). The HR search, competence matrix and lists keep filtering by name unchanged.
- **Migration of existing data:** existing free-text team names are converted into teams, matched case-insensitively, and the employees are linked to them.
- **Permissions (no new ones):**
  - viewing needs `employee.view` or `hr.view`;
  - managing needs `employee.manage` or `hr.manage`;
  - external members have no access.
- **Audit:** `team.create`, `team.update`, `team.archive`, `team.members_add` and `team.members_remove`.
- **User interface:**
  - *Henkilöstö → Tiimit*: create, edit and archive teams; add and remove members.
  - *Personnel card*: a team is chosen from the list, no longer typed.
  - *Rotation calendar* (ADR 0027): the side panel can be filtered by team, and a whole team can be dragged (or tapped, then a day tapped) into the calendar. The same period is then saved for every member.

## Consequences
- **Archiving a team leaves its members without a team.** History of earlier teams is in the audit log only.
- **A person belongs to one team at a time.** Overlapping crews would need a many-to-many model later.
