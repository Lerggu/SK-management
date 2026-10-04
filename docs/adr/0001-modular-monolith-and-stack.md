# ADR 0001 — Modular monolith and technology stack

- Status: Accepted (V1)
- Date: 2026-10-04

## Context
Build Master §2–3 and CLAUDE.md require a maintainable, boring stack with clear layers and no microservices in V1.

## Decision
- **Next.js 16 (App Router) + React 19 + TypeScript (strict)**, Tailwind CSS 4, **shadcn/ui** (Radix base) components in `src/ui/components`.
- **Prisma 6.19 + PostgreSQL 16.** Prisma 7 was available, but it changes client generation and requires driver adapters; 6.x is the well-documented, stable line. Upgrading is an isolated change in `src/platform/db`.
- **pnpm**, Node ≥ 20.9.
- Layers: `src/app` (UI, server actions, `/api/v1`) → `src/modules/<module>/service.ts` → `repo.ts` → `src/platform/db` (Prisma) → PostgreSQL.
- Cross-cutting concerns live in `src/platform` (auth, authz, audit, db, storage, errors, config, i18n, ratelimit, and the AI/integration interfaces).
- Boundaries are enforced by **dependency-cruiser** (`.dependency-cruiser.cjs`, run in CI):
  - `app/` must not import Prisma, `platform/db` or repositories;
  - domain modules must not import vendor SDKs, Next.js or React;
  - `platform/` must not import modules. The one exception is `platform/auth`, which may use `modules/identity` for sign-in eligibility and recording;
  - `src/ui` is presentation-only;
  - no circular dependencies.

## Consequences
- One deployable unit; domain modules can be extracted later if scale requires it.
- The UI uses server actions; `/api/v1` exposes the same services as JSON for integrations and tests.
