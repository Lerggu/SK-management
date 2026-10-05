/**
 * V8 live verification (acceptance criterion 8): one real AI project review
 * against the seeded development database, through the same service path as
 * the UI. Requires SK_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in the environment (never in a file).
 * The run is stored in ai_runs and counts toward the company's monthly cap.
 *
 * Usage: pnpm ai:verify            (project NDC-001 as pm@skinfra.example.com)
 */
import "dotenv/config";
import "@/modules/registry";
import { db } from "@/platform/db";
import { anthropicApiKey, getAiProvider } from "@/platform/ai";
import { resolveRequestContext } from "@/modules/companies/context";
import { aiProjectControllerService } from "@/modules/ai/service";

async function main() {
  if (!anthropicApiKey()) throw new Error("SK_ANTHROPIC_API_KEY is not set — add it to the environment settings and start a new session.");
  const provider = getAiProvider();
  if (provider?.name !== "anthropic") throw new Error(`Expected the Anthropic provider, got ${provider?.name ?? "none"}`);

  const user = await db.user.findUniqueOrThrow({ where: { email: "pm@skinfra.example.com" } });
  const project = await db.project.findFirstOrThrow({ where: { code: "NDC-001" } });
  const ctx = await resolveRequestContext({ userId: user.id, companySlug: "sk-infra-demo", meta: { requestId: "ai-verify", ip: null, userAgent: "ai-verify" }, locale: "fi" });

  console.log(`▶ Live AI review: ${project.code} with ${provider.model} …`);
  const started = Date.now();
  const run = await aiProjectControllerService.review(ctx, project.id);
  console.log(`  status:   ${run.status}${run.error ? ` (${run.error})` : ""}`);
  console.log(`  model:    ${run.model} (provider ${run.provider})`);
  console.log(`  tools:    ${run.toolCalls.map((c) => `${c.name}${c.ok ? "" : " ✗"}`).join(", ")}`);
  console.log(`  tokens:   ${run.tokens}, cost ${run.costEur} €, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (run.result) {
    console.log(`  summary:  ${run.result.summary}`);
    for (const i of run.result.items) console.log(`   - [${i.kind}/${i.severity}] ${i.title} (${i.evidence.join(", ")})`);
  }
  if (run.status !== "SUCCEEDED") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
