import { readClient, runInTransaction, isUniqueViolation } from "@/platform/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/platform/errors";
import { writeAudit } from "@/platform/audit";
import { parseInput } from "@/platform/http/validation";
import { hasPermission, type RequestContext } from "@/platform/authz";
import { TeamRepo } from "./team.repo";
import { memberSchema, teamSchema, type MemberInput, type TeamInput } from "./team.schemas";

function requireView(ctx: RequestContext) {
  if (ctx.external) throw new ForbiddenError("External members have no workforce access");
  if (!hasPermission(ctx, "employee.view") && !hasPermission(ctx, "hr.view")) throw new ForbiddenError("Missing permission employee.view");
}

/** Teams are managed by those who manage employees or HR. */
export function canManageTeams(ctx: RequestContext) {
  return !ctx.external && (hasPermission(ctx, "employee.manage") || hasPermission(ctx, "hr.manage"));
}

function requireManage(ctx: RequestContext) {
  if (!canManageTeams(ctx)) throw new ForbiddenError("Missing permission employee.manage");
}

const nameTaken = (e: unknown): never => {
  if (isUniqueViolation(e)) throw new ValidationError({ name: ["validation.nameTaken"] });
  throw e;
};

async function teamOr404(repo: TeamRepo, id: string) {
  const t = await repo.find(id);
  if (!t || t.archivedAt) throw new NotFoundError();
  return t;
}

async function validLeader(repo: TeamRepo, leaderId: string | null) {
  if (!leaderId) return null;
  const [e] = await repo.findEmployees([leaderId]);
  if (!e) throw new ValidationError({ leaderId: ["validation.invalidOption"] });
  return e;
}

/**
 * Teams of employees (docs/adr/0029-teams.md): one team per person, with a
 * leader. The employee's `team` text is a cached copy of the team name, kept
 * in sync here, so HR filters and lists keep working.
 */
export const teamService = {
  async list(ctx: RequestContext) {
    requireView(ctx);
    const teams = await new TeamRepo(readClient(), ctx.company.id).list();
    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        color: t.color,
        leader: t.leader ? { id: t.leader.id, name: `${t.leader.lastName} ${t.leader.firstName}` } : null,
        members: t.members.map((m) => ({ id: m.id, name: `${m.lastName} ${m.firstName}`, trade: m.trade, active: m.status === "ACTIVE" })),
      })),
      canManage: canManageTeams(ctx),
    };
  },

  async create(ctx: RequestContext, input: TeamInput) {
    requireManage(ctx);
    const data = parseInput(teamSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TeamRepo(tx, ctx.company.id);
      const leader = await validLeader(repo, data.leaderId);
      const team = await repo.create({ ...data, createdById: ctx.user.id, updatedById: ctx.user.id }).catch(nameTaken);
      // The leader belongs to the team.
      if (leader) await repo.setTeam([leader.id], team, ctx.user.id);
      await writeAudit(tx, ctx, { action: "team.create", entityType: "team", entityId: team.id, after: { name: team.name, leaderId: team.leaderId, color: team.color } });
      return { id: team.id };
    });
  },

  async update(ctx: RequestContext, teamId: string, input: TeamInput) {
    requireManage(ctx);
    const data = parseInput(teamSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TeamRepo(tx, ctx.company.id);
      const before = await teamOr404(repo, teamId);
      const leader = await validLeader(repo, data.leaderId);
      const after = await repo.update(before.id, { ...data, updatedById: ctx.user.id }).catch(nameTaken);
      if (after.name !== before.name) await repo.renameMembers(after.id, after.name);
      if (leader && leader.teamId !== after.id) await repo.setTeam([leader.id], after, ctx.user.id);
      await writeAudit(tx, ctx, { action: "team.update", entityType: "team", entityId: after.id, before: { name: before.name, leaderId: before.leaderId, color: before.color, description: before.description }, after: { name: after.name, leaderId: after.leaderId, color: after.color, description: after.description } });
      return { id: after.id };
    });
  },

  /** Archives the team; its members become team-less. */
  async archive(ctx: RequestContext, teamId: string) {
    requireManage(ctx);
    return runInTransaction(async (tx) => {
      const repo = new TeamRepo(tx, ctx.company.id);
      const team = await teamOr404(repo, teamId);
      const { count } = await repo.clearMembers(team.id, ctx.user.id);
      await repo.update(team.id, { archivedAt: new Date(), leaderId: null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "team.archive", entityType: "team", entityId: team.id, after: { name: team.name, membersReleased: count } });
      return { id: team.id };
    });
  },

  /** Adds people to the team (moving them from their previous team). */
  async addMembers(ctx: RequestContext, teamId: string, input: MemberInput) {
    requireManage(ctx);
    const { employeeIds } = parseInput(memberSchema, input);
    return runInTransaction(async (tx) => {
      const repo = new TeamRepo(tx, ctx.company.id);
      const team = await teamOr404(repo, teamId);
      const ids = [...new Set(employeeIds)];
      const found = await repo.findEmployees(ids);
      if (found.length !== ids.length) throw new ValidationError({ employeeIds: ["validation.invalidOption"] });
      await repo.setTeam(ids, team, ctx.user.id);
      await writeAudit(tx, ctx, { action: "team.members_add", entityType: "team", entityId: team.id, after: { employeeIds: ids, movedFrom: [...new Set(found.map((f) => f.teamId).filter((x): x is string => !!x && x !== team.id))] } });
      return { added: ids.length };
    });
  },

  async removeMember(ctx: RequestContext, teamId: string, employeeId: string) {
    requireManage(ctx);
    return runInTransaction(async (tx) => {
      const repo = new TeamRepo(tx, ctx.company.id);
      const team = await teamOr404(repo, teamId);
      const [e] = await repo.findEmployees([employeeId]);
      if (!e || e.teamId !== team.id) throw new NotFoundError();
      await repo.setTeam([e.id], null, ctx.user.id);
      if (team.leaderId === e.id) await repo.update(team.id, { leaderId: null, updatedById: ctx.user.id });
      await writeAudit(tx, ctx, { action: "team.members_remove", entityType: "team", entityId: team.id, after: { employeeId: e.id } });
      return { removed: 1 };
    });
  },
};
