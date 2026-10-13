import { defineConfig, devices } from "@playwright/test";

// Every target runs the same contract suite. `sveltekit` is the reference
// implementation: a contract test that fails only on hono-svelte is a bug.
// `playground` runs its own spec against the real example app.
type Target = { name: string; port: number; command: string; testMatch?: RegExp; testIgnore?: RegExp };
const app = /playground\.spec\.ts/;
const targets: Target[] = [
  { name: "hono-svelte-node", port: 4301, command: "node hono-app/dist/server/server.mjs", testIgnore: app },
  { name: "hono-svelte-bun", port: 4302, command: "bun hono-app/dist/server/server.mjs", testIgnore: app },
  { name: "sveltekit", port: 4303, command: "node kit-app/build/index.js", testIgnore: app },
  { name: "hono-svelte-dev", port: 4304, command: "npm run dev:hono", testIgnore: app },
  { name: "playground", port: 4305, command: "cd ../examples/playground && bun ./dist/index.js", testMatch: app },
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
  projects: active.map((t) => ({
    name: t.name,
    testMatch: t.testMatch,
    testIgnore: t.testIgnore,
    use: { baseURL: `http://localhost:${t.port}` },
  })),
  webServer: active.map((t) => ({
    command: t.command,
    url: `http://localhost:${t.port}/`,
    env: { PORT: String(t.port) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  })),
});
