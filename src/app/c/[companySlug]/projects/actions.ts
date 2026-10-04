"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { projectService, siteService } from "@/modules/projects/service";
import type { AssignMemberInput, ProjectInput, SiteInput } from "@/modules/projects/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const base = (slug: string) => `/c/${slug}/projects`;

export async function createProjectAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id = "";
  const r = await runAction(formData, async () => {
    id = (await projectService.create(ctx, formInput<ProjectInput>(formData))).id;
  });
  if (r.ok) redirect(`${base(slug)}/${id}`);
  return r;
}

export async function updateProjectAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => projectService.update(ctx, projectId, formInput<ProjectInput>(formData)).then(() => undefined));
  if (r.ok) redirect(`${base(slug)}/${projectId}`);
  return r;
}

export async function archiveProjectAction(slug: string, projectId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => projectService.archive(ctx, projectId).then(() => undefined));
  if (r.ok) redirect(base(slug));
  return r;
}

export async function createSiteAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => siteService.create(ctx, projectId, formInput<SiteInput>(formData)).then(() => undefined));
  if (r.ok) redirect(`${base(slug)}/${projectId}`);
  return r;
}

export async function updateSiteAction(slug: string, projectId: string, siteId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => siteService.update(ctx, siteId, formInput<SiteInput>(formData)).then(() => undefined));
  if (r.ok) redirect(`${base(slug)}/${projectId}`);
  return r;
}

export async function archiveSiteAction(slug: string, projectId: string, siteId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => siteService.archive(ctx, siteId).then(() => undefined));
  if (r.ok) redirect(`${base(slug)}/${projectId}`);
  return r;
}

export async function assignMemberAction(slug: string, projectId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => projectService.assignMember(ctx, projectId, formInput<AssignMemberInput>(formData)).then(() => undefined));
  revalidatePath(`${base(slug)}/${projectId}`);
  return r;
}

export async function removeMemberAction(slug: string, projectId: string, membershipId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => projectService.removeMember(ctx, membershipId));
  revalidatePath(`${base(slug)}/${projectId}`);
  return r;
}
