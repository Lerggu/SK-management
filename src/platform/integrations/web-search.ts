/**
 * Web search for the marketing discovery agent (ADR 0032). Google's own
 * Custom Search JSON API is closed to new customers and ends on 2027-01-01,
 * so Google results come through Serper (google.serper.dev). Brave Search
 * (own index) is the alternative. The provider is chosen by which key is
 * configured; keys come from the environment (Key Vault) only.
 *
 * Only the search query, country and language are sent.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string | null;
  date: string | null;
  source: string | null;
}

export interface SearchQuery {
  query: string;
  /** ISO 3166-1 alpha-2, e.g. FI. */
  country?: string | null;
  /** ISO 639-1, e.g. fi, sv, en. */
  language?: string | null;
  /** Prefer news (recent articles) over general results. */
  news?: boolean;
  num?: number;
}

export interface WebSearchProvider {
  readonly name: "serper" | "brave" | "test";
  search(q: SearchQuery): Promise<SearchHit[]>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const TIMEOUT = 20_000;

/** Google results via Serper. POST https://google.serper.dev/search|news, header X-API-KEY. */
export class SerperSearch implements WebSearchProvider {
  readonly name = "serper" as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async search(q: SearchQuery): Promise<SearchHit[]> {
    const res = await this.fetchFn(`https://google.serper.dev/${q.news ? "news" : "search"}`, {
      method: "POST",
      headers: { "X-API-KEY": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: q.query, gl: q.country?.toLowerCase() ?? undefined, hl: q.language ?? undefined, num: Math.min(q.num ?? 10, 20) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
    return parseSerper(await res.json());
  }
}

export function parseSerper(data: unknown): SearchHit[] {
  const d = (data ?? {}) as { organic?: unknown[]; news?: unknown[] };
  return [...(d.news ?? []), ...(d.organic ?? [])]
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const url = str(o.link);
      const title = str(o.title);
      return url && title ? { title, url, snippet: str(o.snippet), date: str(o.date), source: str(o.source) } : null;
    })
    .filter((h): h is SearchHit => h !== null);
}

/** Brave Search. GET https://api.search.brave.com/res/v1/web|news/search, header X-Subscription-Token. */
export class BraveSearch implements WebSearchProvider {
  readonly name = "brave" as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async search(q: SearchQuery): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q: q.query, count: String(Math.min(q.num ?? 10, 20)) });
    if (q.country) params.set("country", q.country.toUpperCase());
    if (q.language) params.set("search_lang", q.language);
    if (q.news) params.set("freshness", "py");
    const res = await this.fetchFn(`https://api.search.brave.com/res/v1/${q.news ? "news" : "web"}/search?${params}`, {
      headers: { "X-Subscription-Token": this.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
    return parseBrave(await res.json());
  }
}

export function parseBrave(data: unknown): SearchHit[] {
  const d = (data ?? {}) as { web?: { results?: unknown[] }; results?: unknown[] };
  return [...(d.web?.results ?? []), ...(d.results ?? [])]
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const url = str(o.url);
      const title = str(o.title);
      const meta = (o.meta_url ?? {}) as Record<string, unknown>;
      return url && title ? { title, url, snippet: str(o.description), date: str(o.age) ?? str(o.page_age), source: str(meta.hostname) } : null;
    })
    .filter((h): h is SearchHit => h !== null);
}

let override: WebSearchProvider | null | undefined;

/** The configured search provider, or null (the agent then uses the AI's own web search only). */
export function getWebSearch(): WebSearchProvider | null {
  if (override !== undefined) return override;
  const serper = process.env.SK_SERPER_API_KEY?.trim();
  if (serper) return new SerperSearch(serper);
  const brave = process.env.SK_BRAVE_API_KEY?.trim();
  if (brave) return new BraveSearch(brave);
  return null;
}

export function setWebSearchForTests(provider: WebSearchProvider | null | undefined): void {
  override = provider;
}
