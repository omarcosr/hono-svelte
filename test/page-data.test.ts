import { describe, expect, it } from "vitest";
import { extractPageDataType } from "../src/page-data.js";

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

  it("scans an interface with generics and extends", () => {
    const src =
      '<script module lang="ts">export interface Data<T extends { id: number }> extends Array<T> { pick: T["id"] }</script>';
    const out = extractPageDataType(src);
    expect(out.declaration).toBe(
      'interface Data<T extends { id: number }> extends Array<T> { pick: T["id"] }',
    );
  });
});
