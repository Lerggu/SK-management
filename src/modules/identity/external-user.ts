import { z } from "zod";
import { readClient } from "@/platform/db";
import { EXTERNAL_TEMPLATE_KEYS } from "@/platform/authz";

const emailSchema = z.email().max(200);

/**
 * An invited, active user whose every active/invited membership consists of
 * external roles only. Anyone holding an internal role must use Entra ID.
 */
export async function findExternalSignInUser(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!emailSchema.safeParse(normalized).success) return null;
  const user = await readClient().user.findFirst({
    where: { email: normalized, status: "ACTIVE", archivedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      companyMemberships: {
        where: { status: { in: ["INVITED", "ACTIVE"] }, company: { archivedAt: null } },
        select: { roles: { select: { role: { select: { templateKey: true } } } } },
      },
    },
  });
  if (!user || user.companyMemberships.length === 0) return null;
  const externalOnly = user.companyMemberships.every(
    (m) => m.roles.length > 0 && m.roles.every((r) => r.role.templateKey !== null && EXTERNAL_TEMPLATE_KEYS.has(r.role.templateKey)),
  );
  return externalOnly ? user : null;
}
