import type { Context } from "hono";
import { Hono } from "hono";
import { hasSession } from "../../lib/auth";
import login from "./login";
import logout from "./logout";

const app = new Hono();

async function renderAuth(c: Context) {
  if (hasSession(c)) {
    return c.redirect("/dashboard");
  }

  return c.render("auth");
}

const routes = app.get("/", renderAuth).route("/", login).route("/", logout);

export default routes;
