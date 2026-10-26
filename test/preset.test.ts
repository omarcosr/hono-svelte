import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectRuntime, honoSvelte } from "../src/vite.js";

describe("honoSvelte() preset", () => {
  async function inApp(fn: (root: string) => Promise<void>): Promise<void> {
    const cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "hs-preset-"));
    try {
      mkdirSync(join(root, "src", "pages"), { recursive: true });
      writeFileSync(join(root, "src", "pages", "index.svelte"), "<h1>hi</h1>\n");
      writeFileSync(join(root, "src", "pages", "app.svelte"), "<script>let n = 1;</script><p>{n}</p>\n");
      process.chdir(root);
      await fn(root);
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("client mode: svelte + pages, manifest on, page entries + styles as input", async () => {
    await inApp(async (root) => {
      const config = honoSvelte({ entry: "src/server.ts" });
      const cfg = await config({ command: "build", mode: "client", isSsrBuild: false, isPreview: false });
      const build = cfg.build as { manifest?: boolean; outDir?: string; rollupOptions: { input: Record<string, string> } };
      expect(build.manifest).toBe(true);
      expect(build.outDir).toBe("dist");
      expect(Object.keys(build.rollupOptions.input).sort()).toEqual(["app", "styles"]);
      expect(build.rollupOptions.input.styles).toBe(resolve(root, "src/styles.css"));
      const names = (cfg.plugins as { name?: string }[]).flat().map((p) => p?.name ?? "");
      expect(names).toContain("hono-svelte-pages");
      expect(names).toContain("hono-svelte-precompress");
      expect(names.some((n) => n.includes("vite-plugin-svelte"))).toBe(true);
      expect(config.pages.entries()).toEqual(["app", "index"]);
      expect(config.pages.dtsPath()).toBe(resolve(root, "src/hono-svelte-entries.d.ts"));
    });
  });

  it("styles: false drops the stylesheet input; dts can be turned off", async () => {
    await inApp(async () => {
      const config = honoSvelte({ styles: false, dts: false, outDir: "./build/" });
      const cfg = await config({ command: "build", mode: "client", isSsrBuild: false, isPreview: false });
      const build = cfg.build as { outDir?: string; rollupOptions: { input: Record<string, string> } };
      expect(Object.keys(build.rollupOptions.input)).toEqual(["app"]);
      expect(build.outDir).toBe("build");
      expect(config.pages.dtsPath()).toBeNull();
      for (const staticFiles of [false, { precompressed: false }] as const) {
        const off = await honoSvelte({ styles: false, dts: false, staticFiles })({ command: "build", mode: "client", isSsrBuild: false, isPreview: false });
        expect((off.plugins as { name?: string }[]).flat().map((p) => p?.name)).not.toContain("hono-svelte-precompress");
      }
    });
  });

  it("server modes name the missing optional peer", async () => {
    const config = honoSvelte({ pagesDir: "test/fixtures/pages", dts: false });
    await expect(config({ command: "serve", mode: "development", isSsrBuild: false, isPreview: false })).rejects.toThrow(
      /@hono\/vite-dev-server/,
    );
    await expect(config({ command: "build", mode: "production", isSsrBuild: true, isPreview: false })).rejects.toThrow(
      /@hono\/vite-build/,
    );
  });

  it("detectRuntime: Bun global, bun run user agent or a bun lockfile mean bun", () => {
    const agent = process.env.npm_config_user_agent;
    const cwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "hs-rt-"));
    try {
      process.chdir(root);
      process.env.npm_config_user_agent = "npm/10.0.0 node/v24.0.0";
      const underBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
      expect(detectRuntime()).toBe(underBun ? "bun" : "node");
      process.env.npm_config_user_agent = "bun/1.4.0 npm/? node/v24.0.0";
      expect(detectRuntime()).toBe("bun");
      process.env.npm_config_user_agent = "npm/10.0.0 node/v24.0.0";
      writeFileSync(join(root, "bun.lock"), "");
      expect(detectRuntime()).toBe("bun");
    } finally {
      process.chdir(cwd);
      if (agent === undefined) delete process.env.npm_config_user_agent;
      else process.env.npm_config_user_agent = agent;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
