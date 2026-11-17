/**
 * TED — Tenders Electronic Daily, the EU public procurement journal (ADR
 * 0032). Official anonymous search API: POST
 * https://api.ted.europa.eu/v3/notices/search (expert query syntax). Only
 * public notice data is read; nothing is sent but the search query.
 */

const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";

/** ISO 3166-1 alpha-2 → alpha-3 for the European countries TED covers. */
export const ISO2_TO_ISO3: Record<string, string> = {
  AT: "AUT", BE: "BEL", BG: "BGR", HR: "HRV", CY: "CYP", CZ: "CZE", DK: "DNK", EE: "EST", FI: "FIN", FR: "FRA",
  DE: "DEU", GR: "GRC", HU: "HUN", IE: "IRL", IT: "ITA", LV: "LVA", LT: "LTU", LU: "LUX", MT: "MLT", NL: "NLD",
  PL: "POL", PT: "PRT", RO: "ROU", SK: "SVK", SI: "SVN", ES: "ESP", SE: "SWE", NO: "NOR", IS: "ISL", CH: "CHE",
  GB: "GBR", LI: "LIE",
};
const ISO3_TO_ISO2 = Object.fromEntries(Object.entries(ISO2_TO_ISO3).map(([a, b]) => [b, a]));

/**
 * CPV codes of work we can do: electrical installation, electricity supply
 * installations, power lines and their ancillary works, power plants,
 * industrial buildings.
 */
export const TED_CPV_CODES = ["45310000", "45315300", "45317000", "45231400", "45232200", "45251000", "45213250", "45223000"];

/** Contract notices and prior information notices (not award notices). */
const NOTICE_TYPES = ["cn-standard", "cn-social", "pin-only", "pin-cfc-standard", "pin-cfc-social"];

const FIELDS = [
  "publication-number",
  "notice-title",
  "notice-type",
  "publication-date",
  "buyer-name",
  "buyer-country",
  "organisation-city-buyer",
  "organisation-tel-buyer",
  "place-of-performance-city-lot",
  "deadline-receipt-tender-date-lot",
  "estimated-value-lot",
  "estimated-value-cur-lot",
  "description-lot",
];

export interface TedNotice {
  publicationNumber: string;
  title: string;
  noticeType: string | null;
  publishedAt: string | null;
  buyer: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  city: string | null;
  buyerPhone: string | null;
  deadline: string | null;
  estimatedValue: number | null;
  currency: string | null;
  description: string | null;
  url: string;
}

export interface TedSearch {
  countries: string[];
  /** YYYY-MM-DD; notices published on or after this day. */
  since: string;
  limit: number;
}

export type TedFetch = (search: TedSearch) => Promise<TedNotice[]>;

type Multi = Record<string, string | string[]> | undefined;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);

/** English text when present, otherwise the first language. */
function pick(value: Multi): string | null {
  if (!value) return null;
  const v = value.eng ?? value.ENG ?? Object.values(value)[0];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? decode(s.trim()) : null;
}

const first = (v: unknown): string | null => (Array.isArray(v) && typeof v[0] === "string" ? v[0] : typeof v === "string" ? v : null);

/** "Finland – Electrical installation work – Buyer / Project" → "Buyer / Project". */
function shortTitle(full: string): string {
  const parts = full.split(" – ");
  return parts.length >= 3 ? parts.slice(2).join(" – ") : full;
}

/** Maps one raw TED notice to `TedNotice` (exported for tests). */
export function mapTedNotice(raw: Record<string, unknown>): TedNotice | null {
  const publicationNumber = first(raw["publication-number"]);
  const fullTitle = pick(raw["notice-title"] as Multi);
  if (!publicationNumber || !fullTitle) return null;
  const iso3 = first(raw["buyer-country"]);
  const value = Number(first(raw["estimated-value-lot"]));
  const date = (v: string | null) => (v ? v.slice(0, 10) : null);
  return {
    publicationNumber,
    title: shortTitle(fullTitle).slice(0, 300),
    noticeType: first(raw["notice-type"]),
    publishedAt: date(first(raw["publication-date"])),
    buyer: pick(raw["buyer-name"] as Multi),
    country: iso3 ? (ISO3_TO_ISO2[iso3] ?? null) : null,
    city: first(raw["place-of-performance-city-lot"]) ?? first(raw["organisation-city-buyer"]),
    buyerPhone: first(raw["organisation-tel-buyer"]),
    deadline: date(first(raw["deadline-receipt-tender-date-lot"])),
    estimatedValue: Number.isFinite(value) && value > 0 ? value : null,
    currency: first(raw["estimated-value-cur-lot"]),
    description: pick(raw["description-lot"] as Multi)?.slice(0, 1500) ?? null,
    url: `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}`,
  };
}

/** Expert query for TED (exported for tests). */
export function tedQuery(search: TedSearch): string {
  const countries = search.countries.map((c) => ISO2_TO_ISO3[c]).filter(Boolean);
  const parts = [`classification-cpv IN (${TED_CPV_CODES.join(" ")})`, `notice-type IN (${NOTICE_TYPES.join(" ")})`, `publication-date>=${search.since.replaceAll("-", "")}`];
  if (countries.length) parts.push(`buyer-country IN (${countries.join(" ")})`);
  return parts.join(" AND ");
}

const realTedFetch: TedFetch = async (search) => {
  const res = await fetch(TED_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: tedQuery(search), fields: FIELDS, limit: Math.min(search.limit, 100), page: 1, scope: "ACTIVE" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`TED search failed: HTTP ${res.status}`);
  const data = (await res.json()) as { notices?: Record<string, unknown>[] };
  return (data.notices ?? []).map(mapTedNotice).filter((n): n is TedNotice => n !== null);
};

let override: TedFetch | undefined;

/** E2E and offline demos: TED_API=off returns no notices (never set in production). */
const offline: TedFetch = async () => [];

export function getTedFetch(): TedFetch {
  return override ?? (process.env.TED_API === "off" ? offline : realTedFetch);
}

export function setTedFetchForTests(fn: TedFetch | undefined): void {
  override = fn;
}
