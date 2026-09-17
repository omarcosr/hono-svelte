// Conventional error-page handlers: `404.svelte` / `500.svelte` pages
// rendered with the matching HTTP status.

import type { HeadProps } from "./head.js";

export type ErrorPageOptions = {
  /** Entry name. @default "404" (not-found) / "500" (error) */
  entry?: string;
  title?: string;
  data?: Record<string, unknown>;
  head?: string | HeadProps;
};

/** Hono `notFound` handler: `app.notFound(notFoundHandler())`. */
export function notFoundHandler(opts: ErrorPageOptions = {}) {
  const entry = opts.entry ?? "404";
  return (c: any) => {
    return c.render(entry, {
      title: opts.title,
      data: opts.data,
      head: opts.head,
      status: 404,
    });
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
  return (err: unknown, c: any) => {
    if (log === true) console.error(err);
    else if (typeof log === "function") log(err);
    return c.render(entry, {
      title: opts.title,
      data: opts.data,
      head: opts.head,
      status: 500,
    });
  };
}
