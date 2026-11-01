// Server entry for test/islands.test.ts: built by `honoSvelte()` with
// the real @hono/vite-build, client and server in one `vite build`.
import { Hono } from "hono";
import { shell } from "../../../../../src/index.js";

const app = new Hono();
app.use("/*", shell({ title: "Island app" }));
app.get("/", (c) => c.render("home", { title: "Islands" }));
app.get("/plain", (c) => c.render("plain"));
app.get("/docs/intro", (c) => c.render("docs/intro"));

export default app;
