import { describe, expect, it } from "vitest";
import { mapTedNotice, tedQuery } from "./ted";

describe("TED integration", () => {
  it("builds the expert query with CPV codes, notice types, date and ISO-3 countries", () => {
    const q = tedQuery({ countries: ["FI", "SE", "ZZ"], since: "2026-11-01", limit: 50 });
    expect(q).toContain("classification-cpv IN (45310000");
    expect(q).toContain("notice-type IN (cn-standard");
    expect(q).toContain("publication-date>=20261101");
    expect(q).toContain("buyer-country IN (FIN SWE)");
  });

  it("maps a raw notice: English title part, decoded entities, ISO-2 country, value and link", () => {
    const n = mapTedNotice({
      "publication-number": "713083-2026",
      "notice-title": { swe: "Sverige – Elinstallation – Köpare / Fastighet &amp; El", eng: "Sweden – Electrical installation – Buyer / Property &amp; Power" },
      "buyer-name": { swe: ["Motala kommun"] },
      "buyer-country": ["SWE"],
      "place-of-performance-city-lot": ["Motala"],
      "organisation-tel-buyer": ["0141225000"],
      "deadline-receipt-tender-date-lot": ["2026-11-17Z"],
      "estimated-value-lot": ["160000000"],
      "estimated-value-cur-lot": ["SEK"],
      "publication-date": "2026-10-15+02:00",
    });
    expect(n).toMatchObject({
      title: "Buyer / Property & Power",
      buyer: "Motala kommun",
      country: "SE",
      city: "Motala",
      buyerPhone: "0141225000",
      deadline: "2026-11-17",
      publishedAt: "2026-10-15",
      estimatedValue: 160000000,
      currency: "SEK",
      url: "https://ted.europa.eu/en/notice/-/detail/713083-2026",
    });
    expect(mapTedNotice({ "notice-title": { eng: "x" } })).toBeNull();
  });
});
