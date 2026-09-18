import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getIds } from "../src/ids.js";
import { MANIFEST_RESOLVED, MANIFEST_ID, ENTRY_PREFIX } from "../src/virtual.js";
import { pages } from "../src/vite.js";
import { newPageFile } from "../src/scaffold.js";
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
    expect(manifest).toContain("__clientEntries");
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

  it("dataTypes() extracts export type Data from module scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-data-"));
    try {
      writeFileSync(
        join(dir, "typed.svelte"),
        '<script module lang="ts">export type Data = { plan: string };</script>\n<h1>typed</h1>\n',
      );
      writeFileSync(join(dir, "plain.svelte"), "<h1>plain</h1>\n");
      const out = join(dir, "entries.d.ts");
      const plugin = pages({ pagesDir: dir, dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      expect(plugin.dataTypes()).toEqual({ typed: "type Data = { plan: string };" });
      const content = readFileSync(out, "utf8");
      expect(content).toContain("type HonoSvelteData_typed = { plan: string };");
      expect(content).toContain(
        '(entryName: "typed", props?: import("hono-svelte").RenderProps<HonoSvelteData_typed>): Response | Promise<Response>;',
      );
      // typed overload first, union catch-all stays last
      expect(content.indexOf("HonoSvelteData_typed")).toBeLessThan(
        content.indexOf("entryName: HonoSvelteEntries"),
      );
      // the union catch-all is still present for untyped entries
      expect(content).toContain("(entryName: HonoSvelteEntries, props?: ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("interface Data and nested entry names get sanitized dts names", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-data2-"));
    try {
      mkdirSync(join(dir, "dash"), { recursive: true });
      writeFileSync(
        join(dir, "dash", "index.svelte"),
        '<script module lang="ts">export interface Data { seats: number }</script>\n<h1>d</h1>\n',
      );
      const out = join(dir, "entries.d.ts");
      const plugin = pages({ pagesDir: dir, dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      const content = readFileSync(out, "utf8");
      expect(content).toContain("interface HonoSvelteData_dash_index { seats: number };");
      expect(content).toContain(
        '(entryName: "dash/index", props?: import("hono-svelte").RenderProps<HonoSvelteData_dash_index>): Response | Promise<Response>;',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Data types referencing imports are skipped with a one-time warning", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-data3-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      writeFileSync(
        join(dir, "bad.svelte"),
        '<script module lang="ts">\n  import type { Plan } from "./plan";\n  export type Data = { plan: Plan };\n</script>\n<h1>bad</h1>\n',
      );
      const out = join(dir, "entries.d.ts");
      const plugin = pages({ pagesDir: dir, dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      plugin.buildStart(); // refresh again: still one warning
      expect(plugin.dataTypes()).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('page "bad"');
      expect(warn.mock.calls[0][0]).toContain("Plan");
      const content = readFileSync(out, "utf8");
      expect(content).not.toContain("HonoSvelteData_bad");
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dts regenerates when a page's Data type changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-data4-"));
    const out = join(dir, "entries.d.ts");
    try {
      writeFileSync(
        join(dir, "a.svelte"),
        '<script module lang="ts">export type Data = { plan: string };</script>\n<h1>a</h1>\n',
      );
      const plugin = pages({ pagesDir: dir, dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      expect(readFileSync(out, "utf8")).toContain("plan: string");
      writeFileSync(
        join(dir, "a.svelte"),
        '<script module lang="ts">export type Data = { plan: string; seats: number };</script>\n<h1>a</h1>\n',
      );
      plugin.buildStart();
      expect(readFileSync(out, "utf8")).toContain("seats: number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`add page` template is detected as a static page (no script-tag false positives)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-add-static-"));
    try {
      const template = newPageFile("demo")?.content ?? "";
      writeFileSync(join(dir, "demo.svelte"), template);
      const plugin = pages({ pagesDir: dir });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      expect(plugin.staticEntries()).toEqual(["demo"]);
      expect(plugin.hasClient("demo")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("colliding sanitized Data names get numeric suffixes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-data5-"));
    const out = join(dir, "entries.d.ts");
    try {
      writeFileSync(
        join(dir, "a-b.svelte"),
        '<script module lang="ts">export type Data = { x: 1 };</script>\n<h1>1</h1>\n',
      );
      writeFileSync(
        join(dir, "a_b.svelte"),
        '<script module lang="ts">export type Data = { y: 2 };</script>\n<h1>2</h1>\n',
      );
      const plugin = pages({ pagesDir: dir, dts: out });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      const content = readFileSync(out, "utf8");
      expect(content).toContain("type HonoSvelteData_a_b = { x: 1 };");
      expect(content).toContain("type HonoSvelteData_a_b_2 = { y: 2 };");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});