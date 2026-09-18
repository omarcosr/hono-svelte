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

export type ErrorPageOptions = {
  /** Entry name. @default "404" (not-found) / "500" (error) */
  entry?: string;
  title?: string;
  data?: Record<string, unknown>;
  head?: string | HeadProps;
};

type EntryRenderFn = (entryName: string, props?: RenderProps) => Response | Promise<Response>;

function entryRender(c: any): EntryRenderFn {
  return (c as unknown as { render: EntryRenderFn }).render;
}

function pageProps(opts: ErrorPageOptions, status: number): RenderProps {
  return {
    title: opts.title,
    data: opts.data,
    head: opts.head,
    status,
  };
}

/** Hono `notFound` handler: `app.notFound(notFoundHandler())`. */
export function notFoundHandler(opts: ErrorPageOptions = {}) {
  const entry = opts.entry ?? "404";
  // See the file header for why the context param stays `any`.
  return (c: any): Response | Promise<Response> => {
    return entryRender(c)(entry, pageProps(opts, 404));
  };
}

export type ServerErrorHandlerOptions = ErrorPageOptions & {
  /** Log the error. `true` = `console.error`. @default true */
  log?: boolean | ((err: unknown) => void);
};

/** Hono `onError` handler: `app.onError(errorHandler())`. */
export function errorHandler(opts: ServerErrorHandlerOptions = {}) {
  const entry = opts.entry ?? "500";
  const log = opts.log ?? true;
  return (err: Error, c: any): Response | Promise<Response> => {
    if (log === true) console.error(err);
    else if (typeof log === "function") log(err);
    return entryRender(c)(entry, pageProps(opts, 500));
  };
}
