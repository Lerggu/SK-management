# V8 — AI & Optimization: plan

- Approved by the owner: 2026-10-05 ("saa aloittaa V8").
- Scope: Build Master §25 (AI architecture), §26 (AI Project Controller), §42 (V8), and CLAUDE.md tenant isolation rule 4 (RLS).
- Out of scope: the AI Logistics Controller (§27) and resource optimization. These follow in a later phase, as the owner chose to start with project control.

## Owner decisions (2026-10-05)
| # | Decision |
|---|---|
| 1 | PostgreSQL row-level security (RLS) is part of V8 and is done first. |
| 2 | The Claude API (Anthropic) is the AI service, and project data may be sent to it. The provider stays behind an adapter (§1.10). |
| 3 | AI cost cap: **10 € per month per company**. |
| 4 | Data limits accepted: no personal data, the model gets only data the requesting user may see, and AI use needs its own permission. |
| 5 | The first AI feature is **project control** (AI Project Controller). |

## Phase 1 — row-level security
- **Role.** The NOLOGIN role `sk_app` is created by migration. Company-scoped service calls run `SET LOCAL ROLE sk_app` and set `app.company_id` and `app.organization_id` in each transaction.
- **Policies.** Every table with `company_id` gets `tenant_isolation`. Documented group exceptions:
  - shared resources (employees, equipment, equipment types);
  - resource bookings and their context for the resource owner;
  - invoice candidates billed to the company;
  - audit events written for another group company.
- **Scope wrapper.** Every service in `SERVICE_REGISTRY` is wrapped, so a call with a company `RequestContext` runs in the tenant scope. A meta-test fails if a method is not wrapped.
- **Unscoped paths.** Identity paths (sign-in, membership resolution) and migrations run as the owner role.

## Phase 2 — AI Project Controller (§26)
- **Adapter.** A provider adapter in `platform/ai`:
  - the Anthropic implementation (`ANTHROPIC_API_KEY`);
  - a deterministic fake provider for tests and for environments without a key.
  - Domain modules depend only on the interface.
- **Controlled tools.** The model never queries the database. Each tool calls the existing services with the requesting user's `RequestContext`, so permissions, isolation and RLS apply:
  - project summary;
  - takt progress and blocked activities;
  - forecast/EAC, only with `commercial.view`;
  - variations, only with `commercial.view`;
  - HSE key figures;
  - look-ahead shortages.
- **No personal data.** Names, e-mails and injured-person data are never sent; tools return codes, counts and amounts.
- **Answers.** Answers are structured items marked **FACT**, **FORECAST** or **AI_RECOMMENDATION**, each with evidence references to the records it is based on.
- **Storage (`ai_runs`).** Every run is stored: user, company, project scope, provider, model, prompt template version, tool calls, structured result, tokens and cost (€).
- **Recommendations** are advisory. A person accepts or dismisses each one (audited); nothing is changed automatically.
- **Cost cap.** Before a run the month's spend is checked against the 10 € cap, which is configurable per company. Over the cap, AI is unavailable for the rest of the month and the user is told.
- **Permission.** `ai.use` is granted to CEO, Project Director and Project Manager, and never to external roles.
- **UI.** A "Tilannekuva (AI)" panel on the project page:
  - generate a project review;
  - ask a question in natural language about the project;
  - accept or dismiss recommendations;
  - run history and the month's cost.

## Acceptance criteria (proposed)
1. With RLS active, a query without a company condition returns only the scoped company's rows, and writing another company's row fails.
2. All V1–V7 tests pass with RLS on.
3. The AI only sees data the requesting user is permitted to see (tests compare tool output across roles), and no personal data is sent.
4. Every AI run is stored with model, template version, tools used, result, tokens and cost.
5. Answers distinguish FACT, FORECAST and AI_RECOMMENDATION, with evidence.
6. Recommendations require human acceptance; the AI changes no data.
7. The monthly cost cap blocks further runs.
8. The feature works without a key (fake provider); with a key, one live verification run is recorded.
