import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { shell } from "../src/index.js";
import { readPage } from "../src/testing.js";
import Home from "./fixtures/pages/home.svelte";

function app() {
  const a = new Hono();
  a.use("/*", shell({ strict: false, ssrPages: { home: async () => ({ default: Home }) } }));
  a.get("/users/:id", (c) => c.render("admin", { data: { id: c.req.param("id"), note: `</script><b>"&"</b>` } }));
  a.get("/", (c) => c.render("home"));
  return a;
}

describe("readPage", () => {
  it("reads data, path, route and the rendered entry", async () => {
    const page = readPage<{ id: string; note: string }>(await (await app().request("/users/7?x=1")).text());
    expect(page.data).toEqual({ id: "7", note: `</script><b>"&"</b>` });
    expect([page.path, page.route]).toEqual(["/users/7", "/users/:id"]);
    expect(page.is("admin")).toBe(true);
    expect(page.is("home")).toBe(false);
  });

  it("data is undefined when the render passed none", async () => {
    const page = readPage(await (await app().request("/")).text());
    expect(page.data).toBeUndefined();
    expect(page.is("home")).toBe(true);
  });

  it("throws on documents not rendered by the shell", () => {
    expect(() => readPage("<html><body>hi</body></html>")).toThrow(/not a document rendered by shell/);
  });
});
