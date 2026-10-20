import tailwindcss from "@tailwindcss/vite";
import { honoSvelte } from "hono-svelte/vite";

// Client build (hashed assets + manifest), dev server and server bundle in
// one call. The runtime (bun/node) follows the process running Vite.
export default honoSvelte({
  entry: "src/routes/index.ts",
  plugins: [tailwindcss()],
});
