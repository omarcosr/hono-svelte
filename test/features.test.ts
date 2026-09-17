import { describe, expect, it } from "vitest";
import { renderHead } from "../src/head.js";
import {
  CACHE_IMMUTABLE,
  createManifestAssets,
  immutableHeaders,
  manifestCssFor,
  manifestImportsFor,
} from "../src/assets.js";
import { errorHandler, notFoundHandler } from "../src/handlers.js";
import { checkAppLink, doctorChecks, initFiles } from "../src/scaffold.js";

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
    expect(await notFoundHandler()(c)).toBe("nf");
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
      c,
    )) as { entry: string; props: { status: number } };
    expect(res.entry).toBe("oops");
    expect(res.props.status).toBe(500);
    expect(logged.length).toBe(1);
  });
});

describe("scaffold", () => {
  it("initFiles scaffolds env, vite config and index page", () => {
    const files = initFiles();
    expect(files.map((f) => f.path)).toEqual([
      "src/env.d.ts",
      "vite.config.ts",
      "src/pages/index.svelte",
    ]);
    expect(files.every((f) => f.skipIfExists)).toBe(true);
  });

  it("doctorChecks flags missing dist and missing app link", () => {
    const issues = doctorChecks({ packageRoot: "/nope", appRoot: "/nope" });
    expect(issues.map((i) => i.code)).toContain("missing-dist");
    expect(issues[0].fix.length).toBeGreaterThan(0);
    expect(checkAppLink("/nope")?.code).toBe("missing-link");
  });
});
