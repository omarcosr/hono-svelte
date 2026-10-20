// Test helpers: read what the shell put in a rendered document without
// depending on its markup (opaque ids, attribute names, escaping).
import { getIds } from "./ids.js";
import { PAGE_ATTRIBUTES } from "./page.js";

export type RenderedPage<TData = Record<string, unknown>> = {
  /** The `data` passed to `c.render` (after layout data, if any); `undefined` when none was embedded. */
  data: TData | undefined;
  /** Request path the page was rendered for. */
  path: string;
  /** Hono route pattern that rendered it, e.g. `/users/:id`. */
  route: string;
  /** Whether the document was rendered for `entryName`. */
  is: (entryName: string) => boolean;
};

const ROOT = /<div id="(r-[0-9a-f]{8})"([^>]*)>/;
const DATA = /<script type="application\/json" id="(r-[0-9a-f]{8})">([\s\S]*?)<\/script>/;

function unescapeAttr(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function attr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? unescapeAttr(match[1] as string) : "";
}

/**
 * Parses a document rendered by `shell()` — e.g. `readPage(await res.text())`
 * in a route test. Throws when `html` is not a hono-svelte document.
 */
export function readPage<TData = Record<string, unknown>>(html: string): RenderedPage<TData> {
  const root = html.match(ROOT);
  if (!root) throw new Error("hono-svelte: not a document rendered by shell() (no page root)");
  const rootId = root[1] as string;
  const dataMatch = html.match(DATA);
  return {
    data: dataMatch ? (JSON.parse(dataMatch[2] as string) as TData) : undefined,
    path: attr(root[2] as string, PAGE_ATTRIBUTES.path),
    route: attr(root[2] as string, PAGE_ATTRIBUTES.route),
    is: (entryName) => getIds(entryName).rootId === rootId,
  };
}
