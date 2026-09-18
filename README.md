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

Small, public initial data (plan name, title, preferences) goes in `data` and arrives via `$props()` — no extra request.
Works for static (zero-JS) pages too: the shell passes `data` as SSR props **and** embeds the JSON for hydration:

```ts
app.get("/dashboard", (c) => c.render("dashboard", { data: { plan: "pro" } }));
```

Large payloads trigger a one-time `console.warn` (default limit 100KB, `shell({ dataLimit })`).
Anything sensitive stays in the API (`hc<AppType>`, HttpOnly cookie). Never put secrets in `data`.

## Status, headers and per-page head

```ts
app.get("/old", (c) => c.render("gone", { status: 410, headers: { "X-Gone": "1" } }));

app.get("/post", (c) =>
  c.render("post", {
    head: {
      description: "A post about islands",
      canonical: "https://example.com/post",
      og: { title: "Islands", image: "https://example.com/og.png" },
      twitter: { card: "summary_large_image" },
    },
  }),
);
```

`<svelte:head>` inside pages also works (shell forwards SSR `head`). Page `head` never emits executable inline scripts (CSP-safe; `extra` is for trusted raw HTML like fonts or JSON-LD).

## Nested layouts

`<dir>/layout.svelte` wraps every page under `<dir>/` (SSR inside-out, outermost first). A root `layout.svelte` wraps everything. Layouts receive `children` plus all page `data` as props — e.g. `title`/`description` passed via `c.render(entry, { data })`:

```svelte
<!-- src/pages/dashboard/layout.svelte -->
<script lang="ts">
  import type { Snippet } from "svelte";
  type Props = { title?: string; description?: string; children: Snippet };
  let { title = "Dashboard", description = "", children }: Props = $props();
</script>

<div class="layout">
  <h1>{title}</h1>
  {@render children()}
</div>
```

```ts
// routes/dashboard/page1.ts — layout data comes from the route, not the page
c.render("dashboard/page1", { data: { title: "Page 1", description: "..." } });
```

```svelte
<!-- src/pages/dashboard/page1.svelte — content only, NO layout import -->
<section class="card">Page 1 content</section>
```

> Pages must NOT import their layout manually — the shell applies it automatically. The plugin fails fast at build time (`manually imports ... but the layout is applied automatically`) instead of rendering `<main><div><main>` twice.

Layouts never become entries (`pages().layouts()` / `layoutChain(entry)` inspect them; `layouts: false` restores legacy ignore).


## Error pages

```ts
import { errorHandler, notFoundHandler } from "hono-svelte";

app.notFound(notFoundHandler()); // renders `404.svelte` with status 404
app.onError(errorHandler()); // renders `500.svelte` with status 500
```

## CLI

```sh
# Start a new app (works with npx, bunx or pnpm dlx — no install needed):
bunx hono-svelte init                 # minimal: 2 pages + routes + configs
bunx hono-svelte init --full          # + auth, dashboard w/ layout, typed RPC

cd my-app && bun install && bun run dev   # or: npm install && npm run dev
```

`init` scaffolds a complete runnable app: `package.json`, `tsconfig.json`,
`vite.config.ts` (with `pages({ dts: true })`), `src/pages/` and
`src/routes/`. The `--full` flavor adds cookie-session auth, a dashboard with
nested layout, and a typed API (`hc<AppType>`) — open `/auth`, sign in, explore
`/dashboard`. Generated scripts run under npm and bun.

```sh
npx hono-svelte doctor                # check dist, link and vite config
npx hono-svelte doctor --app=./my-app # check another app directory
```

## API

### `shell(options?)`

Hono middleware that provides `c.render(entry, { title?, data?, status?, headers?, head? })` on every route.

| Option | Default | Description |
|---|---|---|
| `title` | `"App"` | Title used when the route doesn't provide one |
| `lang` | `"en"` | `<html>` `lang` attribute |
| `assetsBase` | `"/static"` | Prefix for JS files in production (legacy; prefer `assets`) |
| `assets` | `"/static"` | String prefix, Vite manifest object, or resolver `(entry) => url` (hashed files) |
| `isProd` | auto | Force prod/dev asset behavior |
| `stylesHref` | `"/static/styles.css"` in prod, `"/src/styles.css"` in dev | Global stylesheet (or an `(isProd) => string` function) |
| `styles` | `[]` | Extra CSS hrefs emitted per response |
| `head` | `""` | Extra HTML in `<head>` (fonts, meta tags) |
| `nonce` | — | CSP nonce string or `(c) => string` (applied to shell `<script>`/`<link>`) |
| `preload` | `true` in prod | `<link rel="modulepreload">` for the entry (+ manifest imports) |
| `prefetch` | `false` | `"all"` prefetches other entries; `"hover"` injects a hover-prefetch script |
| `dataLimit` | `102400` | Warn once above this many `data` bytes (`false` disables) |
| `status` | `200` | Default response status |
| `headers` | `{}` | Default response headers (per-render `headers` merge over them) |
| `strict` | `true` | Unknown entries throw a dev-friendly error; `false` disables |
| `knownEntries` | auto from manifest | Override the page list used by strict mode and prefetch |

`shell()` also exposes `availableEntries()` for diagnostics.

### `pages(options?)`

Vite plugin (`hono-svelte/vite`) that discovers pages and generates client entries.

| Option | Default | Description |
|---|---|---|
| `pagesDir` | `"src/pages"` | Pages folder |
| `ignore` | `["**/_*.svelte"]` | Ignored patterns (`layout.svelte` is a layout, not a page) |
| `layouts` | `true` | Nested `<dir>/layout.svelte` support (`false` = legacy ignore) |
| `dts` | `false` | Typed `c.render` entries: `true` writes `src/hono-svelte-entries.d.ts`, a string sets a custom path |
| `alwaysClient` | `[]` | Pages that always get JS, even without `<script>` |

Handy methods: `input()` (client build entries), `entries()` (all pages), `staticEntries()` (static pages only), `hasClient(entry)`, `layouts()`, `layoutChain(entry)`, `types()` (entry union), `typeDeclarations()` (hono module snippet), `dtsPath()` / `writeDts()` (generated `.d.ts`), `validateConfig()` (fail fast on bad Vite setup).

### Typing `c.render`

Opt-in typed entry names — a typo fails `tsc` instead of 500ing at runtime:

```ts
// vite.config.ts
const appPages = pages({ dts: true }); // writes src/hono-svelte-entries.d.ts
```

```ts
// src/env.d.ts — the generated file carries the `declare module "hono"`
// augmentation, so this file is only a reference. Remove any manual
// `(entryName: string)` declaration or it will swallow the union.
 /// <reference path="./hono-svelte-entries.d.ts" />
```

```ts
// generated src/hono-svelte-entries.d.ts (commit it — CI needs no Vite run)
export type HonoSvelteEntries = "auth" | "dashboard/index" | "index";

declare module "hono" {
  interface ContextRenderer {
    (entryName: HonoSvelteEntries, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;
  }
}
```

`dts: "path/to/entries.d.ts"` sets a custom path (relative to the Vite root). The file regenerates on `buildStart` and via the dev watcher when entries change. Without `dts` (default `false`), declare the renderer manually with a plain `string`:

```ts
import type { RenderProps } from "hono-svelte";

declare module "hono" {
  interface ContextRenderer {
    (entryName: string, props?: RenderProps): Response | Promise<Response>;
  }
}
```

`data` stays `Record<string, unknown>` — per-page payload types are a future feature. Programmatic access: `pages().types()` → `"admin" | "home"`, `pages().typeDeclarations()` for the snippet, `dtsPath()` / `writeDts()` for the file.

## Production tips

- Pass the Vite manifest to `shell({ assets: manifest })` for hashed files; manifest CSS and shared chunks are emitted automatically (`modulepreload`).
- Serve hashed files with long cache and `immutable` (`immutableHeaders()` / `CACHE_IMMUTABLE`); the HTML shell itself suits `CACHE_NO_STORE`.
- CSP: pass `shell({ nonce })` (string or from `secureHeaders()` context) — shell tags carry the nonce. Without a nonce, static pages keep working with `script-src 'self'` (no executable inline script, except the opt-in `prefetch: "hover"` helper).
- Run both client and server builds before serving; the example in `examples/playground/` shows the full setup.

## Example

`examples/playground/` is a real Hono app using the package: static landing, login, and a dashboard with typed RPC and cookie session. To run it:

```sh
cd examples/playground && npm install && npm run build
```

## License

MIT — see [LICENSE](./LICENSE). Changelog in [CHANGELOG.md](./CHANGELOG.md).

Anything sensitive, large, or frequently changing stays in the API, fetched after mount with the typed Hono client (`hc<AppType>`) — with the session in an `HttpOnly` cookie as usual. Never put secrets in `data`: it is visible in the HTML.
