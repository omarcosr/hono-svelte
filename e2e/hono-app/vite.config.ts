import { svelte } from "@sveltejs/vite-plugin-svelte";
import { pages } from "hono-svelte/vite";
import { defineConfig } from "vite";

const appPages = pages({ pagesDir: "pages" });

export default defineConfig(({ mode }) =>
  mode === "client"
    ? {
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
      }
    : {
        plugins: [svelte(), appPages],
        ssr: { noExternal: true },
        build: {
          ssr: "server.ts",
          outDir: "dist/server",
          emptyOutDir: true,
          rollupOptions: { output: { entryFileNames: "server.mjs" } },
        },
      },
);
