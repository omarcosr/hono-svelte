// One-call Vite config for a hono-svelte app: the svelte plugin, pages(),
// the client build (hashed assets + manifest) and the server build/dev
// server from @hono/vite-build / @hono/vite-dev-server, per mode.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConfigEnv, Plugin, PluginOption, UserConfig } from "vite";
import { pages, type PagesOptions, type PagesPlugin } from "./vite.js";

export type HonoSvelteRuntime = "bun" | "node";

export type HonoSvelteOptions = PagesOptions & {
  /** Server entry — the module exporting the Hono app. @default "src/routes/index.ts" */
  entry?: string;
  /**
   * Global stylesheet bundled with the client build (`false` = none).
   * Forwarded as `pages({ stylesEntry })`: the shell links it (hashed in
   * production) with no `stylesEntry` of its own.
   * @default "src/styles.css"
   */
  styles?: string | false;
  /**
   * Runtime of the dev server adapter and the server bundle
   * (`@hono/vite-build/<runtime>`). @default "bun" under Bun, else "node"
   */
  runtime?: HonoSvelteRuntime;
  /** Output directory of both builds (client assets + server bundle). @default "dist" */
  outDir?: string;
  /**
   * Extra Vite plugins applied in every mode (Tailwind, …), before svelte().
   * Typed loosely on purpose: a Vite `PluginOption` from the app's own vite
   * copy is not assignable to this package's when the two resolve differently
   * (file:/link installs, monorepos).
   */
  plugins?: unknown[];
  /** Extra options forwarded to `@hono/vite-dev-server`. */
  devServer?: Record<string, unknown>;
  /** Extra options forwarded to `@hono/vite-build/<runtime>`. */
  build?: Record<string, unknown>;
};

export type HonoSvelteConfig = ((env: ConfigEnv) => Promise<UserConfig>) & {
  /** The underlying `pages()` plugin (entries, layouts, dts helpers). */
  pages: PagesPlugin;
};

const PAGES_KEYS: (keyof PagesOptions)[] = ["pagesDir", "ignore", "alwaysClient", "generatedHeader", "layouts", "dts", "clientManifest"];

function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}

type ExportsField = string | string[] | { [key: string]: ExportsField } | null | undefined;

/** Walk an `exports` value with the `import`/`default` conditions (the shapes the supported peers use). */
function pickExport(value: ExportsField): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return pickExport(value[0]);
  if (!value) return null;
  for (const key of ["import", "default", "node"]) {
    if (key in value) return pickExport(value[key]);
  }
  return null;
}

/**
 * Entry file of `pkg/subpath` installed for the app (cwd upwards). Resolved
 * by hand instead of `import()`: with a linked or `file:` install this
 * module's real path sits outside the app's node_modules, and
 * `require.resolve` cannot apply the `import` condition of ESM-only peers.
 */
function appPackageEntry(pkg: string, subpath: string): string | null {
  let dir = resolve(".");
  for (;;) {
    const pkgDir = resolve(dir, "node_modules", pkg);
    const manifestPath = resolve(pkgDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        exports?: ExportsField;
        module?: string;
        main?: string;
      };
      const exportsField = manifest.exports;
      let file: string | null = null;
      if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField) && Object.keys(exportsField).some((k) => k.startsWith("."))) {
        file = pickExport((exportsField as Record<string, ExportsField>)[subpath]);
      } else if (subpath === ".") {
        file = pickExport(exportsField) ?? manifest.module ?? manifest.main ?? null;
      }
      return file ? resolve(pkgDir, file) : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Optional peer, resolved at config time so apps without it are not forced to install it. */
async function loadPeer(specifier: string, pkg: string): Promise<any> {
  const entry = appPackageEntry(pkg, "." + specifier.slice(pkg.length));
  try {
    return await import(entry ? pathToFileURL(entry).href : specifier);
  } catch (err) {
    if (!isModuleNotFound(err)) throw err;
    throw new Error(`hono-svelte: honoSvelte() needs "${pkg}" — install it (bun add -d ${pkg}) or write the Vite config by hand with pages().`);
  }
}

/**
 * "bun" when Vite runs under Bun, was started by `bun run` (Bun executes
 * node-shebang binaries with Node, so the global alone is not enough) or the
 * app has a Bun lockfile; "node" otherwise.
 */
export function detectRuntime(): HonoSvelteRuntime {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") return "bun";
  const agent = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.npm_config_user_agent ?? "";
  if (agent.startsWith("bun/")) return "bun";
  return existsSync(resolve("bun.lock")) || existsSync(resolve("bun.lockb")) ? "bun" : "node";
}

/**
 * `@hono/vite-build` writes its `external` list to the top-level
 * `build.rollupOptions`, which every environment inherits — the client too.
 * A browser cannot resolve a bare `import "pkg"`, so the client build bundles
 * everything; `external` stays a server-only option.
 */
export function clientBundlesDeps(): Plugin {
  return {
    name: "hono-svelte-client-bundles-deps",
    applyToEnvironment: (environment) => environment.name === "client",
    options: (input) => (input.external === undefined ? null : { ...input, external: undefined }),
  };
}

/**
 * `export default honoSvelte({ entry: "src/routes/index.ts" })` — replaces the
 * three-branch Vite config (client build / dev server / server build).
 * `pages({ dts: true })` is on by default.
 */
export function honoSvelte(options: HonoSvelteOptions = {}): HonoSvelteConfig {
  const entry = options.entry ?? "src/routes/index.ts";
  const styles = options.styles ?? "src/styles.css";
  const outDir = (options.outDir ?? "dist").replace(/^\.\//, "").replace(/\/$/, "");
  const extra = (options.plugins ?? []) as PluginOption[];
  const pagesOptions: PagesOptions = {
    dts: true,
    clientManifest: `${outDir}/.vite/manifest.json`,
    ...(styles ? { stylesEntry: styles } : {}),
  };
  for (const key of PAGES_KEYS) {
    if (options[key] !== undefined) (pagesOptions as Record<string, unknown>)[key] = options[key];
  }
  const appPages = pages(pagesOptions);

  const config = async ({ command, mode }: ConfigEnv): Promise<UserConfig> => {
    const runtime = options.runtime ?? detectRuntime();
    const { svelte } = await loadPeer("@sveltejs/vite-plugin-svelte", "@sveltejs/vite-plugin-svelte");
    const plugins: PluginOption[] = [...extra, svelte(), appPages];

    const clientBuild = (): NonNullable<UserConfig["build"]> => ({
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      manifest: true,
      rollupOptions: {
        input: appPages.input(),
        output: {
          entryFileNames: "static/[name]-[hash].js",
          chunkFileNames: "static/chunks/[name]-[hash].js",
          assetFileNames: "static/[name]-[hash][extname]",
        },
      },
    });

    if (mode === "client") {
      return { plugins, build: clientBuild() };
    }

    if (command === "serve") {
      const devServer = (await loadPeer("@hono/vite-dev-server", "@hono/vite-dev-server")).default;
      const adapter = runtime === "bun" ? (await loadPeer("@hono/vite-dev-server/bun", "@hono/vite-dev-server")).default() : undefined;
      return { plugins: [...plugins, devServer({ entry, ...(adapter ? { adapter } : {}), ...options.devServer })] };
    }

    const build = (await loadPeer(`@hono/vite-build/${runtime}`, "@hono/vite-build")).default;
    const serverPlugins: PluginOption[] = [
      ...plugins,
      clientBundlesDeps(),
      build({ entry, outputDir: "./" + outDir, staticRoot: "./" + outDir, ...options.build }),
    ];
    // Plain `vite build`: one run builds the client environment (hashed
    // assets + manifest) and then the server bundle, which embeds that
    // manifest. `vite build --mode client` / `--ssr` keep the split flow.
    return {
      plugins: serverPlugins,
      builder: {},
      environments: {
        client: { consumer: "client", build: clientBuild() },
        ssr: { consumer: "server" },
      },
    };
  };

  return Object.assign(config, { pages: appPages });
}
