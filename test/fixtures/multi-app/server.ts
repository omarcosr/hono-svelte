// Server entry for test/multi-dir.test.ts: pages from the app's own folder
// and from a sibling package (test/fixtures/multi-core), outside the Vite root.
import { Hono } from "hono";
import { shell } from "../../../src/index.js";

const app = new Hono();
app.use("/*", shell({ title: "Multi app" }));
app.get("/", (c) => c.render("home"));
app.get("/admin/users", (c) => c.render("admin/users/index"));
app.get("/admin/counter", (c) => c.render("admin/counter"));

export default app;
