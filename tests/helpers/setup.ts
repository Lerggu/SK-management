import "dotenv/config";
import { afterAll } from "vitest";

// Point the application at the test database before any module creates the
// Prisma client, and use in-memory object storage.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DEV_LOGIN_ENABLED = "true";

const { setStorageForTests, MemoryObjectStorage } = await import("@/platform/storage");
setStorageForTests(new MemoryObjectStorage());
// V7: e-mails go to an in-memory mailbox (getMailer() as MemoryMailer).
const { setMailerForTests, MemoryMailer } = await import("@/platform/mail");
setMailerForTests(new MemoryMailer());

afterAll(async () => {
  const { db } = await import("@/platform/db");
  await db.$disconnect();
});
