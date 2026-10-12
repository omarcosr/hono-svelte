import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { renderHead } from "../src/head.js";
import {
  CACHE_IMMUTABLE,
  createManifestAssets,
  immutableHeaders,
  manifestCssFor,
  manifestImportsFor,
} from "../src/assets.js";
import { errorHandler, notFoundHandler } from "../src/handlers.js";
import { shell } from "../src/index.js";
import {
  checkAppLink,
  doctorChecks,
  initFiles,
  isSafeAppPath,
  isValidPageName,
  newPageFile,
} from "../src/scaffold.js";
import { existsSync } from "node:fs";

describe("renderHead", () => {
  it("renders description, canonical and theme-color", () => {
    const html = renderHead({ description: "D", canonical: "https://x/", themeColor: "#fff" });
    expect(html).toContain('name="description" content="D"');
    expect(html).toContain('<link rel="canonical" href="https://x/" />');
    expect(html).toContain('name="theme-color" content="#fff"');
  });

  it("renders og/twitter/meta and escapes attrs", () => {
    const html = renderHead({
      meta: [{ name: "x", content: 'a"b<c' }],
      og: { title: "T" },
      twitter: { card: "summary" },
    });
    expect(html).toContain('content="a&quot;b&lt;c"');
    expect(html).toContain('property="og:title" content="T"');
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("passes strings through and appends extra raw", () => {
    expect(renderHead('<meta name="a"/>')).toBe('<meta name="a"/>');
    expect(renderHead({ extra: "<!-- x -->" })).toContain("<!-- x -->");
    expect(renderHead(undefined)).toBe("");
  });
});

describe("assets", () => {
  const manifest = {
    admin: { file: "a-1.js", css: ["a-1.css"], imports: ["./c.js"] },
    "./c.js": { file: "c-1.js" },
  };

  it("resolves hashed files with fallback", () => {
    const resolve = createManifestAssets(manifest);
    expect(resolve("admin")).toBe("/a-1.js");
    expect(resolve("missing")).toBe("/static/missing.js");
  });

  it("exposes css and shared imports", () => {
    expect(manifestCssFor(manifest, "admin")).toEqual(["/a-1.css"]);
    expect(manifestImportsFor(manifest, "admin")).toEqual(["/c-1.js"]);
    expect(manifestCssFor(manifest, "missing")).toEqual([]);
  });

  // Vite puts a shared module's CSS on the chunk that owns it: a layout used
  // by several pages lands in `_layout.js` with `layout.css`, not on the entry.
  const graph = {
    "virtual:hono-svelte/entry/dash/page": {
      file: "static/dash/page.js",
      isEntry: true,
      imports: ["_layout.js", "_icon.js"],
      css: ["static/page.css"],
    },
    "_layout.js": { file: "static/chunks/layout.js", imports: ["_runtime.js", "_modal.js"], css: ["static/layout.css"] },
    "_modal.js": { file: "static/chunks/modal.js", imports: ["_runtime.js"], css: ["static/modal.css"] },
    "_icon.js": { file: "static/chunks/icon.js", imports: ["_runtime.js"], dynamicImports: ["_lazy.js"] },
    "_runtime.js": { file: "static/chunks/runtime.js" },
    "_lazy.js": { file: "static/chunks/lazy.js", css: ["static/lazy.css"] },
  };

  it("collects CSS from the whole static import graph, shared chunks first", () => {
    expect(manifestCssFor(graph, "dash/page")).toEqual(["/static/modal.css", "/static/layout.css", "/static/page.css"]);
  });

  it("preloads every statically reachable chunk once, skipping dynamic imports", () => {
    expect(manifestImportsFor(graph, "dash/page")).toEqual([
      "/static/chunks/runtime.js",
      "/static/chunks/modal.js",
      "/static/chunks/layout.js",
      "/static/chunks/icon.js",
    ]);
  });

  it("survives import cycles", () => {
    const cyclic = {
      entry: { file: "e.js", imports: ["_a.js"], css: ["e.css"] },
      "_a.js": { file: "a.js", imports: ["_b.js"], css: ["a.css"] },
      "_b.js": { file: "b.js", imports: ["_a.js"], css: ["b.css"] },
    };
    expect(manifestCssFor(cyclic, "entry")).toEqual(["/b.css", "/a.css", "/e.css"]);
    expect(manifestImportsFor(cyclic, "entry")).toEqual(["/b.js", "/a.js"]);
  });

  it("cache helpers use immutable", () => {
    expect(CACHE_IMMUTABLE).toContain("immutable");
    expect(immutableHeaders({ "X-A": "1" })).toEqual({
      "Cache-Control": CACHE_IMMUTABLE,
      "X-A": "1",
    });
  });
});

describe("handlers", () => {
  it("notFoundHandler renders 404 entry", async () => {
    let seen: { entry: string; props: unknown } | null = null;
    const c = {
      render: (entry: string, props: unknown) => {
        seen = { entry, props };
        return "nf";
      },
    };
    const res = (await notFoundHandler()(c as unknown as Context)) as unknown;
    expect(res).toBe("nf");
    expect(seen!.entry).toBe("404");
    expect((seen!.props as { status: number }).status).toBe(404);
  });

  it("errorHandler renders 500 entry and logs", async () => {
    const logged: unknown[] = [];
    const c = {
      render: (entry: string, props: unknown) => ({ entry, props }),
    };
    const res = (await errorHandler({ entry: "oops", log: (e) => logged.push(e) })(
      new Error("boom"),
      c as unknown as Context,
    )) as unknown as { entry: string; props: { status: number } };
    expect(res.entry).toBe("oops");
    expect(res.props.status).toBe(500);
    expect(logged.length).toBe(1);
  });

  describe("status, message and JSON for API paths", () => {
    const isApi = (c: Context) => c.req.path.startsWith("/api/");
    const dataOf = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="[^"]+">(.*?)<\/script>/)![1]);

    function app(opts: Parameters<typeof errorHandler>[0] = {}) {
      const logged: unknown[] = [];
      const a = new Hono();
      a.use("/*", shell({ strict: false }));
      a.notFound(notFoundHandler({ json: isApi, message: "Página não encontrada" }));
      a.onError(errorHandler({ json: isApi, log: (e) => logged.push(e), ...opts }));
      for (const prefix of ["", "/api"]) {
        a.get(`${prefix}/boom`, () => {
          throw new Error("db password leaked");
        });
        a.get(`${prefix}/gone`, () => {
          throw new HTTPException(410, { message: "Registro removido" });
        });
      }
      return { app: a, logged };
    }

    it("pages get { status, message } as data and the matching status", async () => {
      const { app: a } = app();
      const notFound = await a.request("/nope");
      expect(notFound.status).toBe(404);
      expect(dataOf(await notFound.text())).toEqual({ status: 404, message: "Página não encontrada" });

      const gone = await a.request("/gone");
      expect(gone.status).toBe(410);
      expect(dataOf(await gone.text())).toEqual({ status: 410, message: "Registro removido" });
    });

    it("5xx never expose the error message and are logged; 4xx are not logged", async () => {
      const { app: a, logged } = app();
      const boom = await a.request("/boom");
      expect(boom.status).toBe(500);
      const html = await boom.text();
      expect(html).not.toContain("leaked");
      expect(dataOf(html)).toEqual({ status: 500, message: "Internal Server Error" });
      await a.request("/gone");
      expect(logged).toHaveLength(1);
    });

    it("json() paths answer { message } JSON with the same status", async () => {
      const { app: a } = app();
      const notFound = await a.request("/api/nope");
      expect(notFound.status).toBe(404);
      expect(await notFound.json()).toEqual({ message: "Página não encontrada" });
      const gone = await a.request("/api/gone");
      expect([gone.status, await gone.json()]).toEqual([410, { message: "Registro removido" }]);
      const boom = await a.request("/api/boom");
      expect([boom.status, await boom.json()]).toEqual([500, { message: "Internal Server Error" }]);
    });

    it("message, expose and data are configurable", async () => {
      const { app: a } = app({ message: "Erro interno", expose: () => false, data: { support: "x@y.z" } });
      expect(dataOf(await (await a.request("/gone")).text())).toEqual({ status: 410, message: "Erro interno", support: "x@y.z" });
    });
  });
});

describe("scaffold", () => {
  it("initFiles scaffolds env, vite config and index page", () => {
    const files = initFiles();
    const paths = files.map((f) => f.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("src/env.d.ts");
    expect(paths).toContain("src/hono-svelte-entries.d.ts");
    expect(paths).toContain("vite.config.ts");
    expect(paths).toContain("src/pages/index.svelte");
    expect(paths).toContain("src/pages/hello.svelte");
    expect(paths).toContain("src/routes/index.ts");
    expect(files.every((f) => f.skipIfExists)).toBe(true);
  });

  it("initFiles --full adds auth, dashboard, layout and typed RPC", () => {
    const paths = initFiles("full").map((f) => f.path);
    for (const p of [
      "src/lib/auth.ts",
      "src/middleware/auth.ts",
      "src/routes/auth.ts",
      "src/routes/dashboard.ts",
      "src/routes/api.ts",
      "src/pages/auth.svelte",
      "src/pages/dashboard/index.svelte",
      "src/pages/dashboard/page1.svelte",
      "src/pages/dashboard/layout.svelte",
    ]) {
      expect(paths).toContain(p);
    }
    // minimal stays lean
    expect(initFiles("minimal").map((f) => f.path)).not.toContain("src/routes/api.ts");
  });

  it("doctorChecks flags missing dist and missing app link", () => {
    const issues = doctorChecks({ packageRoot: "/nope", appRoot: "/nope" });
    expect(issues.map((i) => i.code)).toContain("missing-dist");
    expect(issues[0].fix.length).toBeGreaterThan(0);
    expect(checkAppLink("/nope")?.code).toBe("missing-link");
  });

  it("isSafeAppPath keeps writes inside the app root", () => {
    expect(isSafeAppPath(process.cwd(), "src/env.d.ts")).toBe(true);
    expect(isSafeAppPath("/app", "/etc/passwd")).toBe(false);
    expect(isSafeAppPath("/app", "/app/../evil.ts")).toBe(false);
  });

  // Drive-letter paths are only absolute on Windows: on POSIX `C:\\proj` is a
  // relative segment, so these assertions only make sense there.
  it.runIf(process.platform === "win32")("isSafeAppPath accepts in-root files on any separator/case (win32)", () => {
    // Regression: on Windows join() yields backslashes, so comparing
    // against root + "/" rejected EVERY file and `init` refused to write.
    expect(isSafeAppPath("C:\\proj", "C:\\proj\\src\\env.d.ts")).toBe(true);
    expect(isSafeAppPath("C:/proj", "C:/proj/src/pages/index.svelte")).toBe(true);
    expect(isSafeAppPath("C:\\proj", "c:\\PROJ\\src\\env.d.ts")).toBe(true);
    expect(isSafeAppPath("C:\\proj", "C:\\other\\evil.ts")).toBe(false);
  });

  it("generated package.json carries the security floors (no vulnerable ranges)", () => {
    const files = initFiles();
    const pkg = JSON.parse(
      files.find((f) => f.path === "package.json")?.content ?? "{}",
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // All published advisories sit below these floors (hono < 4.12.34,
    // svelte <= 5.55.6, vite <= 8.0.15) — keep them in sync with the
    // package's own peerDependencies.
    expect(pkg.dependencies.hono).toBe("^4.13.8");
    expect(pkg.dependencies.svelte).toBe("^5.57.0");
    expect(pkg.devDependencies.vite).toBe("^8.3.0");
  });

  it("init --full scaffolds a runnable app (smoke: tsc on generated files)", () => {
    const pkgRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
    const dir = mkdtempSync(join(tmpdir(), "hs-init-full-"));
    try {
      execFileSync(process.execPath, [join(pkgRoot, "dist", "cli.js"), "init", "--full", `--app=${dir}`], {
        stdio: "pipe",
      });
      // key files exist
      for (const p of [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "src/routes/index.ts",
        "src/routes/dashboard.ts",
        "src/pages/dashboard/layout.svelte",
        "src/pages/dashboard/index.svelte",
      ]) {
        expect(existsSync(join(dir, p)), p).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isValidPageName accepts entry names, rejects traversal and layouts", () => {
    expect(isValidPageName("blog/post-1")).toBe(true);
    expect(isValidPageName("a")).toBe(true);
    expect(isValidPageName("../evil")).toBe(false);
    expect(isValidPageName("/abs")).toBe(false);
    expect(isValidPageName("a/../b")).toBe(false);
    expect(isValidPageName("a//b")).toBe(false);
    expect(isValidPageName("layout")).toBe(false);
    expect(isValidPageName("dash/layout")).toBe(false);
    expect(isValidPageName("")).toBe(false);
  });

  it("newPageFile builds a static page under src/pages", () => {
    const file = newPageFile("blog/post-1");
    expect(file?.path).toBe("src/pages/blog/post-1.svelte");
    expect(file?.skipIfExists).toBe(true);
    expect(file?.content).not.toContain("<script");
    expect(file?.content).toContain("blog/post-1");
    expect(file?.content).toContain("<h1>post 1</h1>");
    expect(newPageFile("../evil")).toBeNull();
    expect(newPageFile("blog.svelte")?.path).toBe("src/pages/blog.svelte");
  });

  it("`add page` CLI writes the file, skips existing, refuses bad names (dist smoke)", () => {
    const pkgRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
    const dir = mkdtempSync(join(tmpdir(), "hs-add-"));
    try {
      const run = (args: string[]) =>
        spawnSync(process.execPath, [join(pkgRoot, "dist", "cli.js"), ...args], {
          stdio: "pipe",
          encoding: "utf8",
        });
      const ok = run(["add", "page", "demo/nested", `--app=${dir}`]);
      expect(ok.status).toBe(0);
      expect(existsSync(join(dir, "src", "pages", "demo", "nested.svelte"))).toBe(true);
      // second run skips the existing file
      const again = run(["add", "page", "demo/nested", `--app=${dir}`]);
      expect(again.status).toBe(0);
      expect(String(again.stdout)).toContain("skipping");
      // traversal names are refused
      const bad = run(["add", "page", "../evil", `--app=${dir}`]);
      expect(bad.status).toBe(1);
      expect(String(bad.stderr)).toContain("invalid page name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
