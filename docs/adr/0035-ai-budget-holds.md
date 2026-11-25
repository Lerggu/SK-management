# ADR 0035 — Serialized AI budget holds

- Status: Accepted (2026-11-25; fixes limitation 2 of the V8 report §5, within the approved V8 scope)

## Context
Every AI feature checks the company's monthly cap before calling the provider. The shared AI cap is `companies.ai_monthly_budget_eur` (default 10 €), used by the project controller, the assistant, staffing suggestions and §27 risks. Marketing has its own budget (ADR 0032). A run's cost is known only when it ends. So several runs started at the same moment all saw the same remaining budget, and together they could exceed the cap.

## Decision
- A new table `ai_budget_holds` (migration `20261126090000_ai_budget_holds`) has the columns company, pool (`AI` or `MARKETING`), amount and expiry. It has row-level security like every company table.
- Before calling the provider, a run reserves budget in one transaction:
  1. take `pg_advisory_xact_lock` on the key `ai-budget:<pool>:<company>`;
  2. remove expired holds;
  3. compute free = cap − recorded costs this month − live holds;
  4. if free is below the minimum (0.10 € for AI, 0.50 € for marketing), store a `BLOCKED_BUDGET` run as before; otherwise insert a hold of min(0.30 €, free).
- The hold is removed after the run's real cost has been recorded, whether the run succeeded or failed. While both exist, the run is counted twice, which is the safe direction.
- A hold expires after 15 minutes. A crashed process therefore never blocks the budget permanently.
- The helper `withBudgetHold` (`src/modules/ai/budget.ts`) wraps every AI call site. `withAiBudget` is the shared-cap version.

## Consequences
- Concurrent runs can no longer all pass the check. With 0.40 € left, two runs start and the third is blocked (`tests/integration/ai-budget.test.ts`).
- One run can still cost more than its 0.30 € hold. The cap is exceeded by at most the difference between a single run's cost and its hold, not by the number of concurrent runs.
- The budget shown in the UI is the recorded cost. Holds are short-lived and not shown.
- No new permissions, audit actions or UI strings.
