/** AI provider port types (see index.ts). */
export type AiResultKind = "FACT" | "FORECAST" | "AI_RECOMMENDATION";
export const AI_RESULT_KINDS: readonly AiResultKind[] = ["FACT", "FORECAST", "AI_RECOMMENDATION"];
export type AiSeverity = "INFO" | "WARNING" | "CRITICAL";
export const AI_SEVERITIES: readonly AiSeverity[] = ["INFO", "WARNING", "CRITICAL"];

/**
 * The one structured answer shape every AI run returns (§26): a summary plus
 * items that each declare whether they are a fact, a forecast or an AI
 * recommendation, and which tool output supports them.
 */
export interface AiInsightItem {
  kind: AiResultKind;
  severity: AiSeverity;
  title: string;
  detail: string;
  /** Names of the data tools whose output supports this item. */
  evidence: string[];
}

export interface AiInsightResult {
  summary: string;
  items: AiInsightItem[];
}

/** JSON Schema of `AiInsightResult` (strict-tool compatible). */
export const AI_INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "items"],
  properties: {
    summary: { type: "string", description: "Short overall summary (2-4 sentences)." },
    items: {
      type: "array",
      description: "Findings, at most 12.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "title", "detail", "evidence"],
        properties: {
          kind: { type: "string", enum: [...AI_RESULT_KINDS] },
          severity: { type: "string", enum: [...AI_SEVERITIES] },
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "array", items: { type: "string" }, description: "Names of the tools whose output supports this item." },
        },
      },
    },
  },
} as const;

/** JSON Schema for a tool input or the final structured result. */
export type JsonSchema = Record<string, unknown>;

/** A controlled data tool. The provider never touches the database directly. */
export interface AiTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface AiToolCall {
  name: string;
  input: unknown;
  ok: boolean;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated cost in USD from the provider's list prices. */
  costUsd: number;
}

export interface AiRunRequest {
  system: string;
  prompt: string;
  tools: AiTool[];
  /** Executes a tool for the requesting user; errors come back as results. */
  executeTool(name: string, input: unknown): Promise<unknown>;
  maxToolRounds: number;
}

export interface AiRunResult {
  provider: string;
  model: string;
  /** Raw final answer (validate before use — it is model output). */
  result: unknown;
  toolCalls: AiToolCall[];
  usage: AiUsage;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  run(request: AiRunRequest): Promise<AiRunResult>;
}

export class AiProviderError extends Error {}
