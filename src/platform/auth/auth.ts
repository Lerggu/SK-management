import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { db } from "@/platform/db";
import { env, isEntraConfigured } from "@/platform/config/env";
import { checkRateLimit, RATE_LIMITS } from "@/platform/ratelimit";
import { findSignInEligibleUser, recordSignIn, SESSION_MAX_AGE_SECONDS } from "@/modules/identity/service";
import { secureCookiesEnabled } from "./cookies";

interface EntraProfile {
  oid?: string;
  tid?: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
}

function providers(): NextAuthConfig["providers"] {
  if (!isEntraConfigured()) return [];
  const e = env();
  return [
    MicrosoftEntraID({
      clientId: e.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: e.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: e.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      // Invitations pre-create the user by e-mail; the first Entra sign-in
      // links the account to it. Safe because the issuer is pinned to our
      // tenant and sign-in is restricted to invited users (signIn callback).
      allowDangerousEmailAccountLinking: true,
      profile(profile: EntraProfile) {
        const email = (profile.email ?? profile.preferred_username ?? "").trim().toLowerCase();
        return { id: profile.oid ?? profile.sub ?? email, email, name: profile.name ?? null, image: null };
      },
    }),
  ];
}

async function requestMeta() {
  try {
    const h = await headers();
    return {
      requestId: h.get("x-request-id") ?? randomUUID(),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { requestId: randomUUID(), ip: null, userAgent: null };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 60 * 60 },
  useSecureCookies: secureCookiesEnabled(),
  trustHost: true,
  providers: providers(),
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    /** No open sign-up: only invited, active users may sign in. */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return "/sign-in?error=not_invited";
      try {
        checkRateLimit(RATE_LIMITS.signIn, `entra:${email}`);
      } catch {
        return "/sign-in?error=rate_limited";
      }
      const eligible = await findSignInEligibleUser(email);
      return eligible ? true : "/sign-in?error=not_invited";
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      if (!user.id || !account) return;
      const p = (profile ?? {}) as EntraProfile;
      await recordSignIn({
        userId: user.id,
        provider: account.provider,
        subject: p.oid ?? account.providerAccountId,
        tenantId: p.tid ?? null,
        email: user.email ?? null,
        meta: await requestMeta(),
      });
    },
  },
});
