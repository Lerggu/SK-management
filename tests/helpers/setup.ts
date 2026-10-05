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
// V8: never call a real AI provider from tests, even when ANTHROPIC_API_KEY is set.
const { setAiProviderForTests, FakeAiProvider } = await import("@/platform/ai");
setAiProviderForTests(new FakeAiProvider());
// V8: wrap all services in the tenant scope (row-level security), as the app does.
await import("@/modules/registry");

afterAll(async () => {
  const { db } = await import("@/platform/db");
  await db.$disconnect();
});
