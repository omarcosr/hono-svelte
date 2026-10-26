// Production static serving for the server bundle (`hono-svelte/static`):
// wraps the runtime's own `serveStatic` (hono/bun, @hono/node-server) with
// cache headers, precompressed variants and a deny-list for source maps.
// `honoSvelte()` wires it into the entry `@hono/vite-build` generates; it
// reads the disk, so it only suits Bun/Node.
import { statSync } from "node:fs";
import type { Context, MiddlewareHandler } from "hono";
import { CACHE_IMMUTABLE } from "./assets.js";

/** Revalidated after an hour (ETag): public files keep their names across deploys. */
export const CACHE_PUBLIC = "public, max-age=3600";

export type StaticFilesOptions = {
  /** Directory the files are read from (the build `outDir`). @default "./" */
  root?: string;
  /** Serve `<file>.br` / `<file>.gz` when the client accepts them. @default true */
  precompressed?: boolean;
  /** Serve `*.map` files (they expose the original sources). @default false */
  sourcemaps?: boolean;
  /** URL prefix of content-hashed files, cached as `immutable`. @default "/static/" */
  hashedPrefix?: string;
  /** `Cache-Control` of every other file (favicon, fonts from `publicDir`). @default CACHE_PUBLIC */
  cacheControl?: string;
};

type ServeStaticOptions = {
  root?: string;
  precompressed?: boolean;
  onFound?: (path: string, c: Context) => void | Promise<void>;
};

// Build metadata and source maps: on disk next to the assets, never public.
const PRIVATE = /\.map$|(?:^|\/)\.vite\//;

function matchesTag(header: string, tag: string): boolean {
  const weak = (t: string) => t.trim().replace(/^W\//, "");
  return header.split(",").some((t) => t.trim() === "*" || weak(t) === weak(tag));
}

/**
 * `app.use("/static/*", staticFiles(serveStatic, { root: "./dist" }))` —
 * hashed files get `Cache-Control: immutable`; the others a short
 * `Cache-Control` plus a weak `ETag` (size + mtime), answered with 304.
 */
export function staticFiles(
  serveStatic: (options: ServeStaticOptions) => MiddlewareHandler,
  options: StaticFilesOptions = {},
): MiddlewareHandler {
  const hashedPrefix = options.hashedPrefix ?? "/static/";
  const cacheControl = options.cacheControl ?? CACHE_PUBLIC;
  const serve = serveStatic({
    root: options.root ?? "./",
    precompressed: options.precompressed ?? true,
    onFound: (path, c) => {
      if (c.req.path.startsWith(hashedPrefix)) {
        c.header("Cache-Control", CACHE_IMMUTABLE);
        return;
      }
      const { size, mtimeMs } = statSync(path);
      c.header("Cache-Control", cacheControl);
      c.header("ETag", `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`);
    },
  });
  return async (c, next) => {
    if (!options.sourcemaps && PRIVATE.test(c.req.path)) return next();
    const res = (await serve(c, next)) || undefined;
    const tag = res?.headers.get("ETag");
    const ifNoneMatch = c.req.header("If-None-Match");
    if (!res || res.status !== 200 || !tag || !ifNoneMatch || !matchesTag(ifNoneMatch, tag)) return res;
    await res.body?.cancel();
    const headers = new Headers({ ETag: tag, "Cache-Control": res.headers.get("Cache-Control") ?? cacheControl });
    const vary = res.headers.get("Vary");
    if (vary) headers.set("Vary", vary);
    return new Response(null, { status: 304, headers });
  };
}
