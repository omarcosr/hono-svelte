import { existsSync, globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { getIds } from "./ids.js";
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
  /** Nested layout entryNames (or [] when `layouts: false`). */
  layouts: () => string[];
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
};

export type PagesConfigIssue = { code: string; message: string; fix: string };

function checkPagesDir(_pagesDir: string): PagesConfigIssue | null {
  return null;
}

void checkPagesDir;

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
    if (entryName.endsWith("/layout") || entryName === "layout") return [];
    const chain: string[] = [];
    const parts = entryName.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const layout = (dir ? dir + "/" : "") + "layout";
      if (layouts.some((l) => l.entryName === layout)) chain.push(layout);
    }
    if (layouts.some((l) => l.entryName === "layout")) chain.unshift("layout");
    return chain;
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
      if (entryName === "layout" || entryName.endsWith("/layout")) continue;
      if (seen.has(entryName)) {
        throw new Error(`hono-svelte: duplicate entry: ${entryName}`);
      }
      seen.add(entryName);
      const absFile = resolve(pagesDir, file);
      // Automatic zero-JS: a page without <script> has no interactivity,
      // so the shell renders it on the server and the client downloads no JS.
      const hasScript = /<script[\s>]/i.test(readFileSync(absFile, "utf8"));
      result.push({
        entryName,
        file,
        absFile,
        isStatic: !hasScript && !alwaysClient.has(entryName),
        layouts: chainFor(entryName, cachedLayouts),
      });
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
      .map((p) => (p.isStatic ? "S:" : "C:") + p.entryName)
      .join("|");
  }

  function pageImportPath(page: PageSpec): string {
    const root = viteRoot ?? process.cwd();
    const rel = relative(root, page.absFile);
    if (rel.startsWith("..")) {
      throw new Error("hono-svelte: pagesDir precisa estar dentro do root do Vite");
    }
    return "/" + normalizeSlashes(rel);
  }

  function layoutByName(entryName: string): LayoutSpec {
    const found = cachedLayouts.find((l) => l.entryName === entryName);
    if (!found) throw new Error(`hono-svelte: no layout found for entry: ${entryName}`);
    return found;
  }

  function layoutImportPath(layout: LayoutSpec): string {
    const root = viteRoot ?? process.cwd();
    const rel = relative(root, layout.absFile);
    if (rel.startsWith("..")) {
      throw new Error("hono-svelte: pagesDir precisa estar dentro do root do Vite");
    }
    return "/" + normalizeSlashes(rel);
  }

  function manifestSource(): string {
    const all = listPages();
    const client = all.filter((p) => !p.isStatic).map((p) => p.entryName);
    const staticPages = all.filter((p) => p.isStatic);
    const loaders = staticPages.map(
      (p) => "  " + JSON.stringify(p.entryName) + ": () => import(" + JSON.stringify(pageImportPath(p)) + "),",
    );
    const layoutLoaders = cachedLayouts.map(
      (l) => "  " + JSON.stringify(l.entryName) + ": () => import(" + JSON.stringify(layoutImportPath(l)) + "),",
    );
    return [
      header + " gerado em memoria pelo plugin - nao editar.",
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
      ...(loaders.length > 0 ? loaders : ["  // nenhuma pagina estatica detectada"]),
      "};",
      "",
      "export const ssrLayouts = {",
      ...(layoutLoaders.length > 0 ? layoutLoaders : ["  // nenhum layout detectado"]),
      "};",
      "",
      "ssrPages.__allEntries = allEntries;",
      "ssrPages.__layouts = ssrLayouts;",
      "",
      "export function hasClient(entryName) {",
      "  return !Object.prototype.hasOwnProperty.call(ssrPages, entryName);",
      "}",
      "",
    ].join("\n");
  }

  function entrySource(page: PageSpec): string {
    const ids = getIds(page.entryName);
    // Layouts are a server-side (SSR) composition: the shell renders
    // Page inside LayoutN...Layout0 via svelte/server. On the client the
    // entry mounts the outermost layout; the inner page HTML is already in
    // the SSR DOM (MPA navigation = full reload per page). Layout files that
    // need interactivity keep their own <script> and hydrate with the layout.
    const layoutImports = page.layouts
      .map((l, i) => `import Layout${i} from ${JSON.stringify(layoutImportPath(layoutByName(l)))};`)
      .join("\n");
    return (
      header + " Source: " + page.file + "\n" +
      'import { mount } from "svelte";\n' +
      "import Page from " + JSON.stringify(pageImportPath(page)) + ";\n" +
      (layoutImports && page.layouts.length === 0 ? layoutImports + "\n" : "") +
      (page.layouts.length > 0 ? layoutImports + "\n" : "") +
      "const target = document.getElementById(" + JSON.stringify(ids.rootId) + ");\n" +
      "const raw = document.getElementById(" + JSON.stringify(ids.dataId) + ")?.textContent;\n" +
      "const props = raw ? JSON.parse(raw) : {};\n" +
      entryMountSource(page) +
      "\n"
    );
  }

  function entryMountSource(page: PageSpec): string {
    if (page.layouts.length === 0) return "if (target) mount(Page, { target, props });";
    // SSR DOM already contains Layout+Page HTML. Mount the layout shell
    // (its <script>, if any, runs) and then the interactive Page into the
    // layout's children outlet when present.
    return [
      "if (target) {",
      "  mount(Layout0, { target, props });",
      "  const outlet = target.querySelector('[data-hs-outlet]') || target;",
      "  if (outlet !== target) mount(Page, { target: outlet, props });",
      "}",
    ].join("\n");
  }

  function wrapperSource(page: PageSpec): string {
    void page;
    throw new Error("hono-svelte: wrappers are compiled at build time (unreachable)");
  }

  void wrapperSource;

  const plugin: PagesPlugin = {
    name: "hono-svelte-pages",
    // pre: must run BEFORE vite:resolve to intercept the shell's
    // relative import ("./ssr-manifest.js") and redirect it to the manifest.
    enforce: "pre",
    configResolved(config) {
      viteRoot = config.root;
    },
    buildStart() {
      refresh();
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
      void options;
      if (id.startsWith(ENTRY_RESOLVED_PREFIX)) {
        const entryName = id.slice(ENTRY_RESOLVED_PREFIX.length);
        const page = listPages().find((p) => p.entryName === entryName);
        if (!page) {
          throw new Error("hono-svelte: no page found for entry: " + entryName);
        }
        return entrySource(page);
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
    types() {
      const names = listPages().map((p) => p.entryName);
      if (names.length === 0) return "never";
      return names.map((n) => JSON.stringify(n)).join(" | ");
    },
    typeDeclarations() {
      const names = listPages().map((p) => p.entryName);
      const typeName = "HonoSvelteEntries";
      const unionSrc = names.length === 0 ? "never" : names.map((n) => JSON.stringify(n)).join(" | ");
      return [
        `export type ${typeName} = ${unionSrc};`,
        "",
        `declare module "hono" {`,
        `  interface ContextRenderer {`,
        `    (entryName: ${typeName}, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;`,
        `  }`,
        `}`,
        "",
      ].join("\n");
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
    };
    viteRoot = c.root ?? viteRoot;
    vitePlugins = c.plugins ?? [];
    viteMode = c.mode ?? "";
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

