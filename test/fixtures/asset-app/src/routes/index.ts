// Server entry for test/preset-build.test.ts: built by `honoSvelte()` with
// the real @hono/vite-build, client and server in one `vite build`.
import { Hono } from "hono";
import { shell } from "../../../../../src/index.js";

const app = new Hono();
app.use("/*", shell({ title: "Asset app" }));
app.get("/", (c) => c.render("home"));

export default app;
