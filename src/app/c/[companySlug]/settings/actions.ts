"use server";

import { revalidatePath } from "next/cache";
import { companyAdminService } from "@/modules/companies/service";
import type { InviteMemberInput, UpdateCompanyInput } from "@/modules/companies/schemas";
import { formInput, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const roleIds = (formData: FormData) => formData.getAll("roleIds").map(String);

export async function updateCompanyAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => companyAdminService.updateSettings(ctx, formInput<UpdateCompanyInput>(formData)).then(() => undefined));
  revalidatePath(`/c/${slug}`, "layout");
  return r;
}

export async function inviteMemberAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let sent = false;
  const r = await runAction(formData, async () => {
    const m = await companyAdminService.inviteMember(ctx, { ...formInput<InviteMemberInput>(formData), roleIds: roleIds(formData), projectIds: formData.getAll("projectIds").map(String) });
    sent = m.email.sent;
  });
  revalidatePath(`/c/${slug}/settings/members`);
  return r.ok ? { ok: true, message: sent ? "settings.inviteSent" : "settings.inviteSavedNoMail" } : r;
}

export async function resendInviteAction(slug: string, membershipId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => companyAdminService.resendInvite(ctx, membershipId).then(() => undefined));
  return r.ok ? { ok: true, message: "settings.inviteSent" } : r;
}

export async function updateMemberRolesAction(slug: string, membershipId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => companyAdminService.updateMemberRoles(ctx, membershipId, { roleIds: roleIds(formData) }));
  revalidatePath(`/c/${slug}/settings/members`);
  return r;
}

export async function setMemberStatusAction(slug: string, membershipId: string, status: "ACTIVE" | "DISABLED"): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => companyAdminService.setMemberStatus(ctx, membershipId, { status }));
  revalidatePath(`/c/${slug}/settings/members`);
  return r;
}

export async function updateRolePermissionsAction(slug: string, roleId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => companyAdminService.updateRolePermissions(ctx, roleId, { permissionKeys: formData.getAll("permissionKeys").map(String) }));
  revalidatePath(`/c/${slug}/settings/roles`);
  return r;
}

/** Personal extra permissions of one member (ADR 0030). */
export async function setMemberPermissionsAction(slug: string, membershipId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => companyAdminService.setMemberPermissions(ctx, membershipId, { permissionKeys: formData.getAll("permissionKeys").map(String) }).then(() => undefined));
  revalidatePath(`/c/${slug}/settings/members`);
  return r;
}
