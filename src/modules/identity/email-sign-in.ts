import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { readClient } from "@/platform/db";
import { EXTERNAL_TEMPLATE_KEYS, type RequestMeta } from "@/platform/authz";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import { RateLimitedError, UnauthenticatedError } from "@/platform/errors";
import { getMailer } from "@/platform/mail";
import { appBaseUrl } from "@/platform/config/env";
import { translate } from "@/platform/i18n/translate";
import { createDatabaseSession, EXTERNAL_SESSION_MAX_AGE_SECONDS, recordSignIn } from "./service";

/**
 * V7 owner decision 1: external users (Client, Client approver,
 * Subcontractor) sign in with a single-use e-mail link. Internal users keep
 * Entra ID. docs/adr/0020-external-access-and-portals.md.
 */
export const EMAIL_LINK_TTL_MS = 15 * 60 * 1000;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

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

/** Whether e-mail sign-in is offered (a mailer is configured). */
export function isEmailSignInAvailable(): boolean {
  return getMailer() !== null;
}

/**
 * Sends a sign-in link if — and only if — the address belongs to an eligible
 * external user. The caller always shows the same response, so the result
 * never reveals whether the address exists. Rate limited per address and IP.
 */
export async function requestEmailSignIn(email: string, meta: RequestMeta, locale: string | null = null): Promise<void> {
  const normalized = email.trim().toLowerCase();
  checkRateLimit(RATE_LIMITS.emailLinkIp, meta.ip ?? "unknown");
  try {
    checkRateLimit(RATE_LIMITS.emailLinkAddress, normalized);
  } catch (e) {
    // Per-address limiting is silent: no difference visible to the requester.
    if (e instanceof RateLimitedError) return;
    throw e;
  }
  const mailer = getMailer();
  if (!mailer) return;
  const user = await findExternalSignInUser(normalized);
  if (!user) return;
  const token = randomBytes(32).toString("base64url");
  await readClient().emailSignInToken.create({
    data: { userId: user.id, tokenSha256: sha256(token), expiresAt: new Date(Date.now() + EMAIL_LINK_TTL_MS), createdIp: meta.ip ?? null },
  });
  const link = `${appBaseUrl()}/sign-in/email?token=${encodeURIComponent(token)}`;
  const lang = user.locale ?? locale;
  await mailer.send({
    to: user.email,
    subject: translate(lang, "mail.signInSubject"),
    text: translate(lang, "mail.signInBody", { name: user.name ?? user.email, link, minutes: EMAIL_LINK_TTL_MS / 60_000 }),
  });
}

/**
 * Consumes a link token (single use, atomic) and creates an external session.
 * Invalid, expired, reused or no-longer-eligible tokens are all rejected the
 * same way.
 */
export async function consumeEmailSignIn(token: string, meta: RequestMeta) {
  checkRateLimit(RATE_LIMITS.signIn, `email:${meta.ip ?? "unknown"}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthenticatedError("Invalid link");
  const now = new Date();
  const hash = sha256(token);
  const consumed = await readClient().emailSignInToken.updateMany({
    where: { tokenSha256: hash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw new UnauthenticatedError("Invalid link");
  const row = await readClient().emailSignInToken.findUniqueOrThrow({ where: { tokenSha256: hash }, select: { userId: true, user: { select: { email: true } } } });
  const user = await findExternalSignInUser(row.user.email);
  if (!user || user.id !== row.userId) throw new UnauthenticatedError("Invalid link");
  const session = await createDatabaseSession(user.id, EXTERNAL_SESSION_MAX_AGE_SECONDS);
  await recordSignIn({ userId: user.id, provider: "email", subject: user.email, email: user.email, meta });
  return session;
}
