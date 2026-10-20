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
          'import { Hono, type Context } from "hono";',
          'import type { Entry, TypedEntry, UntypedEntry } from "hono-svelte";',
          "const app = new Hono();",
          'export const helper = (entry: UntypedEntry) => (c: Context) => { c.setHead({ title: "x" }); return c.render(entry); };',
          'app.get("/plain", helper("plain"));',
          "// @ts-expect-error typed pages need their own data",
          'app.get("/rows", helper("rows/index"));',
          'export const typed: TypedEntry = "rows/index";',
          'export const any: Entry[] = ["plain", "rows/index"];',
          'app.get("/ok", (c) => c.render("rows/index", { rows: [{ id: 1, name: "a" }] }));',
          "// @ts-expect-error id must be a number",
          'app.get("/bad", (c) => c.render("rows/index", { rows: [{ id: "x", name: "a" }] }));',
          "// @ts-expect-error rows is required",
          'app.get("/missing", (c) => c.render("rows/index", {}));',
          "// @ts-expect-error typed pages require their data",
          'app.get("/none", (c) => c.render("rows/index"));',
          "// @ts-expect-error unknown head option",
          'app.get("/head", (c) => { c.setHead({ titel: "x" }); return c.render("plain"); });',
        ].join("\n"),
      },
      (dir) => {
        mkdirSync(join(dir, "pages", "rows"), { recursive: true });
        writeFileSync(join(dir, "pages", "plain.svelte"), "<p>plain</p>\n");
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

describe("layout Data typing", () => {
  it("types shell({ layoutData }) keys and loader results from the layouts' Data", () => {
    const result = typecheck(
      {
        "usage.ts": [
          'import { shell, type Layout, type LayoutDataFor } from "hono-svelte";',
          'export const ok = shell({ layoutData: { "dash/layout": () => ({ user: "grace", seats: 2 }), layout: async () => ({ anything: true }) } });',
          "// @ts-expect-error seats must be a number",
          'export const badType = shell({ layoutData: { "dash/layout": () => ({ user: "grace", seats: "2" }) } });',
          "// @ts-expect-error user is required",
          'export const missing = shell({ layoutData: { "dash/layout": () => ({ seats: 2 }) } });',
          "// @ts-expect-error not a layout",
          'export const notLayout = shell({ layoutData: { "dash/index": () => ({}) } });',
          'export const layouts: Layout[] = ["layout", "dash/layout"];',
          'export const data: LayoutDataFor<"dash/layout"> = { user: "x", seats: 1 };',
          'export const loose: LayoutDataFor<"layout"> = { whatever: 1 };',
        ].join("\n"),
      },
      (dir) => {
        mkdirSync(join(dir, "pages", "dash"), { recursive: true });
        writeFileSync(join(dir, "pages", "layout.svelte"), "<slot />\n");
        writeFileSync(
          join(dir, "pages", "dash", "layout.svelte"),
          '<script module lang="ts">\n  export type Data = { user: string; seats: number };\n</script>\n<slot />\n',
        );
        writeFileSync(join(dir, "pages", "dash", "index.svelte"), "<p>dash</p>\n");
        const plugin = pages({ pagesDir: join(dir, "pages"), dts: join(dir, "entries.d.ts") });
        plugin.configResolved({ root: dir } as never);
        plugin.buildStart();
      },
    );
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 60_000);

  it("without the generated declarations any layout key and record is accepted", () => {
    const result = typecheck({
      "usage.ts": [
        'import { shell } from "hono-svelte";',
        'export const ok = shell({ layoutData: { "x/layout": () => ({ a: 1 }) } });',
      ].join("\n"),
    });
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
