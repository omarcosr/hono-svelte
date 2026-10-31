# Changelog

## Unreleased

- **fix: `styles: false` links no global stylesheet.** With
  `honoSvelte({ styles: false })` (or `pages({ stylesEntry: false })`) the
  shell still linked `/src/styles.css` in dev and `/static/styles.css` in
  production, a 404 on every page. `false` now reaches the shell through the
  virtual manifest and no global sheet is linked; `shell({ stylesEntry:
  false })` does the same by hand. Leaving the option out keeps the
  `src/styles.css` default.
- **fix(vite): static pages get the CSS their layouts and components
  import.** A static page under a layout that does `import "../../app.css"`
  only received its inlined component styles: the server build drops CSS
  imports and the page had no client chunk. Like SvelteKit's per-route
  client nodes, every static page now gets a CSS-only entry in the client
  build (its layouts and the page, followed through every import); the shell
  links its hashed CSS and drops the inlined copies, and dev inlines the same
  CSS. The entry's JS chunk is never linked: static pages still ship no JS.
  Layouts of static pages are now compiled for the client too, so keep
  server-only code out of them. Because more entries share code, interactive
  pages may load the Svelte runtime and shared layouts as separate
  (preloaded) chunks instead of one file.
- **fix: dev no longer repeats component styles on server-rendered pages.**
  Once the shell inlines the collected CSS, the copies Svelte injected into
  the server render are dropped, as in production.

## 0.9.2

- **fix(vite): hydrated pages are styled before their script runs.** In dev,
  a `pages({ hydrate })` page painted its server markup before Vite injected
  its component `<style>` blocks and its layouts' `.css` imports (a flash of
  unstyled content and layout shift). The plugin now collects that CSS from
  the client module graph and the shell inlines it as
  `<style data-vite-dev-id>`, which Vite's client adopts and hot-updates. In
  production, hydrated pages with linked CSS no longer repeat Svelte's
  injected component styles inline in every HTML.

## 0.9.1

- **fix(vite): Svelte libraries stay bundled in the server build.** With
  `pages({ hydrate })` component libraries reach the server too, and
  `honoSvelte({ build: { external: Object.keys(pkg.dependencies) } })` left
  bare imports such as `@canutin/svelte-currency-input` in the server bundle;
  Bun then failed with "Cannot find module" because the package only exports
  the `svelte` condition. Any dependency with a `svelte` field or `svelte`
  export condition is now treated like `hono-svelte`: removed from
  `ssr.external`, `environments.*.resolve.external` and rollup `external`,
  and added to `ssr.noExternal`.

## 0.9.0

- **feat(vite): `pages({ hydrate })` server-renders interactive pages.**
  Interactive pages (with an instance `<script>`) arrived as an empty root
  plus JSON props and stayed blank until their bundle ran. With
  `pages({ hydrate: true | string[] })` (also forwarded by `honoSvelte()`) the
  shell renders them inside their layout chain and still ships their script;
  the generated entry hydrates the server render, or mounts an empty root
  (`ssrFallback`). Same markup, props block and nonce handling, no new inline
  scripts. Opt-in: page scripts also run on the server, so `window`/`document`
  must stay in `onMount`/`$effect`.

- **feat(preset): production static files get cache headers, compression and
  no source maps.** `honoSvelte()` replaces `@hono/vite-build`'s plain
  `serveStatic` (which sent no `Cache-Control`/`ETag`, so browsers fetched
  every asset on every page) with the new `staticFiles()` from
  `hono-svelte/static`: hashed `/static/*` files are `immutable` for a year,
  other files (`publicDir`) get `public, max-age=3600` plus a weak `ETag`
  (304s). A new `precompress()` build step writes `.br`/`.gz` next to text
  assets, served when the client accepts them. `*.map` files and `.vite/` are
  no longer served — **behavior change** for apps that relied on public client
  source maps (`staticFiles: { sourcemaps: true }` restores them). Opt out
  entirely with `honoSvelte({ staticFiles: false })`.
- **docs: `prefetch: "hover"` needs a CSP nonce** — it is an inline script.

## 0.8.2

- **fix(preset): the client build bundles its dependencies.** `@hono/vite-build`
  writes `external` to the top-level `build.rollupOptions`, and the client
  environment of the one-run `vite build` inherited it:
  `honoSvelte({ build: { external: Object.keys(pkg.dependencies) } })` shipped
  page bundles with bare `import "pkg"` that the browser cannot resolve
  ("Failed to resolve module specifier"). `external` now applies to the server
  build only.

## 0.8.1

- **fix(vite): `hono-svelte` stays bundled when another plugin externalizes
  it.** `@hono/vite-build` copies its `external` list into `ssr.external`,
  which beats `noExternal` — `honoSvelte({ build: { external:
  Object.keys(pkg.dependencies) } })` shipped a server bundle that imported the
  package from node_modules and loaded the empty manifest stub (no static
  pages, no layouts, unhashed asset URLs). The plugin's `config` hook now runs
  `post` and removes the package from `ssr.external` /
  `environments.*.resolve.external` in place (#27).
- **fix(playground): `runtime: "bun"` pinned.** Built through npm, runtime
  auto-detection picked node and bundled `@hono/node-server`, whose global
  `Response` override makes `Bun.serve` reject every response. README notes
  the pitfall for apps that build and serve on different runtimes.

## 0.8.0

- **BREAKING — `c.render(entry, data)` and `c.setHead(head)`.** The second
  argument of `c.render` is the page data itself; `title`/`head` moved to
  `c.setHead({ title, description, og, … })` (merges across calls), status
  and headers are Hono's own `c.status()` / `c.header()`, which the shell
  now respects (a shell default header never overrides one the route set).
  `RenderProps` and `shell({ status })` are gone; the generated dts types
  `c.render("x", data)` per page and declares `Context.setHead`. Migration:
  `c.render(e, { data })` → `c.render(e, data)`; `{ title, head }` →
  `c.setHead(…)`; `{ status, headers }` → `c.status()` / `c.header()`.
  The old shape is detected and warned about once per entry.

- **fix(vite): page analysis reads the Svelte AST** (`svelte/compiler`
  `parse`) instead of regexes: a `<script>` inside an HTML comment no longer
  turns a page into a client page, an `import` inside a string no longer trips
  the manual-layout guard. A page that does not parse fails the scan with its
  path. `analyzeSource()` is exported from `hono-svelte/vite`.

- **fix(assets): hashed entries resolve when the Vite root is not the cwd.**
  Vite writes virtual entries to the manifest relative to the root
  (`../../virtual:hono-svelte/entry/x`); the shell only knew the exact ids
  and fell back to `/static/x.js` (404). New `manifestKeyFor(manifest, entry)`;
  `test/build-client.test.ts` pins the key contract against a real client build.

- **feat(shell): a `layoutData` loader can return a `Response`** (e.g.
  `c.redirect("/login")`) — the shell sends it instead of the page, so one
  layout guards every route under it.

- **feat(vite): typed `layoutData`.** `export type Data` in a layout's
  `<script module>` lands in the generated dts: `shell({ layoutData })` keys
  are checked against the real layouts and each loader's result against the
  layout's `Data`. New `Layout`, `LayoutDataFor`, `LayoutDataMap`,
  `LayoutDataOptions` types; `LayoutDataLoader<T>` is generic.

- **feat(vite): one `vite build` with `honoSvelte()`.** The preset declares
  the `client` and `ssr` Vite environments: a plain `vite build` builds the
  hashed client assets, then the server bundle with the manifest embedded.
  No more `build:client && build:server` scripts (`--mode client` still
  builds the client alone).
- **feat(vite): `honoSvelte()` config preset.** `export default honoSvelte({ entry })`
  replaces the three-branch Vite config: svelte plugin, `pages({ dts: true })`,
  client build (hashed assets + manifest) and `@hono/vite-dev-server` /
  `@hono/vite-build` for the detected runtime (Bun/Node); `styles` is
  forwarded as `pages({ stylesEntry })` and the client manifest is embedded
  from `<outDir>/.vite/manifest.json`. The optional peers are resolved from
  the app at config time. `pages()` stays for manual setups.
- **feat(shell): layout slot wrappers are `display: contents`.** The per-level
  `<div>` no longer takes part in flex/grid layout (SSR and client mount).
- **feat(cli): scaffold uses `honoSvelte()`**, pins `hono-svelte` to the
  CLI's own version instead of `latest`, and drops `src/env.d.ts` (the
  generated dts is picked up by `tsconfig` `include`). `initFiles(flavor, { version })`.
- **perf(vite):** page sources are re-read only when their mtime/size changed
  (the dev watcher re-scans every page on each save).
- `shell({ assetsBase })` is deprecated in favour of `assets`.

- **fix(vite): the manual-layout-import guard only fires for the page's own
  layouts.** It matched any import whose file was named `layout.svelte`
  (`../_ui/layout.svelte`); the specifier is now resolved against the page
  file and compared to the real layout paths.

- **fix(vite): a page whose only script is `<script module>` stays static.**
  Declaring a per-page `Data` type turned a zero-JS page into a client page
  shipping a bundle; only an instance `<script>` makes a page interactive now.
- **perf(shell):** a static page and its layouts load in parallel; the layout
  chain, client-entry lookups and prefetch targets are computed once per entry
  instead of on every request.
- **refactor(shell):** the render path is split into small functions
  (`renderEntry`, `clientAssets`, `renderSsrBody`, `linkTags`); one shared
  `escapeAttr`; dead code removed.

## 0.7.0

- **feat(vite): per-page `Data` can use imported types.** The generated dts
  rewrites references to types imported in the page's `<script module>` as
  `import("…")` type queries (named, aliased, default and namespace
  imports; alias/package specifiers kept, relative ones re-resolved from the
  dts). Pages whose data comes from the app's own types — every real app —
  can now use per-page typing instead of being skipped with a warning.
- **fix(vite): typed `c.render` overloads are actually enforced.** The
  catch-all overload accepted every entry, so a wrong `data` for a typed
  page failed its overload and silently matched the catch-all
  (`Record<string, unknown>`). The catch-all now excludes typed entries.
  Behavior change: rendering through a value typed as the whole `Entry`
  union no longer compiles once a page declares `Data`. New `UntypedEntry`
  (pages without `Data`) and `TypedEntry` types: generic helpers take
  `UntypedEntry`.
- Imported types inside template literal types (`\`row-${RowId}\``) are
  qualified too; a `//` inside an import specifier (URL) no longer cuts it.
- New `test/types.test.ts` case runs `tsc` on a page whose `Data` imports
  an app type: correct data compiles, a wrong field type and a missing field
  fail.

## 0.6.2

- **fix(shell): unknown-entry errors never list the app's pages in
  production** (as documented for `knownEntries`); dev keeps the list.
- **refactor:** the layout chain lives in one module (`src/layouts.ts`)
  shared by the Vite plugin and the shell — the 0.6.1 nesting bug came from
  two diverging copies. Removed dead code (`isDev`, an unused prefetch
  parameter).
- **perf(shell):** the Vite manifest is resolved once per shell and its
  per-entry CSS/preload lists are cached, instead of walking the chunk graph
  on every request.
- **getPage().route** keeps reading the request's own `routePath`: the
  `hono/route` helper breaks with duplicate hono copies (found by the new
  playground e2e run). A test guards against runtime hono imports.
- **Node 24 (LTS) supported**: `engines.node` is `>=24` (package and
  `init` template); CI runs Node 24 and 26.
- **CI/release:** `release.yml` publishes tags with npm trusted publishing
  (OIDC, provenance) and creates the GitHub release from this file;
  Dependabot for npm and actions; coverage floors raised to the measured
  level; e2e adds `vite` dev and the playground app (sign-in, session,
  dashboard).

## 0.6.1

- **fix(shell): nested layouts nest outermost first.** With a root
  `layout.svelte` plus `<dir>/layout.svelte`, the server wrapped the page in
  the root layout first, so the directory layout ended up outside.
- **fix(vite): client pages mount the whole layout chain.** The client entry
  imported every layout but only mounted `Layout0`; inner layouts vanished.
  Client entries are never server-rendered, so the chain is now mounted
  (no hydration of an empty root).
- **fix(vite): components imported by static pages and layouts keep their
  `<style>`.** Only the page/layout files were compiled with
  `css: "injected"` for the server; a layout's nav or a component-library
  component lost its CSS on zero-JS pages.
- **fix(handlers): `errorHandler` keeps the headers of `HTTPException`
  responses** — `basicAuth`/`bearerAuth` 401s now carry `WWW-Authenticate`.
- **fix(shell): prefetch.** `prefetch: "all"` no longer preloads static pages
  (no JS chunk → 404); `"hover"` dedupes its links (it looked for
  `rel="prefetch"` but created `modulepreload`) and maps `/` → `index` and
  `/dir` → `dir/index`.
- **fix(shell):** the global stylesheet fallback follows `assetsBase`; a
  throwing `nonce()` is logged instead of silently dropping the CSP nonce.
- **fix(vite):** `pagesDir` outside the Vite root (including another drive
  on Windows) fails with a clear English error.
- **test:** `test/regressions.test.ts` (one test per fix) and a Playwright
  contract suite in `e2e/` that runs the same browser tests against
  hono-svelte on Node, on Bun, and against SvelteKit as the reference. CI
  adds the e2e job and a peer-dependency matrix (declared minimums and
  latest within the majors).

## 0.6.0

- **feat(shell): `htmlAttributes` option.** Only `lang` could be set on
  `<html>`, so themes driven by a root attribute (DaisyUI `data-theme`,
  `class="dark"`) needed CSS workarounds. `htmlAttributes` takes a record
  or `(c) => record` (per-request, e.g. from a cookie); values are escaped,
  invalid names (and `lang`, which has its own option) throw.

- **feat(handlers): error pages get `{ status, message }`; JSON for API
  paths.** `notFoundHandler`/`errorHandler` rendered the page without any
  data, always with 404/500, and had no way to keep API routes on JSON.
  Now: pages receive `{ status, message }` (merged under `opts.data`);
  `errorHandler` uses the status carried by the error (`HTTPException`
  and friends), exposes the error message only for 4xx (`expose` to
  customize, `message` for the generic text) and logs only 5xx; new
  `json: (c) => boolean` answers `{ message }` JSON with the same status.
  `notFoundHandler` takes a `message`. `ErrorPageData` type exported.

- **feat: `getPage()` from `hono-svelte/page`.** Layouts had no way to
  know which route rendered them (active-link logic needed the route
  threaded through every page's `data`). `getPage()` returns `{ path,
  route }` (request pathname + Hono route pattern, e.g. `/users/:id`) in
  server-rendered components and client pages alike: the shell provides it
  as Svelte context on SSR and writes `data-hs-path`/`data-hs-route` on the
  root element, which the generated client entry passes as `context` to
  `mount`/`hydrate`. New `./page` export; `PageInfo` type exported from the
  main entry.

- **feat(shell): global stylesheet resolved from the manifest
  (`stylesEntry`).** With `assets: manifest`, the global CSS kept pointing at
  the unhashed `/static/styles.css`, so hashed client builds needed a
  hand-written `stylesHref: "/" + manifest["src/styles.css"].file`. The
  shell now resolves it from the manifest. New `stylesEntry` option
  (default `"src/styles.css"`) names the source file for both modes: dev
  links `/<stylesEntry>`, prod the hashed file (fallback
  `/static/styles.css`). `stylesHref` still wins when set.

- **feat(types): `Entry` type exported from `hono-svelte`.** The generated
  `.d.ts` now also augments the package (`interface Register { entries }`),
  so helpers that forward an entry to `c.render` can be typed with
  `import type { Entry } from "hono-svelte"` instead of importing the
  generated file by relative path. Without the `.d.ts`, `Entry` is
  `string`. A new `test/types.test.ts` runs `tsc` against the generated
  declarations.

- **fix(shell): the page's `<svelte:head>` title and description win.**
  The shell always emitted its default `<title>` first and browsers use the
  first one, so a static page's `<svelte:head><title>` was ignored (and
  `shell({ head })` descriptions were duplicated). The document now keeps a
  single title — `c.render(entry, { title })` > page/layout `<svelte:head>`
  > `shell({ title })` — and a page description (`<svelte:head>` or
  `head.description`) removes the one from `shell({ head })`.

- **fix(assets): CSS of shared chunks is linked in production.** Vite
  attaches a module's CSS to the chunk that owns it, so a layout or
  component shared by several pages gets its own chunk + CSS file.
  `manifestCssFor`/`manifestImportsFor` (and therefore `shell({ assets:
  manifest })`) only read the entry chunk: pages rendered without their
  layout's styles. Both now walk the static `imports` graph (shared chunks
  first, cycles handled, `dynamicImports` skipped). `ViteManifestChunk`
  gains the optional `src`, `name` and `dynamicImports` fields.
- **fix(vite): static pages and layouts keep their `<style>` after `vite
  build`.** Server-rendered components have no client bundle, but with
  vite-plugin-svelte's default `emitCss: true` the compiler emits their CSS
  as an import that SSR drops — zero-JS pages shipped unstyled. `pages()`
  now loads static pages and layouts for the server with
  `css: "injected"` (merged into an existing `<svelte:options>`, explicit
  `css` respected), so `render()` returns the styles in `head`. New
  `test/build.test.ts` exercises the real `vite build --ssr` pipeline.

- **fix(scaffold): `isSafeAppPath` normalizes absolute targets.** An
  absolute path such as `/app/../evil.ts` passed the in-root prefix check
  on POSIX (only relative targets went through `resolve()`). Every target is
  now resolved before the comparison.
- **CI green on main**: the Windows-only `isSafeAppPath` assertions run only
  on win32 (drive letters are relative segments on POSIX); the nested-layout
  test uses its temp dir as the Vite root (it only passed on Windows because
  tmpdir sits on another drive); the `example` job installs Bun, which its
  build script calls.

## 0.5.1

- **Scaffold hardening** (`hono-svelte init`):
  - the generated `package.json` pins the security floors
    (`hono ^4.13.8`, `svelte ^5.57.0`, `vite ^8.3.0`) — the previous
    `^4`/`^5`/`^8` ranges resolved versions with known advisories; a
    regression test keeps the floors in sync with the package peers.
  - `init` writes an initial `src/hono-svelte-entries.d.ts` stub
    (plain-string renderer): `tsc` right after `init` used to fail on
    `c.render(entry, props)` (2 args vs hono's 1-arg default renderer)
    because the typed dts only exists after the first vite run;
    `pages({ dts: true })` replaces the stub with the typed union on the
    first `dev`/`build`.
- **`c.render()` coexistence contract**: 6 tests pin the shell against
  hono's renderer semantics — `c.render(string)` (default renderer) is
  reinterpreted as an entry name under the shell (strict 500); renderer
  middlewares on the same path pattern are last-registered-wins; and
  **path-scoped coexistence works**: default-render routes and
  jsxRenderer-style middlewares keep working next to a `shell()` mounted on
  its own path (`app.use("/pages/*", shell())`). Documented in the README
  ("Coexistence with other renderers").
- **CI**: new `scaffold` job smoke-tests `init --full` end to end (install
  with the local package via `file:` → typecheck → build), guarding the
  inline templates against drift from the (unpublished) playground example.

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