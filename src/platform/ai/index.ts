/**
 * AI provider port (Build Master §25, V8 docs/adr/0023). Domain modules use
 * these types only — never a vendor SDK — so the system stays
 * provider-independent (§1.10). Implementations: Anthropic Claude
 * (`anthropic.ts`, when ANTHROPIC_API_KEY is set) and a deterministic fake for
 * tests and keyless development (`fake.ts`).
 *
 * AI output is advisory: operational changes always need human approval.
 */
import { isProduction } from "@/platform/config/env";
import { AnthropicProvider } from "./anthropic";
import { FakeAiProvider } from "./fake";
import type { AiProvider } from "./types";

export * from "./types";

let override: AiProvider | null | undefined;

/**
 * The configured provider: Claude when ANTHROPIC_API_KEY is set; otherwise the
 * deterministic fake outside production; null (AI unavailable) in production
 * without a key.
 */
export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  // E2E and demos can force the fake even when a key is present (never in production).
  if (process.env.AI_PROVIDER === "fake" && !isProduction()) return new FakeAiProvider();
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (!isProduction()) return new FakeAiProvider();
  return null;
}

export function setAiProviderForTests(provider: AiProvider | null | undefined): void {
  override = provider;
}

/** USD → EUR for the cost cap (Anthropic bills in USD). Configurable. */
export function usdToEur(usd: number): number {
  const rate = Number(process.env.AI_EUR_PER_USD ?? "0.92");
  return usd * (Number.isFinite(rate) && rate > 0 ? rate : 0.92);
}

export { FakeAiProvider } from "./fake";
