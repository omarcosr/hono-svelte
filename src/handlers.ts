// Conventional error-page handlers: `404.svelte` / `500.svelte` pages
// rendered with the matching HTTP status.
//
// The context parameter stays `any` ON PURPOSE — validated empirically:
// typing it with hono types works with a single hono copy (and even with
// duplicate copies of the same version), but breaks when the consumer's
// resolution picks a hono copy with a DIFFERENT version than the one this
// package's d.ts resolves to (file:/npm-link/monorepo setups — e.g.
// app hono 4.13.7 vs package types 4.13.8 fail on `[GET_MATCH_RESULT]`
// symbol members). hono's `Context<any, ...>` default is not a supertype of
// concrete contexts either. `any` keeps the handlers assignable in every
// copy/version layout; everything else (return type, the render call) is
// typed via the narrow cast below.

import type { HeadProps } from "./head.js";
import type { RenderProps } from "./index.js";

/** Data every error page receives (merged under `opts.data`). */
export type ErrorPageData = {
  status: number;
  message: string;
};

export type ErrorPageOptions = {
  /** Entry name. @default "404" (not-found) / "500" (error) */
  entry?: string;
  title?: string;
  /** Extra page data, merged over `{ status, message }`. */
  data?: Record<string, unknown>;
  head?: string | HeadProps;
  /**
   * Answer `{ message }` JSON with the same status instead of rendering the
   * page — e.g. `(c) => c.req.path.startsWith("/api/")` so API clients never
   * get an HTML document.
   */
  json?: (c: any) => boolean;
  /**
   * Body of the JSON response when `json` matches. Receives the resolved
   * `{ status, message }` and, for `errorHandler`, the thrown error — so an
   * API keeps its own error contract (`code`, validation `errors`…). Only
   * `{ status, message }` is safe to expose as-is: `err` is the raw error,
   * 5xx internals included. @default ({ message }) => ({ message })
   */
  jsonBody?: (page: ErrorPageData, err?: Error) => unknown;
};

type EntryRenderFn = (entryName: string, props?: RenderProps) => Response | Promise<Response>;
type JsonHeadersFn = (body: unknown, status: number, headers?: Record<string, string>) => Response;

function entryRender(c: any): EntryRenderFn {
  return (c as unknown as { render: EntryRenderFn }).render;
}

function respond(
  c: any,
  opts: ErrorPageOptions,
  entry: string,
  page: ErrorPageData,
  headers?: Record<string, string>,
  err?: Error,
): Response | Promise<Response> {
  if (opts.json?.(c)) {
    const body = opts.jsonBody ? opts.jsonBody(page, err) : { message: page.message };
    return (c as unknown as { json: JsonHeadersFn }).json(body, page.status, headers);
  }
  return entryRender(c)(entry, {
    title: opts.title,
    data: { ...page, ...opts.data },
    head: opts.head,
    status: page.status,
    ...(headers ? { headers } : {}),
  });
}

/**
 * Headers of the response carried by the error — hono's `HTTPException(401, { res })`
 * (`basicAuth`, `bearerAuth`) carries `WWW-Authenticate` there. Body headers are
 * dropped: the page/JSON replaces the body.
 */
function headersOf(err: Error): Record<string, string> | undefined {
  const res = (err as { res?: unknown }).res;
  if (!(res instanceof Response)) return undefined;
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (name !== "content-type" && name !== "content-length") out[name] = value;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Hono `notFound` handler: `app.notFound(notFoundHandler())`. */
export function notFoundHandler(opts: ErrorPageOptions & { message?: string } = {}) {
  const entry = opts.entry ?? "404";
  const message = opts.message ?? "Not Found";
  // See the file header for why the context param stays `any`.
  return (c: any): Response | Promise<Response> => respond(c, opts, entry, { status: 404, message });
}

export type ServerErrorHandlerOptions = ErrorPageOptions & {
  /** Log the error. `true` = `console.error`. @default true */
  log?: boolean | ((err: unknown) => void);
  /** Message for errors whose own message is not exposed. @default "Internal Server Error" */
  message?: string;
  /**
   * Whether the error's own message reaches the page/JSON. Default: only for
   * errors carrying a 4xx `status` (e.g. hono's `HTTPException(404, …)`) —
   * 5xx and unknown errors get `message`, never internals.
   */
  expose?: (err: Error, status: number) => boolean;
};

/** HTTP status carried by the error (hono's `HTTPException` and friends), else 500. */
function statusOf(err: Error): number {
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

/** Hono `onError` handler: `app.onError(errorHandler())`. */
export function errorHandler(opts: ServerErrorHandlerOptions = {}) {
  const entry = opts.entry ?? "500";
  const log = opts.log ?? true;
  const fallback = opts.message ?? "Internal Server Error";
  const expose = opts.expose ?? ((_err: Error, status: number) => status < 500);
  return (err: Error, c: any): Response | Promise<Response> => {
    const status = statusOf(err);
    if (status >= 500) {
      if (log === true) console.error(err);
      else if (typeof log === "function") log(err);
    }
    const message = expose(err, status) && err.message ? err.message : fallback;
    return respond(c, opts, entry, { status, message }, headersOf(err), err);
  };
}
