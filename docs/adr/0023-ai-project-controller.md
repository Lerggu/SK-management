# ADR 0023 — AI architecture and the AI Project Controller

- Status: Accepted (V8, owner decisions 2–5).
- Related: Build Master §25 (AI architecture), §26 (AI Project Controller); ADR 0022 (RLS).

## Context
The owner made four decisions:
- the Claude API is the AI service, and project data may be sent to it;
- the cost cap is 10 € per month per company;
- no personal data is sent, the model sees only what the requesting user may see, and AI use needs its own permission;
- the first AI feature is project control.

The Build Master requires the following:
- the system stays provider-independent (§1.10);
- every run is stored;
- results distinguish facts, forecasts and recommendations;
- operational changes always need human approval.

## Decision

### Provider port (`src/platform/ai`)
- **Port.** `AiProvider.run({ system, prompt, tools, executeTool, maxToolRounds })` returns `{ provider, model, result, toolCalls, usage }`. Domain modules depend only on these types; dependency-cruiser keeps vendor SDKs out of `src/modules`.
- **`AnthropicProvider`** (`@anthropic-ai/sdk`) is selected when `ANTHROPIC_API_KEY` is set:
  - **Model and thinking:** `claude-opus-5-5` with adaptive thinking, and `output_config.effort: "medium"` set explicitly.
  - **Requests:** streamed and collected with `finalMessage()`, so long requests do not time out.
  - **Tool loop:** a manual loop over strict tools (`strict: true`). The final answer comes through a `submit_result` tool whose schema is `AI_INSIGHT_SCHEMA`. `tool_choice` is `auto` because forced tool choice is not supported with adaptive thinking; the prompt instructs the model to submit, and the adapter nudges once if it does not.
  - **Prompt caching:** top-level `cache_control`.
  - **Server-side model fallback:** enabled with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so an overloaded primary model does not fail the run. The model that actually answered is stored in the run.
  - **Stop reasons:** `refusal` and `max_tokens` become provider errors; `pause_turn` is resumed.
  - **Tool results:** truncated to 40 000 characters.
  - **Cost:** estimated from list prices; unknown (fallback) models are priced as Opus, the conservative choice.
- **`FakeAiProvider`** is deterministic. It calls every offered tool once and builds a fixed-shape answer.
  - It is used when no key is set (outside production), in all tests (forced in `tests/helpers/setup.ts`), in E2E (`AI_PROVIDER=fake`), and for the seed's example run.
  - In production without a key, AI is unavailable.
- **Key storage.** The key is read from the environment only: never from files in the repository or from the database.

### Module `src/modules/ai`
- **Controlled tools.** The model never queries the database. Each tool calls an existing domain service with the requesting user's own `RequestContext`, so permissions, tenant isolation and RLS apply unchanged. A tool is offered only if the user holds its permission.

  | Tool | Permission | Source |
  |---|---|---|
  | `project_overview` | project.view | projectService.get |
  | `schedule_status` | takt.view | scheduleSummaryService + blocked/delayed activities, open constraints |
  | `lookahead_shortages` | takt.view | lookaheadService (6 weeks) |
  | `cost_forecast` | commercial.view | forecastService.get |
  | `variations` | commercial.view | variationService.list |
  | `hse_metrics` | hse.view | hseOverviewService.metrics |

- **No personal data.** Output mappers select explicit fields: codes, names of activities and resources (trades and equipment types), statuses, dates, amounts and counts. They never include person names, e-mails, user ids or rates; HSE data is aggregate only. A test asserts that the provider never receives the user's or an employee's name, e-mail or id.
- **Answer.** `{ summary, items[] }`. Each item has:
  - `kind`: FACT / FORECAST / AI_RECOMMENDATION;
  - `severity`: INFO / WARNING / CRITICAL;
  - `title`, `detail`;
  - `evidence`: the names of the tools whose output supports it.

  The answer is validated with Zod as untrusted output; evidence is reduced to tools that actually returned data in the run. Answers follow the user's UI language.
- **Prompt injection.** The system prompt states that tool results are data, not instructions. Tools are read-only, and the model has no write capability at all.
- **Storage.**
  - `ai_runs` is append-only (database trigger). Each row records user, project, kind (REVIEW/QUESTION), question, locale, provider, model, prompt version (`project-controller/1`), tool calls, result, tokens, cost in € (`numeric(14,6)`, a usage metric so that sub-cent runs add up exactly) and status (SUCCEEDED / FAILED / BLOCKED_BUDGET).
  - AI_RECOMMENDATION items also become `ai_recommendations` rows, PROPOSED until a person accepts or dismisses them once.
  - Both tables have the RLS `tenant_isolation` policy and composite foreign keys.
- **Cost cap.**
  - `companies.ai_monthly_budget_eur` defaults to 10 € and can be changed by users with `company.manage`; changes are audited.
  - Before a run, the spend for the current calendar month (Helsinki time) is summed. A run is started only if at least 0.10 € remains; otherwise a BLOCKED_BUDGET run is stored and nothing is sent.
  - USD is converted to € with `AI_EUR_PER_USD` (default 0.92).
  - A single run is bounded by six tool rounds and 16k output tokens, so it can overshoot the remaining amount only slightly.
- **Permission.**
  - `ai.use` is sensitive, so it is never granted to external roles.
  - It is granted to CEO, Project Director and Project Manager.
  - A migration grants it to existing companies' template roles and writes an audit event.
- **Audit.** The following are audited:
  - `ai.run` (status, model, cost, tools, number of recommendations);
  - `ai.recommendation.accept` and `ai.recommendation.dismiss`;
  - `company.ai_budget.update`.

## Consequences
- **Data seen by the model.** The AI sees exactly what the user's services return, so a role-specific view is guaranteed by the same code paths as the UI.
- **Tests cost nothing.** Tests and CI never call the network.
- **Live verification.** `pnpm ai:verify` runs one real review once a key is configured in the environment.
- **Concurrency.** The cap check is not serialized, so two simultaneous runs could both pass a nearly exhausted cap. This is accepted: the excess is bounded by one run, about 0.1–0.3 €.
- **Deferred.** The AI Logistics Controller (§27) and resource optimization will reuse the port, storage and recommendation flow.
