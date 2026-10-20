import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { manifestKeysFor, type ViteManifest } from "./assets.js";
import { getIds } from "./ids.js";
import { isLayoutEntry, layoutChain } from "./layouts.js";
import { extractPageDataType, qualifyImports, type DataImport } from "./page-data.js";
import {
  ENTRY_PREFIX,
  ENTRY_RESOLVED_PREFIX,
  MANIFEST_ID,
  MANIFEST_RESOLVED,
} from "./virtual.js";
import { createFilter, type Plugin, type ViteDevServer } from "vite";

export type PagesOptions = {
  pagesDir?: string;
  ignore?: string[];
  /** entryNames that always generate client JS, even without a `<script>`. */
  alwaysClient?: string[];
  generatedHeader?: string;
  /**
   * Nested layouts: `<dir>/layout.svelte` wraps pages under `<dir>/`.
   * When `false`, `layout.svelte` files are ignored (legacy behavior).
   * @default true
   */
  layouts?: boolean;
  /**
   * Write a `.d.ts` file with the entry union + `declare module "hono"`
   * augmentation so `c.render()` is typed with the available pages.
   * Opt-in: `false` (default) disables generation.
   *
   * - `true` writes next to the tsconfig-based default
   *   (`src/hono-svelte-entries.d.ts` relative to the Vite root).
   * - A string sets the output path (relative paths resolve from Vite root).
   *
   * The file must be inside the `tsconfig.json` `include` for `tsc` to pick
   * it up. Regenerated when the entry list changes (build + dev watcher).
   * @default false
   */
  dts?: boolean | string;
  /**
   * The client build's Vite manifest, embedded into the server build so
   * `shell()` resolves hashed JS/CSS on its own — no reading the file at
   * startup and passing it as `assets`. Path relative to the Vite root; the
   * client build must run first. A missing file embeds nothing (the shell
   * keeps its `assets` default). `false` disables it. Only `vite build`
   * embeds it — dev never does.
   * @default "dist/.vite/manifest.json"
   */
  clientManifest?: string | false;
};

export type PagesPlugin = Plugin & {
  input: () => Record<string, string>;
  entries: () => string[];
  staticEntries: () => string[];
  hasClient: (entryName: string) => boolean;
  /** Union source for typing `c.render`: `"a" | "b"`. */
  types: () => string;
  /** `declare module "hono"` snippet + the entry union. */
  typeDeclarations: () => string;
  /** Absolute path of the generated `.d.ts`, or `null` when `dts` is off. */
  dtsPath: () => string | null;
  /** (Re)write the `.d.ts` file now. No-op when `dts` is off. */
  writeDts: () => string | null;
  /** Nested layout entryNames (or [] when `layouts: false`). */
  layouts: () => string[];
  /** Extracted `Data` declarations per entry (per-page typed data), if any. */
  dataTypes: () => Record<string, string>;
  /** Layout chain for an entry, outermost first (or [] for none). */
  layoutChain: (entryName: string) => string[];
  /**
   * Fail fast when the surrounding Vite config looks wrong
   * (missing svelte plugin, missing pages plugin in a client build).
   * @default true in non-test envs
   */
  validateConfig?: () => void;
};

export type LayoutSpec = { entryName: string; file: string; absFile: string };

const DEFAULT_IGNORE = ["**/_*.svelte"];

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Server-rendered components (static pages and layouts) have no client
 * bundle, so their `<style>` must travel inside the SSR output. With
 * vite-plugin-svelte's default `emitCss: true` the compiler runs with
 * `css: "external"` and the styles become a CSS import that an SSR build
 * drops. Forcing `css: "injected"` makes `render()` return them in `head`.
 * An explicit `css` option on the component is respected.
 */
export function withInjectedCss(source: string): string {
  const options = /<svelte:options\b([^>]*?)(\s*\/?)>/.exec(source);
  if (!options) return source + '\n<svelte:options css="injected" />\n';
  if (/\bcss\s*=/.test(options[1])) return source;
  return (
    source.slice(0, options.index) +
    `<svelte:options${options[1]} css="injected"${options[2]}>` +
    source.slice(options.index + options[0].length)
  );
}

/**
 * A page needs client JS when it has an instance `<script>`. A module script
 * (`<script module>` / legacy `context="module"`) alone — the usual home of
 * the per-page `Data` type — runs no per-component code: the page stays static.
 */
function hasInstanceScript(source: string): boolean {
  for (const m of source.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\bmodule\b|\bcontext\s*=\s*["']module["']/i.test(m[1])) return true;
  }
  return false;
}

function entryNameFromFile(file: string): string {
  return normalizeSlashes(file).slice(0, -".svelte".length);
}

type PageSpec = {
  entryName: string;
  file: string;
  absFile: string;
  isStatic: boolean;
  /** Layout entryNames, outermost first. Empty when `layouts: false` or none. */
  layouts: string[];
  /** Extracted `Data` declaration (per-page typed data for the dts), if any. */
  dataType?: string;
  /** Module-script imports referenced by `dataType`. */
  dataImports: DataImport[];
};

const SELF = "hono-svelte";

const isSelf = (id: string): boolean => id === SELF || id.startsWith(SELF + "/");

type ExternalFn = (id: string, parent: string | undefined, isResolved: boolean) => boolean | null | undefined | void;
type ExternalOption = string | RegExp | (string | RegExp)[] | ExternalFn;

/** `external` with hono-svelte (and its subpaths) taken out; everything else unchanged. */
function bundleSelf(external: ExternalOption): ExternalOption {
  if (typeof external === "function") {
    return (id, parent, isResolved) => (isSelf(id) ? false : external(id, parent, isResolved));
  }
  const list = Array.isArray(external) ? external : [external];
  if (list.every((e) => typeof e === "string")) return list.filter((e) => !isSelf(e as string));
  return (id) => !isSelf(id) && list.some((e) => (typeof e === "string" ? e === id : e.test(id)));
}

export function pages(options: PagesOptions = {}): PagesPlugin {
  const pagesDir = resolve(options.pagesDir ?? "src/pages");
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const layoutsEnabled = options.layouts ?? true;
  const alwaysClient = new Set(options.alwaysClient ?? []);
  const header = options.generatedHeader ?? "// @generated - hono-svelte, do not edit.";
  const filter = createFilter(["**/*.svelte"], ignore, { resolve: pagesDir });

  let cachedPages: PageSpec[] | null = null;
  let cachedLayouts: LayoutSpec[] = [];
  let cachedInput: Record<string, string> = {};
  let viteRoot: string | null = null;
  let vitePlugins: { name?: string }[] = [];
  let viteMode = "";
  let viteCommand = "";
  let lastWrittenDts: string | null = null;

  /** Client manifest JSON to embed, or `null` (dev, disabled, or not built yet). */
  function clientManifestJson(): string | null {
    if (viteCommand !== "build" || options.clientManifest === false) return null;
    const file = resolve(viteRoot ?? process.cwd(), options.clientManifest ?? "dist/.vite/manifest.json");
    if (!existsSync(file)) return null;
    let manifest: ViteManifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8")) as ViteManifest;
    } catch (err) {
      throw new Error(`hono-svelte: invalid client manifest ${file}: ${(err as Error).message}`);
    }
    // A leftover manifest from an older client build silently links missing
    // hashed files in production — flag pages it doesn't know about.
    listPages();
    const missing = Object.keys(cachedInput).filter((name) => !manifestKeysFor(name).some((key) => key in manifest));
    if (missing.length > 0) {
      console.warn(
        `[hono-svelte] client manifest ${file} has no chunk for ${missing.map((m) => JSON.stringify(m)).join(", ")} — ` +
          "stale or partial client build? Build the client before the server.",
      );
    }
    return JSON.stringify(manifest);
  }

  function computeLayouts(allFiles: string[]): LayoutSpec[] {
    if (!layoutsEnabled) return [];
    const layouts: LayoutSpec[] = [];
    for (const file of allFiles) {
      if (!file.endsWith("/layout.svelte") && file !== "layout.svelte") continue;
      if (!filter(pagesDir + "/" + file)) continue;
      const entryName = entryNameFromFile(file);
      layouts.push({ entryName, file, absFile: resolve(pagesDir, file) });
    }
    return layouts.sort((a, b) => a.entryName.localeCompare(b.entryName));
  }

function chainFor(entryName: string, layouts: LayoutSpec[]): string[] {
    return layoutChain(entryName, layouts.map((l) => l.entryName));
  }

  function computePages(): PageSpec[] {
    const allFiles = (globSync("**/*.svelte", { cwd: pagesDir }) as string[])
      .map(normalizeSlashes)
      .sort();
    cachedLayouts = computeLayouts(allFiles);
    const files = allFiles.filter((f) => filter(pagesDir + "/" + f));
    const seen = new Set<string>();
    const result: PageSpec[] = [];
    for (const file of files) {
      const entryName = entryNameFromFile(file);
      if (isLayoutEntry(entryName)) continue;
      if (seen.has(entryName)) {
        throw new Error(`hono-svelte: duplicate entry: ${entryName}`);
      }
      seen.add(entryName);
      const absFile = resolve(pagesDir, file);
      // Automatic zero-JS: a page without <script> has no interactivity,
      // so the shell renders it on the server and the client downloads no JS.
      // Exception: layout chain is resolved for EVERY page (even static ones)
      // because the SHELL decides SSR-vs-client at request time:
      // static+layouts => SSR page, then wrap in layout(s).
      const layouts = chainFor(entryName, cachedLayouts);
      // Single source of truth: when layouts are enabled, the shell composes
      // Page inside LayoutN...Layout0 automatically (SSR or client mount). A page
      // that ALSO imports its layout manually would render it twice
      // (<main><div><main>). Fail fast with a clear message instead.
      const source = readFileSync(absFile, "utf8");
      if (layoutsEnabled && layouts.length > 0) {
        for (const layout of layouts) {
          const layoutFile = layout.endsWith("/layout")
            ? layout.slice(0, -"/layout".length) + "/layout.svelte"
            : "layout.svelte";
          const base = layoutFile.split("/").pop() as string;
          const importRe = new RegExp(
            `import\\s+[^;]*["'][^"']*${escapeRegExp(base)}["']`,
          );
          if (importRe.test(source)) {
            throw new Error(
              `hono-svelte: page "${entryName}" manually imports "${layoutFile}", ` +
                `but the layout is applied automatically (layoutChain: ${layouts.join(" -> ")}). ` +
                `Remove the import and keep only the page content; ` +
                `pass title/description via c.render(entry, { data }) if the layout needs them.`,
            );
          }
        }
      }
      const hasScript = hasInstanceScript(source);
      // A page is static when it has no <script> — EVEN with layouts.
      // The shell SSRs the page and wraps it in the layout chain; the layout
      // files themselves are compiled into the page's client entry only when
      // the page needs JS. Layout-wrapped static pages ship zero JS.
      const isStatic = !hasScript && !alwaysClient.has(entryName);
      // Per-page typed data: `export type Data` / `interface Data` in a
      // <script module> feeds a typed overload in the generated dts. Types it
      // imports are carried along as `import("…")` queries (see dataDeclaration).
      const extracted = extractPageDataType(source);
      const dataType = extracted.declaration ?? undefined;
      result.push({ entryName, file, absFile, isStatic, layouts, dataType, dataImports: extracted.imports });
    }
    return result;
  }

  function refresh(log = true): void {
    cachedPages = computePages();
    cachedInput = {};
    let jsCount = 0;
    for (const page of cachedPages) {
      if (page.isStatic) continue;
      cachedInput[page.entryName] = ENTRY_RESOLVED_PREFIX + page.entryName;
      jsCount++;
    }
    if (log) {
      const staticCount = cachedPages.length - jsCount;
      console.log(
        "[hono-svelte] " + jsCount + " page(s) with JS + " + staticCount + " static(s), all in-memory",
      );
    }
  }

  function listPages(): PageSpec[] {
    if (!cachedPages) refresh(false);
    return cachedPages as PageSpec[];
  }

  function stateKey(): string {
    return listPages()
      .map((p) => (p.isStatic ? "S:" : "C:") + p.entryName + (p.dataType ? "@" + p.dataType + JSON.stringify(p.dataImports) : ""))
      .join("|");
  }

  function resolveDtsPath(): string | null {
    if (options.dts === false || options.dts === undefined) return null;
    const root = viteRoot ?? process.cwd();
    const rel = typeof options.dts === "string" ? options.dts : "src/hono-svelte-entries.d.ts";
    return isAbsolute(rel) ? rel : resolve(root, rel);
  }

  /**
   * The page's `Data` declaration, valid from the dts location: imported
   * types become `import("…")` queries. Bare/alias specifiers (`$lib/db`,
   * `some-package`) stay as written; relative ones are re-resolved from the
   * page file to the dts file (or the Vite root when `dts` is off).
   */
  function dataDeclaration(page: PageSpec): string {
    const declaration = page.dataType as string;
    if (page.dataImports.length === 0) return declaration;
    const fromDir = dirname(resolveDtsPath() ?? resolve(viteRoot ?? process.cwd(), "index.d.ts"));
    return qualifyImports(declaration, page.dataImports, (specifier) => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
      const target = normalizeSlashes(relative(fromDir, resolve(dirname(page.absFile), specifier)));
      return target.startsWith(".") ? target : "./" + target;
    });
  }

  function dataTypeNames(): Map<string, string> {
    const names = new Map<string, string>();
    const used = new Set<string>();
    for (const p of listPages()) {
      if (!p.dataType) continue;
      const base = "HonoSvelteData_" + p.entryName.replace(/[^A-Za-z0-9_$]/g, "_");
      let name = base;
      let n = 2;
      while (used.has(name)) name = `${base}_${n++}`;
      used.add(name);
      names.set(p.entryName, name);
    }
    return names;
  }

  function typeDeclarations(): string {
    const names = listPages().map((p) => p.entryName);
    const typeName = "HonoSvelteEntries";
    const unionSrc = names.length === 0 ? "never" : names.map((n) => JSON.stringify(n)).join(" | ");
    const dataNames = dataTypeNames();
    const typed = listPages().filter((p) => p.dataType && dataNames.has(p.entryName));
    const declarationFor = (p: PageSpec): string => {
      const decl = dataDeclaration(p).replace("Data", dataNames.get(p.entryName) as string);
      return decl.endsWith(";") ? decl : decl + ";";
    };
    return [
      `export type ${typeName} = ${unionSrc};`,
      "",
      ...(typed.length > 0
        ? [
            "// Per-page data — `export type Data` / `interface Data` in each page's <script module>:",
            ...typed.map((p) => declarationFor(p)),
            "",
          ]
        : []),
      // Registers the union on the package itself so apps can write
      // `import type { Entry } from "hono-svelte"` instead of importing this file.
      `declare module "hono-svelte" {`,
      `  interface Register {`,
      `    entries: ${typeName};`,
      `    typedEntries: ${typed.length > 0 ? typed.map((p) => JSON.stringify(p.entryName)).join(" | ") : "never"};`,
      `  }`,
      `}`,
      "",
      `declare module "hono" {`,
      `  interface ContextRenderer {`,
      // One typed overload per page with `Data`, then a catch-all for the
      // other entries. The catch-all EXCLUDES the typed entries: otherwise a
      // wrong `data` fails the typed overload and silently matches the
      // catch-all (Record<string, unknown>), and nothing is checked.
      ...typed.map(
        (p) =>
          `    (entryName: ${JSON.stringify(p.entryName)}, props?: import("hono-svelte").RenderProps<${dataNames.get(p.entryName)}>): Response | Promise<Response>;`,
      ),
      `    (entryName: ${
        typed.length > 0 ? `Exclude<${typeName}, ${typed.map((p) => JSON.stringify(p.entryName)).join(" | ")}>` : typeName
      }, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;`,
      `  }`,
      `}`,
      "",
    ].join("\n");
  }

  function dtsSource(): string {
    const names = listPages().map((p) => p.entryName);
    return [
      header,
      `// Entries: ${names.length === 0 ? "(none)" : names.join(", ")}`,
      "",
      typeDeclarations(),
    ].join("\n");
  }

  function writeDtsFile(): string | null {
    const out = resolveDtsPath();
    if (!out) return null;
    const content = dtsSource();
    if (content === lastWrittenDts && existsSync(out)) return out;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content);
    lastWrittenDts = content;
    return out;
  }

function rootImportPath(absFile: string): string {
    const root = viteRoot ?? process.cwd();
    const rel = relative(root, absFile);
    // Another drive on Windows makes relative() return an absolute path.
    if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
      throw new Error(`hono-svelte: pagesDir must be inside the Vite root (${root}): ${absFile}`);
    }
    return "/" + normalizeSlashes(rel);
  }

  function pageImportPath(page: PageSpec): string {
    return rootImportPath(page.absFile);
  }

  function layoutByName(entryName: string): LayoutSpec {
    const found = cachedLayouts.find((l) => l.entryName === entryName);
    if (!found) throw new Error(`hono-svelte: no layout found for entry: ${entryName}`);
    return found;
  }

function layoutImportPath(layout: LayoutSpec): string {
    return rootImportPath(layout.absFile);
  }

  /** Absolute path when `id` is a static page or a layout (the components the shell SSRs). */
/**
   * Absolute path when `id` is a component the shell may render on the server:
   * static pages, layouts AND every component they import (a layout's nav, a
   * component library). Client pages are excluded — the shell never SSRs them.
   */
  function ssrRenderedFile(id: string): string | null {
    if (!id.endsWith(".svelte") || !existsSync(id)) return null;
    // Windows paths are case-insensitive and Vite may report a different drive-letter case.
    const key = (p: string) => (process.platform === "win32" ? normalizeSlashes(p).toLowerCase() : normalizeSlashes(p));
    const target = key(id);
    if (listPages().some((p) => !p.isStatic && key(p.absFile) === target)) return null;
    return id;
  }

  function manifestSource(): string {
    const all = listPages();
    // NOTE: `isStatic` here means "no <script>" — LAYOUTS DON'T MATTER.
    // Static pages get an ssrPages loader REGARDLESS of layouts; the shell
    // SSRs them and wraps the chain. Client entries (has <script>) also get
    // a virtual entry module for the client build, but NEVER an ssrPages
    // loader — otherwise hasClientEntry() can't distinguish them.
    const client = all.filter((p) => !p.isStatic).map((p) => p.entryName);
    const staticPages = all.filter((p) => p.isStatic);
    const loaders = staticPages.map(
      (p) => "  " + JSON.stringify(p.entryName) + ": () => import(" + JSON.stringify(pageImportPath(p)) + "),",
    );
    const layoutLoaders = cachedLayouts.map(
      (l) => "  " + JSON.stringify(l.entryName) + ": () => import(" + JSON.stringify(layoutImportPath(l)) + "),",
    );
    return [
      header + " in-memory manifest generated by the plugin.",
      "",
      "export const clientEntries = " + JSON.stringify(client) + ";",
      "",
      "export const staticEntries = " + JSON.stringify(staticPages.map((p) => p.entryName)) + ";",
      "",
      "export const allEntries = " + JSON.stringify(all.map((p) => p.entryName)) + ";",
      "",
      "export const layoutEntries = " + JSON.stringify(cachedLayouts.map((l) => l.entryName)) + ";",
      "",
      "export const ssrPages = {",
      ...(loaders.length > 0 ? loaders : ["  // no static pages"]),
      "};",
      "",
      "export const ssrLayouts = {",
      ...(layoutLoaders.length > 0 ? layoutLoaders : ["  // no layouts"]),
      "};",
      "",
      "export const clientManifest = " + (clientManifestJson() ?? "null") + ";",
      "",
      "ssrPages.__allEntries = allEntries;",
      "ssrPages.__layouts = ssrLayouts;",
      "ssrPages.__clientEntries = clientEntries;",
      "",
    ].join("\n");
  }

  function entrySource(page: PageSpec): string {
    const ids = getIds(page.entryName);
    // Client entries mount the layout chain around the page (see
    // entryMountSource). Static import (no `await import`) so the
    // bundler keeps one copy of the svelte runtime in the entry chunk.
    const layoutImports = page.layouts
      .map((l, i) => `import Layout${i} from ${JSON.stringify(layoutImportPath(layoutByName(l)))};`)
      .join("\n");
    return (
      header + " Source: " + page.file + "\n" +
      (page.layouts.length > 0
        ? 'import { createRawSnippet, mount } from "svelte";\n'
        : 'import { mount } from "svelte";\n') +
      "import Page from " + JSON.stringify(pageImportPath(page)) + ";\n" +
      (page.layouts.length > 0 ? layoutImports + "\n" : "") +
      "const target = document.getElementById(" + JSON.stringify(ids.rootId) + ");\n" +
      "const raw = document.getElementById(" + JSON.stringify(ids.dataId) + ")?.textContent;\n" +
      "const props = raw ? JSON.parse(raw) : {};\n" +
      // Same context the shell gives server-rendered components (see src/page.ts).
      "const context = new Map([[Symbol.for(\"hono-svelte:page\"), {" +
      " path: target?.getAttribute(\"data-hs-path\") ?? location.pathname," +
      " route: target?.getAttribute(\"data-hs-route\") ?? location.pathname }]]);\n" +
      entryMountSource(page) +
      "\n"
    );
  }

function entryMountSource(page: PageSpec): string {
    if (page.layouts.length === 0) return "if (target) mount(Page, { target, props, context });";
    // Client entries are never server-rendered (the shell only SSRs static
    // pages), so the chain is MOUNTED, outermost first: Layout0 > … > Page.
    // NOTE: createRawSnippet's snippet MUST render one wrapper element
    // (client impl takes get_first_child(fragment) and calls setup(element));
    // an empty render yields a null element. The SSR side (src/index.ts)
    // renders the same <div> wrappers.
    const lines = [
      "if (target) {",
      "  const slot = (C, p) => createRawSnippet(() => ({",
      "    render: () => \"<div></div>\",",
      "    setup: (el) => { mount(C, { target: el, props: p, context }); },",
      "  }));",
      "  let children = slot(Page, props);",
    ];
    for (let i = page.layouts.length - 1; i >= 1; i--) {
      lines.push(`  children = slot(Layout${i}, { ...props, children });`);
    }
    lines.push("  mount(Layout0, { target, props: { ...props, children }, context });", "}");
    return lines.join("\n");
  }


  const plugin: PagesPlugin = {
    name: "hono-svelte-pages",
    // pre: must run BEFORE vite:resolve to intercept the shell's
    // relative import ("./ssr-manifest.js") and redirect it to the manifest.
    enforce: "pre",
    // The shell only sees the pages through its relative "./ssr-manifest.js"
    // import, which resolveId redirects to the virtual manifest — that works
    // only while hono-svelte goes through the bundler. Externalized (Vite's
    // default for SSR deps, or an app `external` list built from
    // package.json), the server silently loads the empty stub: no static
    // pages, no layouts. So the plugin keeps the package bundled itself.
    config() {
      return { ssr: { noExternal: [SELF] } };
    },
    options(input) {
      if (input.external === undefined) return null;
      return { ...input, external: bundleSelf(input.external as unknown as ExternalOption) as typeof input.external };
    },
    configResolved(config) {
      viteRoot = config.root;
    },
    buildStart() {
      refresh();
      writeDtsFile();
    },
    resolveId(source, importer) {
      // Virtual manifest: explicit (virtual:hono-svelte/manifest, backwards compat)
      // or the shell's own relative import. Without pages() active, the
      // relative import resolves the static dist/ssr-manifest.js stub.
      if (source === MANIFEST_ID || source === "./ssr-manifest.js") return MANIFEST_RESOLVED;
      if (source.startsWith(ENTRY_PREFIX)) {
        return ENTRY_RESOLVED_PREFIX + source.slice(ENTRY_PREFIX.length);
      }
      // already-resolved ids (\0...) go straight through to load()
      if (source === MANIFEST_RESOLVED || source.startsWith(ENTRY_RESOLVED_PREFIX)) {
        return source;
      }
      void importer;
      return null;
    },
    load(id, options) {
      if (id === MANIFEST_RESOLVED) return manifestSource();
      if (id.startsWith(ENTRY_RESOLVED_PREFIX)) {
        const entryName = id.slice(ENTRY_RESOLVED_PREFIX.length);
        const page = listPages().find((p) => p.entryName === entryName);
        if (!page) {
          throw new Error("hono-svelte: no page found for entry: " + entryName);
        }
        return entrySource(page);
      }
      // Vite 8 passes the environment on the plugin context; `options.ssr` covers older call sites.
      const context = this as { environment?: { config?: { consumer?: string } }; addWatchFile?: (path: string) => void } | undefined;
      const isSsr = options?.ssr === true || context?.environment?.config?.consumer === "server";
      if (isSsr && !id.includes("?")) {
        const file = ssrRenderedFile(id);
        if (file) {
          context?.addWatchFile?.(file);
          return withInjectedCss(readFileSync(file, "utf8"));
        }
      }
      return null;
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(pagesDir);
      const isPagePath = (file: string): boolean => {
        const rel = normalizeSlashes(relative(pagesDir, file));
        return rel.length > 0 && !rel.startsWith("..") && rel.endsWith(".svelte");
      };
      const onMaybeStructural = (): void => {
        const before = stateKey();
        cachedPages = null;
        refresh();
        if (stateKey() !== before) {
          writeDtsFile();
          const mod = server.moduleGraph.getModuleById(MANIFEST_RESOLVED);
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }
      };
      server.watcher.on("add", (file) => {
        if (isPagePath(file)) onMaybeStructural();
      });
      server.watcher.on("unlink", (file) => {
        if (isPagePath(file)) onMaybeStructural();
      });
      server.watcher.on("change", (file) => {
        if (isPagePath(file)) onMaybeStructural();
      });
    },
    input() {
      listPages();
      return cachedInput;
    },
    entries() {
      return listPages().map((p) => p.entryName);
    },
    staticEntries() {
      return listPages().filter((p) => p.isStatic).map((p) => p.entryName);
    },
    hasClient(entryName: string) {
      const page = listPages().find((p) => p.entryName === entryName);
      return page ? !page.isStatic : false;
    },
    layouts() {
      listPages();
      return cachedLayouts.map((l) => l.entryName);
    },
    layoutChain(entryName: string) {
      const page = listPages().find((p) => p.entryName === entryName);
      return page ? [...page.layouts] : [];
    },
    dataTypes() {
      const out: Record<string, string> = {};
      for (const p of listPages()) {
        if (p.dataType) out[p.entryName] = p.dataType;
      }
      return out;
    },
    types() {
      const names = listPages().map((p) => p.entryName);
      if (names.length === 0) return "never";
      return names.map((n) => JSON.stringify(n)).join(" | ");
    },
    dtsPath() {
      return resolveDtsPath();
    },
    writeDts() {
      return writeDtsFile();
    },
    typeDeclarations() {
      return typeDeclarations();
    },
    validateConfig() {
      const issues: string[] = [];
      const names = vitePlugins.map((p) => p?.name ?? "");
      if (!names.some((n) => n.includes("vite-plugin-svelte") || n === "svelte")) {
        issues.push(
          "hono-svelte: the svelte plugin was not detected. Add svelte() before pages() in every Vite mode.",
        );
      }
      if (viteMode === "client" && !names.includes("hono-svelte-pages")) {
        issues.push(
          "hono-svelte: the pages() plugin is missing from the client build. Add appPages to the mode === 'client' config.",
        );
      }
      if (!existsSync(pagesDir)) {
        issues.push(
          `hono-svelte: pagesDir does not exist: ${pagesDir}. Set pages({ pagesDir }) or create the folder.`,
        );
      }
      if (issues.length > 0) throw new Error(issues.join("\n"));
    },
  };

  const origConfigResolved = plugin.configResolved;
  plugin.configResolved = async function (config) {
    const c = config as unknown as {
      root?: string;
      plugins?: { name?: string }[];
      mode?: string;
      command?: string;
    };
    viteRoot = c.root ?? viteRoot;
    viteCommand = c.command ?? "";
    vitePlugins = c.plugins ?? [];
    viteMode = c.mode ?? "";
    // Write the entries .d.ts as soon as the root is known — before
    // buildStart — so `vite build` fails fast on a bad dts path and the
    // file exists even if a later hook throws.
    writeDtsFile();
    if (
      (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITEST !== "true" &&
      (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV !== "test"
    ) {
      try {
        plugin.validateConfig?.();
      } catch (err) {
        console.error((err as Error).message);
        throw err;
      }
    }
    if (typeof origConfigResolved === "function") {
      await (origConfigResolved as (cfg: typeof config) => void | Promise<void>).call(this, config);
    }
  };

  return plugin;
}

