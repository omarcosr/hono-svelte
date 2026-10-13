// Dev target: served by `vite` through @hono/vite-dev-server (SSR via Vite's module graph).
import { createApp } from "./app";

export default createApp({ stylesEntry: "styles.css", isProd: false });
