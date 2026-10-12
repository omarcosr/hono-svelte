// hono-svelte target of the contract suite. Built with `vite build --mode server`
// into a single dist/server/server.mjs that runs on Node and on Bun.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { CACHE_IMMUTABLE, errorHandler, notFoundHandler, shell, type ViteManifest } from "hono-svelte";

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
const manifest = JSON.parse(readFileSync(join(clientDir, ".vite", "manifest.json"), "utf8")) as ViteManifest;
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css" };

const app = new Hono();

app.get("/static/*", (c) => {
  const file = normalize(join(clientDir, c.req.path));
  if (!file.startsWith(clientDir + sep) || !existsSync(file)) return c.text("Not found", 404);
  return c.body(readFileSync(file), 200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "cache-control": CACHE_IMMUTABLE,
  });
});

app.use("/*", shell({ title: "Shell default", assets: manifest, stylesEntry: "styles.css", prefetch: "hover" }));
app.get("/", (c) => c.render("index"));
app.get("/nested/static", (c) => c.render("nested/static"));
app.get("/nested/client", (c) => c.render("nested/client"));
app.get("/private", basicAuth({ username: "user", password: "pass" }), (c) => c.text("ok"));
app.notFound(notFoundHandler());
app.onError(errorHandler());

const port = Number(process.env.PORT ?? 4301);
const bun = (globalThis as { Bun?: { serve: (options: object) => unknown } }).Bun;
if (bun) {
  bun.serve({ port, fetch: app.fetch });
} else {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port });
}
console.log(`hono-svelte e2e app on http://localhost:${port}`);
