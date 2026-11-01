import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { privateAssetDirs, type ViteManifest } from "../src/assets.js";
import { privateAssets } from "../src/index.js";

const V = "\0virtual:hono-svelte/entry/";
// Two public pages, two admin pages: a shared chunk, an admin-only layout (with CSS and a lazy chunk),
// a library only the admin uses and a chunk the dash and the admin share.
const manifest: ViteManifest = {
  [V + "index"]: { file: "static/index-a.js", isEntry: true, imports: ["_shared.js"] },
  [V + "dash/index"]: { file: "static/dash/index-b.js", isEntry: true, imports: ["_shared.js", "_both.js"] },
  [V + "admin/index"]: { file: "static/admin/index-c.js", isEntry: true, imports: ["_shared.js", "_admin-layout.js", "_both.js"] },
  [V + "admin/users"]: { file: "static/admin/users-d.js", isEntry: true, imports: ["_admin-layout.js", "_csv.js"], css: ["static/users-d.css"] },
  "_shared.js": { file: "static/chunks/shared-e.js" },
  "_both.js": { file: "static/chunks/both-f.js" },
  "_admin-layout.js": { file: "static/chunks/layout-g.js", css: ["static/layout-g.css"], dynamicImports: ["_lazy.js"], assets: ["static/logo-h.svg"] },
  "_lazy.js": { file: "static/chunks/lazy-i.js" },
  "_csv.js": { file: "static/chunks/csv-j.js" },
  "src/app.css": { file: "static/app-k.css", isEntry: true },
};

describe("privateAssetDirs()", () => {
  it("lists what only the private folder reaches (statically, lazily, CSS and assets), nothing a public entry reaches", () => {
    const owners = privateAssetDirs(manifest, ["admin"]);
    expect([...owners.keys()].sort()).toEqual([
      "/static/admin/index-c.js",
      "/static/admin/users-d.js",
      "/static/chunks/csv-j.js",
      "/static/chunks/layout-g.js",
      "/static/chunks/lazy-i.js",
      "/static/layout-g.css",
      "/static/logo-h.svg",
      "/static/users-d.css",
    ]);
    expect(owners.get("/static/admin/users-d.js")).toEqual(["admin"]);
  });

  it("keys written relative to a parent root count too; no private folders, no private files", () => {
    const relative = { ["../../" + V.slice(1) + "admin/index"]: { file: "static/admin/index-c.js", isEntry: true } } as ViteManifest;
    expect([...privateAssetDirs(relative, ["admin"]).keys()]).toEqual(["/static/admin/index-c.js"]);
    expect(privateAssetDirs(manifest, []).size).toBe(0);
  });
});

describe("privateAssets()", () => {
  const app = (allowed: boolean) => {
    const hono = new Hono();
    const seen: string[][] = [];
    hono.use(
      "/static/*",
      privateAssets({
        manifest,
        privatePages: ["admin"],
        allow: (c, dirs) => (seen.push(dirs), allowed && c.req.header("x-admin") === "1"),
        serve: (c) => c.text("file " + c.req.path),
      }),
    );
    hono.all("*", (c) => c.text("next", 404));
    return { hono, seen };
  };

  it("serves a private file when allowed, 404 otherwise; other paths go on untouched", async () => {
    const { hono, seen } = app(true);
    const ok = await hono.request("/static/chunks/layout-g.js", { headers: { "x-admin": "1" } });
    expect(await ok.text()).toBe("file /static/chunks/layout-g.js");
    expect(seen).toEqual([["admin"]]);
    expect((await hono.request("/static/chunks/layout-g.js")).status).toBe(404);
    const denied = await app(false).hono.request("/static/admin/index-c.js", { headers: { "x-admin": "1" } });
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain("file");
    const shared = await hono.request("/static/chunks/shared-e.js");
    expect(await shared.text()).toBe("next");
  });
});
