import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono().get("/purchase", requireSession("redirect"), (c) =>
  c.render("dashboard/purchase", {
    data: {
      title: "Purchase",
      description: "A business sub-route inside the authenticated area.",
    },
  }),
);

export default app;
