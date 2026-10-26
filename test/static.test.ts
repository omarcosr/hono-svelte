import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic as baseServeStatic } from "hono/serve-static";
import { afterAll, describe, expect, it } from "vitest";
import { CACHE_IMMUTABLE } from "../src/assets.js";
import { staticFilesHook } from "../src/preset.js";
import { CACHE_PUBLIC, staticFiles, type StaticFilesOptions } from "../src/static.js";

const root = mkdtempSync(join(tmpdir(), "hs-static-"));
mkdirSync(join(root, "static"));
mkdirSync(join(root, ".vite"));
writeFileSync(join(root, "static", "app-abc.js"), "console.log(1)");
writeFileSync(join(root, "static", "app-abc.js.br"), "BR");
writeFileSync(join(root, "static", "app-abc.js.map"), "{}");
writeFileSync(join(root, ".vite", "manifest.json"), "{}");
writeFileSync(join(root, "favicon.svg"), "<svg/>");
afterAll(() => rmSync(root, { recursive: true, force: true }));

// hono's runtime-neutral serveStatic, reading the disk like hono/bun does.
const serveStatic = (options: Parameters<typeof baseServeStatic>[0] extends infer O ? Omit<O, "getContent"> : never) =>
  baseServeStatic({
    ...options,
    getContent: async (path) => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },
  });

function app(options: StaticFilesOptions = {}) {
  const files = staticFiles(serveStatic, { root, ...options });
  const hono = new Hono();
  for (const path of ["/static/*", "/.vite/*", "/favicon.svg", "/missing.txt"]) hono.use(path, files);
  hono.all("*", (c) => c.text("app", 404));
  return hono;
}

describe("staticFiles()", () => {
  it("hashed files: immutable, precompressed variant when accepted", async () => {
    const res = await app().request("/static/app-abc.js", { headers: { "Accept-Encoding": "gzip, br" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_IMMUTABLE);
    expect(res.headers.get("Content-Encoding")).toBe("br");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");
    expect(await res.text()).toBe("BR");
    const plain = await app().request("/static/app-abc.js");
    expect(plain.headers.get("Content-Encoding")).toBeNull();
    expect(await plain.text()).toBe("console.log(1)");
  });

  it("precompressed: false serves the plain file", async () => {
    const res = await app({ precompressed: false }).request("/static/app-abc.js", { headers: { "Accept-Encoding": "br" } });
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });

  it("public files: short cache + ETag, 304 on a matching If-None-Match", async () => {
    const res = await app().request("/favicon.svg");
    expect(res.headers.get("Cache-Control")).toBe(CACHE_PUBLIC);
    const tag = res.headers.get("ETag");
    expect(tag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    const again = await app().request("/favicon.svg", { headers: { "If-None-Match": `"other", ${tag!.slice(2)}` } });
    expect(again.status).toBe(304);
    expect(again.headers.get("ETag")).toBe(tag);
    expect(again.headers.get("Cache-Control")).toBe(CACHE_PUBLIC);
    expect(await again.text()).toBe("");
    const stale = await app({ cacheControl: "no-cache" }).request("/favicon.svg", { headers: { "If-None-Match": '"other"' } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("source maps and .vite/ fall through to the app unless sourcemaps: true", async () => {
    for (const path of ["/static/app-abc.js.map", "/.vite/manifest.json"]) {
      const res = await app().request(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("app");
    }
    expect((await app({ sourcemaps: true }).request("/static/app-abc.js.map")).status).toBe(200);
  });

  it("a missing file reaches the app without static headers", async () => {
    const res = await app().request("/missing.txt");
    expect(res.status).toBe(404);
    expect(res.headers.get("ETag")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});

describe("staticFilesHook()", () => {
  it("imports the runtime's serveStatic and wraps every static path", () => {
    const bun = staticFilesHook("bun", { root: "./dist", sourcemaps: false })("mainApp", { staticPaths: ["/static/*", "/favicon.svg"] });
    expect(bun).toContain("import { serveStatic } from 'hono/bun'");
    expect(bun).toContain("import { staticFiles } from 'hono-svelte/static'");
    expect(bun).toContain('const hsStaticFiles = staticFiles(serveStatic, {"root":"./dist","sourcemaps":false})');
    expect(bun).toContain('mainApp.use("/static/*", hsStaticFiles)\nmainApp.use("/favicon.svg", hsStaticFiles)');
    expect(staticFilesHook("node", {})("app")).toContain("from '@hono/node-server/serve-static'");
  });
});
