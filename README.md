# hono-svelte

Render Svelte 5 pages in Hono apps with a single `c.render("page")` — no SPA, no build boilerplate.

Each `.svelte` file becomes an independent page. Static pages reach the browser as ready-made HTML with **zero JavaScript**. Interactive pages receive only their own JS. Works in dev with HMR and in production with per-page bundles.

## Why use it

Real sites and dashboards mix simple pages (landing, login, terms) with interactive screens (panels, forms). In a traditional SPA, a landing visitor downloads the entire dashboard's JS. With hono-svelte:

- **Static pages cost zero JS** — HTML arrives ready from the server;
- **Interactive pages cost only their own JS** — independent bundles, no loading the rest of the app;
- **Public initial data ships in the HTML** — the page mounts with content, no extra fetch;
- **Sensitive data stays in the API** — typed end to end with the Hono client.

## Installation

Requires Node 22+, Hono 4, Svelte 5, and Vite 6/7/8.

```sh
npm install hono-svelte
```

## Quick start

**1. Configure Vite** — add the pages plugin in every mode and use the entry list in the client build:

```ts
import build from "@hono/vite-build/node";
import devServer from "@hono/vite-dev-server";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { pages } from "hono-svelte/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const appPages = pages();

export default defineConfig(({ command, mode }) => {
  if (mode === "client") {
    return {
      plugins: [svelte(), appPages],
      build: {
        rollupOptions: {
          input: { ...appPages.input(), styles: resolve("src/styles.css") },
          output: {
            entryFileNames: "static/[name].js",
            chunkFileNames: "static/chunks/[name]-[hash].js",
            assetFileNames: "static/[name][extname]",
          },
        },
      },
    };
  }

  if (command === "serve") {
    return {
      plugins: [svelte(), appPages, devServer({ entry: "src/routes/index.ts" })],
    };
  }

  return {
    plugins: [svelte(), appPages, build({ entry: "src/routes/index.ts", staticRoot: "./dist" })],
  };
});
```

**2. Register the shell on the server:**

```ts
import { Hono } from "hono";
import { shell } from "hono-svelte";

const app = new Hono().use("/*", shell({ title: "My App", lang: "en" }));
```

**3. Create pages** in `src/pages` — one page per file:

```svelte
<!-- src/pages/home.svelte — no <script>: becomes plain HTML, zero JS -->
<main>
  <h1>Welcome</h1>
  <a href="/dashboard">Sign in</a>
</main>
```

```svelte
<!-- src/pages/dashboard.svelte — has <script>: gets its own JS -->
<script lang="ts">
  import { hc } from "hono/client";
  import type { AppType } from "../routes/api";

  let { plan } = $props<{ plan: string }>();
  const client = hc<AppType>("/");

  let time = $state("--:--");
  async function refresh() {
    const res = await client.api.time.$get();
    time = (await res.json()).time;
  }
</script>

<main>
  <h1>Dashboard — {plan} plan</h1>
  <p>Server time: {time}</p>
  <button onclick={refresh}>Refresh</button>
</main>
```

**4. Render in routes:**

```ts
app.get("/", (c) => c.render("home"));
app.get("/dashboard", (c) => c.render("dashboard", { data: { plan: "pro" } }));
```

The rule is simple: **if the `.svelte` file has no `<script>`, the page ships as plain HTML. If it has one, it hydrates on the client** with initial data available via `$props()`.

Files starting with `_` and `layout.svelte` are ignored (convention for partials and layouts).

## Passing data to the page

Small, public initial data (plan name, title, preferences) goes in `data` and arrives via `$props()` — no extra request:

```ts
app.get("/dashboard", (c) => c.render("dashboard", { data: { plan: "pro" } }));
```


## API

### `shell(options?)`

Hono middleware that provides `c.render(entry, { title?, data? })` on every route.

| Option | Default | Description |
|---|---|---|
| `title` | `"App"` | Title used when the route doesn't provide one |
| `lang` | `"en"` | `<html>` `lang` attribute |
| `assetsBase` | `"/static"` | Prefix for JS files in production |
| `stylesHref` | `"/static/styles.css"` in prod, `"/src/styles.css"` in dev | Global stylesheet (or an `(isProd) => string` function) |
| `head` | `""` | Extra HTML in `<head>` (fonts, meta tags) |

### `pages(options?)`

Vite plugin (`hono-svelte/vite`) that discovers pages and generates client entries.

| Option | Default | Description |
|---|---|---|
| `pagesDir` | `"src/pages"` | Pages folder |
| `ignore` | `["**/layout.svelte", "**/_*.svelte"]` | Ignored patterns |
| `alwaysClient` | `[]` | Pages that always get JS, even without `<script>` |

Handy methods: `input()` (client build entries), `entries()` (all pages), `staticEntries()` (static pages only), `hasClient(entry)`.

### Typing `c.render`

So TypeScript accepts `c.render` in routes, declare once in the app:

```ts
import type { RenderProps } from "hono-svelte";

declare module "hono" {
  interface ContextRenderer {
    (entryName: string, props?: RenderProps): Response | Promise<Response>;
  }
}
```

## Production tips

- Serve hashed files with long cache and `immutable`; the stylesheet with short cache or a versioned name.
- Works with `script-src 'self'` — there is no executable inline script on the page.
- Run both client and server builds before serving; the example in `examples/playground/` shows the full setup.

## Example

`examples/playground/` is a real Hono app using the package: static landing, login, and a dashboard with typed RPC and cookie session. To run it:

```sh
cd examples/playground && npm install && npm run build
```

## License

MIT — see [LICENSE](./LICENSE). Changelog in [CHANGELOG.md](./CHANGELOG.md).

Anything sensitive, large, or frequently changing stays in the API, fetched after mount with the typed Hono client (`hc<AppType>`) — with the session in an `HttpOnly` cookie as usual. Never put secrets in `data`: it is visible in the HTML.
