import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { SESSION_COOKIE, SESSION_VALUE } from "../../lib/auth";

const app = new Hono().post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "");
  const password = String(body.password ?? "");
  if (!email.includes("@") || !password) {
    return c.redirect("/auth?error=invalid");
  }
  setCookie(c, SESSION_COOKIE, SESSION_VALUE, {
    maxAge: 3600,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });

  return c.redirect("/dashboard");
});

export default app;
