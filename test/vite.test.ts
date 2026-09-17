import { dirname, resolve } from "node:path";
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
    expect(code).toContain('import { mount } from "svelte"');
    expect(code).toContain('"/test/fixtures/pages/admin.svelte"');
  });

  it("missing entry fails with a clear error", () => {
    const plugin = makePlugin();
    expect(() => plugin.load(String.fromCharCode(0) + ENTRY_PREFIX + "missing")).toThrowError(/no page found/);
  });
});