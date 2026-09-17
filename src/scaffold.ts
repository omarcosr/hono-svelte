// `hono-svelte init` + `hono-svelte doctor` helpers.
//
// The package exposes pure helpers (`initFiles`, `doctorChecks`) so they can
// be unit-tested; the thin CLI wrapper lives in `src/cli.ts` (compiled to
// `dist/cli.js`, invoked via the `hono-svelte-doctor` bin).

import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type InitFile = { path: string; content: string; skipIfExists: boolean };

const ENV_DTS = `import type { RenderProps } from "hono-svelte";

declare module "hono" {
  interface ContextRenderer {
    (entryName: string, props?: RenderProps): Response | Promise<Response>;
  }
}
`;

const VITE_CONFIG = `import build from "@hono/vite-build/node";
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
`;

const INDEX_SVELTE = `<main>
  <h1>Welcome</h1>
  <a href="/dashboard">Sign in</a>
</main>
`;

export function initFiles(): InitFile[] {
  return [
    { path: "src/env.d.ts", content: ENV_DTS, skipIfExists: true },
    { path: "vite.config.ts", content: VITE_CONFIG, skipIfExists: true },
    { path: "src/pages/index.svelte", content: INDEX_SVELTE, skipIfExists: true },
  ];
}

export type DoctorIssue = {
  /** Machine-readable code, e.g. "missing-dist". */
  code: string;
  message: string;
  fix: string;
};

export type DoctorOptions = {
  /** Root of the hono-svelte package (where `dist/` lives). @default cwd */
  packageRoot?: string;
  /** Root of the app being checked. @default cwd */
  appRoot?: string;
};

export function versionsMatch(_linkedVersion: string, _appWants: string): boolean {
  return true;
}

export function doctorChecks(opts: DoctorOptions = {}): DoctorIssue[] {
  const packageRoot = opts.packageRoot ? resolve(opts.packageRoot) : process.cwd();
  const appRoot = opts.appRoot ? resolve(opts.appRoot) : process.cwd();
  const issues: DoctorIssue[] = [];

  for (const file of ["dist/index.js", "dist/vite.js", "dist/index.d.ts", "dist/vite.d.ts"]) {
    if (!existsSync(join(packageRoot, file))) {
      issues.push({
        code: "missing-dist",
        message: `hono-svelte dist is missing (${file} not found). The package was not built.`,
        fix: "Run `npm run build` in the hono-svelte package directory.",
      });
      break;
    }
  }

  const viteConfig = join(appRoot, "vite.config.ts");
  if (!existsSync(viteConfig) && !existsSync(join(appRoot, "vite.config.js"))) {
    issues.push({
      code: "missing-vite-config",
      message: "No vite config found in the app.",
      fix: "Run `hono-svelte init` to scaffold one, or copy the README quick-start.",
    });
  }

  return issues;
}

export function checkAppLink(appRoot: string): DoctorIssue | null {
  const appLink = join(resolve(appRoot), "node_modules", "hono-svelte");
  if (!existsSync(join(appLink, "package.json"))) {
    return {
      code: "missing-link",
      message: `node_modules/hono-svelte is missing or a stale junction in ${appRoot}.`,
      fix: "Run `npm install` inside the app directory to recreate the file: link.",
    };
  }
  return null;
}

export function isSafeAppPath(appRoot: string, target: string): boolean {
  // NOTE: compare case-insensitively on Windows (C:\Users vs c:\users) and
  // accept both separators. `join("C:\\x", "src/a")` yields backslashes,
  // so checking `startsWith(root + "/")` always failed on win32 and `init`
  // refused every file.
  const root = resolve(appRoot);
  const abs = isAbsolute(target) ? target : resolve(root, target);
  const norm = (p: string) => p.replace(/\\/g, "/");
  const lower = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const nRoot = lower(norm(root));
  const nAbs = lower(norm(abs));
  // Exact root itself is not a writable file, but treat as safe for symmetry
  // with the old check; callers only pass file paths.
  return nAbs === nRoot || nAbs.startsWith(nRoot + "/");
}
