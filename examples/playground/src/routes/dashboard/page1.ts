import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono().get("/page1", requireSession("redirect"), (c) =>
  c.render("dashboard/page1"),
);

export default app;
