import { z } from "zod";

const boolString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().optional(),
  AUTH_URL: z.string().optional(),
  AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional(),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional(),
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.string().optional(),
  DEV_LOGIN_ENABLED: boolString,
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("eu-north-1"),
  S3_BUCKET: z.string().default("sk-management-dev"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolString,
  // Production on Azure (ADR 0024): Blob Storage with managed identity.
  STORAGE_PROVIDER: z.enum(["s3", "azure"]).default("s3"),
  AZURE_STORAGE_ACCOUNT_URL: z.string().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default("documents"),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(25),
  // V7: e-mail (sign-in links for external users, serious-incident alerts).
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("SK Management <no-reply@sk-management.invalid>"),
  // HR (ADR 0025): hourly expiry-reminder job inside the app process.
  // Default: on in production, off elsewhere ("on"/"off" overrides).
  HR_REMINDERS: z.enum(["on", "off", ""]).optional(),
  HR_REMINDER_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment. Throws on first access if required values are missing. */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that mutate process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Dev credentials login guard. Hard-disabled in production regardless of the
 * DEV_LOGIN_ENABLED flag — this is the single place the decision is made.
 */
export function isDevLoginEnabled(): boolean {
  if (isProduction()) return false;
  return env().DEV_LOGIN_ENABLED;
}

export function isEntraConfigured(): boolean {
  const e = env();
  return Boolean(e.AUTH_MICROSOFT_ENTRA_ID_ID && e.AUTH_MICROSOFT_ENTRA_ID_SECRET && e.AUTH_MICROSOFT_ENTRA_ID_ISSUER);
}

export function uploadMaxBytes(): number {
  return Math.floor(env().UPLOAD_MAX_MB * 1024 * 1024);
}

/** V7: SMTP is configured for real e-mail delivery. */
export function isSmtpConfigured(): boolean {
  return Boolean(env().SMTP_URL);
}

/** Public base URL for links in e-mails (AUTH_URL), without a trailing slash. */
export function appBaseUrl(): string {
  return (env().AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Whether the in-process expiry-reminder scheduler runs (ADR 0025). */
export function isReminderSchedulerEnabled(): boolean {
  const v = env().HR_REMINDERS;
  if (v === "on") return true;
  if (v === "off") return false;
  return isProduction();
}
