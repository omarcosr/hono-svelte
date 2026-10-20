// @generated - hono-svelte, do not edit.
// Entries: auth, dashboard/index, dashboard/page1, dashboard/purchase, index

export type HonoSvelteEntries = "auth" | "dashboard/index" | "dashboard/page1" | "dashboard/purchase" | "index";

declare module "hono-svelte" {
  interface Register {
    entries: HonoSvelteEntries;
    typedEntries: never;
    layouts: "dashboard/layout";
  }
}

declare module "hono" {
  interface ContextRenderer {
    (entryName: HonoSvelteEntries, data?: Record<string, unknown>): Response | Promise<Response>;
  }
  interface Context<E extends import("hono").Env = any, P extends string = any, I extends import("hono").Input = {}> {
    /** Per-response <head> tags (title, description, og, …) for the page `c.render` emits next. */
    setHead(head: import("hono-svelte").HeadOptions): void;
  }
}
