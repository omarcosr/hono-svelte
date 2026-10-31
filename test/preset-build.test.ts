// `honoSvelte()` end to end: one `vite build` with the real @hono/vite-build
// builds the client and the server (test/fixtures/asset-app). An asset the
// server renders must have the URL of the file the client build publishes.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ViteManifest } from "../src/assets.js";
import { honoSvelte } from "../src/vite.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/asset-app");
const outDir = join(fixture, "dist");
let manifest: ViteManifest;
let html: string;

beforeAll(async () => {
  const cwd = process.cwd();
  // vitest sets NODE_ENV=test, which would compile `import.meta.env.PROD` to false.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  // The preset resolves its paths (entry, pages, outDir) from the working directory, like a Vite config.
  process.chdir(fixture);
  try {
    const config = await honoSvelte({ runtime: "bun", dts: false, staticFiles: false, build: { entryContentBeforeHooks: [] } })({
      command: "build",
      mode: "production",
      isSsrBuild: false,
      isPreview: false,
    });
    const builder = await createBuilder({ ...config, root: fixture, configFile: false, logLevel: "silent" });
    await builder.buildApp();
    manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8")) as ViteManifest;
    const app = (await import(pathToFileURL(join(outDir, "index.js")).href)).default as { request: (p: string) => Promise<Response> };
    html = await (await app.request("/")).text();
  } finally {
    process.chdir(cwd);
    process.env.NODE_ENV = nodeEnv;
  }
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("honoSvelte() build: asset URLs", () => {
  it("a `?url` asset rendered on the server has the client manifest's URL", () => {
    const font = "/" + manifest["src/assets/font.woff2"]?.file;
    expect(font).toMatch(/^\/static\/font-[\w-]+\.woff2$/);
    expect(existsSync(join(outDir, font))).toBe(true);
    expect(html).toContain(`<link rel="preload" href="${font}"`);
    expect(html).not.toContain("/assets/");
  });

  it("CSS `url()` references point at the same file", () => {
    const font = "/" + manifest["src/assets/font.woff2"]?.file;
    // The global stylesheet the server-rendered page links.
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map((m) => m[1]);
    expect(sheets).toContain(manifest["src/styles.css"]?.file);
    const css = sheets.map((href) => readFileSync(join(outDir, href), "utf8")).join("");
    expect(css).toContain(`url(${font})`);
  });
});
