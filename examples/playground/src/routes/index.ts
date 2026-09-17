import { Hono } from "hono";
import api from "./api";
import auth from "./auth";
import dashboardPurchase from "./dashboard/purchase";
import dashboard from "./dashboard/index";
import dashboardPage1 from "./dashboard/page1";
import site from "./site";
import { shell } from "hono-svelte";

const app = new Hono();

const routes = app
  .use("/*", shell({ title: "Hono UI Playground", lang: "en" }))
  .route("/", site)
  .route("/auth", auth)
  .route("/dashboard", dashboard)
  .route("/dashboard", dashboardPage1)
  .route("/dashboard", dashboardPurchase)
  .route("/api", api);

export type AppType = typeof routes;

export default app;

