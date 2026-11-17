"use server";

import { revalidatePath } from "next/cache";
import { teamService } from "@/modules/workforce/team.service";
import type { TeamInput } from "@/modules/workforce/team.schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const done = (slug: string) => revalidatePath(`/c/${slug}/workforce`, "layout");

/** Team forms (ADR 0029); the service checks access. */
export async function teamCreateAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => teamService.create(ctx, formInput<TeamInput>(formData)).then(() => undefined));
  done(slug);
  return r;
}

export async function teamUpdateAction(slug: string, teamId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => teamService.update(ctx, teamId, formInput<TeamInput>(formData)).then(() => undefined));
  done(slug);
  return r;
}

export async function teamArchiveAction(slug: string, teamId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => teamService.archive(ctx, teamId).then(() => undefined));
  done(slug);
  return r;
}

export async function teamAddMembersAction(slug: string, teamId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => teamService.addMembers(ctx, teamId, { employeeIds: formData.getAll("employeeIds").map(String) }).then(() => undefined));
  done(slug);
  return r;
}

export async function teamRemoveMemberAction(slug: string, teamId: string, employeeId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => teamService.removeMember(ctx, teamId, employeeId).then(() => undefined));
  done(slug);
  return r;
}
