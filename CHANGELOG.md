# Changelog

## 0.5.0

- **Per-page data typing (opt-in, `pages({ dts: true })`)**: declare
  `export type Data` (or `interface Data`) in a page's `<script module>` and
  the generated `.d.ts` adds a typed overload per page —
  `c.render("dashboard", { data })` is checked by `tsc` (a missing/mistyped
  field fails the typecheck instead of shipping `undefined`). The declaration
  is inlined verbatim, so it must be self-contained; types that reference
  imports are skipped with a one-time warning and keep
  `Record<string, unknown>` data. `RenderProps` is now generic
  (`RenderProps<TData = Record<string, unknown>>`) and `pages().dataTypes()`
  exposes the extractions. The dts also regenerates when a page's `Data`
  type changes (dev watcher + `buildStart`).
- **Neutral `<body>`**: the shell no longer hardcodes DaisyUI classes
  (`bg-base-200 min-h-screen text-base-content`) — it emits a plain,
  CSS-framework-agnostic document. Style `body`/`html` from your global
  stylesheet instead (`body { background: var(--color-base-200); ... }`, or
  `@apply` with Tailwind — the playground does exactly that in
  `styles.css`). **Breaking** for apps relying on the hardcoded classes.
- **`shell({ ssrFallback })`**: when SSR of a page throws at request time,
  log the error and fall back to client rendering (entry script) instead of
  a 500. Default `false` keeps the previous behavior.
- `prefetch: "all"` / `"hover"` now emit `rel="modulepreload"` (prefetch on a
  module URL could double-fetch in some browsers; modulepreload also warms
  the entry's import graph).
- `dataLimit` warning fires once per **(page, limit)** instead of once per
  process — a second oversized page is reported too, with the entry name in
  the message.
- **Removed dead stubs**: `versionsMatch()` (always returned `true`), the
  unused `hasClient` export from the ssr-manifest stub/virtual manifest, and
  the no-op `checkPagesDir`. **Breaking: `versionsMatch` is no longer
  exported.**
- Fully typed handlers/middleware: `notFoundHandler()` / `errorHandler()`
  match Hono's `NotFoundHandler`/`ErrorHandler` signatures and `shell()` no
  longer uses `any` internally.
- **CLI: `hono-svelte add page <name>`** — scaffolds
  `src/pages/<name>.svelte` (static by default, skip-if-exists, traversal
  refused). `isValidPageName()` / `newPageFile()` exported for tests.
- Metadata: `engines` now declares `bun >= 1.4` and `node >= 26`, the
  `./package.json` export subpath was added, and TypeScript 7 builds the
  package.
- **Security floors in `peerDependencies`**: `hono ^4.13.8`, `svelte ^5.57.0`,
  `vite ^8.3.0` — every published advisory sits outside these floors
  (hono < 4.12.12 and 4.12.0–4.12.33, patched in 4.12.34; svelte ≤ 5.55.6,
  patched in 5.55.7; vite ≤ 8.0.15, patched in 8.0.16; transitive `devalue`
  resolves to the patched 5.9.2, which also closes CVE-2026-81176). The
  versions installed in the repo and in the example are the latest published
  and none is affected by a known advisory — the ranges just avoid
  advertising vulnerable versions to consumers and scanners.
- CI: ubuntu + windows runners (Windows-only regressions like the old
  `isSafeAppPath` bug are caught now), coverage via `@vitest/coverage-v8`
  with thresholds (`npm test` runs it), all on the officially supported
  runtimes (Node 26, TS 7, Vite 8, Bun 1.4+).
- `hono-svelte init` now scaffolds TypeScript 7 + `@types/node` 26 in the
  generated app.

## 0.4.2

- `hono-svelte init` now scaffolds a complete runnable app (works with
  `npx`, `bunx` and `pnpm dlx` — writes text files only, no install/network).
  Minimal flavor (default): `package.json`, `tsconfig.json`, `.gitignore`,
  `vite.config.ts` (with `pages({ dts: true })`), two pages (`index` zero-JS,
  `hello` with `data`), `src/routes/index.ts`, `src/styles.css`.
  `init --full` adds auth (cookie session), dashboard with nested layout,
  and typed RPC (`hc<AppType>`) — `/auth` → login → `/dashboard`.
  Generated scripts (`dev`/`build`/`typecheck`/`start`) run under npm and bun.
  `InitFlavor` type exported.

## 0.4.1

- Fix `hono-svelte init` refusing every file on Windows: `isSafeAppPath()`
  now normalizes `\` vs `/` and compares case-insensitively on win32
  (path traversal still blocked).
- Fix `bin` path without `./` prefix — npm was silently stripping the CLI
  from the published tarball.

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