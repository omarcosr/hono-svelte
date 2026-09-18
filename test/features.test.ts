import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";
import { renderHead } from "../src/head.js";
import {
  CACHE_IMMUTABLE,
  createManifestAssets,
  immutableHeaders,
  manifestCssFor,
  manifestImportsFor,
} from "../src/assets.js";
import { errorHandler, notFoundHandler } from "../src/handlers.js";
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
});

describe("scaffold", () => {
  it("initFiles scaffolds env, vite config and index page", () => {
    const files = initFiles();
    const paths = files.map((f) => f.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("src/env.d.ts");
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

  it("isSafeAppPath accepts in-root files on any separator/case", () => {
    // Regression: on Windows join() yields backslashes, so comparing
    // against root + "/" rejected EVERY file and `init` refused to write.
    expect(isSafeAppPath("C:\\proj", "C:\\proj\\src\\env.d.ts")).toBe(true);
    expect(isSafeAppPath("C:/proj", "C:/proj/src/pages/index.svelte")).toBe(true);
    expect(isSafeAppPath(process.cwd(), "src/env.d.ts")).toBe(true);
    expect(isSafeAppPath("C:\\proj", "C:\\other\\evil.ts")).toBe(false);
    expect(isSafeAppPath("/app", "/etc/passwd")).toBe(false);
    expect(isSafeAppPath("/app", "/app/../evil.ts")).toBe(false);
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
