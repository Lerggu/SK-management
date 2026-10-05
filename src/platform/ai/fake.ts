/**
 * Deterministic AI provider for tests, CI and keyless development. It never
 * calls a network service: it runs every offered tool once with `{}` and
 * builds a fixed-shape answer from what the tools returned. Answers are
 * clearly labelled as test output.
 */
import type { AiInsightItem, AiInsightResult, AiProvider, AiRunRequest, AiRunResult, AiToolCall } from "./types";

export interface FakeAiOptions {
  /** Cost reported per run (USD), for budget tests. */
  costUsd?: number;
  /** Replace the generated answer (e.g. to test validation of bad output). */
  respond?: (toolOutputs: Record<string, unknown>) => unknown;
  /** Throw instead of answering. */
  fail?: string;
}

export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  readonly model = "fake-deterministic";
  /** Requests seen, for assertions. */
  readonly requests: AiRunRequest[] = [];

  constructor(private readonly options: FakeAiOptions = {}) {}

  async run(request: AiRunRequest): Promise<AiRunResult> {
    this.requests.push(request);
    if (this.options.fail) throw new Error(this.options.fail);

    const toolCalls: AiToolCall[] = [];
    const outputs: Record<string, unknown> = {};
    for (const tool of request.tools.slice(0, request.maxToolRounds)) {
      try {
        outputs[tool.name] = await request.executeTool(tool.name, {});
        toolCalls.push({ name: tool.name, input: {}, ok: true });
      } catch (e) {
        toolCalls.push({ name: tool.name, input: {}, ok: false });
        outputs[tool.name] = { error: e instanceof Error ? e.message : "error" };
      }
    }

    const result = this.options.respond ? this.options.respond(outputs) : defaultAnswer(outputs);
    return {
      provider: this.name,
      model: this.model,
      result,
      toolCalls,
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: this.options.costUsd ?? 0.008 },
    };
  }
}

function defaultAnswer(outputs: Record<string, unknown>): AiInsightResult {
  const names = Object.keys(outputs).sort();
  const facts: AiInsightItem[] = names.map((name) => ({
    kind: "FACT",
    severity: "INFO",
    title: `[TEST] ${name}`,
    detail: `[TEST] Data source read: ${name}`,
    evidence: [name],
  }));
  return {
    summary: `[TEST] Deterministic test analysis without an AI model. Data sources read: ${names.length}.`,
    items: [
      ...facts,
      {
        kind: "AI_RECOMMENDATION",
        severity: "WARNING",
        title: "[TEST] Review the project status",
        detail: "[TEST] Example recommendation produced by the test provider.",
        evidence: names.slice(0, 1),
      },
    ],
  };
}
