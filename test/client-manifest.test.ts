import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// What `pages()` puts in the server build's virtual manifest after a client build.
vi.mock("../src/ssr-manifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ssr-manifest.js")>()),
  clientManifest: {
    "src/styles.css": { file: "static/styles-abc.css" },
    "virtual:hono-svelte/entry/admin": { file: "static/admin-123.js", isEntry: true, css: ["static/admin-9.css"] },
  },
}));

const { shell } = await import("../src/index.js");

function render(options: Parameters<typeof shell>[0]) {
  const app = new Hono();
  app.use("/*", shell({ isProd: true, strict: false, ...options }));
  app.get("/", (c) => c.render("admin"));
  return app.request("/").then((res) => res.text());
}

describe("embedded client manifest", () => {
  it("resolves hashed JS and CSS without the assets option", async () => {
    const html = await render({});
    expect(html).toContain('src="/static/admin-123.js"');
    expect(html).toContain('href="/static/styles-abc.css"');
    expect(html).toContain('href="/static/admin-9.css"');
  });

  it("an explicit assets option still wins", async () => {
    const html = await render({ assets: (entry) => `/cdn/${entry}.js` });
    expect(html).toContain('src="/cdn/admin.js"');
  });
});
