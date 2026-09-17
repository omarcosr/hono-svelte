# Changelog

## Unreleased

- `c.render(entry, { status, headers, head })`: per-render status/headers (merged over shell defaults) and CSP-safe per-page head tags (`description`, `canonical`, `og`, `twitter`, `meta`, `extra`).
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