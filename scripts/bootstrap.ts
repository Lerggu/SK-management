/**
 * Production bootstrap from environment variables (ADR 0024, docs/DEPLOY_AZURE.md).
 * Runs at container start after migrations; does nothing unless
 * BOOTSTRAP_OWNER_EMAIL is set, and nothing once the organization exists.
 *
 *   BOOTSTRAP_ORG_NAME="SK Group"  BOOTSTRAP_ORG_SLUG="sk-group"
 *   BOOTSTRAP_OWNER_EMAIL="first.admin@company.fi"  BOOTSTRAP_OWNER_NAME="First Admin"
 *   BOOTSTRAP_COMPANIES="SK Infra Oy|sk-infra|1234567-8;Purent Oy|purent"
 */
import "dotenv/config";
import "@/modules/registry";
import { db } from "@/platform/db";
import { bootstrapProduction, parseCompanies } from "@/modules/system/bootstrap";

async function main() {
  const e = process.env;
  if (!e.BOOTSTRAP_OWNER_EMAIL) {
    console.log("Bootstrap: BOOTSTRAP_OWNER_EMAIL not set — skipped.");
    return;
  }
  const result = await bootstrapProduction({
    orgName: e.BOOTSTRAP_ORG_NAME ?? "",
    orgSlug: e.BOOTSTRAP_ORG_SLUG ?? "",
    ownerEmail: e.BOOTSTRAP_OWNER_EMAIL,
    ownerName: e.BOOTSTRAP_OWNER_NAME ?? "",
    companies: parseCompanies(e.BOOTSTRAP_COMPANIES ?? ""),
  });
  console.log(result.created ? `Bootstrap: created organization and companies ${result.companies.join(", ")}.` : "Bootstrap: organization already exists — nothing to do.");
}

main()
  .catch((err) => {
    console.error("Bootstrap failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
