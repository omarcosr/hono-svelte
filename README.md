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

Requires Bun 1.4+, Node 26+, Hono 4, Svelte 5, Vite 8, and TypeScript 7.

```sh
bun add hono-svelte
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

The rule is simple: **if the `.svelte` file has no `<script>`, the page ships as plain HTML. If it has one, it hydrates on the client** with initial data available via `$props()`. A `<script module>` alone (e.g. holding the page's `Data` type) does not count — only an instance `<script>` makes a page interactive.

Server-rendered components (static pages and the layouts wrapping them) have no client bundle, so `pages()` compiles them for the server with `css: "injected"`: their `<style>` blocks arrive inline in the `<head>`. An explicit `<svelte:options css="...">` in the component wins.

Files starting with `_` and `layout.svelte` are ignored (convention for partials and layouts).

## Passing data to the page

Small, public initial data (plan name, title, preferences) goes in `data` and arrives via `$props()` — no extra request.
Works for static (zero-JS) pages too: the shell passes `data` as SSR props **and** embeds the JSON for hydration:

```ts
app.get("/dashboard", (c) => c.render("dashboard", { data: { plan: "pro" } }));
```

Declare `export type Data` in the page's `<script module>` to type it per page — see [per-page data typing](#per-page-data-typing).

Large payloads trigger a `console.warn` — once per page (default limit 100KB, `shell({ dataLimit })`).
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

`<svelte:head>` inside pages also works (shell forwards SSR `head`). The document keeps a single `<title>` and `<meta name="description">`: `c.render(entry, { title })` > the page/layout `<svelte:head>` > `shell({ title })`, and a page description (`<svelte:head>` or `head.description`) replaces one set in `shell({ head })`. Page `head` never emits executable inline scripts (CSP-safe; `extra` is for trusted raw HTML like fonts or JSON-LD).

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

> **Hydration wrapper:** each layout level wraps the page's SSR output in one `<div>` (a Svelte 5 raw-snippet requirement — an empty snippet render breaks hydration). The wrapper is hydration-safe, but it is part of the DOM: account for it in CSS selectors (e.g. `:global(> div)`).


## Current page (`getPage`)

Pages and layouts can read the request path and the Hono route pattern that rendered them — e.g. to highlight the active link in a layout nav, ignoring params:

```svelte
<!-- src/pages/dashboard/layout.svelte -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { getPage } from "hono-svelte/page";

  let { children }: { children: Snippet } = $props();
  const page = getPage(); // { path: "/dashboard/users/7", route: "/dashboard/users/:id" }
</script>

<a href="/dashboard/users" aria-current={page.route.startsWith("/dashboard/users") ? "page" : undefined}>Users</a>
{@render children()}
```

It works in server-rendered components (static pages + layouts) and in client pages: the shell passes it as Svelte context on the server and writes it on the root element for the client entry. Call it during component initialisation, like `getContext`.

## Error pages

```ts
import { errorHandler, notFoundHandler } from "hono-svelte";

app.notFound(notFoundHandler()); // renders `404.svelte` with status 404
app.onError(errorHandler()); // renders `500.svelte` with status 500
```

Both pages receive `{ status, message }` as props (merged under `data`). `errorHandler` takes the status from errors that carry one (hono's `HTTPException(410, { message })` → 410) and only exposes the error's own message for 4xx — 5xx get `message` (default `"Internal Server Error"`) and are the only ones logged. `json` answers `{ message }` JSON instead of the page, e.g. for API routes:

```ts
const isApi = (c: Context) => c.req.path.startsWith("/api/");

app.notFound(notFoundHandler({ json: isApi, message: "Page not found" }));
app.onError(errorHandler({ json: isApi, expose: (err, status) => status < 500 }));
```

`jsonBody` keeps the API's own error contract instead of the bare `{ message }`. It receives the resolved `{ status, message }` (already safe: 5xx carry the generic message) and, in `errorHandler`, the thrown error:

```ts
app.onError(
  errorHandler({
    json: isApi,
    jsonBody: ({ message }, err) => ({
      message,
      code: err instanceof AppError ? err.code : undefined,
      errors: err instanceof ValidationError ? err.errors : undefined,
    }),
  }),
);
```

To also map domain errors to a status, give them a numeric `status` (or throw an `HTTPException`): the handler reads it from any error.

```svelte
<!-- src/pages/500.svelte -->
<script lang="ts">
  let { status, message }: { status: number; message: string } = $props();
</script>

<h1>{status}</h1>
<p>{message}</p>
```

## CLI

```sh
# Start a new app (no install needed):
bunx hono-svelte init                 # minimal: 2 pages + routes + configs
bunx hono-svelte init --full          # + auth, dashboard w/ layout, typed RPC

cd my-app && bun install && bun run dev
```

`init` scaffolds a complete runnable app: `package.json`, `tsconfig.json`,
`vite.config.ts` (with `pages({ dts: true })`), `src/pages/` and
`src/routes/`. The `--full` flavor adds cookie-session auth, a dashboard with
nested layout, and a typed API (`hc<AppType>`) — open `/auth`, sign in, explore
`/dashboard`. (npm/pnpm work too: `npx hono-svelte init`, `npm install`.)

```sh
bunx hono-svelte add page blog/post-1  # create src/pages/blog/post-1.svelte
bunx hono-svelte doctor                # check dist, link and vite config
bunx hono-svelte doctor --app=./my-app # check another app directory
```

`add page <name>` writes a static page (no `<script>` → zero JS; add one to
hydrate on the client). Existing files are skipped, traversal names are
refused, and the default pagesDir is `src/pages` (a custom one set via
`pages({ pagesDir })` is not visible to the CLI — adjust the path manually).

## API

### `shell(options?)`

Hono middleware that provides `c.render(entry, { title?, data?, status?, headers?, head? })` on every route.

| Option | Default | Description |
|---|---|---|
| `title` | `"App"` | Title used when neither `c.render(entry, { title })` nor the page's `<svelte:head>` provides one |
| `lang` | `"en"` | `<html>` `lang` attribute |
| `htmlAttributes` | — | Extra `<html>` attributes (`{ "data-theme": "dark" }`) or `(c) => attrs` per request; values escaped |
| `assetsBase` | `"/static"` | Prefix for JS files in production (legacy; prefer `assets`) |
| `assets` | `"/static"` | String prefix, Vite manifest object, or resolver `(entry) => url` (hashed files) |
| `isProd` | auto | Force prod/dev asset behavior |
| `stylesHref` | from `stylesEntry` | Global stylesheet href (or an `(isProd) => string` function); overrides `stylesEntry` |
| `stylesEntry` | `"src/styles.css"` | Source of the global stylesheet: dev links `/<stylesEntry>`, prod resolves the hashed file from the manifest in `assets` (fallback `/static/styles.css`) |
| `styles` | `[]` | Extra CSS hrefs emitted per response |
| `head` | `""` | Extra HTML in `<head>` (fonts, meta tags) |
| `nonce` | — | CSP nonce string or `(c) => string` (applied to shell `<script>`/`<link>`) |
| `preload` | `true` in prod | `<link rel="modulepreload">` for the entry (+ manifest imports) |
| `prefetch` | `false` | `"all"` emits `modulepreload` for other entries; `"hover"` injects a script that preloads them on link hover |
| `dataLimit` | `102400` | Warn once above this many `data` bytes (`false` disables) |
| `status` | `200` | Default response status |
| `headers` | `{}` | Default response headers (per-render `headers` merge over them) |
| `strict` | `true` | Unknown entries throw a dev-friendly error; `false` disables |
| `ssrFallback` | `false` | SSR failures log and fall back to client rendering instead of a 500 |
| `knownEntries` | auto from manifest | Override the page list used by strict mode and prefetch |

`shell()` also exposes `availableEntries()` for diagnostics.

#### Coexistence with other renderers

`c.render(entry)` rides on hono's renderer mechanism — one renderer per
request, **last-registered wins** (the same contract as hono's own
`hono/jsx` `jsx-renderer`). In practice:

- **Path-scoped coexistence works**: mount the shell only where pages live
  (`app.use("/pages/*", shell())`, registered after broader renderer
  middlewares) — existing routes using hono's default `c.render(string)` or
  `jsxRenderer()` keep working on their own paths, each renderer serves its
  routes (pinned by `test/render-conflicts.test.ts`).
- Two renderer middlewares on the **same pattern** (e.g. two shells on `/*`,
  or shell + `jsxRenderer` on `/*`): the last one registered silently
  replaces the earlier one — keep one renderer per path pattern.
- With more than one `shell()` on nested paths, register the **more
  specific one last** — it then overrides the catch-all for its paths.
- `c.render("some string")` (hono's default string renderer) is reinterpreted
  by the shell as an entry name — under `strict` it fails loudly with the
  available pages list. Use `c.html(...)` for raw string responses, or scope
  the shell away from those routes.

### `pages(options?)`

Vite plugin (`hono-svelte/vite`) that discovers pages and generates client entries.

| Option | Default | Description |
|---|---|---|
| `pagesDir` | `"src/pages"` | Pages folder |
| `ignore` | `["**/_*.svelte"]` | Ignored patterns (`layout.svelte` is a layout, not a page) |
| `layouts` | `true` | Nested `<dir>/layout.svelte` support (`false` = legacy ignore) |
| `dts` | `false` | Typed `c.render` entries: `true` writes `src/hono-svelte-entries.d.ts`, a string sets a custom path |
| `alwaysClient` | `[]` | Pages that always get JS, even without `<script>` |

Handy methods: `input()` (client build entries), `entries()` (all pages), `staticEntries()` (static pages only), `hasClient(entry)`, `layouts()`, `layoutChain(entry)`, `dataTypes()` (extracted `Data` declarations), `types()` (entry union), `typeDeclarations()` (hono module snippet), `dtsPath()` / `writeDts()` (generated `.d.ts`), `validateConfig()` (fail fast on bad Vite setup).

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

declare module "hono-svelte" {
  interface Register {
    entries: HonoSvelteEntries;
  }
}

declare module "hono" {
  interface ContextRenderer {
    (entryName: HonoSvelteEntries, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;
  }
}
```

The package exports the entry unions — the generated ones once the `.d.ts` is in the program, `string` without it. No import of the generated file needed:

- `Entry`: every page.
- `TypedEntry`: pages that declare a `Data` type (see per-page data typing below).
- `UntypedEntry`: the others — use it in helpers that forward an entry to `c.render`; typed pages need their own `data` and are rendered directly.

```ts
import type { UntypedEntry } from "hono-svelte";

export const page = (entry: UntypedEntry, title: string) => (c: Context) => c.render(entry, { title });
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

`data` stays `Record<string, unknown>` by default — declare a `Data` type in the page for per-page typing (below). Programmatic access: `pages().types()` → `"admin" | "home"`, `pages().typeDeclarations()` for the snippet, `dtsPath()` / `writeDts()` for the file.

### Per-page data typing

Declare the page payload once — the `Data` type in a `<script module>` — and reuse it as the page props:

```svelte
<!-- src/pages/dashboard.svelte -->
<script module lang="ts">
  export type Data = { plan: string; seats: number };
</script>

<script lang="ts">
  let { plan, seats }: Data = $props();
</script>

<h1>{plan} — {seats} seats</h1>
```

With `pages({ dts: true })`, the generated `.d.ts` adds a typed overload per
page, so `c.render("dashboard", { data: { plan: "pro" } })` is checked by
`tsc` — a missing `plan` fails the typecheck instead of shipping `undefined`
to the client:

```ts
// generated (excerpt)
type HonoSvelteData_dashboard = { plan: string; seats: number };

declare module "hono" {
  interface ContextRenderer {
    (entryName: "dashboard", props?: import("hono-svelte").RenderProps<HonoSvelteData_dashboard>): Response | Promise<Response>;
    (entryName: HonoSvelteEntries, props?: import("hono-svelte").RenderProps): Response | Promise<Response>;
  }
}
```

`Data` can use types imported in the same `<script module>` — the usual
case when the data comes from your database layer:

```svelte
<script module lang="ts">
  import type { Row } from "$lib/db";
  import type { LayoutData } from "../dashboard/layout-data";
  export type Data = LayoutData & { rows: Row[] };
</script>
```

The generated dts rewrites each imported reference as an `import("…")` type
query (`import("$lib/db").Row`). Alias and package specifiers are kept as
written (your `tsconfig` resolves them anywhere); relative ones are
re-resolved from the dts location. Types declared locally in the module
script (not exported from another file) can't be referenced. Both
`export type Data = ...` and `export interface Data { ... }` work (including
legacy `<script context="module">`). `pages().dataTypes()` exposes the
extracted declarations.

Entries with a `Data` type only accept their own overload: `c.render(entry, …)`
with an entry typed as the whole `Entry` union no longer compiles — type
generic helpers with `UntypedEntry`, and render typed pages directly.

## Production tips

- Pass the Vite manifest to `shell({ assets: manifest })` for hashed files — including the global stylesheet: with `styles: resolve("src/styles.css")` in the client input (or `stylesEntry` pointing at another file), its hashed name comes from the manifest, no hand-written `stylesHref`. The shell walks the entry's static import graph: the CSS of shared chunks (layouts, components used by several pages) is linked together with the entry's own CSS, and every reachable chunk gets a `modulepreload`.
- `pages()` keeps `hono-svelte` itself bundled in the server build (`ssr.noExternal`, and taken out of any `build.rollupOptions.external` / `@hono/vite-build` `external` list): the shell reaches the pages through the plugin's virtual manifest, so an externalized copy would silently render with no static pages or layouts. Externalizing every other dependency (e.g. native modules) is fine.
- Serve hashed files with long cache and `immutable` (`immutableHeaders()` / `CACHE_IMMUTABLE`); the HTML shell itself suits `CACHE_NO_STORE`.
- CSP: pass `shell({ nonce })` (string or from `secureHeaders()` context) — shell tags carry the nonce. Without a nonce, static pages keep working with `script-src 'self'` (no executable inline script, except the opt-in `prefetch: "hover"` helper).
- Theme attributes on the root element: `shell({ htmlAttributes: { "data-theme": "dark" } })` (DaisyUI), or a function reading a cookie for per-user themes.
- The shell emits a neutral `<body>` (no framework classes) — style `body`/`html` from your global stylesheet (`stylesHref`), e.g. `body { @apply bg-base-200 min-h-screen text-base-content; }` with Tailwind/DaisyUI.
- Run both client and server builds before serving; the example in `examples/playground/` shows the full setup.

## Example

`examples/playground/` is a real Hono app using the package: static landing, login, and a dashboard with typed RPC and cookie session. To run it:

```sh
cd examples/playground && bun install && bun run build
```

## Testing your routes

`hono-svelte/testing` reads a rendered document back, so route tests assert on what the page received instead of on the shell's markup (opaque ids, escaping):

```ts
import { readPage } from "hono-svelte/testing";

const res = await app.request("/users/7");
const page = readPage<{ user: User }>(await res.text());
expect(page.is("users/detail")).toBe(true); // which entry rendered
expect(page.data?.user.id).toBe(7);         // c.render data (+ layout data)
expect(page.route).toBe("/users/:id");      // same as getPage()
```

## Testing

- `npm test` — unit + integration suite (vitest, real `vite build --ssr` included), with coverage thresholds.
- `npm run test:e2e` — Playwright contract suite in [`e2e/`](./e2e/README.md): the same browser tests run against hono-svelte on Node, on Bun, and against an equivalent SvelteKit app used as the reference implementation (layout nesting, `<title>` precedence, scoped CSS, interactivity, console errors, broken assets).
- CI also runs the suite against the minimum and the latest peer versions (`hono`, `svelte`, `vite`).
- Releases: push a `vX.Y.Z` tag matching `package.json`; `.github/workflows/release.yml` publishes to npm with provenance (trusted publishing) and creates the GitHub release.

## License

MIT — see [LICENSE](./LICENSE). Changelog in [CHANGELOG.md](./CHANGELOG.md).

Anything sensitive, large, or frequently changing stays in the API, fetched after mount with the typed Hono client (`hc<AppType>`) — with the session in an `HttpOnly` cookie as usual. Never put secrets in `data`: it is visible in the HTML.
