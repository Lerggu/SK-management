import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/platform/authz/permissions";
import fi from "./messages/fi.json";
import en from "./messages/en.json";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const flatFi = flatten(fi as Tree);
const flatEn = flatten(en as Tree);
const src = sourceFiles(join(process.cwd(), "src"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("i18n catalogues", () => {
  it("Finnish and English have exactly the same keys", () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatFi).sort());
  });

  it("no empty translations", () => {
    for (const [k, v] of [...Object.entries(flatFi), ...Object.entries(flatEn)]) expect(v, k).not.toBe("");
  });

  it("every validation key used in code is translated", () => {
    const used = new Set([...src.matchAll(/"(validation\.[A-Za-z]+)"/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) expect(flatFi[key], key).toBeDefined();
  });

  it("every permission has a label", () => {
    for (const p of ALL_PERMISSIONS) expect((fi as Tree & { settings: { permissions: Record<string, string> } }).settings.permissions[p.replaceAll(".", "_")], p).toBeDefined();
  });

  it("every audit action written by the code has a label", () => {
    const actions = new Set([...src.matchAll(/action: "([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]));
    expect(actions.size).toBeGreaterThan(20);
    const labels = (fi as unknown as { audit: { actions: Record<string, string> } }).audit.actions;
    for (const a of actions) expect(labels[a.replaceAll(".", "_")], a).toBeDefined();
  });
});
