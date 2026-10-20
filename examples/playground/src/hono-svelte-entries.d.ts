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
    (entryName: HonoSvelteEntries, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;
  }
}
