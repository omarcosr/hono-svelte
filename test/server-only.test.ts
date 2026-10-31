// A layout that imports a server-only module (test/fixtures/leak-app): the
// client build must fail instead of writing that code into a public file, and
// the dev client must refuse to serve it. Real Vite, svelte() + pages().
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { describe, expect, it } from "vitest";
import { pages } from "../src/vite.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/leak-app");

function leakPages() {
  const appPages = pages({ pagesDir: join(fixture, "pages") });
  (appPages.configResolved as (config: unknown) => void)({ root: fixture, plugins: [], mode: "client", command: "build" });
  return appPages;
}

describe("server-only modules", () => {
  it("fail the client build, naming the module and who imported it", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "hono-svelte-leak-"));
    try {
      const appPages = leakPages();
      await expect(
        build({
          root: fixture,
          configFile: false,
          logLevel: "silent",
          plugins: [svelte(), appPages],
          build: { outDir, emptyOutDir: true, rollupOptions: { input: appPages.input() } },
        }),
      ).rejects.toThrow(/lib\/server\/secret\.ts is server-only but reached client code, imported by pages\/layout\.svelte/);
      // Nothing was written: the secret never reaches a public file.
      expect(readdirSync(outDir)).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("are refused by the dev client, and still load on the server", async () => {
    // Its own prebundle cache: dev-css.test.ts runs a dev server in parallel, and a
    // shared node_modules/.vite gets rewritten under it ("new version of the pre-bundle").
    const cacheDir = mkdtempSync(join(tmpdir(), "hono-svelte-leak-vite-"));
    const server = await createServer({
      root: fixture,
      cacheDir,
      configFile: false,
      logLevel: "silent",
      appType: "custom",
      server: { middlewareMode: true, ws: false },
      plugins: [svelte(), pages({ pagesDir: join(fixture, "pages") })],
    });
    try {
      await expect(server.environments.client.transformRequest("/lib/server/secret.ts")).rejects.toThrow(/server-only/);
      expect(((await server.ssrLoadModule("/lib/server/secret.ts")) as { secret: string }).secret).toBe("do-not-ship");
    } finally {
      await server.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);
});
