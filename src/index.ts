import type { Next } from "hono";
import type { Component } from "svelte";
import {
  createManifestAssets,
  manifestCssFor,
  manifestImportsFor,
  type AssetsResolver,
  type ViteManifest,
} from "./assets.js";
import { renderHead, type HeadProps } from "./head.js";
import { getIds } from "./ids.js";
import {
  allEntries as autoAllEntries,
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
  manifestKeysFor,
} from "./assets.js";
export type {
  AssetsResolver,
  ManifestAssetsOptions,
  ViteManifest,
  ViteManifestChunk,
} from "./assets.js";
export { errorHandler, notFoundHandler } from "./handlers.js";
export type { ErrorPageOptions, ServerErrorHandlerOptions } from "./handlers.js";
export { renderHead } from "./head.js";
export type { HeadMetaItem, HeadProps } from "./head.js";
export { getIds } from "./ids.js";
export type { SharedIds } from "./ids.js";
export { checkAppLink, doctorChecks, initFiles, isSafeAppPath, isValidPageName, newPageFile } from "./scaffold.js";
export type { DoctorIssue, DoctorOptions, InitFile, InitFlavor } from "./scaffold.js";

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
  assetsBase?: string;
  /**
   * Resolve the client JS URL for an entry.
   * - String: base prefix (`/static` -> `/static/<entry>.js`).
   * - Vite manifest object or resolver function: hashed files.
   * @default "/static"
   */
  assets?: string | ViteManifest | AssetsResolver;
  /** Extra CSS links per HTML response. Strings are hrefs verbatim. */
  styles?: string[];
  stylesHref?: string | ((isProd: boolean) => string);
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
};

export type ShellContext = {
  render: (entryName: string, props?: RenderProps) => Response | Promise<Response>;
};

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function isValidEntryName(entryName: string): boolean {
  if (!entryName || entryName.length > 200) return false;
  if (entryName.startsWith("/") || entryName.startsWith(".")) return false;
  if (entryName.includes("\\")) return false;
  const parts = entryName.split("/");
  return parts.every(
    (p) => p.length > 0 && p !== "." && p !== ".." && !p.includes(String.fromCharCode(0)),
  );
}

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
  const lt = String.fromCharCode(60);
  return {
    json,
    html: lt + 'script type="application/json" id="' + dataId + '">' + safe + lt + "/script>",
  };
}

const warnedDataLimit = new Set<string>();

function checkDataLimit(entryName: string, json: string, dataLimit: number | false): void {
  if (dataLimit === false) return;
  const bytes = new TextEncoder().encode(json).length;
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

type EnvProbe = { env?: { PROD?: boolean; DEV?: boolean } };

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

function isDev(): boolean {
  try {
    if (import.meta.env.DEV !== undefined) return import.meta.env.DEV;
  } catch {
    // plain node / vitest
    return false;
  }
  return (
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NODE_ENV !==
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

function renderNotFoundHint(available: string[] | undefined, _prod?: boolean): string {
  if (!available || available.length === 0) {
    return "hono-svelte: unknown entry (check pagesDir and the entryName passed to c.render)";
  }
  const list = [...available].sort().slice(0, 20).join('", "');
  const more = available.length > 20 ? ` (+${available.length - 20} more)` : "";
  return `hono-svelte: unknown entry. Available pages: "${list}"${more}`;
}

function resolveAssetUrl(
  assets: string | ViteManifest | AssetsResolver | undefined,
  assetsBase: string,
  entryName: string,
): string {
  const resolver: AssetsResolver =
    typeof assets === "function"
      ? assets
      : typeof assets === "object" && assets !== null
        ? createManifestAssets(assets)
        : (entry) => `${assetsBase}/${entry}.js`;
  return resolver(entryName);
}

function manifestFor(
  assets: string | ViteManifest | AssetsResolver | undefined,
): ViteManifest | undefined {
  return typeof assets === "object" && assets !== null ? (assets as ViteManifest) : undefined;
}

function prefetchUrls(
  mode: PrefetchMode,
  entryName: string,
  allEntries: string[] | undefined,
  resolveUrl: (entry: string) => string,
): string[] {
  if (!mode || !allEntries) return [];
  if (mode === "all") return allEntries.filter((e) => e !== entryName).map(resolveUrl);
  return [];
}

function prefetchHoverScript(
  nonce: string | undefined,
  dataId: string,
  urls: { entry: string; url: string }[],
): string {
  if (urls.length === 0) return "";
  const lt = String.fromCharCode(60);
  const map = JSON.stringify(Object.fromEntries(urls.map((u) => [u.entry, u.url])));
  const code =
    `(function(){var m=${map};` +
    `function pre(u){if(document.querySelector('link[rel=\"prefetch\"][href=\"'+u+'\"]'))return;` +
    `var l=document.createElement('link');l.rel='modulepreload';l.href=u;document.head.appendChild(l);}` +
    `document.addEventListener('mouseover',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;` +
    `if(!a)return;try{var p=new URL(a.href,location.origin).pathname.replace(/^\\//,'');` +
    `var u=m[p];if(u)pre(u);}catch(_){}},{passive:true});})();`;
  return lt + `script${nonceAttr(nonce)}>${code}` + lt + "/script>";
}

export function shell(options: ShellOptions = {}) {
  const titleDefault = options.title ?? "App";
  const lang = options.lang ?? "en";
  const assetsBase = (options.assetsBase ?? "/static").replace(/\/$/, "");
  const assetsOpt = options.assets ?? assetsBase;
  const head = options.head ?? "";
  const defaultStatus = options.status ?? 200;
  const defaultHeaders = options.headers ?? {};
  const dataLimit = options.dataLimit ?? 102400;
  const strict = options.strict ?? true;
  const ssrFallback = options.ssrFallback ?? false;
  const extraStyles = options.styles ?? [];
  const resolveStyles =
    typeof options.stylesHref === "function"
      ? options.stylesHref
      : () => options.stylesHref as string | undefined;
  // Zero config: with pages() active, this module is redirected to the
  // in-memory manifest by the plugin's resolveId (enforce: "pre").
  const ssrPages = options.ssrPages ?? autoSsrPages;
  // NOTE: `p` in the bundle below is the layouts map. It must come from the
  // VIRTUAL manifest (ssrPages.__layouts), never from the stub — the stub's
  // ssrLayouts is always {}. When the caller passes a manual ssrPages map,
  // __layouts travels on the same object (see vite.ts manifestSource).
  const ssrLayouts: Record<string, SsrPageLoader> =
    (ssrPages as unknown as { __layouts?: Record<string, SsrPageLoader> }).__layouts ??
    (autoSsrPages as unknown as { __layouts?: Record<string, SsrPageLoader> }).__layouts ??
    (autoSsrLayouts as Record<string, SsrPageLoader>);
  const staticKnown =
    options.knownEntries ??
    (autoAllEntries.length > 0 ? [...autoAllEntries] : undefined) ??
    defaultKnownEntries(ssrPages);

  function availableEntries(): string[] | undefined {
    if (staticKnown) return staticKnown;
    return defaultKnownEntries(ssrPages);
  }

  /**
   * Client entries have a JS bundle (input() in the plugin). The virtual
   * manifest carries them via `clientEntries`; the static stub has none.
   * Layout-wrapped STATIC pages are SSR (no script branch) — their chain
   * is rendered server-side.
   */
  function hasClientEntry(entryName: string): boolean {
    const fromManifest = (ssrPages as unknown as { __clientEntries?: string[] }).__clientEntries;
    if (fromManifest) return fromManifest.includes(entryName);
    const auto = (autoSsrPages as unknown as { __clientEntries?: string[] }).__clientEntries;
    if (auto) return auto.includes(entryName);
    return false;
  }

  function layoutChainFor(entryName: string): string[] {
    if (entryName === "layout" || entryName.endsWith("/layout")) return [];
    const layouts = Object.keys(ssrLayouts);
    if (layouts.length === 0) return [];
    const chain: string[] = [];
    const parts = entryName.split("/");
    for (let i = 1; i < parts.length; i++) {
      const layout = parts.slice(0, i).join("/") + "/layout";
      if (layouts.includes(layout)) chain.push(layout);
    }
    if (layouts.includes("layout")) chain.unshift("layout");
    return chain;
  }

  function resolveNonce(c: unknown): string | undefined {
    if (typeof options.nonce === "function") {
      try {
        return options.nonce(c) ?? undefined;
      } catch {
        return undefined;
      }
    }
    return options.nonce;
  }

  async function renderSsrBody(
    loader: SsrPageLoader,
    pageData: Record<string, unknown> | undefined,
    nonce: string | undefined,
    layoutChain: SsrPageLoader[],
  ): Promise<{ html: string; head: string }> {
    const mod = await loader();
    const { render } = await import("svelte/server");
    const renderOpts: Record<string, unknown> = {};
    if (pageData !== undefined) renderOpts.props = pageData;
    if (nonce) renderOpts.csp = { nonce };
    const rendered = render(mod.default as Component, renderOpts) as {
      html?: string;
      body?: string;
      head?: string | (() => string);
    };
    let html = rendered.html ?? rendered.body ?? "";
    let headValue = typeof rendered.head === "function" ? rendered.head() : (rendered.head ?? "");
    if (layoutChain.length > 0) {
      const { createRawSnippet } = await import("svelte");
      for (const layoutLoader of layoutChain) {
        const layoutMod = await layoutLoader();
        const childHtml = html;
        // The snippet MUST render a single wrapper element: the server
        // renderer pushes render() output verbatim, and the client
        // createRawSnippet takes get_first_child(fragment). An empty render
        // breaks hydration ("Cannot set properties of null"). The extra div
        // is hydration-safe (hydrate reuses SSR DOM).
        const childSnippet = createRawSnippet(() => ({ render: () => `<div>${childHtml}</div>` }));
        const wrapped = render(layoutMod.default as Component, {
          ...(pageData !== undefined ? { props: pageData } : {}),
          props: { ...pageData, children: childSnippet },
          ...(nonce ? { csp: { nonce } } : {}),
        }) as { html?: string; body?: string; head?: string | (() => string) };
        html = wrapped.html ?? wrapped.body ?? "";
        const layoutHead =
          typeof wrapped.head === "function" ? wrapped.head() : (wrapped.head ?? "");
        headValue = layoutHead + headValue;
      }
    }
    return { html, head: headValue };
  }

  /**
   * hono's built-in `Renderer` type covers only the default string renderer;
   * apps get the typed one via the generated dts (`declare module "hono"`).
   * The narrow cast at this boundary keeps the middleware signature `any`-free
   * (calling through the cast object preserves `this`).
   */
  type SetEntryRenderer = (
    renderer: (entryName: string, props?: RenderProps) => Response | Promise<Response>,
  ) => void;

  // The context param stays `any` ON PURPOSE (see src/handlers.ts header for
  // the full rationale: hono's unique symbols + `Context<any>` not being a
  // supertype of concrete contexts). Everything the shell touches is typed
  // through the casts below — no `any` leaks into the rendered response.
  // The context param stays `any` ON PURPOSE — validated empirically:
  // typing it (MiddlewareHandler / Context / generics) works with a single
  // hono copy and even with duplicate copies of the SAME version, but breaks
  // when the consumer's resolution picks a hono copy with a different version
  // than the one this package's d.ts resolves to (file:/npm-link/monorepo
  // topologies — e.g. app hono 4.13.7 vs package types 4.13.8 fail with
  // `[GET_MATCH_RESULT]`-symbol mismatches). A d.ts free of hono type
  // references is immune to any copy/version layout. The
  // render/setRenderer boundary needs casts regardless (hono's default
  // Renderer only accepts string content), so `any` here costs no real
  // type safety — the casts carry the correctness burden.
  const inner = async (c: any, next: Next): Promise<void> => {
    (c as unknown as { setRenderer: SetEntryRenderer }).setRenderer(
      async (entryName: string, props?: RenderProps) => {
      if (!isValidEntryName(entryName)) {
        throw new Error(`hono-svelte: invalid entryName: ${JSON.stringify(entryName)}`);
      }
      const loader: SsrPageLoader | undefined = ssrPages[entryName];
      // A page is SSR when it is static (no <script>) — LAYOUTS DON'T MATTER
      // here. A static page wrapped in layouts SSRs the page and wraps it in
      // the layout chain (same rule as pages().staticEntries/clientEntries).
      // Client entries (has <script>) always go the script branch.
      const chain = layoutChainFor(entryName)
        .map((l) => ssrLayouts[l])
        .filter((l): l is SsrPageLoader => l !== undefined);
      let isSsr = loader !== undefined && !hasClientEntry(entryName);
      if (strict && !isSsr) {
        const known = availableEntries();
        if (known && !known.includes(entryName)) {
          throw new Error(`${renderNotFoundHint(known)} (got ${JSON.stringify(entryName)})`);
        }
      }
      const ids = getIds(entryName);
      const title = props?.title ?? titleDefault;
      const isProd = options.isProd ?? detectProd();
      const nonce = resolveNonce(c);
      const nAttr = nonceAttr(nonce);
      const stylesHref =
        resolveStyles(isProd) ?? (isProd ? "/static/styles.css" : "/src/styles.css");
      const { html: dataHtml } = serializePageData(entryName, props?.data, ids.dataId, dataLimit);
      const lt = String.fromCharCode(60);

      let bodyHtml = "";
      let ssrHead = "";
      if (isSsr) {
        try {
          const rendered = await renderSsrBody(loader as SsrPageLoader, props?.data, nonce, chain);
          bodyHtml = rendered.html;
          ssrHead = rendered.head;
        } catch (err) {
          if (!ssrFallback) throw err;
          console.error(
            `[hono-svelte] SSR failed for "${entryName}" — falling back to client rendering:`,
            err,
          );
          bodyHtml = "";
          ssrHead = "";
          isSsr = false;
        }
      }

      const resolveUrl = (entry: string): string =>
        isProd ? resolveAssetUrl(assetsOpt, assetsBase, entry) : devEntryUrl(entry);

      let scriptHtml = "";
      let preloadHtml = "";
      let prefetchHtml = "";
      if (!isSsr) {
        const src = resolveUrl(entryName);
        scriptHtml =
          lt + `script type="module" src="${escapeAttr(src)}"${nAttr}>` + lt + "/script>";
        const shouldPreload = options.preload ?? isProd;
        const manifest = isProd ? manifestFor(assetsOpt) : undefined;
        if (shouldPreload) {
          const urls = [src];
          if (manifest) {
            for (const imp of manifestImportsFor(manifest, entryName)) {
              if (!urls.includes(imp)) urls.push(imp);
            }
          }
          preloadHtml = urls
            .map((u) => lt + `link rel="modulepreload" href="${escapeAttr(u)}"${nAttr} />`)
            .join("");
        }
        if (isProd && options.prefetch) {
          const known = availableEntries();
          if (options.prefetch === "all" && known) {
            for (const u of prefetchUrls("all", entryName, known, resolveUrl)) {
              prefetchHtml += lt + `link rel="modulepreload" href="${escapeAttr(u)}"${nAttr} />`;
            }
          } else if (options.prefetch === "hover" && known) {
            const others = known.filter((e) => e !== entryName && ssrPages[e] === undefined);
            prefetchHtml = prefetchHoverScript(
              nonce,
              ids.dataId,
              others.map((e) => ({ entry: e, url: resolveUrl(e) })),
            );
          }
        }
      }

      const status = props?.status ?? defaultStatus;
      const headers = { ...defaultHeaders, ...props?.headers };
      const pageHead = props?.head !== undefined ? renderHead(props.head) : "";
      const manifestNow = isProd ? manifestFor(assetsOpt) : undefined;
      const cssLinks =
        (manifestNow ? manifestCssFor(manifestNow, entryName) : [])
          .map((href) => lt + `link rel="stylesheet" href="${escapeAttr(href)}"${nAttr} />`)
          .join("") +
        extraStyles
          .map((href) => lt + `link rel="stylesheet" href="${escapeAttr(href)}"${nAttr} />`)
          .join("");

      return c.html(
        `<!doctype html><html lang="${escapeAttr(lang)}"><head><title>${escapeAttr(title)}</title>` +
          `<meta charset="utf-8" /><meta content="width=device-width, initial-scale=1" name="viewport" />` +
          (head ? head : "") +
          `<link rel="stylesheet" href="${escapeAttr(stylesHref)}"${nAttr} />` +
          cssLinks +
          ssrHead +
          pageHead +
          preloadHtml +
          prefetchHtml +
          scriptHtml +
          `</head>` +
          `<body><div id="${ids.rootId}">${bodyHtml}</div>` +
          dataHtml +
          `</body></html>`,
        status,
        headers,
      );
      },
    );

    await next();
  }

  const mw = inner as typeof inner & {
    availableEntries: () => string[] | undefined;
  };
  mw.availableEntries = availableEntries;
  return mw;
}
