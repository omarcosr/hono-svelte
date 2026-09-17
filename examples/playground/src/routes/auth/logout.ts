import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { SESSION_COOKIE } from "../../lib/auth";

const app = new Hono().post("/logout", (c) => {
  setCookie(c, SESSION_COOKIE, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });

  return c.redirect("/");
});
export default app;
