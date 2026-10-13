import { describe, expect, it } from "vitest";
import { extractPageDataType, qualifyImports, type DataImport } from "../src/page-data.js";

describe("extractPageDataType", () => {
  it("returns null when there is no module script or no Data", () => {
    expect(extractPageDataType("<h1>x</h1>").declaration).toBeNull();
    expect(
      extractPageDataType('<script module lang="ts">export const x = 1;</script>').declaration,
    ).toBeNull();
    expect(
      extractPageDataType('<script lang="ts">export type Data = { a: 1 };</script>').declaration,
    ).toBeNull();
  });

  it("extracts export type Data (single line, with and without semicolon)", () => {
    expect(
      extractPageDataType(
        '<script module lang="ts">export type Data = { plan: string };</script>',
      ).declaration,
    ).toBe("type Data = { plan: string };");
    expect(
      extractPageDataType(
        '<script module lang="ts">export type Data = Record<string, string></script>',
      ).declaration,
    ).toBe("type Data = Record<string, string>");
  });

  it("extracts multiline aliases and interface Data", () => {
    const type = `<script module lang="ts">
  export type Data = {
    plan: string;
    seats: number;
  }
</script>`;
    expect(extractPageDataType(type)?.declaration).toBe(
      "type Data = {\n    plan: string;\n    seats: number;\n  }",
    );
    const iface = `<script module lang="ts">
  export interface Data {
    plan: string;
  }
</script>`;
    expect(extractPageDataType(iface)?.declaration).toBe("interface Data {\n    plan: string;\n  }");
  });

  it("extracts from a legacy context=module script and balances generics", () => {
    expect(
      extractPageDataType(
        '<script context="module" lang="ts">export type Data = { a: 1 };</script>',
      ).declaration,
    ).toBe("type Data = { a: 1 };");
    const generic =
      '<script module lang="ts">export type Fn = (a: string) => void; export type Data = { cb: Fn };</script>';
    expect(extractPageDataType(generic)?.declaration).toBe("type Data = { cb: Fn };");
  });

  it("flags declarations that reference imported identifiers", () => {
    const src = `<script module lang="ts">
  import type { Plan } from "../lib/plan";
  import def from "../lib/other";
  import { helper } from "../lib/util";
  export type Data = { plan: Plan };
</script>`;
    const out = extractPageDataType(src);
    expect(out.declaration).toBe("type Data = { plan: Plan };");
    expect(out.importedRefs).toEqual(["Plan"]);
  });

  it("does not flag unused imports", () => {
    const src = `<script module lang="ts">
  import type { Plan } from "../lib/plan";
  export type Data = { plan: string };
</script>`;
    const out = extractPageDataType(src);
    expect(out.declaration).toBe("type Data = { plan: string };");
    expect(out.importedRefs).toEqual([]);
  });

  it("returns null on malformed declarations", () => {
    // `type Data` without the `=` of an alias
    const out = extractPageDataType('<script module lang="ts">type Data</script>');
    expect(out.declaration).toBeNull();
  });

  it("skips comments and strings while scanning", () => {
    const src = `<script module lang="ts">
  // import { decoy } from "x";
  export type Data = {
    /* block ; comment */
    sep: ";" // line ; comment
    quote: "}"
    arrow: (a: string) => void;
  };
</script>`;
    const out = extractPageDataType(src);
    expect(out.declaration).toContain('sep: ";"');
    expect(out.declaration).toContain('quote: "}"');
    expect(out.declaration).toContain("=> void");
    expect(out.importedRefs).toEqual([]);
  });

  it("detects namespace and named imports in refs", () => {
    const src = `<script module lang="ts">
  import * as lib from "./lib";
  import type { Plan } from "./plan";
  export type Data = { plan: Plan; extra: lib.Extra };
</script>`;
    const out = extractPageDataType(src);
    expect(out.declaration).toBe("type Data = { plan: Plan; extra: lib.Extra };");
    expect(out.importedRefs).toEqual(["lib", "Plan"]);
  });

  it("reports the imports behind the references (named, aliased, default, namespace)", () => {
    const src = `<script module lang="ts">
  import type { Plan, Seat as S } from "./plan";
  import Def from "./def";
  import * as lib from "$lib/x";
  import { unused } from "./unused";
  export type Data = { plan: Plan; seat: S; def: Def; extra: lib.Extra };
</script>`;
    expect(extractPageDataType(src).imports).toEqual([
      { local: "Plan", imported: "Plan", specifier: "./plan" },
      { local: "S", imported: "Seat", specifier: "./plan" },
      { local: "Def", imported: "default", specifier: "./def" },
      { local: "lib", imported: "*", specifier: "$lib/x" },
    ]);
  });

  it("scans an interface with generics and extends", () => {
    const src =
      '<script module lang="ts">export interface Data<T extends { id: number }> extends Array<T> { pick: T["id"] }</script>';
    const out = extractPageDataType(src);
    expect(out.declaration).toBe(
      'interface Data<T extends { id: number }> extends Array<T> { pick: T["id"] }',
    );
  });
});

describe("qualifyImports", () => {
  const imports: DataImport[] = [
    { local: "Row", imported: "Row", specifier: "$lib/db" },
    { local: "Alias", imported: "Original", specifier: "./types" },
    { local: "Def", imported: "default", specifier: "./def" },
    { local: "ns", imported: "*", specifier: "pkg" },
  ];
  const same = (specifier: string) => specifier;

  it("rewrites named, aliased, default and namespace references", () => {
    expect(qualifyImports("type Data = { a: Row; b: Alias[]; c: Def; d: ns.Thing<Row> };", imports, same)).toBe(
      'type Data = { a: import("$lib/db").Row; b: import("./types").Original[]; c: import("./def").default; d: import("pkg").Thing<import("$lib/db").Row> };',
    );
  });

  it("leaves object keys, property accesses, strings and comments alone", () => {
    const decl = 'type Data = { Row: string; Def?: Row; x: Other.Row; s: "Row"; /* Row */ c: (Row) };';
    expect(qualifyImports(decl, imports, same)).toBe(
      'type Data = { Row: string; Def?: import("$lib/db").Row; x: Other.Row; s: "Row"; /* Row */ c: (import("$lib/db").Row) };',
    );
  });

  it("handles conditional types, typeof and interfaces", () => {
    expect(qualifyImports("type Data = Row extends Def ? Row : never;", imports, same)).toBe(
      'type Data = import("$lib/db").Row extends import("./def").default ? import("$lib/db").Row : never;',
    );
    expect(qualifyImports("type Data = Awaited<ReturnType<typeof Def>>;", imports, same)).toBe(
      'type Data = Awaited<ReturnType<typeof import("./def").default>>;',
    );
    expect(qualifyImports("interface Data extends Row { extra: Alias }", imports, same)).toBe(
      'interface Data extends import("$lib/db").Row { extra: import("./types").Original }',
    );
  });

  it("maps specifiers through the callback", () => {
    expect(qualifyImports("type Data = Alias;", imports, (s) => s.replace("./", "../src/"))).toBe('type Data = import("../src/types").Original;');
  });
});

describe("template literal types and URL specifiers", () => {
  const same = (s: string) => s;
  it("qualifies references inside \${…} holes, not the literal text", () => {
    const imports: DataImport[] = [{ local: "RowId", imported: "RowId", specifier: "$lib/db" }];
    expect(qualifyImports("type Data = { id: `RowId-${RowId}-${Lowercase<RowId>}` };", imports, same)).toBe(
      'type Data = { id: `RowId-${import("$lib/db").RowId}-${Lowercase<import("$lib/db").RowId>}` };',
    );
  });

  it("keeps import specifiers containing //", () => {
    const page = '<script module lang="ts">\n  import type { Row } from "https://x.dev/db"; // note\n  export type Data = { r: Row };\n</script>';
    expect(extractPageDataType(page).imports).toEqual([{ local: "Row", imported: "Row", specifier: "https://x.dev/db" }]);
  });
});
