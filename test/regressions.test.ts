// One test per bug fixed in 0.6.1 — each failed before its fix.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler, shell } from "../src/index.js";
import { pages } from "../src/vite.js";
import PropsPage from "./fixtures/_pages/props.svelte";
import Outer from "./fixtures/_pages/outer-layout.svelte";
import Inner from "./fixtures/_pages/inner-layout.svelte";

type Loader = () => Promise<{ default: unknown }>;

function manifest(pages: Record<string, Loader>, extra: Record<string, unknown>): never {
  return Object.assign(pages, extra) as never;
}

afterEach(() => vi.restoreAllMocks());

describe("regressions", () => {
  it("nested layouts nest outermost first on the server (root layout > dir layout > page)", async () => {
    const app = new Hono();
    app.use(
      "/*",
      shell({
        ssrPages: manifest(
          { "a/page": async () => ({ default: PropsPage }) },
          {
            __layouts: { layout: async () => ({ default: Outer }), "a/layout": async () => ({ default: Inner }) },
            __clientEntries: [],
          },
        ),
      }),
    );
    app.get("/", (c) => c.render("a/page", { data: { name: "Ada" } }));
    const html = await (await app.request("/")).text();
    const outer = html.indexOf('class="outer"');
    const inner = html.indexOf('class="inner"');
    const page = html.indexOf("Greeting page");
    expect(outer).toBeGreaterThan(-1);
    expect(outer).toBeLessThan(inner);
    expect(inner).toBeLessThan(page);
  });

  it("client entries mount every layout of the chain, outermost first", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-chain-"));
    try {
      mkdirSync(join(dir, "pages", "a"), { recursive: true });
      writeFileSync(join(dir, "pages", "layout.svelte"), "<div><slot /></div>\n");
      writeFileSync(join(dir, "pages", "a", "layout.svelte"), "<div><slot /></div>\n");
      writeFileSync(join(dir, "pages", "a", "page.svelte"), "<script>let x = 1;</script><p>{x}</p>\n");
      const plugin = pages({ pagesDir: join(dir, "pages") });
      plugin.configResolved({ root: dir } as never);
      plugin.buildStart();
      const code = (plugin.load as (id: string) => string)(String.fromCharCode(0) + "virtual:hono-svelte/entry/a/page");
      expect(code).toContain('import Layout0 from "/pages/layout.svelte"');
      expect(code).toContain('import Layout1 from "/pages/a/layout.svelte"');
      expect(code).toContain("children = slot(Layout1, { ...props, children })");
      expect(code).toContain("mount(Layout0, { target, props: { ...props, children }, context })");
      expect(code).not.toContain("hydrate");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefetch: all skips static pages (they have no JS chunk)", async () => {
    const app = new Hono();
    app.use(
      "/*",
      shell({
        ssrPages: manifest(
          { st: async () => ({ default: PropsPage }) },
          { __allEntries: ["st", "c1", "c2"], __clientEntries: ["c1", "c2"] },
        ),
        isProd: true,
        prefetch: "all",
      }),
    );
    app.get("/", (c) => c.render("c1"));
    const html = await (await app.request("/")).text();
    expect(html).toContain('href="/static/c2.js"');
    expect(html).not.toContain("/static/st.js");
  });

  it("prefetch: hover dedupes its links and maps / and /dir to index entries", async () => {
    const app = new Hono();
    app.use("/*", shell({ knownEntries: ["a", "index", "dash/index"], prefetch: "hover", isProd: true }));
    app.get("/", (c) => c.render("a"));
    const html = await (await app.request("/")).text();
    const code = html.match(/<script>(\(function\(\)\{var m=[\s\S]*?)<\/script>/)![1];
    const links: string[] = [];
    let onOver: (e: unknown) => void = () => {};
    const document = {
      querySelector: (sel: string) => (links.some((u) => sel.includes('rel="modulepreload"') && sel.includes(u)) ? {} : null),
      createElement: () => ({}) as { href?: string },
      head: { appendChild: (l: { href: string }) => links.push(l.href) },
      addEventListener: (_: string, fn: (e: unknown) => void) => (onOver = fn),
    };
    runInNewContext(code, { document, location: { origin: "http://x" }, URL });
    const hover = (href: string) => onOver({ target: { closest: () => ({ href }) } });
    hover("http://x/");
    hover("http://x/");
    hover("http://x/dash/");
    expect(links).toEqual(["/static/index.js", "/static/dash/index.js"]);
  });

  it("errorHandler keeps the headers of HTTPException responses (WWW-Authenticate)", async () => {
    const app = new Hono();
    app.use("/*", shell({ strict: false }));
    app.onError(errorHandler({ log: false, json: (c) => c.req.path.startsWith("/api") }));
    const res401 = () =>
      new HTTPException(401, { res: new Response("no", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="x"' } }) });
    app.get("/", () => {
      throw res401();
    });
    app.get("/api", () => {
      throw res401();
    });
    for (const path of ["/", "/api"]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="x"');
    }
    expect((await app.request("/")).headers.get("content-type")).toContain("text/html");
  });

  it("the global stylesheet fallback follows assetsBase", async () => {
    const app = new Hono();
    app.use("/*", shell({ assetsBase: "/assets", isProd: true }));
    app.get("/", (c) => c.render("admin"));
    expect(await (await app.request("/")).text()).toContain('<link rel="stylesheet" href="/assets/styles.css"');
  });

  it("a throwing nonce() is logged instead of silently dropping the CSP nonce", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono();
    app.use(
      "/*",
      shell({
        nonce: () => {
          throw new Error("no nonce");
        },
      }),
    );
    app.get("/", (c) => c.render("admin"));
    expect((await app.request("/")).status).toBe(200);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("nonce() threw"), expect.any(Error));
  });

  it("pagesDir outside the Vite root fails with a clear (English) error", () => {
    const dir = mkdtempSync(join(tmpdir(), "hs-outside-"));
    try {
      writeFileSync(join(dir, "p.svelte"), "<script>let x = 1;</script>{x}\n");
      const plugin = pages({ pagesDir: dir });
      plugin.configResolved({ root: join(dir, "app") } as never);
      expect(() => (plugin.load as (id: string) => string)(String.fromCharCode(0) + "virtual:hono-svelte/entry/p")).toThrowError(
        /pagesDir must be inside the Vite root/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
