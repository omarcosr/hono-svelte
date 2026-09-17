import type { RenderProps } from "hono-svelte";

declare module "hono" {
  interface ContextRenderer {
    (entryName: string, props?: RenderProps): Response | Promise<Response>;
  }
}