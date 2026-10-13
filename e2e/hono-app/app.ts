// Routes shared by the production server (server.ts) and the Vite dev server (dev.ts).
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { errorHandler, notFoundHandler, shell, type ShellOptions } from "hono-svelte";

export function createApp(options: ShellOptions, setup?: (app: Hono) => void): Hono {
  const app = new Hono();
  setup?.(app);
  app.use("/*", shell({ title: "Shell default", ...options }));
  app.get("/", (c) => c.render("index"));
  app.get("/nested/static", (c) => c.render("nested/static"));
  app.get("/nested/client", (c) => c.render("nested/client"));
  app.get("/private", basicAuth({ username: "user", password: "pass" }), (c) => c.text("ok"));
  app.notFound(notFoundHandler());
  app.onError(errorHandler());
  return app;
}
