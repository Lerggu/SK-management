/**
 * Role journeys (exploratory usability runs, not part of the regular E2E).
 *
 * A journey walks one role through its real work on the demo site. Each step
 * is "soft": a failing step is recorded and the journey continues, so one run
 * shows every rough spot. Every step saves a screenshot and simple usability
 * measurements; the run writes docs/journeys/<project>/<role>/report.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { USERS, authFile } from "../e2e/helpers";

export type Role = keyof typeof USERS;

type StepResult = {
  n: number;
  title: string;
  ok: boolean;
  ms: number;
  url: string;
  screenshot: string | null;
  error?: string;
  consoleErrors: string[];
  untranslated: string[];
  horizontalOverflow: boolean;
  smallTargets: string[];
  note?: string;
};

export class Journey {
  readonly steps: StepResult[] = [];
  private consoleErrors: string[] = [];
  private n = 0;
  readonly dir: string;

  constructor(
    readonly page: Page,
    readonly testInfo: TestInfo,
    readonly role: Role,
  ) {
    this.dir = `docs/journeys/${testInfo.project.name}/${role}`;
    mkdirSync(this.dir, { recursive: true });
    // A step must fail fast instead of hanging until the whole test times out.
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(20_000);
    page.on("console", (m) => {
      if (m.type() === "error") this.consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
  }

  get mobile() {
    return this.testInfo.project.name === "mobile";
  }

  /** Runs one step; never throws. `note` is a free remark shown in the report. */
  async step(title: string, fn: () => Promise<void | string>) {
    const n = ++this.n;
    const t0 = Date.now();
    this.consoleErrors = [];
    let ok = true;
    let error: string | undefined;
    let note: string | undefined;
    try {
      const r = await fn();
      if (typeof r === "string") note = r;
    } catch (e) {
      ok = false;
      error = (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 6).join("\n").slice(0, 800);
    }
    const ms = Date.now() - t0;
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    const slug = title.toLowerCase().replace(/[^a-z0-9åäö]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50);
    const shot = `${this.dir}/${String(n).padStart(2, "0")}-${slug}.jpg`;
    let screenshot: string | null = shot;
    await this.page.screenshot({ path: shot, fullPage: true, type: "jpeg", quality: 55, timeout: 15_000 }).catch(() => (screenshot = null));
    const m = await this.measure().catch(() => ({ untranslated: [], horizontalOverflow: false, smallTargets: [] }));
    this.steps.push({ n, title, ok, ms, url: this.page.url().replace(/^https?:\/\/[^/]+/, ""), screenshot, error, consoleErrors: [...this.consoleErrors], ...m, note });
  }

  private async measure() {
    const mobile = this.mobile;
    return this.page.evaluate((mobile) => {
      const text = document.body.innerText;
      // next-intl shows a missing message as its key path, e.g. "logistics.fooBar".
      // E-mail local parts ("site.manager@…") and file names are not keys.
      const untranslated = [...new Set(text.match(/(?<![\w.@-])(?:[a-z]+[A-Za-z]*\.){1,3}[a-z][A-Za-z]+\b(?![\w.-]*@)(?!\.[a-z])/g) ?? [])].filter((s) => !/\.(fi|com|se|net|org|example|pdf|png|jpg|xlsx|csv|sh|md|txt)$/i.test(s)).slice(0, 10);
      // Sideways scrolling of the page, or any element sticking out of the viewport outside a scroll container.
      const clipped = (el: Element | null): boolean => {
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const o = getComputedStyle(e).overflowX;
          if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
        }
        return false;
      };
      const wide: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= window.innerWidth + 2 || clipped(el.parentElement)) continue;
        wide.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""} ${Math.round(r.right)}px`);
        if (wide.length >= 3) break;
      }
      const horizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 2 || wide.length > 0;
      const smallTargets: string[] = [];
      if (mobile) {
        for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")) {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue;
          // Links inside running text are exempt; controls should be ≥ 40 px tall.
          if (el.tagName === "A" && style.display === "inline") continue;
          // A checkbox or radio inside a tall label: the label is the target.
          const label = el.closest("label");
          if (label && (el as HTMLInputElement).type && ["checkbox", "radio", "file"].includes((el as HTMLInputElement).type) && label.getBoundingClientRect().height >= 40) continue;
          if (r.height < 40 || r.width < 40) smallTargets.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).name || "").trim().slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      if (wide.length) smallTargets.unshift(...wide.map((w) => `WIDE ${w}`));
      return { untranslated, horizontalOverflow, smallTargets: smallTargets.slice(0, 15) };
    }, mobile);
  }

  write() {
    const failed = this.steps.filter((s) => !s.ok).length;
    writeFileSync(`${this.dir}/report.json`, JSON.stringify({ role: this.role, project: this.testInfo.project.name, steps: this.steps.length, failed, results: this.steps }, null, 2));
  }
}

/** Opens a page signed in as the role, with the project's device settings. */
export async function openAs(browser: import("@playwright/test").Browser, testInfo: TestInfo, role: Role) {
  const ctx = await browser.newContext({ ...testInfo.project.use, storageState: authFile(role), locale: "fi-FI", timezoneId: "Europe/Helsinki" });
  return ctx.newPage();
}

export const COMPANY = "/c/sk-infra-demo";

/** A form label with or without the required marker (" *"), matched as the whole label. */
export function lbl(text: string) {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\*)?$`);
}
