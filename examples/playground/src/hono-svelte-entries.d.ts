// @generated - hono-svelte, do not edit.
// Entries: auth, dashboard/index, dashboard/page1, dashboard/purchase, index

export type HonoSvelteEntries = "auth" | "dashboard/index" | "dashboard/page1" | "dashboard/purchase" | "index";

declare module "hono" {
  interface ContextRenderer {
    (entryName: HonoSvelteEntries, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;
  }
}
