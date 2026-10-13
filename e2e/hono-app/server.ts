// Production target: `vite build --mode server` bundles this into
// dist/server/server.mjs, which runs on Node and on Bun.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_IMMUTABLE, type ViteManifest } from "hono-svelte";
import { createApp } from "./app";

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
const manifest = JSON.parse(readFileSync(join(clientDir, ".vite", "manifest.json"), "utf8")) as ViteManifest;
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css" };

const app = createApp({ assets: manifest, stylesEntry: "styles.css", prefetch: "hover" }, (app) => {
  app.get("/static/*", (c) => {
    const file = normalize(join(clientDir, c.req.path));
    if (!file.startsWith(clientDir + sep) || !existsSync(file)) return c.text("Not found", 404);
    return c.body(readFileSync(file), 200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": CACHE_IMMUTABLE,
    });
  });
});

const port = Number(process.env.PORT ?? 4301);
const bun = (globalThis as { Bun?: { serve: (options: object) => unknown } }).Bun;
if (bun) {
  bun.serve({ port, fetch: app.fetch });
} else {
  const { serve } = await import("@hono/node-server");
  serve({ fetch: app.fetch, port });
}
console.log(`hono-svelte e2e app on http://localhost:${port}`);
