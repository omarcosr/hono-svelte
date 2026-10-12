import { defineConfig, devices } from "@playwright/test";

// Every target runs the same suite. `sveltekit` is the reference
// implementation: a contract test that fails only on hono-svelte is a bug.
const targets = [
  { name: "hono-svelte-node", port: 4301, command: "node hono-app/dist/server/server.mjs" },
  { name: "hono-svelte-bun", port: 4302, command: "bun hono-app/dist/server/server.mjs" },
  { name: "sveltekit", port: 4303, command: "node kit-app/build/index.js" },
];

// E2E_PROJECTS=hono-svelte-node,sveltekit limits the servers started (e.g. without Bun).
const only = process.env.E2E_PROJECTS?.split(",").map((s) => s.trim());
const active = only ? targets.filter((t) => only.includes(t.name)) : targets;

export default defineConfig({
  testDir: "tests",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  projects: active.map((t) => ({ name: t.name, use: { baseURL: `http://localhost:${t.port}` } })),
  webServer: active.map((t) => ({
    command: t.command,
    url: `http://localhost:${t.port}/`,
    env: { PORT: String(t.port) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  })),
});
