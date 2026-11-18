import { afterEach, describe, expect, it } from "vitest";
import { BraveSearch, SerperSearch, getWebSearch, parseBrave, parseSerper, setWebSearchForTests } from "./web-search";

function stub(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

afterEach(() => {
  setWebSearchForTests(undefined);
  delete process.env.SK_SERPER_API_KEY;
  delete process.env.SK_BRAVE_API_KEY;
});

describe("web search providers", () => {
  it("Serper (Google): news endpoint, key header, country and language; news first", async () => {
    const { fetchFn, calls } = stub({
      organic: [{ title: "Org", link: "https://a.example/o", snippet: "s1" }, { title: "", link: "https://bad" }],
      news: [{ title: "News", link: "https://b.example/n", snippet: "s2", date: "2 days ago", source: "Yle" }],
    });
    const hits = await new SerperSearch("k", fetchFn).search({ query: "datakeskus", country: "FI", language: "fi", news: true });
    expect(calls[0].url).toBe("https://google.serper.dev/news");
    expect(new Headers(calls[0].init.headers).get("X-API-KEY")).toBe("k");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ q: "datakeskus", gl: "fi", hl: "fi" });
    expect(hits).toEqual([
      { title: "News", url: "https://b.example/n", snippet: "s2", date: "2 days ago", source: "Yle" },
      { title: "Org", url: "https://a.example/o", snippet: "s1", date: null, source: null },
    ]);
  });

  it("Brave: web endpoint with query parameters and token header", async () => {
    const { fetchFn, calls } = stub({ web: { results: [{ title: "T", url: "https://c.example", description: "d", age: "1 week", meta_url: { hostname: "c.example" } }] } });
    const hits = await new BraveSearch("b", fetchFn).search({ query: "datacenter", country: "se", language: "sv" });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/res/v1/web/search");
    expect(url.searchParams.get("country")).toBe("SE");
    expect(url.searchParams.get("search_lang")).toBe("sv");
    expect(new Headers(calls[0].init.headers).get("X-Subscription-Token")).toBe("b");
    expect(hits).toEqual([{ title: "T", url: "https://c.example", snippet: "d", date: "1 week", source: "c.example" }]);
  });

  it("parsers tolerate missing fields", () => {
    expect(parseSerper(null)).toEqual([]);
    expect(parseBrave({ web: {} })).toEqual([]);
  });

  it("chooses the provider by the configured key (Serper first), none without a key", () => {
    expect(getWebSearch()).toBeNull();
    process.env.SK_BRAVE_API_KEY = "b";
    expect(getWebSearch()?.name).toBe("brave");
    process.env.SK_SERPER_API_KEY = "s";
    expect(getWebSearch()?.name).toBe("serper");
  });
});
