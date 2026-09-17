# Changelog

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