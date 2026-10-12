// Current request info for pages and layouts — the hono-svelte counterpart
// of SvelteKit's `page`. The shell provides it as Svelte context on the
// server (SSR of static pages and layouts) and the generated client entry
// provides it on mount/hydrate, so the same `getPage()` works in both.
import { getContext } from "svelte";

export type PageInfo = {
  /** Request pathname, e.g. `/dashboard/settings`. */
  path: string;
  /**
   * Hono route pattern that rendered the page, e.g. `/users/:id` — handy
   * for "active link" logic that must ignore params.
   */
  route: string;
};

/** Context key; `Symbol.for` so duplicated module copies still agree. */
export const PAGE_CONTEXT_KEY: unique symbol = Symbol.for("hono-svelte:page") as never;

/** Root element attributes the shell writes and the client entry reads. */
export const PAGE_ATTRIBUTES = { path: "data-hs-path", route: "data-hs-route" } as const;

/**
 * Page info for the current render. Call during component initialisation
 * (like any `getContext`). Throws outside a page rendered by the shell.
 */
export function getPage(): PageInfo {
  const page = getContext<PageInfo | undefined>(PAGE_CONTEXT_KEY);
  if (!page) {
    throw new Error("hono-svelte: getPage() must be called inside a page or layout rendered by shell()");
  }
  return page;
}

/** Svelte context map carrying the page info (`render`/`mount`/`hydrate` `context` option). */
export function pageContext(page: PageInfo): Map<symbol, PageInfo> {
  return new Map([[PAGE_CONTEXT_KEY, page]]);
}
