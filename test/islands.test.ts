// Islands end to end: `honoSvelte()` builds test/fixtures/island-app (client
// and server). A page that imports a `*.island.svelte` component is rendered
// on the server and ships only the island's bundle, which hydrates each copy.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createManifestAssets, type ViteManifest } from "../src/assets.js";
import { analyzeSource, honoSvelte, pages } from "../src/vite.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/island-app");
const outDir = join(fixture, "dist");
const ISLAND = "@island/src/components/Counter";
let manifest: ViteManifest;
let home: string;
let plain: string;
let docs: string;

beforeAll(async () => {
  const cwd = process.cwd();
  // vitest sets NODE_ENV=test, which would compile `import.meta.env.PROD` to false.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
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
    home = await (await app.request("/")).text();
    plain = await (await app.request("/plain")).text();
    docs = await (await app.request("/docs/intro")).text();
  } finally {
    process.chdir(cwd);
    process.env.NODE_ENV = nodeEnv;
  }
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("islands: discovery", () => {
  it("analyzeSource flags an instance script that imports an island, by any specifier", () => {
    expect(analyzeSource('<script>import C from "./C.island.svelte";</script><C />').islands).toBe(true);
    expect(analyzeSource('<script>import C from "$lib/C.island.svelte";</script><C />').islands).toBe(true);
    expect(analyzeSource('<script>import C from "./C.svelte";</script><C />').islands).toBe(false);
  });

  it("analyzeSource lists browser-only code outside islands, with its line", () => {
    const { clientOnly, components } = analyzeSource(
      [
        "<script>",
        '  import { onMount } from "svelte";',
        '  import Nav from "./Nav.svelte";',
        '  import C from "./C.island.svelte";',
        '  import Card from "$lib/Card.svelte";',
        "  onMount(() => {});",
        "  $effect.pre(() => {});",
        "</script>",
        '<svelte:window onkeydown={f} /><button onclick={() => n++} bind:this={el} bind:value={v} use:tip transition:fade {@attach a}>+</button>',
        '<C onpick={g} /><a onclick="go()">plain</a><Nav online={true} only={x} onselect={() => {}} />',
      ].join("\n"),
    );
    expect(clientOnly).toEqual([
      { what: "onkeydown", line: 9 },
      { what: "onclick", line: 9 },
      { what: "bind:value", line: 9 },
      { what: "use:tip", line: 9 },
      { what: "transition:fade", line: 9 },
      { what: "{@attach}", line: 9 },
      { what: "onselect", line: 10 },
      { what: "onMount()", line: 6 },
      { what: "$effect()", line: 7 },
    ]);
    expect(components).toEqual(["./Nav.svelte", "$lib/Card.svelte"]);
  });

  it("analyzeSource leaves handlers and bindings that pass a prop on to the caller, and boundary onerror", () => {
    const { clientOnly } = analyzeSource(
      [
        "<script>let { onclick, value = $bindable(), ...rest } = $props(); const props = $props();</script>",
        "<button {onclick} onkeydown={rest.onkeydown} onfocus={props.onfocus}>x</button><input bind:value />",
        "<svelte:boundary onerror={(e) => console.error(e)}>y</svelte:boundary><button onclick={() => {}}>z</button>",
      ].join("\n"),
    );
    expect(clientOnly).toEqual([{ what: "onclick", line: 3 }]);
  });

  it("analyzeSource goes by what onMount and $effect are, not by the name", () => {
    const code = (script: string) => analyzeSource(`<script>${script}</script>`).clientOnly.map((c) => c.what);
    expect(code('import { onMount as mounted } from "svelte"; mounted(() => {});')).toEqual(["onMount()"]);
    expect(code("function onMount(f) { f(); } onMount(() => {});")).toEqual([]);
    expect(code("const inside = $effect.tracking(); $effect.root(() => {});")).toEqual(["$effect()"]);
  });

  it("warns about browser-only code in static pages, their layouts and the components they import, aliases included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-static-code-"));
    const ui = mkdtempSync(join(tmpdir(), "hs-static-ui-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      mkdirSync(join(dir, "app"));
      writeFileSync(join(ui, "Toggle.svelte"), "<button onclick={() => {}}>toggle</button>\n");
      writeFileSync(join(ui, "Button.svelte"), "<script>let { onclick, children } = $props();</script>\n<button {onclick}>{@render children?.()}</button>\n");
      writeFileSync(join(dir, "_Menu.svelte"), '<script>import Toggle from "$ui/Toggle.svelte"; import Button from "$ui/Button.svelte";</script>\n<Toggle /><Button>menu</Button>\n');
      writeFileSync(join(dir, "app", "layout.svelte"), '<script>import Menu from "../_Menu.svelte"; let { children } = $props();</script>\n<Menu />{@render children()}\n');
      writeFileSync(join(dir, "app", "about.svelte"), "<p>about</p>\n");
      writeFileSync(join(dir, "app", "form.svelte"), "<script>let n = $state(0);</script>\n<button onclick={() => n++}>{n}</button>\n");
      writeFileSync(join(dir, "plain.svelte"), "<p>plain</p>\n");
      const app = pages({ pagesDir: dir, hydrate: true });
      expect(app.staticEntries()).toEqual(["app/about", "plain"]);
      // What Vite's resolver does with a `$ui` alias.
      const context = { resolve: async (spec: string, importer: string) => ({ id: spec.startsWith("$ui/") ? join(ui, spec.slice(4)) : resolve(dirname(importer), spec) }) };
      await (app.buildStart as unknown as (this: typeof context) => Promise<void>).call(context);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/onclick \(\S*Toggle\.svelte:1\) in "app\/about"\n/);
      expect(message).not.toContain("Button.svelte");
      expect(message).not.toContain("app/form");
      // Same findings on the next check (a dev save): not printed again.
      await (app.buildStart as unknown as (this: typeof context) => Promise<void>).call(context);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      rmSync(ui, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a page that imports an island is server-rendered (no page bundle); hydrate keeps it interactive", () => {
    const pagesDir = join(fixture, "src/pages");
    expect(pages({ pagesDir }).staticEntries()).toEqual(["docs/intro", "home", "plain"]);
    expect(pages({ pagesDir, hydrate: ["home"] }).hasClient("home")).toBe(true);
    expect(pages({ pagesDir, alwaysClient: ["home"] }).hasClient("home")).toBe(true);
  });
});

describe("islands: build", () => {
  it("renders each island inside its marker, with its props and the markers hydrate() starts from", () => {
    expect(home).toContain("<h1>Islands</h1>");
    const islands = [...home.matchAll(/<hono-island data-island="([^"]+)" data-props="([^"]*)"[^>]*><!--\[-->/g)];
    expect(islands.map((m) => m[1])).toEqual([ISLAND, ISLAND]);
    const props = islands.map((m) => JSON.parse((m[2] as string).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<")));
    expect(props).toEqual([
      { start: 2, label: "a" },
      { start: 5, label: '"quoted" & <tagged>' },
    ]);
    expect(home).not.toContain("<tagged>");
    expect(home).not.toContain("data-dropped"); // dev only
  });

  it("ships the island's bundle once and no page bundle", () => {
    const src = createManifestAssets(manifest)(ISLAND);
    expect(src).toMatch(/^\/static\/chunks\/island-Counter-[\w-]+\.js$/);
    const scripts = [...home.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual([src]);
    const code = readFileSync(join(outDir, src), "utf8");
    expect(code).toContain("hono-island[data-island=");
    expect(code).toContain(ISLAND);
  });

  it("links the island's CSS with the page", () => {
    const sheets = [...home.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map((m) => m[1] as string);
    expect(sheets.map((href) => readFileSync(join(outDir, href), "utf8")).join("")).toMatch(/color:\s*(?:rgb\(0,\s*0,\s*255\)|#00f)/);
  });

  it("an island in a layout hydrates in the static pages it wraps", () => {
    expect(docs).toContain("Docs page without a script.");
    expect(docs).toContain(`<hono-island data-island="${ISLAND}"`);
    const scripts = [...docs.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual([createManifestAssets(manifest)(ISLAND)]);
  });

  it("a static page without islands still ships no JS", () => {
    expect(plain).toContain("No islands here.");
    expect(plain).not.toContain("<script type=\"module\"");
  });
});
