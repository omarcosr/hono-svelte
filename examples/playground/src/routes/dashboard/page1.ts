import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono().get("/page1", requireSession("redirect"), (c) =>
  c.render("dashboard/page1", {
    data: {
      title: "Page 1",
      description: "A dashboard sub-route using the same protected client.",
    },
  }),
);

export default app;
