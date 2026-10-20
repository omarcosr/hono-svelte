import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

// One guard for the whole area instead of one per handler.
const app = new Hono()
  .use("/*", requireSession("redirect"))
  .get("/", (c) =>
    c.render("dashboard/index", {
      data: {
        demo: true,
        title: "Your space is ready.",
        description:
          "The session is active. Use the examples below to try client-side state and an authenticated call to the server.",
      },
    }),
  )
  .get("/page1", (c) =>
    c.render("dashboard/page1", {
      data: { title: "Page 1", description: "A dashboard sub-route using the same protected client." },
    }),
  )
  .get("/purchase", (c) =>
    c.render("dashboard/purchase", {
      data: { title: "Purchase", description: "A business sub-route inside the authenticated area." },
    }),
  );

export default app;
