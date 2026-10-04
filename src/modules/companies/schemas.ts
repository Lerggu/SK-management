import { z } from "zod";
import { optionalText, slug, text, uuid } from "@/platform/http/validation";

export const createCompanySchema = z.object({
  organizationId: uuid(),
  name: text(120),
  slug: slug(),
  businessId: optionalText(20),
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

export const updateCompanySchema = z.object({
  name: text(120),
  businessId: optionalText(20),
  defaultLocale: z.enum(["fi", "en"]),
});
export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  name: optionalText(120),
  roleIds: z.array(uuid()).min(1, "validation.roleRequired"),
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const updateMemberRolesSchema = z.object({
  roleIds: z.array(uuid()).min(1, "validation.roleRequired"),
});

export const memberStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string()),
});

export const auditFilterSchema = z.object({
  entityType: optionalText(60),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
