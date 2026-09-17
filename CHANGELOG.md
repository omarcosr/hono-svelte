# Changelog

## 0.4.0

- **Typed `c.render` entries (opt-in)**: `pages({ dts })` writes a `.d.ts` file
  with the entry union (`HonoSvelteEntries`) + `declare module "hono"`
  augmentation. `true` writes `src/hono-svelte-entries.d.ts` (relative to the
  Vite root); a string sets a custom path. Regenerated on `buildStart` and by
  the dev watcher when entries change. `dtsPath()` / `writeDts()` exposed on
  the plugin. The playground wires it (`pages({ dts: true })` +
  `/// <reference path="./hono-svelte-entries.d.ts" />` in `env.d.ts`), so a
  typo in `c.render("...")` fails `tsc` instead of 500ing at runtime.
  `data` stays `Record<string, unknown>` (per-page payload types are a future
  feature).
- **Layouts, single source of truth**: `<dir>/layout.svelte` wraps pages
  automatically (SSR inside-out + client hydrate, `layouts()` /
  `layoutChain()` to inspect, `layouts: false` = legacy ignore). Pages must
  NOT import their layout manually — the plugin fails fast at build time
  (`manually imports ... but the layout is applied automatically`) instead of
  rendering the layout twice. Layout props (`title`, `description`) come from
  the route via `c.render(entry, { data })`, with `title = "Dashboard"`
  fallback in the layout. Rule shared by plugin and shell: static means
  "no `<script>`", layouts don't matter; `__clientEntries` travels in the
  virtual manifest so the shell picks the SSR branch for static+layouts pages.
- **Runtime fixes**: static `import.meta.env.PROD/DEV` access (Vite module
  runner forbids dynamic access — dev 500 fixed); static
  `createRawSnippet` import in layout entries (no duplicated Svelte runtime —
  `Illegal invocation` fixed); layout children snippet renders `<div>` wrapper
  (empty render broke hydration — `Cannot set properties of null` fixed);
  bundled server defaults to prod so plain `node ./dist/index.js` works on
  Windows with no `NODE_ENV` prefix.
- `c.render(entry, { status, headers, head })`: per-render status/headers
  (merged over shell defaults) and CSP-safe per-page head tags
  (`description`, `canonical`, `og`, `twitter`, `meta`, `extra`).
- SSR static pages now receive `data` as component props (plus the embedded JSON).
- Strict entries: unknown entryNames throw a dev-friendly error (`Available pages: ...`, generic in prod); `shell({ strict: false })` disables; `availableEntries()` exposes the list.
- `pages().types()` / `typeDeclarations()` generate the entry union + hono module snippet.
- Nested layouts: `<dir>/layout.svelte` wraps pages (SSR inside-out, `layouts()`/`layoutChain()`, `layouts: false` = legacy).
- `notFoundHandler()` / `errorHandler()` for conventional `404.svelte` / `500.svelte` pages.
- `hono-svelte init|doctor` CLI (`bin`) with `--app` flag.
- `pages().validateConfig()` fails fast on missing svelte plugin / pagesDir.
- `shell({ assets })` accepts a Vite manifest (hashed URLs, CSS, shared-chunk preload) with fallback; `preload`/`prefetch` controls; `styles` extra CSS.
- `shell({ nonce })` CSP support on shell tags; `svelte/server` CSP passthrough for SSR.
- Cache helpers: `immutableHeaders()`, `CACHE_IMMUTABLE`, `CACHE_NO_STORE`.
- `data` size one-time warning (`shell({ dataLimit })`, default 100KB).

## 0.3.1

- Package metadata: repository/homepage/author, publishConfig, LICENSE + CHANGELOG in files.
- No code changes since 0.3.0.

## 0.3.0

- Fully in-memory package: entries and manifest are virtual modules (no files written to disk).
- Automatic zero-JS: `.svelte` pages without `<script>` render on the server (`svelte/server`)
  and download no JS on the client.
- Deterministic opaque IDs derived from the entryName (no salt, no env, no disk).
- Zero config: the shell resolves the SSR map on its own (relative import redirected by the plugin).
- Test suite (vitest) and CI (typecheck + tests + build + publint).

## 0.2.0

- Opaque IDs (`r-` + hash) replace configurable `rootId`/`dataId`.

## 0.1.0

- First version: `shell()` middleware + `pages()` plugin with disk-generated entries.