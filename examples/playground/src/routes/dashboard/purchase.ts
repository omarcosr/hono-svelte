import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono().get("/purchase", requireSession("redirect"), (c) =>
  c.render("dashboard/purchase"),
);

export default app;
