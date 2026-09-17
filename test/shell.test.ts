import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { __resetDataLimitWarned, shell } from "../src/index.js";
import { getIds } from "../src/ids.js";
import Home from "./fixtures/pages/home.svelte";
import PropsPage from "./fixtures/_pages/props.svelte";

const staticLoader = async () => ({ default: Home });
const propsLoader = async () => ({ default: PropsPage });

function makeApp(ssrPages?: Record<string, () => Promise<{ default: unknown }>>): Hono {
  const app = new Hono();
  app.use("/*", shell({ title: "T", lang: "pt-BR", ssrPages }));
  app.get("/", (c) => c.render("home"));
  app.get("/admin", (c) => c.render("admin"));
  app.get("/data", (c) => c.render("admin", { data: { html: "<b>x</b>" } }));
  return app;
}

describe("shell", () => {
  it("SSR branch: server HTML, no script, no data", async () => {
    const res = await makeApp({ home: staticLoader }).request("/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Static home");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("application/json");
    expect(html).toContain(`id="${getIds("home").rootId}"`);
  });

  it("static page scoped CSS lands in head via svelte/server", async () => {
    const html = await (await makeApp({ home: staticLoader }).request("/")).text();
    expect(html).toContain("<style");
    expect(html).toContain("tomato");
  });

  it("client branch: entry script and opaque ids", async () => {
    const html = await (await makeApp().request("/admin")).text();
    expect(html).toContain(`id="${getIds("admin").rootId}"`);
    expect(html).toContain("script type=\"module\"");
    expect(html).not.toContain('id="root"');
  });

  it("embedded data with < escaping and opaque id", async () => {
    const html = await (await makeApp().request("/data")).text();
    const ids = getIds("admin");
    expect(html).toContain(`id="${ids.dataId}"`);
    expect(html).not.toContain("<b>x</b>");
    const match = html.match(new RegExp(`id="${ids.dataId}">(.*?)<`));
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1])).toEqual({ html: "<b>x</b>" });
  });

  it("invalid entryName becomes a server error", async () => {
    const app = new Hono();
    app.use("/*", shell({}));
    app.get("/x", (c) => c.render("../evil"));
    const res = await app.request("/x");
    expect(res.status).toBe(500);
  });

  it("SSR static receives props.data", async () => {
    const app = new Hono();
    app.use("/*", shell({ ssrPages: { props: propsLoader } }));
    app.get("/", (c) => c.render("props", { data: { name: "Ada" } }));
    const html = await (await app.request("/")).text();
    expect(html).toContain("Ada");
    expect(html).not.toContain("<script type=\"module\"");
  });

  it("status and headers are respected", async () => {
    const app = new Hono();
    app.use("/*", shell({}));
    app.get("/missing", (c) => c.render("admin", { status: 404, headers: { "X-Page": "no" } }));
    const res = await app.request("/missing");
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Page")).toBe("no");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("shell defaults for status and headers merge", async () => {
    const app = new Hono();
    app.use("/*", shell({ status: 201, headers: { "X-App": "1", "X-Over": "shell" } }));
    app.get("/", (c) => c.render("admin", { headers: { "X-Over": "page" } }));
    const res = await app.request("/");
    expect(res.status).toBe(201);
    expect(res.headers.get("X-App")).toBe("1");
    expect(res.headers.get("X-Over")).toBe("page");
  });

  it("unknown entry lists available pages in dev", async () => {
    const app = new Hono();
    app.use("/*", shell({ knownEntries: ["admin", "home"] }));
    app.get("/x", (c) => c.render("nope"));
    app.onError((err, c) => c.text((err as Error).message, 500));
    const res = await app.request("/x");
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("Available pages");
    expect(text).toContain("admin");
  });

  it("strict:false skips unknown-entry validation", async () => {
    const app = new Hono();
    app.use("/*", shell({ knownEntries: ["admin"], strict: false }));
    app.get("/x", (c) => c.render("other"));
    const res = await app.request("/x");
    expect(res.status).toBe(200);
  });

  it("availableEntries() exposes the known list", () => {
    const mw = shell({ knownEntries: ["a"] }) as unknown as {
      availableEntries: () => string[];
    };
    expect(mw.availableEntries()).toEqual(["a"]);
  });

  it("per-page head merges after global head", async () => {
    const app = new Hono();
    app.use("/*", shell({ head: '<meta name="global" content="g" />' }));
    app.get("/", (c) =>
      c.render("admin", {
        head: { description: "Page desc", og: { title: "OG" }, canonical: "https://x.test/" },
      }),
    );
    const html = await (await app.request("/")).text();
    const globalAt = html.indexOf('name="global"');
    const descAt = html.indexOf('name="description"');
    expect(globalAt).toBeGreaterThan(-1);
    expect(descAt).toBeGreaterThan(globalAt);
    expect(html).toContain('property="og:title" content="OG"');
    expect(html).toContain('<link rel="canonical" href="https://x.test/" />');
  });

  it("nonce is applied to script and link tags", async () => {
    const app = new Hono();
    app.use("/*", shell({ nonce: "abc123" }));
    app.get("/", (c) => c.render("admin"));
    const html = await (await app.request("/")).text();
    expect(html).toContain('nonce="abc123"');
  });

  it("warns once when data exceeds the limit", async () => {
    __resetDataLimitWarned();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = new Hono();
      app.use("/*", shell({ dataLimit: 10 }));
      app.get("/", (c) => c.render("admin", { data: { big: "0123456789abcdef" } }));
      await app.request("/");
      await app.request("/");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("page data is");
    } finally {
      warn.mockRestore();
    }
  });

  it("manifest assets resolve hashed urls with css and preload", async () => {
    const manifest = {
      admin: {
        file: "static/admin-ABC123.js",
        css: ["static/admin-ABC123.css"],
        imports: ["./chunk.js"],
      },
      "./chunk.js": { file: "static/chunks/chunk-XYZ.js" },
    };
    const app = new Hono();
    app.use("/*", shell({ assets: manifest, isProd: true }));
    app.get("/", (c) => c.render("admin"));
    const html = await (await app.request("/")).text();
    expect(html).toContain('src="/static/admin-ABC123.js"');
    expect(html).toContain('href="/static/admin-ABC123.css"');
    expect(html).toContain('rel="modulepreload" href="/static/admin-ABC123.js"');
    expect(html).toContain('href="/static/chunks/chunk-XYZ.js"');
  });

  it("prefetch all emits links for other entries", async () => {
    const app = new Hono();
    app.use("/*", shell({ knownEntries: ["a", "b"], prefetch: "all", isProd: true }));
    app.get("/", (c) => c.render("a"));
    const html = await (await app.request("/")).text();
    expect(html).toContain('rel="prefetch" href="/static/b.js"');
    expect(html).not.toContain('rel="prefetch" href="/static/a.js"');
  });

  it("nested layouts wrap SSR html inside out", async () => {
    const layout = async () => ({
      default: (await import("./fixtures/_pages/nested-layout.svelte")).default,
    });
    const app = new Hono();
    app.use(
      "/*",
      shell({
        ssrPages: {
          "nested/page": propsLoader,
          __layouts: { "nested/layout": layout },
        } as never,
      }),
    );
    app.get("/", (c) => c.render("nested/page", { data: { name: "Ada" } }));
    const html = await (await app.request("/")).text();
    expect(html).toContain('class="layout"');
    expect(html).toContain("Ada");
    expect(html.indexOf('class="layout"')).toBeLessThan(html.indexOf("Ada"));
  });
});