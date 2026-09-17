import type { Next } from "hono";
import type { Component } from "svelte";
import { getIds } from "./ids.js";
import { ssrPages as autoSsrPages } from "./ssr-manifest.js";
import { devEntryUrl } from "./virtual.js";

export { getIds } from "./ids.js";
export type { SharedIds } from "./ids.js";

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

export type RenderProps = {
  title?: string;
  data?: Record<string, unknown>;
};

export type ShellOptions = {
  title?: string;
  lang?: string;
  assetsBase?: string;
  stylesHref?: string | ((isProd: boolean) => string);
  head?: string;
  /** Manual override of the entryName -> loader map (optional; otherwise the shell
   *  resolves the map automatically via ssr-manifest). */
  ssrPages?: Record<string, SsrPageLoader>;
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

function serializePageData(data: Record<string, unknown> | undefined, dataId: string): string {
  if (!data) return "";
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    throw new Error("hono-svelte: props.data must be JSON-serializable");
  }
  if (json === undefined) return "";
  json = json.replace(/</g, "\\u003c");
  const lt = String.fromCharCode(60);
  return lt + 'script type="application/json" id="' + dataId + '">' + json + lt + "/script>";
}


export function shell(options: ShellOptions = {}) {
  const titleDefault = options.title ?? "App";
  const lang = options.lang ?? "en";
  const assetsBase = (options.assetsBase ?? "/static").replace(/\/$/, "");
  const head = options.head ?? "";
  const resolveStyles =
    typeof options.stylesHref === "function"
      ? options.stylesHref
      : () => options.stylesHref as string | undefined;
  // Zero config: with pages() active, this module is redirected to the
  // in-memory manifest by the plugin's resolveId (enforce: "pre").
  const ssrPages = options.ssrPages ?? autoSsrPages;

  return async function shellMiddleware(c: any, next: Next) {
    c.setRenderer(async (entryName: string, props?: RenderProps) => {
      if (!isValidEntryName(entryName)) {
        throw new Error(`hono-svelte: invalid entryName: ${JSON.stringify(entryName)}`);
      }
      const ids = getIds(entryName);
      const title = props?.title ?? titleDefault;
      const isProd = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD ?? false;
      const stylesHref =
        resolveStyles(isProd) ?? (isProd ? "/static/styles.css" : "/src/styles.css");
      const dataHtml = props?.data ? serializePageData(props.data, ids.dataId) : "";
      const lt = String.fromCharCode(60);

      const loader: SsrPageLoader | undefined = ssrPages[entryName];

      let bodyHtml = "";
      let ssrHead = "";
      if (loader !== undefined) {
        const mod = await loader();
        const { render } = await import("svelte/server");
        const rendered = render(mod.default as Component) as { html: string; head?: string };
        bodyHtml = rendered.html;
        ssrHead = rendered.head ?? "";
      }

      let scriptHtml = "";
      if (loader === undefined) {
        const src = isProd ? `${assetsBase}/${entryName}.js` : devEntryUrl(entryName);
        scriptHtml = lt + `script type="module" src="${escapeAttr(src)}">` + lt + "/script>";
      }

      return c.html(
        `<!doctype html><html lang="${escapeAttr(lang)}"><head><title>${escapeAttr(title)}</title>` +
          `<meta charset="utf-8" /><meta content="width=device-width, initial-scale=1" name="viewport" />` +
          (head ? head : "") +
          `<link rel="stylesheet" href="${escapeAttr(stylesHref)}" />` +
          ssrHead +
          scriptHtml +
          `</head>` +
          `<body class="bg-base-200 min-h-screen text-base-content"><div id="${ids.rootId}">${bodyHtml}</div>` +
          dataHtml +
          `</body></html>`,
      );
    });

    await next();
  };
}
