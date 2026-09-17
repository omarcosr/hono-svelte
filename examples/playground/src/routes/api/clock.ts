import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono();

const routes = app.get("/clock", requireSession("json"), (c) =>
  c.json({
    time: new Date().toLocaleTimeString("en-US"),
  }),
);

export default routes;
