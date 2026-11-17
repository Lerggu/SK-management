import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "./canonical-host";

const OWN = "https://sk.skinfra.fi";
const OLD = "skinfra-management.azurewebsites.net";

describe("canonicalRedirect", () => {
  it("sends the default Azure host to the own domain, keeping path and query", () => {
    expect(canonicalRedirect(OLD, "/c/sk-infra/logistics", "?zoom=day", OWN)).toBe("https://sk.skinfra.fi/c/sk-infra/logistics?zoom=day");
    expect(canonicalRedirect(`${OLD}:443`, "/", "", `${OWN}/`)).toBe("https://sk.skinfra.fi/");
    expect(canonicalRedirect(`${OLD.toUpperCase()}, proxy`, "/sign-in", "", OWN)).toBe("https://sk.skinfra.fi/sign-in");
  });

  it("leaves the health check, the own domain and other hosts alone", () => {
    expect(canonicalRedirect(OLD, "/api/health", "", OWN)).toBeNull();
    expect(canonicalRedirect("sk.skinfra.fi", "/", "", OWN)).toBeNull();
    expect(canonicalRedirect("localhost:3000", "/", "", OWN)).toBeNull();
    expect(canonicalRedirect(null, "/", "", OWN)).toBeNull();
  });

  it("does nothing without an own https domain", () => {
    expect(canonicalRedirect(OLD, "/", "", undefined)).toBeNull();
    expect(canonicalRedirect(OLD, "/", "", `https://${OLD}`)).toBeNull();
    expect(canonicalRedirect(OLD, "/", "", "http://sk.skinfra.fi")).toBeNull();
    expect(canonicalRedirect(OLD, "/", "", "not a url")).toBeNull();
  });
});
