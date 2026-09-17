// Static stub used by the shell when the hono-svelte/vite plugin (pages())
// is not active in the bundler: no static pages, every entry
// is client-side. With pages() active, the plugin resolveId (enforce: 'pre')
// redirects the shell relative import './ssr-manifest.js' to the
// virtual manifest generated in memory.

export const ssrPages: Record<string, () => Promise<{ default: unknown }>> = {};
