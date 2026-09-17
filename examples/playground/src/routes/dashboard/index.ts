import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono().get("/", requireSession("redirect"), (c) =>
  c.render("dashboard/index", {
    data: {
      demo: true,
      title: "Your space is ready.",
      description:
        "The session is active. Use the examples below to try client-side state and an authenticated call to the server.",
    },
  }),
);

export default app;
