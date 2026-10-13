import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // cli.ts is a thin wrapper exercised through dist/cli.js subprocess
      // smoke tests (spawnSync), invisible to the in-process v8 provider.
      exclude: ["src/cli.ts"],
      // Floors sit just under the measured coverage so it can only go up.
      // Branch threshold stays lower: the dev-watcher hooks in vite.ts need a
      // live Vite dev server to exercise.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 90,
        lines: 92,
      },
    },
  },
});