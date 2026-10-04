/**
 * AI provider port (Build Master §25). Interface only in V1 — there is no
 * implementation and no vendor SDK dependency. Domain modules must depend on
 * these types, never on a specific provider.
 *
 * Every future AI run must be stored (user, scope, provider/model, prompt
 * template version, structured result, approval state) and AI output is
 * advisory: operational changes always require human approval.
 */
export type AiResultKind = "FACT" | "FORECAST" | "AI_RECOMMENDATION";

export interface AiScope {
  companyId: string;
  projectId?: string;
  /** Permissions of the requesting user; tools must enforce them. */
  permissions: readonly string[];
}

export interface AiRequest {
  promptTemplate: string;
  promptTemplateVersion: string;
  input: Record<string, unknown>;
  scope: AiScope;
}

export interface AiResultItem {
  kind: AiResultKind;
  text: string;
  evidence?: { entityType: string; entityId: string }[];
}

export interface AiResponse {
  provider: string;
  model: string;
  items: AiResultItem[];
}

export interface AiProvider {
  readonly name: string;
  run(request: AiRequest): Promise<AiResponse>;
}
