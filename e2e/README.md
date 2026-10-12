# Contract tests (Playwright)

The same browser suite runs against three targets — Playwright projects:

| project | app | runtime |
| --- | --- | --- |
| `hono-svelte-node` | `hono-app` (hono-svelte, `vite build`) | Node |
| `hono-svelte-bun` | same build | Bun |
| `sveltekit` | `kit-app` (SvelteKit + adapter-node) | Node |

`kit-app` is the **reference**: it implements the same pages/layouts with
SvelteKit. A contract test (`tests/contract.spec.ts`) must pass on every
project, so a behaviour that diverges from SvelteKit — layout nesting order,
`<title>` precedence, scoped CSS, interactivity after load, console errors,
broken asset requests — fails CI. hono-svelte-only features (zero-JS pages,
hover prefetch, error handlers) live in `tests/hono-svelte.spec.ts`.

```sh
cd e2e
npm install
npx playwright install chromium
npm run build
npm test                      # all projects
npx playwright test --project=sveltekit
```
