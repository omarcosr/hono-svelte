// Type-level contract of the generated `.d.ts`: runs the real `tsc` against a
// throwaway project that imports `hono-svelte` (mapped to src/) next to the
// declarations `pages({ dts: true })` writes.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pages } from "../src/vite.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `typescript` exports no `./bin/*` subpath; its bin lives at a fixed path.
const tsc = join(pkgRoot, "node_modules", "typescript", "bin", "tsc");

function typecheck(files: Record<string, string>, prepare?: (dir: string) => void): { ok: boolean; output: string } {
  // Inside the repo so `hono` and `svelte` resolve from its node_modules.
  const dir = mkdtempSync(join(pkgRoot, "test", ".types-"));
  try {
    prepare?.(dir);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          // Same ambient types as the package build (src/ is type-checked through the mapping).
          types: ["node", "vite/client"],
          paths: { "hono-svelte": [join(pkgRoot, "src/index.ts")] },
        },
        include: ["*.ts"],
      }),
    );
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    try {
      return { ok: true, output: execFileSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" }) };
    } catch (err) {
      return { ok: false, output: String((err as { stdout?: string }).stdout ?? err) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function generatedDts(): string {
  const plugin = pages({ pagesDir: "test/fixtures/pages" });
  plugin.configResolved({ root: pkgRoot } as never);
  plugin.buildStart();
  return plugin.typeDeclarations();
}

describe("per-page Data typing", () => {
  it("checks c.render against a Data type that imports app types", () => {
    const result = typecheck(
      {
        "usage.ts": [
          'import { Hono } from "hono";',
          "const app = new Hono();",
          'app.get("/ok", (c) => c.render("rows/index", { data: { rows: [{ id: 1, name: "a" }] } }));',
          "// @ts-expect-error id must be a number",
          'app.get("/bad", (c) => c.render("rows/index", { data: { rows: [{ id: "x", name: "a" }] } }));',
          "// @ts-expect-error rows is required",
          'app.get("/missing", (c) => c.render("rows/index", { data: {} }));',
        ].join("\n"),
      },
      (dir) => {
        mkdirSync(join(dir, "pages", "rows"), { recursive: true });
        writeFileSync(join(dir, "model.ts"), "export type Row = { id: number; name: string };\n");
        writeFileSync(
          join(dir, "pages", "rows", "index.svelte"),
          [
            '<script module lang="ts">',
            '  import type { Row } from "../../model";',
            "  export type Data = { rows: Row[] };",
            "</script>",
            '<script lang="ts">',
            "  const data: Data = $props();",
            "</script>",
            "<p>{data.rows.length}</p>",
            "",
          ].join("\n"),
        );
        const plugin = pages({ pagesDir: join(dir, "pages"), dts: join(dir, "entries.d.ts") });
        plugin.configResolved({ root: dir } as never);
        plugin.buildStart();
      },
    );
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 60_000);
});

describe("Entry type", () => {
  it("is the generated union, importable from the package", () => {
    const result = typecheck({
      "entries.d.ts": generatedDts(),
      "usage.ts": [
        'import type { Entry } from "hono-svelte";',
        'export const ok: Entry = "home";',
        "// @ts-expect-error not a page",
        'export const bad: Entry = "nope";',
        "export function page(entry: Entry): string { return entry; }",
        'page("admin");',
      ].join("\n"),
    });
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 60_000);

  it("falls back to string without the generated declarations", () => {
    const result = typecheck({
      "usage.ts": ['import type { Entry } from "hono-svelte";', 'export const any: Entry = "whatever";'].join("\n"),
    });
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 60_000);
});
