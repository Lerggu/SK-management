/**
 * Claude adapter tool loop, offline: a stub fetch answers with canned
 * Messages API event streams. Checks the request shape (model, adaptive
 * thinking, effort, strict tools, fallbacks), tool_result wiring, the
 * submit_result answer, usage/cost totals and stop-reason handling.
 */
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "./anthropic";
import { AiProviderError, type AiRunRequest } from "./types";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

function sse(blocks: Block[], stopReason: string, usage = { input: 100, output: 50, cacheRead: 0 }) {
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: 0 },
      },
    },
  ];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
    } else {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: usage.output } });
  events.push({ type: "message_stop" });
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function stubFetch(responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const headers: Headers[] = [];
  const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    headers.push(new Headers(init?.headers));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as typeof fetch;
  return { fetchFn, bodies, headers };
}

const answer = { summary: "Kaikki hyvin", items: [{ kind: "FACT", severity: "INFO", title: "t", detail: "d", evidence: ["project_overview"] }] };

function request(executed: string[]): AiRunRequest {
  return {
    system: "system prompt",
    prompt: "review",
    tools: [{ name: "project_overview", description: "d", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } }],
    maxToolRounds: 3,
    async executeTool(name) {
      executed.push(name);
      return { code: "P-1" };
    },
  };
}

describe("AnthropicProvider", () => {
  it("runs the tool loop and returns the submit_result answer with summed usage", async () => {
    const { fetchFn, bodies, headers } = stubFetch([
      sse([{ type: "tool_use", id: "toolu_1", name: "project_overview", input: {} }], "tool_use"),
      sse([{ type: "tool_use", id: "toolu_2", name: "submit_result", input: answer }], "tool_use", { input: 200, output: 100, cacheRead: 1000 }),
    ]);
    const executed: string[] = [];
    const out = await new AnthropicProvider("test-key", { fetch: fetchFn, maxRetries: 0 }).run(request(executed));

    expect(out.result).toEqual(answer);
    expect(executed).toEqual(["project_overview"]);
    expect(out.toolCalls).toEqual([{ name: "project_overview", input: {}, ok: true }]);
    expect(out.usage).toMatchObject({ inputTokens: 300, outputTokens: 150, cacheReadTokens: 1000 });
    expect(out.usage.costUsd).toBeCloseTo((300 * 4 + 150 * 20 + 1000 * 0.2) / 1e6, 9);

    const first = bodies[0];
    expect(first).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tool_choice: { type: "auto" },
      cache_control: { type: "ephemeral" },
      fallbacks: "default",
      system: "system prompt",
    });
    const tools = first.tools as { name: string; strict: boolean }[];
    expect(tools.map((t) => [t.name, t.strict])).toEqual([["project_overview", true], ["submit_result", true]]);
    expect(headers[0].get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");

    // The second request carries the assistant turn and the tool result.
    const messages = bodies[1].messages as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify({ code: "P-1" }), is_error: false }]);
  });

  it("returns tool errors to the model instead of failing", async () => {
    const { fetchFn, bodies } = stubFetch([
      sse([{ type: "tool_use", id: "toolu_1", name: "project_overview", input: {} }], "tool_use"),
      sse([{ type: "tool_use", id: "toolu_2", name: "submit_result", input: answer }], "tool_use"),
    ]);
    const req = request([]);
    req.executeTool = async () => {
      throw new Error("Not found");
    };
    const out = await new AnthropicProvider("k", { fetch: fetchFn, maxRetries: 0 }).run(req);
    expect(out.toolCalls[0].ok).toBe(false);
    expect((bodies[1].messages as { content: unknown }[])[2].content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", content: "Not found", is_error: true }]);
  });

  it("nudges once when the model answers in text, then fails", async () => {
    const { fetchFn, bodies } = stubFetch([sse([{ type: "text", text: "hello" }], "end_turn"), sse([{ type: "text", text: "still text" }], "end_turn")]);
    await expect(new AnthropicProvider("k", { fetch: fetchFn, maxRetries: 0 }).run(request([]))).rejects.toBeInstanceOf(AiProviderError);
    expect(bodies).toHaveLength(2);
    expect((bodies[1].messages as { content: unknown }[])[2].content).toContain("submit_result");
  });

  it("surfaces refusals and truncation as provider errors", async () => {
    for (const reason of ["refusal", "max_tokens"]) {
      const { fetchFn } = stubFetch([sse([{ type: "text", text: "x" }], reason)]);
      await expect(new AnthropicProvider("k", { fetch: fetchFn, maxRetries: 0 }).run(request([]))).rejects.toBeInstanceOf(AiProviderError);
    }
  });

  it("stops executing tools once the tool budget is used", async () => {
    const call = (id: string) => sse([{ type: "tool_use", id, name: "project_overview", input: {} }], "tool_use");
    const { fetchFn } = stubFetch([call("a"), call("b"), call("c"), call("d"), sse([{ type: "tool_use", id: "s", name: "submit_result", input: answer }], "tool_use")]);
    const executed: string[] = [];
    const out = await new AnthropicProvider("k", { fetch: fetchFn, maxRetries: 0 }).run(request(executed));
    expect(executed).toHaveLength(3);
    expect(out.result).toEqual(answer);
  });

  it("requires an API key", () => {
    expect(() => new AnthropicProvider("")).toThrow(AiProviderError);
  });
});
