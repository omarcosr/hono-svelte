// Server entry for test/build.test.ts: bundled by a real `vite build --ssr`
// with svelte() + pages(), exactly like an app's production server.
import { Hono } from "hono";
import { shell } from "../../../src/index.js";

const app = new Hono();
app.use("/*", shell({ title: "Build app" }));
app.get("/landing", (c) => c.render("landing"));
app.get("/docs", (c) => c.render("docs/intro"));

export default app;
