import build from "@hono/vite-build/bun";
import devServer from "@hono/vite-dev-server";
import bunAdapter from "@hono/vite-dev-server/bun";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { pages } from "hono-svelte/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const appPages = pages({ dts: true });

export default defineConfig(({ command, mode }) => {
  if (mode === "client") {
    return {
      plugins: [tailwindcss(), svelte(), appPages],
      build: {
        outDir: "./dist",
        emptyOutDir: true,
        copyPublicDir: false,
        rollupOptions: {
          input: {
            ...appPages.input(),
            styles: resolve("src/styles.css"),
          },
          output: {
            entryFileNames: "static/[name].js",
            chunkFileNames: "static/chunks/[name]-[hash].js",
            assetFileNames: "static/[name][extname]",
          },
        },
      },
    };
  }

  if (command === "serve") {
    return {
      plugins: [
        tailwindcss(),
        svelte(),
        appPages,
        devServer({
          entry: "src/routes/index.ts",
          adapter: bunAdapter(),
        }),
      ],
    };
  }

  return {
    plugins: [
      svelte(),
      appPages,
      build({
        entry: "src/routes/index.ts",
        staticRoot: "./dist",
      }),
    ],
  };
});
