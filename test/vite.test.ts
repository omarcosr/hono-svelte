import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getIds } from "../src/ids.js";
import { MANIFEST_RESOLVED, MANIFEST_ID, ENTRY_PREFIX } from "../src/virtual.js";
import { pages } from "../src/vite.js";
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function makePlugin() {
  const plugin = pages({ pagesDir: "test/fixtures/pages" });
  plugin.configResolved({ root: pkgRoot } as never);
  plugin.buildStart();
  return plugin;
}

describe("pages() plugin", () => {
  it("detects static vs client and ignores partials", () => {
    const plugin = makePlugin();
    expect(plugin.entries()).toEqual(["admin", "home"]);
    expect(plugin.staticEntries()).toEqual(["home"]);
    expect(plugin.hasClient("admin")).toBe(true);
    expect(plugin.hasClient("home")).toBe(false);
    expect(plugin.hasClient("inexistente")).toBe(false);
  });

  it("input() only includes JS entries via virtual ids", () => {
    const input = makePlugin().input();
    expect(Object.keys(input)).toEqual(["admin"]);
    expect(input.admin).toBe(String.fromCharCode(0) + ENTRY_PREFIX + "admin");
  });

  it("resolveId maps the shell relative import and the manifest", () => {
    const plugin = makePlugin();
    expect(plugin.resolveId("./ssr-manifest.js")).toBe(MANIFEST_RESOLVED);
    expect(plugin.resolveId(MANIFEST_ID)).toBe(MANIFEST_RESOLVED);
    expect(plugin.resolveId(ENTRY_PREFIX + "admin")).toBe(String.fromCharCode(0) + ENTRY_PREFIX + "admin");
  });

  it("virtual manifest lists entries and static loaders", () => {
    const manifest = makePlugin().load(MANIFEST_RESOLVED) as string;
    expect(manifest).toContain('clientEntries = ["admin"]');
    expect(manifest).toContain('staticEntries = ["home"]');
    expect(manifest).toContain('"home": () => import("/test/fixtures/pages/home.svelte")');
    expect(manifest).toContain("hasClient");
  });

  it("virtual entry embeds the opaque ids and the mount", () => {
    const plugin = makePlugin();
    const ids = getIds("admin");
    const code = plugin.load(String.fromCharCode(0) + ENTRY_PREFIX + "admin") as string;
    expect(code).toContain(`document.getElementById("${ids.rootId}")`);
    expect(code).toContain(`document.getElementById("${ids.dataId}")`);
    expect(code).toContain('from "svelte"');
    expect(code).toContain('"/test/fixtures/pages/admin.svelte"');
  });

  it("missing entry fails with a clear error", () => {
    const plugin = makePlugin();
    expect(() => plugin.load(String.fromCharCode(0) + ENTRY_PREFIX + "missing")).toThrowError(/no page found/);
  });

  it("types() returns the entry union", () => {
    expect(makePlugin().types()).toBe('"admin" | "home"');
  });

  it("typeDeclarations() emits the hono module snippet", () => {
    const decl = makePlugin().typeDeclarations();
    expect(decl).toContain("HonoSvelteEntries");
    expect(decl).toContain('declare module "hono"');
    expect(decl).toContain('"admin" | "home"');
  });

  it("virtual manifest lists all entries", () => {
    const manifest = makePlugin().load(MANIFEST_RESOLVED) as string;
    expect(manifest).toContain('allEntries = ["admin","home"]');
    expect(manifest).toContain("__allEntries");
  });

  it("validateConfig() fails on missing svelte plugin", () => {
    const plugin = makePlugin();
    plugin.configResolved({ root: "/x", plugins: [], mode: "client" } as never);
    expect(() => plugin.validateConfig!()).toThrowError(/svelte plugin/);
  });

  it("nested layouts resolve chains without becoming entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-nested-"));
    try {
      mkdirSync(join(dir, "nested"), { recursive: true });
      writeFileSync(join(dir, "nested", "layout.svelte"), "<div><slot /></div>\n");
      writeFileSync(join(dir, "nested", "page.svelte"), "<script>let x = 1;</script><p>{x}</p>\n");
      const plugin = pages({ pagesDir: dir });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      expect(plugin.entries()).toEqual(["nested/page"]);
      expect(plugin.layouts()).toEqual(["nested/layout"]);
      expect(plugin.layoutChain("nested/page")).toEqual(["nested/layout"]);
      const manifest = plugin.load(MANIFEST_RESOLVED) as string;
      expect(manifest).toContain("nested/layout");
      const code = plugin.load(
        String.fromCharCode(0) + ENTRY_PREFIX + "nested/page",
      ) as string;
      expect(code).toContain("Layout0");
      expect(code).toContain("hydrate(Layout0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("layouts:false restores legacy ignore behavior", () => {
    const plugin = pages({ pagesDir: "test/fixtures/pages", layouts: false });
    plugin.configResolved({ root: pkgRoot } as never);
    plugin.buildStart();
    expect(plugin.entries()).toEqual(["admin", "home"]);
    expect(plugin.layouts()).toEqual([]);
    expect(plugin.layoutChain("admin")).toEqual([]);
  });

  it("dts is off by default (no file written)", () => {
    const plugin = makePlugin();
    expect(plugin.dtsPath()).toBeNull();
    expect(plugin.writeDts()).toBeNull();
  });

  it("dts:true writes the entries union + hono augmentation", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-dts-"));
    try {
      const out = join(dir, "entries.d.ts");
      const plugin = pages({ pagesDir: "test/fixtures/pages", dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      expect(plugin.dtsPath()).toBe(out);
      expect(existsSync(out)).toBe(true);
      const content = readFileSync(out, "utf8");
      expect(content).toContain("HonoSvelteEntries");
      expect(content).toContain('"admin" | "home"');
      expect(content).toContain('declare module "hono"');
      // regenerating with identical entries skips the rewrite
      expect(plugin.writeDts()).toBe(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dts regenerates when entries change", () => {
    const pagesDir = mkdtempSync(join(tmpdir(), "hs-dts-pages-"));
    const outDir = mkdtempSync(join(tmpdir(), "hs-dts-out-"));
    try {
      writeFileSync(join(pagesDir, "a.svelte"), "<h1>a</h1>\n");
      const out = join(outDir, "entries.d.ts");
      const plugin = pages({ pagesDir, dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      expect(readFileSync(out, "utf8")).toContain('"a"');
      writeFileSync(join(pagesDir, "b.svelte"), "<h1>b</h1>\n");
      plugin.buildStart();
      const content = readFileSync(out, "utf8");
      expect(content).toContain('"a" | "b"');
    } finally {
      rmSync(pagesDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});