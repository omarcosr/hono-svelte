// The real example app (examples/playground), built and run on Bun.
import { expect, test } from "./fixtures";

test("landing is server-rendered without client JS and links to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("starting point");
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/auth$/);
});

test("the dashboard requires a session", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/$/);
});

test("sign in, use the dashboard, navigate with the active link, sign out", async ({ page }) => {
  await page.goto("/auth");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const nav = page.getByRole("navigation", { name: "Dashboard navigation" });
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Increment" }).click();
  await expect(page.getByText("1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Fetch time" }).click();
  await expect(page.getByText("Response received")).toBeVisible();

  await nav.getByRole("link", { name: "Page 1" }).click();
  await expect(page).toHaveURL(/\/dashboard\/page1$/);
  await expect(nav.getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('script[type="module"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/$/);
});

test("invalid sign-in shows the error", async ({ page }) => {
  await page.goto("/auth?error=invalid");
  await expect(page.getByRole("alert")).toContainText("valid email");
});
