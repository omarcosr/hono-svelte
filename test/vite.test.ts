import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { getIds } from "../src/ids.js";
import { MANIFEST_RESOLVED, MANIFEST_ID, ENTRY_PREFIX } from "../src/virtual.js";
import { analyzeSource, pages, withInjectedCss } from "../src/vite.js";
import { newPageFile } from "../src/scaffold.js";
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function makePlugin() {
  const plugin = pages({ pagesDir: "test/fixtures/pages" });
  plugin.configResolved({ root: pkgRoot } as never);
  plugin.buildStart();
  return plugin;
}

describe("analyzeSource", () => {
  it("reads the Svelte AST: commented-out scripts and imports inside strings do not count", () => {
    const commented = analyzeSource('<!-- <script>let x = 1;</script> -->\n<p>static</p>\n');
    expect(commented.hasScript).toBe(false);
    const inString = analyzeSource('<script lang="ts">const s = \'import L from "./layout.svelte"\';</script>\n');
    expect(inString.hasScript).toBe(true);
    expect(inString.imports).toEqual([]);
    const real = analyzeSource(
      '<script module lang="ts">\n  import type { Row } from "../db";\n  export type Data = { rows: Row[] };\n</script>\n<script lang="ts">\n  import Nav from "./nav.svelte";\n  import { x } from "$lib/x";\n</script>\n',
    );
    expect(real.hasScript).toBe(true);
    expect(real.imports).toEqual(["../db", "./nav.svelte"]);
    expect(real.extracted.declaration).toBe("type Data = { rows: Row[] };");
    expect(real.extracted.imports.map((i) => i.specifier)).toEqual(["../db"]);
  });

  it("a module-only script keeps the page static", () => {
    expect(analyzeSource('<script module lang="ts">\n  export type Data = { a: 1 };\n</script>\n<p>x</p>\n').hasScript).toBe(false);
    expect(analyzeSource('<script context="module">\n  export const n = 1;\n</script>\n<p>x</p>\n').hasScript).toBe(false);
  });

  it("a page that does not parse fails the scan with its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-bad-page-"));
    try {
      writeFileSync(join(dir, "broken.svelte"), "<script>let x = ;</script>\n");
      const plugin = pages({ pagesDir: dir });
      plugin.configResolved({ root: dir } as never);
      expect(() => plugin.buildStart()).toThrowError(/could not parse .*broken\.svelte/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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

  describe("clientManifest", () => {
    const CLIENT = { "src/styles.css": { file: "static/styles-1.css" }, admin: { file: "static/admin-2.js", isEntry: true } };

    function buildPlugin(command: string, opts: { clientManifest?: string | false; write?: string } = {}) {
      const root = mkdtempSync(join(tmpdir(), "hs-client-manifest-"));
      mkdirSync(join(root, "pages"));
      writeFileSync(join(root, "pages", "home.svelte"), "<h1>home</h1>\n");
      const target = join(root, opts.write ?? "dist/.vite/manifest.json");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(CLIENT));
      const { write: _write, ...pluginOpts } = opts;
      const plugin = pages({ pagesDir: join(root, "pages"), ...pluginOpts });
      plugin.configResolved({ root, command } as never);
      plugin.buildStart();
      return { source: plugin.load(MANIFEST_RESOLVED) as string, cleanup: () => rmSync(root, { recursive: true, force: true }) };
    }

    it("vite build embeds the client build's manifest", () => {
      const { source, cleanup } = buildPlugin("build");
      try {
        expect(source).toContain(`export const clientManifest = ${JSON.stringify(CLIENT)};`);
      } finally {
        cleanup();
      }
    });

    it("dev, a disabled option or a missing file embed null", () => {
      for (const run of [
        buildPlugin("serve"),
        buildPlugin("build", { clientManifest: false }),
        buildPlugin("build", { clientManifest: "out/manifest.json" }),
      ]) {
        try {
          expect(run.source).toContain("export const clientManifest = null;");
        } finally {
          run.cleanup();
        }
      }
    });

    it("warns when the manifest misses a client page (stale client build)", () => {
      const root = mkdtempSync(join(tmpdir(), "hs-client-manifest-stale-"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        mkdirSync(join(root, "pages"));
        writeFileSync(join(root, "pages", "admin.svelte"), "<script>let n = 1;</script><p>{n}</p>\n");
        writeFileSync(join(root, "pages", "fresh.svelte"), "<script>let n = 2;</script><p>{n}</p>\n");
        mkdirSync(join(root, "dist/.vite"), { recursive: true });
        writeFileSync(join(root, "dist/.vite/manifest.json"), JSON.stringify(CLIENT));
        const plugin = pages({ pagesDir: join(root, "pages") });
        plugin.configResolved({ root, command: "build" } as never);
        plugin.buildStart();
        plugin.load(MANIFEST_RESOLVED);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toMatch(/no chunk for "fresh"/);
      } finally {
        warn.mockRestore();
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("a custom path is read relative to the Vite root", () => {
      const { source, cleanup } = buildPlugin("build", { clientManifest: "out/m.json", write: "out/m.json" });
      try {
        expect(source).toContain(`"static/admin-2.js"`);
      } finally {
        cleanup();
      }
      });
    });

  describe("keeps hono-svelte bundled", () => {
    type Hook = (input: { external?: unknown }) => { external?: unknown } | null;
    const external = (value: unknown) => ((makePlugin().options as unknown as Hook)({ external: value }) ?? {}).external;

    it("SSR config marks the package noExternal", () => {
      expect((makePlugin().config as unknown as () => unknown)()).toEqual({ ssr: { noExternal: ["hono-svelte"] } });
    });

    it("drops the package from string externals", () => {
      expect(external(["argon2", "hono-svelte", "hono", "hono-svelte/page"])).toEqual(["argon2", "hono"]);
      expect(external("hono-svelte")).toEqual([]);
    });

    it("wraps function and RegExp externals", () => {
      const fn = external((id: string) => !id.startsWith(".")) as (id: string, p?: string, r?: boolean) => unknown;
      expect([fn("hono-svelte"), fn("hono-svelte/page"), fn("hono"), fn("./x")]).toEqual([false, false, true, false]);
      const re = external([/^hono/, "argon2"]) as (id: string) => boolean;
      expect([re("hono-svelte"), re("hono"), re("argon2"), re("svelte")]).toEqual([false, true, true, false]);
    });

    it("leaves builds without external alone", () => {
      expect((makePlugin().options as unknown as Hook)({})).toBeNull();
    });
  });

  describe("stylesEntry", () => {
    function stylesPlugin(stylesEntry?: string) {
      const plugin = pages({ pagesDir: "test/fixtures/pages", ...(stylesEntry ? { stylesEntry } : {}) });
      plugin.configResolved({ root: pkgRoot } as never);
      plugin.buildStart();
      return plugin;
    }

    it("input() adds the stylesheet as the `styles` entry", () => {
      const input = stylesPlugin("./src/app.css").input();
      expect(Object.keys(input)).toEqual(["admin", "styles"]);
      expect(input.styles).toBe(resolve(pkgRoot, "src/app.css"));
    });

    it("the virtual manifest hands the path to the shell", () => {
      expect(stylesPlugin("/src/app.css").load(MANIFEST_RESOLVED)).toContain('export const stylesEntry = "src/app.css";');
      expect(stylesPlugin().load(MANIFEST_RESOLVED)).toContain("export const stylesEntry = null;");
      expect(Object.keys(stylesPlugin().input())).toEqual(["admin"]);
    });
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

  it("virtual entry provides the page context on mount", () => {
    const code = makePlugin().load(String.fromCharCode(0) + ENTRY_PREFIX + "admin") as string;
    expect(code).toContain('new Map([[Symbol.for("hono-svelte:page")');
    expect(code).toContain('target?.getAttribute("data-hs-route")');
    expect(code).toContain("mount(Page, { target, props, context })");
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

  it("typeDeclarations() registers the entry union on the package (Entry type)", () => {
    const decl = makePlugin().typeDeclarations();
    expect(decl).toContain('declare module "hono-svelte" {\n  interface Register {\n    entries: HonoSvelteEntries;');
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
      // The temp dir is the Vite root: pagesDir must live inside it (on
      // Windows a tmpdir on another drive used to slip past the check).
      plugin.configResolved({ root: dir } as never);
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
      expect(code).toContain("mount(Layout0");
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
        '(entryName: "typed", data: HonoSvelteData_typed): Response | Promise<Response>;',
      );
      // typed overload first; the catch-all stays last and excludes typed entries,
      // otherwise a wrong `data` would fall through to it unchecked
      const catchAll = '(entryName: Exclude<HonoSvelteEntries, "typed">, data?: ';
      expect(content).toContain(catchAll);
      expect(content.indexOf("HonoSvelteData_typed")).toBeLessThan(content.indexOf(catchAll));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a layout's Data types its layoutData loader in the dts", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-layout-data-"));
    try {
      mkdirSync(join(dir, "dash"), { recursive: true });
      writeFileSync(join(dir, "layout.svelte"), "<slot />\n");
      writeFileSync(
        join(dir, "dash", "layout.svelte"),
        '<script module lang="ts">\n  export type Data = { user: string };\n</script>\n<slot />\n',
      );
      writeFileSync(join(dir, "dash", "index.svelte"), "<p>x</p>\n");
      const plugin = pages({ pagesDir: dir });
      plugin.configResolved({ root: dir } as never);
      plugin.buildStart();
      const content = plugin.typeDeclarations();
      expect(content).toContain("type HonoSvelteData_dash_layout = { user: string };");
      expect(content).toContain('layouts: "dash/layout" | "layout";');
      expect(content).toContain('"dash/layout": HonoSvelteData_dash_layout;');
      expect(content).toContain("typedEntries: never;");
      expect(content).not.toContain('(entryName: "dash/layout"');
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
        '(entryName: "dash/index", data: HonoSvelteData_dash_index): Response | Promise<Response>;',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Data types referencing imports are carried into the dts as import() queries", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-data3-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mkdirSync(join(dir, "pages", "dash"), { recursive: true });
      writeFileSync(
        join(dir, "pages", "dash", "bms.svelte"),
        [
          '<script module lang="ts">',
          '  import type { Plan } from "../../lib/plan";',
          '  import type { Row as BmRow } from "$lib/db";',
          '  import * as catalog from "@app/catalog";',
          "  export type Data = { plan: Plan; rows: BmRow[]; offer: catalog.Offer };",
          "</script>",
          "<h1>bms</h1>",
          "",
        ].join("\n"),
      );
      const out = join(dir, "types", "entries.d.ts");
      const plugin = pages({ pagesDir: join(dir, "pages"), dts: out });
      plugin.configResolved({ root: dir } as never);
      plugin.buildStart();
      const content = readFileSync(out, "utf8");
      expect(content).toContain(
        'type HonoSvelteData_dash_bms = { plan: import("../lib/plan").Plan; rows: import("$lib/db").Row[]; offer: import("@app/catalog").Offer };',
      );
      expect(content).toContain('(entryName: "dash/bms", data: HonoSvelteData_dash_bms)');
      expect(plugin.dataTypes()["dash/bms"]).toBe("type Data = { plan: Plan; rows: BmRow[]; offer: catalog.Offer };");
      expect(warn).not.toHaveBeenCalled();
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

describe("SSR CSS for server-rendered components", () => {
  const load = (plugin: ReturnType<typeof makePlugin>, file: string, ssr: boolean) =>
    (plugin.load as (id: string, options?: { ssr?: boolean }) => unknown).call({}, resolve(pkgRoot, file), { ssr });

  it("static pages are compiled with css=injected on the server only", () => {
    const plugin = makePlugin();
    expect(load(plugin, "test/fixtures/pages/home.svelte", true)).toContain('<svelte:options css="injected" />');
    expect(load(plugin, "test/fixtures/pages/home.svelte", false)).toBeNull();
  });

  it("components imported by static pages and layouts are injected too (a layout's nav)", () => {
    expect(load(makePlugin(), "test/fixtures/_pages/outer-layout.svelte", true)).toContain('css="injected"');
    expect(load(makePlugin(), "test/fixtures/_pages/outer-layout.svelte", false)).toBeNull();
  });

  it("client pages keep the default (external CSS, linked from the client build)", () => {
    expect(load(makePlugin(), "test/fixtures/pages/admin.svelte", true)).toBeNull();
  });

  it("merges into an existing <svelte:options> and respects an explicit css option", () => {
    expect(withInjectedCss('<svelte:options namespace="html" />\n<p>x</p>')).toBe(
      '<svelte:options namespace="html" css="injected" />\n<p>x</p>',
    );
    expect(withInjectedCss("<svelte:options runes></svelte:options><p>x</p>")).toBe(
      '<svelte:options runes css="injected"></svelte:options><p>x</p>',
    );
    const explicit = '<svelte:options css="external" /><p>x</p>';
    expect(withInjectedCss(explicit)).toBe(explicit);
  });
});