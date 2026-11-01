// hono-svelte-only guarantees (no SvelteKit equivalent).
import { expect, isHonoSvelte, test } from "./fixtures";

test.beforeEach(({}, info) => {
  test.skip(!isHonoSvelte(info.project.name), "hono-svelte only");
});

// Production-build guarantees (hashed assets, zero JS, prefetch) don't apply to `vite` dev.
const prodOnly = () => test.skip(test.info().project.name === "hono-svelte-dev", "production build only");

test("static pages ship zero JS", async ({ page }) => {
  prodOnly();
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
  });
  await page.goto("/nested/static");
  await expect(page.getByTestId("page")).toBeVisible();
  expect(scripts).toEqual([]);
  await expect(page.locator("script")).toHaveCount(0);
});

test("hover prefetch adds one modulepreload per client page, never for static pages", async ({ page }) => {
  prodOnly();
  await page.goto("/");
  const preloads = page.locator('link[rel="modulepreload"]');
  const before = await preloads.count();
  await page.getByTestId("to-static").hover();
  await expect(preloads).toHaveCount(before);
  await page.getByTestId("to-client").hover();
  await expect(preloads).toHaveCount(before + 1);
  await page.mouse.move(0, 0);
  await page.getByTestId("to-client").hover();
  await expect(preloads).toHaveCount(before + 1);
});

test("errorHandler keeps WWW-Authenticate from basicAuth", async ({ request }) => {
  const res = await request.get("/private");
  expect(res.status()).toBe(401);
  expect(res.headers()["www-authenticate"]).toContain("Basic");
});

test("hashed assets are served immutable", async ({ page, request }) => {
  prodOnly();
  await page.goto("/nested/client");
  const href = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
  expect(href).toMatch(/^\/static\/styles-[\w-]+\.css$/);
  const res = await request.get(href!);
  expect(res.headers()["cache-control"]).toContain("immutable");
});

test("islands hydrate on their own, each with its props, in a server-rendered page", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  await page.goto("/islands");
  await expect(page.getByTestId("page")).toHaveText("Static around the islands");
  await expect(page.getByTestId("first")).toHaveText("2");
  await expect(page.getByTestId("second")).toHaveText("10");
  await expect(page.getByTestId("first")).toHaveCSS("color", "rgb(0, 0, 255)");
  // Hydrated in place: the first click already counts, and the other island keeps its own state.
  await expect(async () => {
    await page.getByTestId("first").click();
    await expect(page.getByTestId("first")).not.toHaveText("2", { timeout: 200 });
  }).toPass();
  await expect(page.getByTestId("first")).toHaveText("3");
  await expect(page.getByTestId("second")).toHaveText("10");
  await expect(page.locator("hono-island button")).toHaveCount(2);
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});

test("an islands page ships only the island bundle", async ({ page }) => {
  prodOnly();
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
  });
  await page.goto("/islands");
  await expect(page.getByTestId("second")).toHaveText("10");
  const entries = await page.locator('script[type="module"]').evaluateAll((els) => els.map((el) => el.getAttribute("src")));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/\/island\/__\/shared\/Counter-/);
  expect(scripts).toContain(entries[0]);
});
