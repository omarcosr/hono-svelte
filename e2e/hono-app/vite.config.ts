import devServer from "@hono/vite-dev-server";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { pages } from "hono-svelte/vite";
import { defineConfig, type UserConfig } from "vite";

const appPages = pages({ pagesDir: "pages" });

export default defineConfig(({ command, mode }): UserConfig => {
  if (command === "serve") {
    // `vite` dev: SSR through Vite's module graph, client entries served by Vite.
    return {
      plugins: [svelte(), appPages, devServer({ entry: "dev.ts" })],
      server: { port: Number(process.env.PORT ?? 4304), strictPort: true },
    };
  }
  if (mode === "client") {
    return {
      plugins: [svelte(), appPages],
      build: {
        outDir: "dist/client",
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {
          input: { ...appPages.input(), styles: "styles.css" },
          output: {
            entryFileNames: "static/[name]-[hash].js",
            chunkFileNames: "static/chunks/[name]-[hash].js",
            assetFileNames: "static/[name]-[hash][extname]",
          },
        },
      },
    };
  }
  return {
    plugins: [svelte(), appPages],
    ssr: { noExternal: true },
    build: {
      ssr: "server.ts",
      outDir: "dist/server",
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "server.mjs" } },
    },
  };
});
