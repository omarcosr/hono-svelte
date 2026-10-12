import { test as base, expect } from "@playwright/test";

/**
 * Every test fails on browser-side problems the assertions don't look for:
 * console errors/warnings (hydration mismatches, Svelte runtime errors),
 * uncaught exceptions and failed sub-resource requests (404 assets).
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        // HTTP failures are reported by the response listener (sub-resources only).
        if (m.text().startsWith("Failed to load resource")) return;
        if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("response", (r) => {
        if (r.status() >= 400 && r.request().resourceType() !== "document") problems.push(`${r.status()} ${r.url()}`);
      });
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const isHonoSvelte = (project: string) => project.startsWith("hono-svelte");
