// Contract with the real bundler: a client `vite build` (svelte() + pages(),
// manifest on) must emit the manifest keys `manifestKeysFor` looks up and the
// file names the shell links — the unit tests only ever see hand-written manifests.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManifestAssets, manifestCssFor, manifestKeyFor, type ViteManifest } from "../src/assets.js";
import { pages } from "../src/vite.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/build-app");
const outDir = mkdtempSync(join(tmpdir(), "hono-svelte-client-"));
let manifest: ViteManifest;
let appPages: ReturnType<typeof pages>;

beforeAll(async () => {
  appPages = pages({ pagesDir: join(fixture, "pages"), stylesEntry: "styles.css" });
  // input() is read inside the config, before Vite resolves it — like an app's vite.config.ts.
  (appPages.configResolved as (config: unknown) => void)({ root: fixture, plugins: [], mode: "client", command: "build" });
  await build({
    root: fixture,
    configFile: false,
    logLevel: "silent",
    mode: "client",
    plugins: [svelte(), appPages],
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input: appPages.input(),
        output: {
          entryFileNames: "static/[name]-[hash].js",
          chunkFileNames: "static/chunks/[name]-[hash].js",
          assetFileNames: "static/[name]-[hash][extname]",
        },
      },
    },
  });
  manifest = JSON.parse(readFileSync(join(outDir, ".vite", "manifest.json"), "utf8")) as ViteManifest;
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("vite build (client)", () => {
  it("every client entry is reachable through manifestKeysFor", () => {
    const entries = appPages.entries().filter((e) => appPages.hasClient(e));
    expect(entries).toEqual(["docs/counter"]);
    for (const entry of entries) {
      const key = manifestKeyFor(manifest, entry);
      expect(key, `manifest key for ${entry} (have: ${Object.keys(manifest).join(", ")})`).toBeDefined();
      expect(manifest[key as string].isEntry).toBe(true);
    }
  });

  it("resolved files exist on disk and carry a hash", () => {
    const url = createManifestAssets(manifest);
    for (const entry of appPages.entries().filter((e) => appPages.hasClient(e))) {
      const href = url(entry);
      expect(href).toMatch(/^\/static\/.+-[\w-]+\.js$/);
      expect(existsSync(join(outDir, href.slice(1)))).toBe(true);
      for (const css of manifestCssFor(manifest, entry)) {
        expect(existsSync(join(outDir, css.slice(1)))).toBe(true);
      }
    }
  });

  it("the stylesEntry lands in the manifest under its source path", () => {
    expect(manifest["styles.css"]?.file).toMatch(/^static\/styles-[\w-]+\.css$/);
  });
});
