import { Hono } from "hono";
import { requireSession } from "../../middleware/auth";

const app = new Hono();

const routes = app.get("/", requireSession("redirect"), (c) => c.render("dashboard", { data: { demo: true } }));

export default routes;

