import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { shell } from "../src/index.js";
import { getIds } from "../src/ids.js";
import Home from "./fixtures/pages/home.svelte";

const staticLoader = async () => ({ default: Home });

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

  it("title with quotes and lang are escaped", async () => {
    const app = new Hono();
    app.use("/*", shell({ title: 'a"b', lang: "pt-BR" }));
    app.get("/", (c) => c.render("home"));
    const html = await (await app.request("/")).text();
    expect(html).toContain("<title>a&quot;b</title>");
    expect(html).toContain('lang="pt-BR"');
  });
});