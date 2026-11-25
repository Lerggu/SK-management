// Summarises docs/journeys/*/*/report.json as Markdown (stdout).
import { readdirSync, readFileSync, existsSync } from "node:fs";
const root = "docs/journeys";
const out = ["# Role journeys", ""];
for (const project of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  out.push(`## ${project}`, "", "| Role | Steps | Failed | Console errors | Untranslated | Overflow | Small targets |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const role of readdirSync(`${root}/${project}`)) {
    const f = `${root}/${project}/${role}/report.json`;
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, "utf8"));
    const sum = (k) => r.results.reduce((a, s) => a + (Array.isArray(s[k]) ? s[k].length : s[k] ? 1 : 0), 0);
    out.push(`| ${role} | ${r.steps} | ${r.failed} | ${sum("consoleErrors")} | ${sum("untranslated")} | ${sum("horizontalOverflow")} | ${sum("smallTargets")} |`);
  }
  out.push("");
}
console.log(out.join("\n"));
