import { Hono } from "hono";
import { shell } from "hono-svelte";
import api from "./api";
import auth from "./auth";
import dashboard from "./dashboard/index";
import site from "./site";

const app = new Hono();

const routes = app
  .use("/*", shell({ title: "Hono UI Playground", lang: "en" }))
  .route("/", site)
  .route("/auth", auth)
  .route("/dashboard", dashboard)
  .route("/api", api);

export type AppType = typeof routes;

export default app;
