import { Hono } from "hono";
import { hasSession } from "../../lib/auth";

const app = new Hono().get("/", async (c) => {
  if (hasSession(c)) {
    return c.redirect("/dashboard");
  }

  return c.render("index");
});

export default app;
