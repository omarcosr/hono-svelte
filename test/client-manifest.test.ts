import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// What `pages()` puts in the server build's virtual manifest after a client build.
vi.mock("../src/ssr-manifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ssr-manifest.js")>()),
  stylesEntry: "src/app.css",
  clientManifest: {
    "src/app.css": { file: "static/styles-abc.css" },
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

describe("manifestKeyFor", () => {
  it("accepts the root-relative key Vite writes for virtual entries", async () => {
    const { manifestKeyFor, createManifestAssets } = await import("../src/assets.js");
    const manifest = { "../../virtual:hono-svelte/entry/dash/index": { file: "static/dash/index-1.js" } };
    expect(manifestKeyFor(manifest, "dash/index")).toBe("../../virtual:hono-svelte/entry/dash/index");
    expect(manifestKeyFor(manifest, "dash")).toBeUndefined();
    expect(createManifestAssets(manifest)("dash/index")).toBe("/static/dash/index-1.js");
  });
});

describe("embedded client manifest", () => {
  it("resolves hashed JS and CSS without the assets option", async () => {
    const html = await render({});
    expect(html).toContain('src="/static/admin-123.js"');
    expect(html).toContain('href="/static/styles-abc.css"');
    expect(html).toContain('href="/static/admin-9.css"');
  });

  it("pages({ stylesEntry }) is the shell's stylesEntry default", async () => {
    const app = new Hono();
    app.use("/*", shell({ isProd: false, strict: false }));
    app.get("/", (c) => c.render("admin"));
    expect(await (await app.request("/")).text()).toContain('href="/src/app.css"');
  });

  it("an explicit assets option still wins", async () => {
    const html = await render({ assets: (entry) => `/cdn/${entry}.js` });
    expect(html).toContain('src="/cdn/admin.js"');
  });
});
