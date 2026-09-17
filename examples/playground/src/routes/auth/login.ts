import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import Type from "typebox";
import { SESSION_COOKIE, SESSION_VALUE } from "../../lib/auth";

const LoginSchema = Type.Object({
  email: Type.String({ format: "email", minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});

const app = new Hono().post(
  "/login",
  tbValidator("form", LoginSchema, (result, c) => {
    if (!result.success) {
      return c.redirect("/?error=invalid");
    }
  }),
  (c) => {
    setCookie(c, SESSION_COOKIE, SESSION_VALUE, {
      maxAge: 3600,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });

    return c.redirect("/dashboard");
  },
);

export default app;
