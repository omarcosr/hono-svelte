import { globSync, readFileSync } from "node:fs";
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
};

export type PagesPlugin = Plugin & {
  input: () => Record<string, string>;
  entries: () => string[];
  staticEntries: () => string[];
  hasClient: (entryName: string) => boolean;
};

const DEFAULT_IGNORE = ["**/layout.svelte", "**/_*.svelte"];

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
};

export function pages(options: PagesOptions = {}): PagesPlugin {
  const pagesDir = resolve(options.pagesDir ?? "src/pages");
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const alwaysClient = new Set(options.alwaysClient ?? []);
  const header = options.generatedHeader ?? "// @generated - hono-svelte, do not edit.";
  const filter = createFilter(["**/*.svelte"], ignore, { resolve: pagesDir });

  let cachedPages: PageSpec[] | null = null;
  let cachedInput: Record<string, string> = {};
  let viteRoot: string | null = null;

  function computePages(): PageSpec[] {
    const files = (globSync("**/*.svelte", { cwd: pagesDir }) as string[])
      .map(normalizeSlashes)
      .filter((f) => filter(pagesDir + "/" + f))
      .sort();
    const seen = new Set<string>();
    const result: PageSpec[] = [];
    for (const file of files) {
      const entryName = entryNameFromFile(file);
      if (seen.has(entryName)) {
        throw new Error(`hono-svelte: duplicate entry: ${entryName}`);
      }
      seen.add(entryName);
      const absFile = resolve(pagesDir, file);
      // Automatic zero-JS: a page without <script> has no interactivity,
      // so the shell renders it on the server and the client downloads no JS.
      const hasScript = /<script[\s>]/i.test(readFileSync(absFile, "utf8"));
      result.push({ entryName, file, absFile, isStatic: !hasScript && !alwaysClient.has(entryName) });
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

  function manifestSource(): string {
    const all = listPages();
    const client = all.filter((p) => !p.isStatic).map((p) => p.entryName);
    const staticPages = all.filter((p) => p.isStatic);
    const loaders = staticPages.map(
      (p) => "  " + JSON.stringify(p.entryName) + ": () => import(" + JSON.stringify(pageImportPath(p)) + "),",
    );
    return [
      header + " gerado em memoria pelo plugin - nao editar.",
      "",
      "export const clientEntries = " + JSON.stringify(client) + ";",
      "",
      "export const staticEntries = " + JSON.stringify(staticPages.map((p) => p.entryName)) + ";",
      "",
      "export const ssrPages = {",
      ...(loaders.length > 0 ? loaders : ["  // nenhuma pagina estatica detectada"]),
      "};",
      "",
      "export function hasClient(entryName) {",
      "  return !Object.prototype.hasOwnProperty.call(ssrPages, entryName);",
      "}",
      "",
    ].join("\n");
  }

  function entrySource(page: PageSpec): string {
    const ids = getIds(page.entryName);
    return (
      header + " Source: " + page.file + "\n" +
      'import { mount } from "svelte";\n' +
      "import Page from " + JSON.stringify(pageImportPath(page)) + ";\n" +
      "const target = document.getElementById(" + JSON.stringify(ids.rootId) + ");\n" +
      "const raw = document.getElementById(" + JSON.stringify(ids.dataId) + ")?.textContent;\n" +
      "const props = raw ? JSON.parse(raw) : {};\n" +
      "if (target) mount(Page, { target, props });\n"
    );
  }

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
    resolveId(source) {
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
      return null;
    },
    load(id) {
      if (id === MANIFEST_RESOLVED) return manifestSource();
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
  };

  return plugin;
}

