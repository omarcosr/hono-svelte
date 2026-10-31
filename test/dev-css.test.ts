// Dev server: a hydrated page arrives with its CSS inline (no flash of
// unstyled markup before Vite's client injects it), tagged so the client
// adopts the tags. Runs the real pipeline: Vite dev server + svelte() + pages().
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pages } from "../src/vite.js";
import { DEV_CSS_KEY } from "../src/virtual.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/dev-app");
let server: ViteDevServer;
let app: { request: (p: string) => Promise<Response> };
let html: string;

beforeAll(async () => {
  server = await createServer({
    root: fixture,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, ws: false },
    plugins: [svelte(), pages({ pagesDir: join(fixture, "pages"), hydrate: true })],
  });
  app = (await server.ssrLoadModule(join(fixture, "server.ts"))).default as typeof app;
  html = await (await app.request("/")).text();
}, 60_000);

afterAll(async () => {
  await server?.close();
  delete (globalThis as Record<symbol, unknown>)[DEV_CSS_KEY];
});

const styleTags = () => [...html.matchAll(/<style data-vite-dev-id="([^"]+)">([\s\S]*?)<\/style>/g)].map((m) => ({ id: m[1], css: m[2] }));

describe("dev CSS of a server-rendered page", () => {
  it("is inline in the head, before the page markup", () => {
    const head = html.split("</head>")[0];
    expect(head).toMatch(/<style data-vite-dev-id="[^"]+theme\.css">[^<]*rebeccapurple/);
    expect(head).toMatch(/<style data-vite-dev-id="[^"]+counter\.svelte\?svelte&amp;type=style&amp;lang\.css">[^<]*tomato/);
    expect(head).toMatch(/<style data-vite-dev-id="[^"]+layout\.svelte\?svelte&amp;type=style&amp;lang\.css">[^<]*seagreen/);
    expect(html).toContain("Clicked 0");
  });

  it("follows import order: layout first, its `.css` import before the page", () => {
    const ids = styleTags().map((s) => s.id);
    const at = (needle: string) => ids.findIndex((id) => id.includes(needle));
    expect(at("theme.css")).toBeGreaterThanOrEqual(0);
    expect(at("layout.svelte")).toBeLessThan(at("counter.svelte"));
    expect(at("theme.css")).toBeLessThan(at("counter.svelte"));
  });

  it("a static page gets the `.css` its layouts import, and no component style twice", async () => {
    const about = await (await app.request("/about")).text();
    const head = about.split("</head>")[0];
    expect(head).toMatch(/<style data-vite-dev-id="[^"]+theme\.css">[^<]*rebeccapurple/);
    // Svelte injects component styles into the server render already.
    expect(head).not.toContain("type=style");
    expect(head.match(/seagreen/g)).toHaveLength(1);
    expect(about).toContain("Static about page");
    expect(about).not.toContain("<script");
  });

  it("uses Vite's own module ids, so the client adopts the tags instead of duplicating them", async () => {
    for (const { id } of styleTags()) {
      const moduleId = id.replace(/&amp;/g, "&");
      expect(server.environments.client.moduleGraph.getModuleById(moduleId)?.id).toBe(moduleId);
    }
  });
});
