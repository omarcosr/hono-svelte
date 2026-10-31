// Server entry for test/dev-css.test.ts, loaded through a real Vite dev server.
import { Hono } from "hono";
import { shell } from "../../../src/index.js";

const app = new Hono();
app.use("/*", shell({ title: "Dev app", isProd: false }));
app.get("/", (c) => c.render("counter"));
app.get("/about", (c) => c.render("about"));

export default app;
