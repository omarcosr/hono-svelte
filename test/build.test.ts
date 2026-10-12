// End-to-end: bundles test/fixtures/build-app with a real `vite build --ssr`
// (svelte() + pages()) and requests the built server. Unit tests render
// components through vitest's own transform, which hides how the production
// compiler treats CSS — this suite exercises the real pipeline.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pages } from "../src/vite.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/build-app");
const outDir = mkdtempSync(join(tmpdir(), "hono-svelte-build-"));

type BuiltApp = { request: (path: string) => Promise<Response> };
let app: BuiltApp;

beforeAll(async () => {
  await build({
    root: fixture,
    configFile: false,
    logLevel: "silent",
    plugins: [svelte(), pages({ pagesDir: join(fixture, "pages") })],
    ssr: { noExternal: true },
    build: {
      ssr: join(fixture, "server.ts"),
      outDir,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "server.mjs" } },
    },
  });
  app = (await import(pathToFileURL(join(outDir, "server.mjs")).href)).default as BuiltApp;
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const html = async (path: string) => {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  return res.text();
};

describe("vite build (ssr)", () => {
  it("static page ships zero JS", async () => {
    const page = await html("/landing");
    expect(page).toContain("Zero-JS landing");
    expect(page).not.toContain('<script type="module"');
  });

  it("static page keeps its component <style>", async () => {
    const page = await html("/landing");
    expect(page).toMatch(/<style[^>]*>[^<]*rebeccapurple/);
  });

  it("layout-wrapped static page keeps the page and the layout <style>", async () => {
    const page = await html("/docs");
    expect(page).toContain("Static docs page");
    expect(page).toMatch(/<style[^>]*>[^<]*goldenrod/);
    expect(page).toMatch(/<style[^>]*>[^<]*seagreen/);
  });
});
