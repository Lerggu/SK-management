import { describe, expect, it } from "vitest";
import { activeNavKey } from "./nav-active";

const groups = [
  { items: [{ key: "dashboard", href: "/c/x/dashboard" }] },
  {
    items: [
      { key: "workforce", href: "/c/x/workforce" },
      { key: "myCard", href: "/c/x/workforce/me-id" },
      { key: "teams", href: "/c/x/workforce/teams" },
    ],
  },
  { items: [{ key: "projects", href: "/c/x/projects", match: ["/c/x/diary"] }] },
];

describe("activeNavKey", () => {
  it("picks the most specific item", () => {
    expect(activeNavKey(groups, "/c/x/workforce/teams")).toBe("teams");
    expect(activeNavKey(groups, "/c/x/workforce/teams/abc")).toBe("teams");
    expect(activeNavKey(groups, "/c/x/workforce/me-id")).toBe("myCard");
    expect(activeNavKey(groups, "/c/x/workforce/other-id")).toBe("workforce");
    expect(activeNavKey(groups, "/c/x/workforce")).toBe("workforce");
    expect(activeNavKey(groups, "/c/x/diary/r1")).toBe("projects");
    expect(activeNavKey(groups, "/c/x/workforcex")).toBeNull();
    expect(activeNavKey(groups, "/c/x/settings")).toBeNull();
  });
});
