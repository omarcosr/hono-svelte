// Behaviour shared with SvelteKit (the reference project). Must pass on every project.
import { expect, test } from "./fixtures";

const chain = (leaf: string) => `[data-testid=outer] [data-testid=inner] [data-testid=${leaf}]`;

test("layouts nest outermost first around a static page", async ({ page }) => {
  await page.goto("/nested/static");
  await expect(page.locator(chain("page"))).toHaveText("Static body");
  await expect(page.locator("[data-testid=outer]")).toHaveCount(1);
  await expect(page.locator("[data-testid=inner]")).toHaveCount(1);
});

test("layouts nest outermost first around a client page, which is interactive", async ({ page }) => {
  await page.goto("/nested/client");
  const count = page.locator(chain("count"));
  await expect(count).toHaveText("0");
  await count.click();
  await count.click();
  await expect(count).toHaveText("2");
  await expect(page.locator("[data-testid=outer]")).toHaveCount(1);
  await expect(page.locator("[data-testid=inner]")).toHaveCount(1);
});

test("pages read the request path", async ({ page }) => {
  await page.goto("/nested/client");
  await expect(page.getByTestId("path")).toHaveText("/nested/client");
});

test("the page <title> wins over the default", async ({ page }) => {
  await page.goto("/nested/static");
  await expect(page).toHaveTitle("Static page");
  await page.goto("/nested/client");
  await expect(page).toHaveTitle("Client page");
});

for (const path of ["/nested/static", "/nested/client"]) {
  test(`scoped CSS of the page and of every layout applies (${path})`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId("outer")).toHaveCSS("border-left-color", "rgb(255, 0, 0)");
    await expect(page.getByTestId("inner")).toHaveCSS("border-left-color", "rgb(0, 0, 255)");
    await expect(page.getByTestId("page")).toHaveCSS("color", "rgb(0, 128, 0)");
  });
}

test("links navigate between pages", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("to-client").click();
  await expect(page).toHaveURL(/\/nested\/client$/);
  await page.getByTestId("count").click();
  await expect(page.getByTestId("count")).toHaveText("1");
});

test("unknown paths answer 404 inside the root layout", async ({ page }) => {
  const res = await page.goto("/missing");
  expect(res?.status()).toBe(404);
  await expect(page.locator("[data-testid=outer] [data-testid=error]")).toHaveText("Not found");
});
