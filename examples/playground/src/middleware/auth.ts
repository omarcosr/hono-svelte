import { createMiddleware } from "hono/factory";
import { hasSession } from "../lib/auth";

type UnauthorizedResponse = "redirect" | "json";

export function requireSession(response: UnauthorizedResponse = "json") {
  return createMiddleware(async (c, next) => {
    if (!hasSession(c)) {
      if (response === "json") {
        return c.json({ error: "Not authenticated" }, 401);
      }

      return c.redirect("/");
    }

    return next();
  });
}
