// Pages from several folders: the app's own (test/fixtures/multi-app/pages,
// the Vite root) and a sibling package's (test/fixtures/multi-core/pages,
// outside the root), as a monorepo app sharing a core package's admin pages.
// Real Vite: svelte() + pages(), a client + server build and a dev server.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createManifestAssets, type ViteManifest } from "../src/assets.js";
import { DEV_CSS_KEY, ENTRY_PREFIX, MANIFEST_RESOLVED } from "../src/virtual.js";
import { pages, type PagesOptions } from "../src/vite.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const root = join(fixtures, "multi-app");
const coreDir = join(fixtures, "multi-core/pages");
const pagesDir = [join(root, "pages"), coreDir];

function multiPages(options: PagesOptions = {}, command = "build") {
  const plugin = pages({ pagesDir, hydrate: ["admin/counter"], stylesEntry: false, ...options });
  (plugin.configResolved as (config: unknown) => void)({ root, plugins: [], mode: "client", command });
  return plugin;
}

describe("pagesDir with several folders", () => {
  it("names entries relative to their own folder", () => {
    const plugin = multiPages();
    expect(plugin.entries()).toEqual(["home", "admin/counter", "admin/users/index"]);
    expect(plugin.staticEntries()).toEqual(["home", "admin/users/index"]);
    expect(plugin.layouts()).toEqual(["layout", "admin/layout"]);
  });

  it("a layout wraps only the pages of its own folder", () => {
    const plugin = multiPages();
    expect(plugin.layoutChain("home")).toEqual(["layout"]);
    expect(plugin.layoutChain("admin/users/index")).toEqual(["admin/layout"]);
    const manifest = plugin.load(MANIFEST_RESOLVED) as string;
    expect(manifest).toContain('ssrPages.__layoutChains = {"home":["layout"],"admin/counter":["admin/layout"],"admin/users/index":["admin/layout"]};');
  });

  it("a single folder keeps the name-based chain (no __layoutChains)", () => {
    const plugin = pages({ pagesDir: join(root, "pages") });
    plugin.configResolved({ root } as never);
    expect(plugin.load(MANIFEST_RESOLVED) as string).not.toContain("__layoutChains");
  });

  it("the same entry name in two folders fails, naming both files", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-clash-"));
    try {
      for (const sub of ["a", "b"]) {
        mkdirSync(join(dir, sub, "admin"), { recursive: true });
        writeFileSync(join(dir, sub, "admin", "users.svelte"), "<p>users</p>\n");
      }
      const plugin = pages({ pagesDir: [join(dir, "a"), join(dir, "b")] });
      plugin.configResolved({ root: join(dir, "a") } as never);
      expect(() => plugin.entries()).toThrowError(
        /duplicate entry "admin\/users": .*[\\/]a[\\/]admin[\\/]users\.svelte and .*[\\/]b[\\/]admin[\\/]users\.svelte/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies `ignore` in every folder", () => {
    expect(multiPages({ ignore: ["**/users/**"] }).entries()).toEqual(["home", "admin/counter"]);
  });

  it("the d.ts lists the entries of both folders", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-multi-dts-"));
    try {
      const out = multiPages({ dts: join(dir, "entries.d.ts") }).writeDts() as string;
      expect(readFileSync(out, "utf8")).toContain('export type HonoSvelteEntries = "home" | "admin/counter" | "admin/users/index";');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("guards server-only modules outside the root too", () => {
    const plugin = multiPages({}, "serve");
    expect(() => (plugin.load as (id: string) => unknown)(join(fixtures, "multi-core/src/server/db.ts"))).toThrowError(
      /multi-core\/src\/server\/db\.ts is server-only/,
    );
    expect((plugin.load as (id: string) => unknown)(join(fixtures, "multi-core/src/lib/db.ts"))).toBeNull();
  });
});

describe("vite build (client + server) with a folder outside the root", () => {
  const outDir = mkdtempSync(join(tmpdir(), "hono-svelte-multi-"));
  let manifest: ViteManifest;
  let app: { request: (p: string) => Promise<Response> };

  beforeAll(async () => {
    const client = multiPages();
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      mode: "client",
      plugins: [svelte(), client],
      build: { outDir, emptyOutDir: true, manifest: true, rollupOptions: { input: client.input() } },
    });
    manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8")) as ViteManifest;
    const serverDir = join(outDir, "server");
    // vitest sets NODE_ENV=test, which would compile `import.meta.env.PROD` to false.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [svelte(), pages({ pagesDir, hydrate: ["admin/counter"], stylesEntry: false, clientManifest: join(outDir, ".vite", "manifest.json") })],
        ssr: { noExternal: true },
        build: { ssr: join(root, "server.ts"), outDir: serverDir, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "server.mjs" } } },
      });
      app = (await import(pathToFileURL(join(serverDir, "server.mjs")).href)).default as typeof app;
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const linkedCss = (html: string) =>
    [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map((m) => readFileSync(join(outDir, m[1]), "utf8")).join("");

  it("a static page from the second folder: its own layout and CSS, no JS, not the app's layout", async () => {
    const html = await (await app.request("/admin/users")).text();
    expect(html).toContain("Static admin users");
    expect(html).toContain("admin-nav");
    expect(html).not.toContain("app-nav");
    const css = linkedCss(html);
    expect(css).toContain(".admin-theme"); // admin.css, imported by admin/layout
    expect(css).toMatch(/article\.svelte-[\w-]+\{color:(goldenrod|#daa520)/);
    expect(html).not.toContain("<script");
  });

  it("an interactive page from the second folder is hydrated with its bundle", async () => {
    const html = await (await app.request("/admin/counter")).text();
    expect(html).toContain("Admin clicked 0");
    expect(html).toContain("admin-nav");
    expect(html).not.toContain("app-nav");
    const src = createManifestAssets(manifest)("admin/counter");
    expect(html).toContain(`src="${src}"`);
    expect(existsSync(join(outDir, src.slice(1)))).toBe(true);
  });

  it("the app's own pages keep the app's layout", async () => {
    const html = await (await app.request("/")).text();
    expect(html).toContain("App home");
    expect(html).toContain("app-nav");
    expect(html).not.toContain("admin-nav");
  });
});

describe("dev server with a folder outside the root", () => {
  const added = join(coreDir, "admin", "added.svelte");
  const cacheDir = mkdtempSync(join(tmpdir(), "hono-svelte-multi-vite-"));
  let server: ViteDevServer;
  let plugin: ReturnType<typeof pages>;

  beforeAll(async () => {
    plugin = pages({ pagesDir, hydrate: ["admin/counter"] });
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      appType: "custom",
      // Own pre-bundle cache: another test file runs a dev server on the shared one at the same time.
      cacheDir,
      server: { middlewareMode: true, ws: false },
      plugins: [svelte(), plugin],
    });
  }, 60_000);

  afterAll(async () => {
    rmSync(added, { force: true });
    await server?.close();
    rmSync(cacheDir, { recursive: true, force: true });
    delete (globalThis as Record<symbol, unknown>)[DEV_CSS_KEY];
  });

  it("allows the outside folder while keeping Vite's default", () => {
    const allow = server.config.server.fs.allow.map((p) => p.replace(/\\/g, "/").toLowerCase());
    expect(allow).toContain(coreDir.replace(/\\/g, "/").toLowerCase());
    expect(allow.length).toBeGreaterThan(1);
  });

  it("renders a page of the second folder and compiles it for the client", async () => {
    const app = (await server.ssrLoadModule(join(root, "server.ts"))).default as { request: (p: string) => Promise<Response> };
    const html = await (await app.request("/admin/counter")).text();
    expect(html).toContain("Admin clicked 0");
    expect(html).toMatch(/<style data-vite-dev-id="[^"]+admin\.css">[^<]*slateblue/);
    const entry = await server.environments.client.transformRequest(ENTRY_PREFIX + "admin/counter");
    expect(entry?.code).toContain("multi-core/pages/admin/counter.svelte");
  });

  it("picks up a page added to the second folder without a restart", async () => {
    writeFileSync(added, "<p>Added later</p>\n");
    await vi.waitFor(() => expect(plugin.entries()).toContain("admin/added"), { timeout: 10_000, interval: 50 });
    rmSync(added);
    await vi.waitFor(() => expect(plugin.entries()).not.toContain("admin/added"), { timeout: 10_000, interval: 50 });
  });
});
