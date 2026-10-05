import nodemailer from "nodemailer";
import { db } from "@/platform/db";
import { env, isDevLoginEnabled, isSmtpConfigured } from "@/platform/config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outbound e-mail adapter (V7). Domain modules use this interface only. */
export interface Mailer {
  readonly kind: "smtp" | "dev-outbox" | "test";
  send(message: MailMessage): Promise<void>;
}

class SmtpMailer implements Mailer {
  readonly kind = "smtp" as const;
  private readonly transport = nodemailer.createTransport(env().SMTP_URL!);
  async send(m: MailMessage) {
    await this.transport.sendMail({ from: env().MAIL_FROM, to: m.to, subject: m.subject, text: m.text });
  }
}

/**
 * Development/test mailbox in the database, readable at /dev/mailbox. Only
 * available where the dev login is (hard-disabled in production).
 */
class DevOutboxMailer implements Mailer {
  readonly kind = "dev-outbox" as const;
  async send(m: MailMessage) {
    await db.devMailOutbox.create({ data: { to: m.to.toLowerCase(), subject: m.subject, bodyText: m.text } });
  }
}

let override: Mailer | null | undefined;

/** The configured mailer, or null when e-mail is not available. */
export function getMailer(): Mailer | null {
  if (override !== undefined) return override;
  if (isSmtpConfigured()) return new SmtpMailer();
  if (isDevLoginEnabled()) return new DevOutboxMailer();
  return null;
}

export function setMailerForTests(mailer: Mailer | null | undefined): void {
  override = mailer;
}

/** Collects messages in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly kind = "test" as const;
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

/** Dev mailbox listing (development only). */
export async function listDevMailbox(limit = 50) {
  if (!isDevLoginEnabled()) return [];
  return db.devMailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
