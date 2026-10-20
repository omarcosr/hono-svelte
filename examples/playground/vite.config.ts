import tailwindcss from "@tailwindcss/vite";
import { honoSvelte } from "hono-svelte/vite";

// Client build (hashed assets + manifest), dev server and server bundle in
// one call. `start` runs the bundle with Bun, so the runtime is pinned: the
// e2e job builds it through npm, where auto-detection would pick node and
// bundle @hono/node-server (whose global Response override breaks Bun.serve).
export default honoSvelte({
  entry: "src/routes/index.ts",
  runtime: "bun",
  plugins: [tailwindcss()],
});
