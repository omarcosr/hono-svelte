// Documented c.render() semantics — these pin the coexistence CONTRACT of
// hono-svelte with hono's renderer mechanism (validated against hono 4.13):
//
// 1. c.render(string) has default semantics without any middleware (hon's
//    lazy fallback renders it via c.html). A shell mounted on the same path
//    reinterprets that call as an entry name — a pre-existing default-render
//    route under a shell turns into a strict 500 (loud, not silent).
// 2. hono's setRenderer is last-write-wins per request: the LAST renderer
//    middleware registered on a matching path wins — other renderer
//    middlewares (hono/jsx jsx-renderer, another shell) silently clobber
//    earlier ones. Register more-specific shells AFTER catch-alls.
//
// One renderer per request path is hono's platform contract (its own
// jsx-renderer behaves identically) — these tests document it so changes in
// either side surface here first.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { shell } from "../src/index.js";

describe("c.render coexistence contract", () => {
  it("without a shell, c.render(string) keeps hono's default semantics", async () => {
    const app = new Hono();
    app.get("/", (c) => c.render("Hello default!"));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello default!");
  });

  it("under a shell, the same call is reinterpreted as an entry name (strict 500)", async () => {
    const app = new Hono();
    app.use("/*", shell({ knownEntries: ["home"] }));
    app.get("/", (c) => c.render("Hello default!"));
    const res = await app.request("/");
    expect(res.status).toBe(500);
  });

  it("two shells on overlapping paths: the LAST registered wins", async () => {
    const app = new Hono();
    app.use("/admin/*", shell({ title: "AdminShell" }));
    app.use("/*", shell({ title: "GlobalShell" }));
    app.get("/admin", (c) => c.render("home"));
    const html = await (await app.request("/admin")).text();
    expect(html).toContain("<title>GlobalShell</title>");
  });

  it("shell + another setRenderer middleware: the last registered wins", async () => {
    const app = new Hono();
    const jsxLikeRenderer = async (c: any, next: any) => {
      c.setRenderer((output: any) => c.html(`JSX:${String(output)}`));
      await next();
    };
    app.use("/*", shell({ knownEntries: ["home"] }));
    app.use("/*", jsxLikeRenderer);
    app.get("/", (c) => c.render("home"));
    const res = await app.request("/");
    expect(await res.text()).toContain("JSX:home");
  });
});
