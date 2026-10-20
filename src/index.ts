import type { Next } from "hono";
import type { Component } from "svelte";
import {
  createManifestAssets,
  manifestCssFor,
  manifestImportsFor,
  type AssetsResolver,
  type ViteManifest,
} from "./assets.js";
import { escapeAttr } from "./escape.js";
import { renderHead, type HeadProps } from "./head.js";
import { getIds } from "./ids.js";
import { isLayoutEntry, layoutChain } from "./layouts.js";
import { PAGE_ATTRIBUTES, pageContext, type PageInfo } from "./page.js";
import {
  allEntries as autoAllEntries,
  clientManifest as autoClientManifest,
  stylesEntry as autoStylesEntry,
  ssrLayouts as autoSsrLayouts,
  ssrPages as autoSsrPages,
} from "./ssr-manifest.js";
import { devEntryUrl } from "./virtual.js";

export {
  CACHE_IMMUTABLE,
  CACHE_NO_STORE,
  createManifestAssets,
  immutableHeaders,
  manifestCssFor,
  manifestImportsFor,
  manifestKeyFor,
  manifestKeysFor,
} from "./assets.js";
export type {
  AssetsResolver,
  ManifestAssetsOptions,
  ViteManifest,
  ViteManifestChunk,
} from "./assets.js";
export { errorHandler, notFoundHandler } from "./handlers.js";
export type { ErrorPageData, ErrorPageOptions, ServerErrorHandlerOptions } from "./handlers.js";
export { renderHead } from "./head.js";
export type { HeadMetaItem, HeadProps } from "./head.js";
export { getIds } from "./ids.js";
export type { PageInfo } from "./page.js";
export type { SharedIds } from "./ids.js";
export { checkAppLink, doctorChecks, initFiles, isSafeAppPath, isValidPageName, newPageFile } from "./scaffold.js";
export type { DoctorIssue, DoctorOptions, InitFile, InitFlavor, InitOptions } from "./scaffold.js";

// Template rule (server -> svelte):
// - data: small, public, and serializable - embedded in the initial HTML
//   (application/json script with an opaque id derived from the entryName)
//   and delivered to the page via $props().
//   Never put secrets here: everything in data is visible in View Source.
// - Private, large, or mutable data: fetch via typed RPC (hc<AppType>)
//   on API routes after mount. Session stays in an HttpOnly cookie.
// - Zero-JS: pages without <script> (detected by the plugin) are rendered
//   on the server and skip client JS. The shell resolves the map on its own
//   via ./ssr-manifest.js: with pages() active, the plugin redirects that
//   import to the in-memory virtual manifest; without pages(), the relative
//   import resolves the static stub (no static pages). The ssrPages
//   option exists only as a manual override.

export type SsrPageLoader = () => Promise<{ default: unknown }>;

/**
 * Type registry filled by the generated `.d.ts` (`pages({ dts: true })`):
 *
 * ```ts
 * declare module "hono-svelte" {
 *   interface Register { entries: "index" | "dashboard/index" }
 * }
 * ```
 */
export interface Register {}

/**
 * Page entry names accepted by `c.render`. The union from the generated
 * `.d.ts` once it is part of the program; plain `string` without it.
 * Use it to type helpers that forward an entry to `c.render`:
 * `function page(entry: Entry) { … }`.
 */
export type Entry = Register extends { entries: infer E extends string } ? E : string;

/** Entries whose page declares a `Data` type (they only accept their own `data`). */
export type TypedEntry = Register extends { typedEntries: infer E extends string } ? E : never;

/**
 * Entries without a `Data` type — what a generic helper forwarding an entry
 * to `c.render` should accept: typed entries need their own `data` and have
 * no overload taking an arbitrary entry. `string` without the generated `.d.ts`.
 */
export type UntypedEntry = Exclude<Entry, TypedEntry>;

/** Layout entry names (`"layout"`, `"dashboard/layout"`) from the generated `.d.ts`; `string` without it. */
export type Layout = Register extends { layouts: infer L extends string } ? L : string;

/** `Data` declared by a layout's `<script module>`, keyed by layout entry; `{}` without the generated `.d.ts`. */
export type LayoutDataMap = Register extends { layoutData: infer M extends Record<string, unknown> } ? M : {};

/** What the `layoutData` loader of a layout must return: its `Data` type when declared, else any record. */
export type LayoutDataFor<L extends string> = L extends keyof LayoutDataMap ? LayoutDataMap[L] : Record<string, unknown>;

/**
 * `shell({ layoutData })`: one loader per layout entry. With the generated
 * `.d.ts` the keys are checked against the real layouts and each loader
 * against the layout's `Data` type.
 */
export type LayoutDataOptions = { [L in Layout]?: LayoutDataLoader<LayoutDataFor<L>> };

export type RenderProps<TData = Record<string, unknown>> = {
  title?: string;
  data?: TData;
  /** HTTP status of the shell response. @default 200 */
  status?: number;
  /** Extra response headers merged into the shell response. */
  headers?: Record<string, string>;
  /** Per-page head tags, merged after the shell `head` option. */
  head?: string | HeadProps;
};

export type PrefetchMode = false | "hover" | "all";

export type ShellOptions = {
  title?: string;
  lang?: string;
  /** @deprecated Use `assets` (a prefix string, manifest or resolver). Removed in 1.0. */
  assetsBase?: string;
  /**
   * Resolve the client JS URL for an entry.
   * - String: base prefix (`/static` -> `/static/<entry>.js`).
   * - Vite manifest object or resolver function: hashed files.
   * @default the client manifest embedded by `pages()` in the server build, else "/static"
   */
  assets?: string | ViteManifest | AssetsResolver;
  /** Extra CSS links per HTML response. Strings are hrefs verbatim. */
  styles?: string[];
  stylesHref?: string | ((isProd: boolean) => string);
  /**
   * Source path of the global stylesheet, relative to the Vite root — the
   * same file passed to the client build input. Dev links `/<stylesEntry>`
   * (served by Vite); prod resolves the hashed file from the manifest given
   * in `assets`, falling back to `/static/styles.css`. `stylesHref` wins
   * when set.
   * @default `pages({ stylesEntry })` when set, else "src/styles.css"
   */
  stylesEntry?: string;
  /** Global head HTML (fonts, meta) — page `head` prop is appended after it. */
  head?: string;
  /**
   * CSP nonce applied to `<script>`, `<link>` and `<style data-hs>` tags
   * emitted by the shell. Pass a per-request nonce string or a function
   * reading it from the Hono context (e.g. set by `secureHeaders()`).
   */
  nonce?: string | ((c: unknown) => string | undefined);
  /**
   * `<link rel="modulepreload">` for the current entry (+ its manifest
   * imports). @default true in prod, false in dev.
   */
  preload?: boolean;
  /** Prefetch other client entries. @default false */
  prefetch?: PrefetchMode;
  /**
   * Warn once when serialized `data` exceeds this many bytes.
   * @default 102400 (100KB). Set to `false` to disable.
   */
  dataLimit?: number | false;
  /** Manual override of the entryName -> loader map (otherwise resolved via ssr-manifest). */
  ssrPages?: Record<string, SsrPageLoader>;
  /**
   * Known entry names. When set (or auto-detected from the manifest),
   * unknown entries throw a dev-friendly error listing available pages.
   * In production the error message is generic.
   */
  knownEntries?: string[];
  /** `false` disables unknown-entry validation. @default true */
  strict?: boolean;
  /**
   * When SSR of a page throws at request time: log the error and fall back
   * to client rendering (entry script) instead of a 500. @default false
   */
  ssrFallback?: boolean;
  /** Default status when `c.render(entry)` omits it. @default 200 */
  status?: number;
  /** Default headers merged into every shell response. */
  headers?: Record<string, string>;
  /**
   * Force prod/dev asset behavior. Defaults to auto-detect
   * (`import.meta.env.PROD`, else `NODE_ENV === "production"`).
   */
  isProd?: boolean;
  /**
   * Extra attributes on `<html>` (`lang` comes from the `lang` option), e.g.
   * `{ "data-theme": "dark" }` for DaisyUI themes. A function receives the
   * Hono context (per-request theme from a cookie). Values are escaped;
   * invalid attribute names throw.
   */
  htmlAttributes?: Record<string, string> | ((c: unknown) => Record<string, string>);
  /**
   * Data loaders per layout, keyed by layout entry name (`"layout"`,
   * `"dashboard/layout"`). Every render of a page under that layout runs the
   * loader with the Hono context and merges its result into `data` — the
   * layout (and the page) receive it without each route spreading it by hand.
   * Loaders of one chain run in parallel; on key clashes inner layouts win
   * over outer ones and the route's own `data` wins over all of them.
   */
  layoutData?: LayoutDataOptions;
};

/**
 * Loader for `shell({ layoutData })`; the context is the request's Hono
 * context. Returning a `Response` (e.g. `c.redirect("/login")` when the
 * session is missing) short-circuits the render: that response is sent
 * instead of the page.
 */
export type LayoutDataLoader<TData = Record<string, unknown>> = (c: any) => TData | Response | Promise<TData | Response>;

export type ShellContext = {
  render: (entryName: string, props?: RenderProps) => Response | Promise<Response>;
};

function isValidEntryName(entryName: string): boolean {
  if (!entryName || entryName.length > 200) return false;
  if (entryName.startsWith("/") || entryName.startsWith(".")) return false;
  if (entryName.includes("\\")) return false;
  const parts = entryName.split("/");
  return parts.every(
    (p) => p.length > 0 && p !== "." && p !== ".." && !p.includes(String.fromCharCode(0)),
  );
}

const TITLE_TAG = /<title\b[^>]*>[\s\S]*?<\/title>/gi;
const DESCRIPTION_META = /<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/gi;

/**
 * One `<title>` / `<meta name="description">` per document, page first.
 * Browsers use the FIRST `<title>`, so the shell default used to beat the
 * page's `<svelte:head>`. Precedence: `c.render(entry, { title })` > the
 * page/layout `<svelte:head>` > `shell({ title })`; for the description,
 * the page (`<svelte:head>` or `props.head`) > `shell({ head })`.
 */
function resolveHeadConflicts(input: {
  shellTitle: string;
  explicitTitle: string | undefined;
  shellHead: string;
  ssrHead: string;
  pageHead: string;
}): { title: string; shellHead: string; ssrHead: string } {
  let { shellHead, ssrHead } = input;
  // search() ignores the global flag's lastIndex, unlike test().
  const pageHasTitle = ssrHead.search(TITLE_TAG) >= 0;
  let title = "";
  if (input.explicitTitle !== undefined) {
    title = `<title>${escapeAttr(input.explicitTitle)}</title>`;
    ssrHead = ssrHead.replace(TITLE_TAG, "");
  } else if (!pageHasTitle) {
    title = `<title>${escapeAttr(input.shellTitle)}</title>`;
  }
  if ((ssrHead + input.pageHead).search(DESCRIPTION_META) >= 0) {
    shellHead = shellHead.replace(DESCRIPTION_META, "");
  }
  return { title, shellHead, ssrHead };
}

const ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

function renderAttributes(attributes: Record<string, string>): string {
  let out = "";
  for (const [name, value] of Object.entries(attributes)) {
    if (!ATTRIBUTE_NAME.test(name) || name.toLowerCase() === "lang") {
      throw new Error(`hono-svelte: invalid htmlAttributes name: ${JSON.stringify(name)} (use the lang option for lang)`);
    }
    out += ` ${name}="${escapeAttr(String(value))}"`;
  }
  return out;
}

/**
 * Route pattern of the handler that rendered the page. Deliberately NOT the
 * `hono/route` helper: it reads a module-private symbol, so with two hono
 * copies (npm link, file: deps, monorepos) it sees no match result and
 * throws. The request getter belongs to the request's own hono copy.
 */
function routeOf(c: { req: { path: string; routePath?: string } }): string {
  return c.req.routePath || c.req.path;
}

/** `<` built at runtime, as everywhere the shell emits markup from strings. */
const LT = String.fromCharCode(60);

function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeAttr(nonce)}"` : "";
}

function serializePageData(
  entryName: string,
  data: Record<string, unknown> | undefined,
  dataId: string,
  dataLimit: number | false,
): { json: string; html: string } {
  if (!data) return { json: "", html: "" };
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    throw new Error("hono-svelte: props.data must be JSON-serializable");
  }
  if (json === undefined) return { json: "", html: "" };
  checkDataLimit(entryName, json, dataLimit);
  const safe = json.replace(/</g, "\\u003c");
  return { json, html: `${LT}script type="application/json" id="${dataId}">${safe}${LT}/script>` };
}

const warnedDataLimit = new Set<string>();
const utf8 = new TextEncoder();

function checkDataLimit(entryName: string, json: string, dataLimit: number | false): void {
  if (dataLimit === false) return;
  const bytes = utf8.encode(json).length;
  if (bytes <= dataLimit) return;
  // One warning per (page, limit): a second page over the limit must still
  // be reported (the key used to be just the limit — one warn per process).
  const key = entryName + ":" + String(dataLimit);
  if (warnedDataLimit.has(key)) return;
  warnedDataLimit.add(key);
  const kb = (bytes / 1024).toFixed(1);
  const limitKb = (dataLimit / 1024).toFixed(0);
  console.warn(
    `[hono-svelte] page "${entryName}" data is ${kb}KB (limit ${limitKb}KB). ` +
      `data is inlined in the HTML — move large/sensitive payloads to a typed API (hc<AppType>).`,
  );
}

/** Visible for tests. */
export function __resetDataLimitWarned(): void {
  warnedDataLimit.clear();
}

/**
 * Build-time flags. `import.meta.env.PROD/DEV` MUST be accessed statically
 * (no `as unknown`, no intermediate variable) so Vite/esbuild can replace
 * them with literals per bundle. In plain node (no Vite define) the access
 * throws at module-eval time, hence the try/catch.
 *
 * NOTE: the server bundle is ALWAYS production (built with
 * `vite build --mode production`), so when Vite replaced the flag the answer
 * is baked in. The NODE_ENV fallback only matters for unbundled runtimes
 * (tests, `vite dev` SSR). `node ./dist/index.js` needs no env prefix.
 */
function detectProd(): boolean {
  try {
    if (import.meta.env.PROD !== undefined) return import.meta.env.PROD;
  } catch {
    // plain node / vitest: no import.meta.env — bundled server is prod
    return true;
  }
  return (
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV ===
    "production"
  );
}

function defaultKnownEntries(ssrPages: Record<string, SsrPageLoader>): string[] | undefined {
  const keys = Object.keys(ssrPages);
  if ((ssrPages as { __allEntries?: unknown }).__allEntries !== undefined) {
    return (ssrPages as unknown as { __allEntries: string[] }).__allEntries;
  }
  return keys.length > 0 ? keys : undefined;
}

function renderNotFoundHint(available: string[] | undefined, isProd: boolean): string {
  // Production never lists the app's pages (an app-level onError may expose the message).
  if (isProd || !available || available.length === 0) {
    return "hono-svelte: unknown entry (check pagesDir and the entryName passed to c.render)";
  }
  const list = [...available].sort().slice(0, 20).join('", "');
  const more = available.length > 20 ? ` (+${available.length - 20} more)` : "";
  return `hono-svelte: unknown entry. Available pages: "${list}"${more}`;
}

function manifestFor(
  assets: string | ViteManifest | AssetsResolver | undefined,
): ViteManifest | undefined {
  return typeof assets === "object" && assets !== null ? (assets as ViteManifest) : undefined;
}

function linkTags(rel: "stylesheet" | "modulepreload", hrefs: Iterable<string>, nAttr: string): string {
  let out = "";
  for (const href of hrefs) out += `${LT}link rel="${rel}" href="${escapeAttr(href)}"${nAttr} />`;
  return out;
}

type PrefetchTarget = { entry: string; url: string };

function prefetchHoverScript(nonce: string | undefined, targets: PrefetchTarget[]): string {
  if (targets.length === 0) return "";
  const map = JSON.stringify(Object.fromEntries(targets.map((t) => [t.entry, t.url]))).replace(/</g, "\\u003c");
  // Links map to entries by path: "/" -> "index", "/a" -> "a" or "a/index".
  const code =
    `(function(){var m=${map};` +
    `function pre(u){if(document.querySelector('link[rel=\\"modulepreload\\"][href=\\"'+u+'\\"]'))return;` +
    `var l=document.createElement('link');l.rel='modulepreload';l.href=u;document.head.appendChild(l);}` +
    `document.addEventListener('mouseover',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;` +
    `if(!a)return;try{var p=new URL(a.href,location.origin).pathname.replace(/^\\/+|\\/+$/g,'');` +
    `var u=m[p]||m[p?p+'/index':'index'];if(u)pre(u);}catch(_){}},{passive:true});})();`;
  return `${LT}script${nonceAttr(nonce)}>${code}${LT}/script>`;
}

/** Caches a per-entry computation (the inputs never change for a shell instance). */
function memoByEntry<T>(fn: (entry: string) => T): (entry: string) => T {
  const cache = new Map<string, T>();
  return (entry) => {
    if (!cache.has(entry)) cache.set(entry, fn(entry));
    return cache.get(entry) as T;
  };
}

type Rendered = { html?: string; body?: string; head?: string | (() => string) };
const bodyOf = (r: Rendered): string => r.html ?? r.body ?? "";
const headOf = (r: Rendered): string => (typeof r.head === "function" ? r.head() : (r.head ?? ""));

/**
 * Server-renders a static page inside its layout chain (outermost first).
 * The page and every layout module load in parallel.
 */
async function renderSsrBody(
  loader: SsrPageLoader,
  layouts: SsrPageLoader[],
  data: Record<string, unknown> | undefined,
  nonce: string | undefined,
  page: PageInfo,
): Promise<{ html: string; head: string }> {
  const [{ render }, { createRawSnippet }, pageMod, ...layoutMods] = await Promise.all([
    import("svelte/server"),
    import("svelte"),
    loader(),
    ...layouts.map((load) => load()),
  ]);
  const renderWith = (component: unknown, props: Record<string, unknown> | undefined): Rendered =>
    render(component as Component, {
      ...(props !== undefined ? { props } : {}),
      ...(nonce ? { csp: { nonce } } : {}),
      context: pageContext(page),
    }) as Rendered;
  const rendered = renderWith(pageMod.default, data);
  let html = bodyOf(rendered);
  let head = headOf(rendered);
  // Wrapping goes inside out. The snippet MUST render a single wrapper
  // element: the client createRawSnippet takes get_first_child(fragment),
  // and an empty render breaks it ("Cannot set properties of null").
  for (const layoutMod of layoutMods.reverse()) {
    const childHtml = html;
    const children = createRawSnippet(() => ({ render: () => `<div style="display:contents">${childHtml}</div>` }));
    const wrapped = renderWith(layoutMod.default, { ...data, children });
    html = bodyOf(wrapped);
    head = headOf(wrapped) + head;
  }
  return { html, head };
}

/** The virtual manifest's metadata, carried as properties of the `ssrPages` map. */
type ManifestMeta = {
  __layouts?: Record<string, SsrPageLoader>;
  __clientEntries?: string[];
  __allEntries?: string[];
};
const metaOf = (pages: Record<string, SsrPageLoader>): ManifestMeta => pages as ManifestMeta;

/**
 * hono's built-in `Renderer` type covers only the default string renderer;
 * apps get the typed one via the generated dts (`declare module "hono"`).
 */
type SetEntryRenderer = (
  renderer: (entryName: string, props?: RenderProps) => Response | Promise<Response>,
) => void;

export function shell(options: ShellOptions = {}) {
  const titleDefault = options.title ?? "App";
  const lang = options.lang ?? "en";
  const assetsBase = (options.assetsBase ?? "/static").replace(/\/$/, "");
  // `pages()` embeds the client build's manifest into the server build.
  const assetsOpt = options.assets ?? autoClientManifest ?? assetsBase;
  const head = options.head ?? "";
  const defaultStatus = options.status ?? 200;
  const defaultHeaders = options.headers ?? {};
  const dataLimit = options.dataLimit ?? 102400;
  const strict = options.strict ?? true;
  const ssrFallback = options.ssrFallback ?? false;
  const extraStyles = options.styles ?? [];
  const stylesEntry = (options.stylesEntry ?? autoStylesEntry ?? "src/styles.css").replace(/^\/+/, "");

  // The manifest never changes for a shell instance: resolve once, cache per entry.
  const manifest = manifestFor(assetsOpt);
  const prodUrl = memoByEntry(
    typeof assetsOpt === "function"
      ? assetsOpt
      : manifest
        ? createManifestAssets(manifest)
        : (entry) => `${assetsBase}/${entry}.js`,
  );
  const cssFor = memoByEntry((entry) => (manifest ? manifestCssFor(manifest, entry) : []));
  const importsFor = memoByEntry((entry) => (manifest ? manifestImportsFor(manifest, entry) : []));

  // Zero config: with pages() active, this module is redirected to the
  // in-memory manifest by the plugin's resolveId (enforce: "pre"). The
  // layouts map must come from the VIRTUAL manifest (the stub's is always {});
  // a manual ssrPages map carries its own metadata on the same object.
  const ssrPages = options.ssrPages ?? autoSsrPages;
  const ssrLayouts: Record<string, SsrPageLoader> =
    metaOf(ssrPages).__layouts ?? metaOf(autoSsrPages).__layouts ?? (autoSsrLayouts as Record<string, SsrPageLoader>);
  // Client entries have a JS bundle; static pages (no <script>) are server-rendered.
  const clientEntries = new Set(metaOf(ssrPages).__clientEntries ?? metaOf(autoSsrPages).__clientEntries ?? []);
  const known =
    options.knownEntries ?? (autoAllEntries.length > 0 ? [...autoAllEntries] : undefined) ?? defaultKnownEntries(ssrPages);
  const knownSet = known ? new Set(known) : undefined;
  const isSsrEntry = (entry: string): boolean => ssrPages[entry] !== undefined && !clientEntries.has(entry);
  const layoutLoaders = memoByEntry((entry) =>
    layoutChain(entry, Object.keys(ssrLayouts)).flatMap((name) => ssrLayouts[name] ?? []),
  );
  // Prefetch targets: other entries that have a JS chunk.
  const prefetchTargets = memoByEntry((entry): PrefetchTarget[] =>
    (known ?? []).filter((e) => e !== entry && !isSsrEntry(e)).map((e) => ({ entry: e, url: prodUrl(e) })),
  );

  // Internally untyped: the generated dts narrows the keys for the app, the shell indexes by name.
  const layoutDataLoaders: Record<string, LayoutDataLoader> = (options.layoutData ?? {}) as Record<string, LayoutDataLoader>;
  for (const name of Object.keys(layoutDataLoaders)) {
    if (!isLayoutEntry(name)) {
      throw new Error(`hono-svelte: layoutData key ${JSON.stringify(name)} is not a layout entry ("layout" or "<dir>/layout")`);
    }
  }
  const layoutDataChain = memoByEntry((entry) =>
    layoutChain(entry, Object.keys(layoutDataLoaders)).map((name) => layoutDataLoaders[name] as LayoutDataLoader),
  );

  /**
   * Layout data (outermost first, inner wins) under the route's own `data`.
   * Error renders (status >= 400) survive a failing loader: the error page
   * renders without layout data instead of turning into a bare 500.
   */
  async function pageData(
    c: any,
    entryName: string,
    data: Record<string, unknown> | undefined,
    status: number,
  ): Promise<Record<string, unknown> | undefined | Response> {
    const loaders = layoutDataChain(entryName);
    if (loaders.length === 0) return data;
    let parts: (Record<string, unknown> | Response)[];
    try {
      parts = await Promise.all(loaders.map((load) => load(c)));
    } catch (err) {
      if (status < 400) throw err;
      console.error(`[hono-svelte] layoutData failed while rendering error page "${entryName}":`, err);
      return data;
    }
    // Outermost loader first: a root layout's redirect wins over an inner one's.
    const short = parts.find((p) => p instanceof Response);
    if (short) return short;
    return Object.assign({}, ...parts, data) as Record<string, unknown>;
  }

  const htmlAttributes = (c: unknown): string => {
    const attrs = typeof options.htmlAttributes === "function" ? options.htmlAttributes(c) : options.htmlAttributes;
    return attrs ? renderAttributes(attrs) : "";
  };

  function stylesHrefFor(isProd: boolean): string {
    const custom = typeof options.stylesHref === "function" ? options.stylesHref(isProd) : options.stylesHref;
    if (custom !== undefined) return custom;
    if (!isProd) return "/" + stylesEntry;
    const file = manifest?.[stylesEntry]?.file;
    return file ? "/" + file.replace(/^\/+/, "") : `${assetsBase}/styles.css`;
  }

  function resolveNonce(c: unknown): string | undefined {
    if (typeof options.nonce !== "function") return options.nonce;
    try {
      return options.nonce(c) ?? undefined;
    } catch (err) {
      // Without a nonce the CSP blocks every shell script — never fail silently.
      console.error("[hono-svelte] nonce() threw — rendering without a nonce:", err);
      return undefined;
    }
  }

  /** Module script, preloads and prefetch for an entry rendered on the client. */
  function clientAssets(entryName: string, isProd: boolean, nonce: string | undefined): string {
    const nAttr = nonceAttr(nonce);
    const src = isProd ? prodUrl(entryName) : devEntryUrl(entryName);
    let out = "";
    if (options.preload ?? isProd) {
      out += linkTags("modulepreload", new Set([src, ...(isProd ? importsFor(entryName) : [])]), nAttr);
    }
    if (isProd && options.prefetch === "all") {
      out += linkTags("modulepreload", prefetchTargets(entryName).map((t) => t.url), nAttr);
    } else if (isProd && options.prefetch === "hover") {
      out += prefetchHoverScript(nonce, prefetchTargets(entryName));
    }
    return out + `${LT}script type="module" src="${escapeAttr(src)}"${nAttr}>${LT}/script>`;
  }

  async function renderEntry(c: any, entryName: string, props: RenderProps | undefined): Promise<Response> {
    if (!isValidEntryName(entryName)) {
      throw new Error(`hono-svelte: invalid entryName: ${JSON.stringify(entryName)}`);
    }
    const isProd = options.isProd ?? detectProd();
    let isSsr = isSsrEntry(entryName);
    if (strict && !isSsr && knownSet && !knownSet.has(entryName)) {
      throw new Error(`${renderNotFoundHint(known, isProd)} (got ${JSON.stringify(entryName)})`);
    }
    const ids = getIds(entryName);
    const page: PageInfo = { path: c.req.path, route: routeOf(c) };
    const nonce = resolveNonce(c);
    const nAttr = nonceAttr(nonce);
    const status = props?.status ?? defaultStatus;
    const data = await pageData(c, entryName, props?.data, status);
    if (data instanceof Response) return data;

    let bodyHtml = "";
    let ssrHead = "";
    if (isSsr) {
      try {
        const loader = ssrPages[entryName] as SsrPageLoader;
        ({ html: bodyHtml, head: ssrHead } = await renderSsrBody(loader, layoutLoaders(entryName), data, nonce, page));
      } catch (err) {
        if (!ssrFallback) throw err;
        console.error(`[hono-svelte] SSR failed for "${entryName}" — falling back to client rendering:`, err);
        isSsr = false;
      }
    }
    // Static pages ship no JS: layout data only feeds the server render, so
    // only the route's own `data` is embedded (layout data like a session
    // never lands in their HTML). Client-rendered pages need all of it.
    const { html: dataHtml } = serializePageData(entryName, isSsr ? props?.data : data, ids.dataId, dataLimit);

    const pageHead = props?.head !== undefined ? renderHead(props.head) : "";
    const resolvedHead = resolveHeadConflicts({
      shellTitle: titleDefault,
      explicitTitle: props?.title,
      shellHead: head,
      ssrHead,
      pageHead,
    });
    const stylesheets = [stylesHrefFor(isProd), ...(isProd ? cssFor(entryName) : []), ...extraStyles];

    return c.html(
      `<!doctype html><html lang="${escapeAttr(lang)}"${htmlAttributes(c)}><head>${resolvedHead.title}` +
        `<meta charset="utf-8" /><meta content="width=device-width, initial-scale=1" name="viewport" />` +
        resolvedHead.shellHead +
        linkTags("stylesheet", stylesheets, nAttr) +
        resolvedHead.ssrHead +
        pageHead +
        (isSsr ? "" : clientAssets(entryName, isProd, nonce)) +
        `</head>` +
        `<body><div id="${ids.rootId}" ${PAGE_ATTRIBUTES.path}="${escapeAttr(page.path)}" ${PAGE_ATTRIBUTES.route}="${escapeAttr(page.route)}">${bodyHtml}</div>` +
        dataHtml +
        `</body></html>`,
      status,
      { ...defaultHeaders, ...props?.headers },
    );
  }

  // The context param stays `any` ON PURPOSE — validated empirically:
  // typing it (MiddlewareHandler / Context / generics) works with a single
  // hono copy and even with duplicate copies of the SAME version, but breaks
  // when the consumer's resolution picks a hono copy with a different version
  // than the one this package's d.ts resolves to (file:/npm-link/monorepo
  // topologies — e.g. app hono 4.13.7 vs package types 4.13.8 fail with
  // `[GET_MATCH_RESULT]`-symbol mismatches). A d.ts free of hono type
  // references is immune to any copy/version layout; the casts at the
  // render/setRenderer boundary carry the correctness burden.
  const middleware = async (c: any, next: Next): Promise<void> => {
    (c as { setRenderer: SetEntryRenderer }).setRenderer((entryName, props) => renderEntry(c, entryName, props));
    await next();
  };

  return Object.assign(middleware, { availableEntries: (): string[] | undefined => known });
}
