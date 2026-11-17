import "server-only";
import { redirect } from "next/navigation";
import type { UserContext } from "@/platform/authz";
import { profileService } from "@/modules/identity/service";

/** Sends a person who has not filled in the registration form there first (ADR 0030). */
export async function requireRegistered(uctx: UserContext, next: string) {
  const profile = await profileService.getProfile(uctx);
  if (!profile.registeredAt) redirect(`/welcome?next=${encodeURIComponent(next)}`);
  return profile;
}

/** Only same-site paths are followed after registration. */
export function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
