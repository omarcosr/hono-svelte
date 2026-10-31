// Contract with the real bundler: a client `vite build` (svelte() + pages(),
// manifest on) must emit the manifest keys `manifestKeysFor` looks up and the
// file names the shell links — the unit tests only ever see hand-written manifests.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManifestAssets, manifestCssFor, manifestKeyFor, type ViteManifest } from "../src/assets.js";
import { clientBundlesDeps, precompress } from "../src/preset.js";
import { pages } from "../src/vite.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/build-app");
const outDir = mkdtempSync(join(tmpdir(), "hono-svelte-client-"));
let manifest: ViteManifest;
let appPages: ReturnType<typeof pages>;

beforeAll(async () => {
  appPages = pages({ pagesDir: join(fixture, "pages"), stylesEntry: "styles.css" });
  // input() is read inside the config, before Vite resolves it — like an app's vite.config.ts.
  (appPages.configResolved as (config: unknown) => void)({ root: fixture, plugins: [], mode: "client", command: "build" });
  await build({
    root: fixture,
    configFile: false,
    logLevel: "silent",
    mode: "client",
    plugins: [svelte(), appPages, precompress()],
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input: appPages.input(),
        output: {
          entryFileNames: "static/[name]-[hash].js",
          chunkFileNames: "static/chunks/[name]-[hash].js",
          assetFileNames: "static/[name]-[hash][extname]",
        },
      },
    },
  });
  manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8")) as ViteManifest;
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("vite build (client)", () => {
  it("every client entry is reachable through manifestKeysFor", () => {
    const entries = appPages.entries().filter((e) => appPages.hasClient(e));
    expect(entries).toEqual(["docs/counter"]);
    for (const entry of entries) {
      const key = manifestKeyFor(manifest, entry);
      expect(key, `manifest key for ${entry} (have: ${Object.keys(manifest).join(", ")})`).toBeDefined();
      expect(manifest[key as string].isEntry).toBe(true);
    }
  });

  it("resolved files exist on disk and carry a hash", () => {
    const url = createManifestAssets(manifest);
    for (const entry of appPages.entries().filter((e) => appPages.hasClient(e))) {
      const href = url(entry);
      expect(href).toMatch(/^\/static\/.+-[\w-]+\.js$/);
      expect(existsSync(join(outDir, href.slice(1)))).toBe(true);
      for (const css of manifestCssFor(manifest, entry)) {
        expect(existsSync(join(outDir, css.slice(1)))).toBe(true);
      }
    }
  });

  it("precompress() writes .br and .gz next to the client files", () => {
    const js = join(outDir, createManifestAssets(manifest)("docs/counter").slice(1));
    const source = readFileSync(js);
    expect(brotliDecompressSync(readFileSync(js + ".br")).equals(source)).toBe(true);
    expect(gunzipSync(readFileSync(js + ".gz")).equals(source)).toBe(true);
    expect(readFileSync(js + ".br").length).toBeLessThan(source.length);
  });

  it("the stylesEntry lands in the manifest under its source path", () => {
    expect(manifest["styles.css"]?.file).toMatch(/^static\/styles-[\w-]+\.css$/);
  });

});

// The server build embeds the client manifest above, as `honoSvelte()` does.
describe("vite build (client + server): a static page", () => {
  let page: string;

  beforeAll(async () => {
    const serverDir = mkdtempSync(join(tmpdir(), "hono-svelte-server-"));
    // vitest sets NODE_ENV=test, which would compile `import.meta.env.PROD` to false.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({
        root: fixture,
        configFile: false,
        logLevel: "silent",
        plugins: [svelte(), pages({ pagesDir: join(fixture, "pages"), stylesEntry: "styles.css", clientManifest: join(outDir, ".vite", "manifest.json") })],
        ssr: { noExternal: true },
        build: { ssr: join(fixture, "server.ts"), outDir: serverDir, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "server.mjs" } } },
      });
      const app = (await import(pathToFileURL(join(serverDir, "server.mjs")).href)).default as { request: (p: string) => Promise<Response> };
      page = await (await app.request("/docs")).text();
    } finally {
      process.env.NODE_ENV = nodeEnv;
      rmSync(serverDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("links the CSS of its layout, of what the layout imports and its own, and ships no JS", () => {
    const css = [...page.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map((m) => readFileSync(join(outDir, m[1]), "utf8")).join("");
    expect(css).toContain(".docs-theme"); // docs.css, imported by docs/layout
    expect(css).toContain(".docs-nav"); // docs/layout's <style>
    expect(css).toMatch(/article\.svelte-[\w-]+\{color:(goldenrod|#daa520)/); // the page's own <style>
    expect(page).toContain("Static docs page");
    expect(page).not.toContain("<script");
    expect(page).not.toContain("modulepreload");
  });

  it("drops the inline copies of the styles it links", () => {
    expect(page).not.toMatch(/<style id="svelte-/);
  });
});

// `@hono/vite-build` puts its `external` list on the top-level build, which the
// client environment inherits: the browser then gets a bare `import "svelte/…"`.
describe("vite build (client) with an inherited external list", () => {
  async function clientChunks(extraPlugins: Plugin[]): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "hono-svelte-client-ext-"));
    try {
      const appPages = pages({ pagesDir: join(fixture, "pages") });
      (appPages.configResolved as (config: unknown) => void)({ root: fixture, plugins: [], mode: "client", command: "build" });
      await build({
        root: fixture,
        configFile: false,
        logLevel: "silent",
        plugins: [svelte(), appPages, ...extraPlugins],
        build: { outDir: dir, emptyOutDir: true, rollupOptions: { input: appPages.input(), external: ["svelte", /^svelte\//] } },
      });
      return readdirSync(dir, { recursive: true })
        .filter((f) => String(f).endsWith(".js"))
        .map((f) => readFileSync(join(dir, String(f)), "utf8"))
        .join("\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const bareSvelte = /(?:from|import)\s*["']svelte(?:\/[^"']*)?["']/;

  it("without the fix the bundle keeps bare imports", async () => {
    expect(await clientChunks([])).toMatch(bareSvelte);
  }, 60_000);

  it("clientBundlesDeps() bundles them into the client", async () => {
    expect(await clientChunks([clientBundlesDeps()])).not.toMatch(bareSvelte);
  }, 60_000);
});
