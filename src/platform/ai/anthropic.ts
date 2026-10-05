/**
 * Claude implementation of the AI provider port (ADR 0023). Manual tool loop:
 * the model may call the controlled data tools, then must deliver its answer
 * through the `submit_result` tool (schema `AI_INSIGHT_SCHEMA`). The model
 * never reaches the database; every tool runs through the requesting user's
 * services and permissions.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  AI_INSIGHT_SCHEMA,
  AiProviderError,
  type AiProvider,
  type AiRunRequest,
  type AiRunResult,
  type AiToolCall,
  type AiUsage,
} from "./types";

export const ANTHROPIC_MODEL = "claude-opus-5-5";
const SUBMIT_TOOL = "submit_result";
const MAX_TOKENS = 16_000;
/** Truncate tool output so one tool cannot blow the context or the budget. */
const MAX_TOOL_RESULT_CHARS = 40_000;

/** USD per million tokens. Unknown (fallback) models are priced as Opus — conservative. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export function estimateCostUsd(model: string, usage: Omit<AiUsage, "costUsd">): number {
  const key = Object.keys(PRICES).find((m) => model.startsWith(m));
  const p = PRICES[key ?? ANTHROPIC_MODEL];
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model = ANTHROPIC_MODEL;
  private readonly client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, options: { fetch?: typeof fetch; maxRetries?: number } = {}) {
    if (!apiKey) throw new AiProviderError("ANTHROPIC_API_KEY is not configured");
    this.client = new Anthropic({ apiKey, maxRetries: options.maxRetries ?? 2, timeout: 120_000, fetch: options.fetch });
  }

  async run(request: AiRunRequest): Promise<AiRunResult> {
    const tools: BetaToolUnion[] = [
      ...request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as BetaToolUnion extends { input_schema: infer S } ? S : never,
        strict: true,
      })),
      {
        name: SUBMIT_TOOL,
        description: "Deliver the final structured answer. Call exactly once, after gathering data.",
        input_schema: AI_INSIGHT_SCHEMA as unknown as { type: "object" },
        strict: true,
      },
    ] as BetaToolUnion[];

    const messages: BetaMessageParam[] = [{ role: "user", content: request.prompt }];
    const toolCalls: AiToolCall[] = [];
    const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let servedModel: string = this.model;
    let costUsd = 0;
    let nudged = false;
    let rounds = 0;

    // Hard upper bound on API calls (tool rounds + pause_turn resumes + one nudge).
    for (let call = 0; call < request.maxToolRounds + 4; call++) {
      const response: BetaMessage = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: MAX_TOKENS,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          system: request.system,
          tools,
          tool_choice: { type: "auto" },
          messages,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
        .finalMessage()
        .catch((e: unknown) => {
          throw new AiProviderError(e instanceof Error ? e.message : "AI request failed");
        });

      servedModel = response.model;
      const u = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      totals.inputTokens += u.inputTokens;
      totals.outputTokens += u.outputTokens;
      totals.cacheReadTokens += u.cacheReadTokens;
      totals.cacheWriteTokens += u.cacheWriteTokens;
      costUsd += estimateCostUsd(response.model, u);
      const usage = (): AiUsage => ({ ...totals, costUsd });

      if (response.stop_reason === "refusal") throw new AiProviderError("The model declined the request");
      if (response.stop_reason === "max_tokens") throw new AiProviderError("The answer exceeded the output limit");

      messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });

      if (response.stop_reason === "pause_turn") continue;

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      const submit = toolUses.find((b) => b.name === SUBMIT_TOOL);
      if (submit) {
        return { provider: this.name, model: servedModel, result: submit.input, toolCalls, usage: usage() };
      }

      if (toolUses.length === 0) {
        if (nudged) throw new AiProviderError("The model did not deliver a structured answer");
        nudged = true;
        messages.push({ role: "user", content: `Deliver your answer now by calling the ${SUBMIT_TOOL} tool.` });
        continue;
      }

      rounds++;
      const exhausted = rounds > request.maxToolRounds;
      const results: BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        if (exhausted) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Tool budget exhausted. Call ${SUBMIT_TOOL} now with what you have.`,
            is_error: true,
          });
          continue;
        }
        let ok = true;
        let content: string;
        try {
          content = JSON.stringify(await request.executeTool(use.name, use.input));
        } catch (e) {
          ok = false;
          content = e instanceof Error ? e.message : "Tool failed";
        }
        toolCalls.push({ name: use.name, input: use.input, ok });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: content.length > MAX_TOOL_RESULT_CHARS ? `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]` : content,
          is_error: !ok,
        });
      }
      messages.push({ role: "user", content: results });
    }
    throw new AiProviderError("The model did not finish within the tool budget");
  }
}
