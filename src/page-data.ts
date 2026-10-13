// Extraction of the per-page `Data` type used by the generated dts:
// `export type Data = ...` / `export interface Data { ... }` inside a page's
// `<script module lang="ts">` (legacy `<script context="module">` works too).
//
// The declaration is copied into the dts. Types it imports in the module
// script (`import type { Row } from "$lib/db"`) are carried along: each
// reference becomes an `import("…")` type query (`qualifyImports`), with
// relative specifiers re-resolved from the dts location by the caller.

/** An import of the module script that the `Data` declaration references. */
export type DataImport = {
  /** Local name used in the declaration. */
  local: string;
  /** Exported name: an identifier, `"default"` or `"*"` (namespace import). */
  imported: string;
  /** Module specifier as written in the page. */
  specifier: string;
};

export type PageDataExtraction = {
  /** Declaration text (`type Data = ...` / `interface Data { ... }`, `export` stripped). Null when the page declares no `Data`. */
  declaration: string | null;
  /** Imported identifiers referenced by the declaration. */
  importedRefs: string[];
  /** The imports behind `importedRefs`, used to qualify the declaration for the dts. */
  imports: DataImport[];
};

const MODULE_SCRIPT_RE = /<script\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/script>/;
const DATA_DECL_RE = /(?:export\s+)?(type|interface)\s+Data\b/;

export function extractPageDataType(source: string): PageDataExtraction {
  const none: PageDataExtraction = { declaration: null, importedRefs: [], imports: [] };
  const script = MODULE_SCRIPT_RE.exec(source)?.[1];
  if (!script) return none;
  const m = DATA_DECL_RE.exec(script);
  if (!m) return none;
  const isInterface = m[1] === "interface";
  const end = scanDeclarationEnd(script, m.index + m[0].length, isInterface);
  if (end < 0) return none;
  const declaration = script
    .slice(m.index, end)
    .replace(/^export\s+/, "")
    .replace(/\s+$/, "");
  if (!declaration) return none;
  const imports = scriptImports(script).filter((imp) => findReferences(declaration, imp.local).length > 0);
  return { declaration, importedRefs: imports.map((imp) => imp.local), imports };
}

/**
 * Rewrites every reference to an imported identifier as an `import("…")`
 * type query, so the declaration resolves from any file (the generated dts):
 * `Row` → `import("$lib/db").Row`, a default import → `.default`, a
 * namespace `ns.Row` → `import("…").Row`. `specifierFor` maps the page's
 * specifier to one valid from the dts location (relative paths move).
 */
export function qualifyImports(
  declaration: string,
  imports: DataImport[],
  specifierFor: (specifier: string) => string,
): string {
  const edits: { at: number; length: number; text: string }[] = [];
  for (const imp of imports) {
    const target = `import(${JSON.stringify(specifierFor(imp.specifier))})`;
    const text =
      imp.imported === "*" ? target : imp.imported === "default" ? `${target}.default` : `${target}.${imp.imported}`;
    for (const at of findReferences(declaration, imp.local)) edits.push({ at, length: imp.local.length, text });
  }
  let out = declaration;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at + edit.length);
  }
  return out;
}

/**
 * Positions where `name` is used as a type reference: a whole identifier,
 * not a property access (`.name`), not an object/interface key
 * (`{ name: …`), outside strings and comments.
 */
function findReferences(text: string, name: string): number[] {
  const found: number[] = [];
  const isId = (ch: string | undefined) => ch !== undefined && /[\w$]/.test(ch);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (!text.startsWith(name, i) || isId(text[i - 1]) || isId(text[i + name.length])) continue;
    const before = text.slice(0, i).replace(/\s+$/, "");
    const after = text.slice(i + name.length).replace(/^\s+/, "");
    const isPropertyAccess = before.endsWith(".");
    const isKey = (before === "" || /[{;,(]$/.test(before)) && /^\??:/.test(after);
    if (!isPropertyAccess && !isKey) found.push(i);
    i += name.length - 1;
  }
  return found;
}

/**
 * Scan to the end of the declaration starting right after `Data`.
 * - `type`: the `=` alias value, ended by a `;` at depth 0, a newline after
 *   a balanced bracket pair, or the end of the module script.
 * - `interface`: the balanced `{ ... }` body.
 * Returns -1 for malformed declarations.
 */
function scanDeclarationEnd(text: string, from: number, isInterface: boolean): number {
  let i = from;
  if (!isInterface) {
    // skip to the `=` of the type alias
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "=") return -1;
    i++;
  }
  let depth = 0;
  let seenBrackets = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[" || ch === "<") {
      depth++;
      seenBrackets = true;
      continue;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (isInterface && depth === 0) return i + 1;
      continue;
    }
    if (ch === ">" && text[i - 1] !== "=") {
      // `>` but not the `=>` of a function type
      depth--;
      continue;
    }
    if (depth === 0 && ch === ";") return i + 1;
    if (depth === 0 && ch === "\n" && seenBrackets && !isInterface) return i;
  }
  // EOF: a `type` alias that never hit `;` but balanced its brackets.
  return !isInterface && seenBrackets ? text.length : -1;
}

/** Bindings created by the `import … from "…"` clauses of the script, in order. */
function scriptImports(script: string): DataImport[] {
  const imports: DataImport[] = [];
  const add = (imp: DataImport) => {
    if (!imports.some((other) => other.local === imp.local)) imports.push(imp);
  };
  const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const m of code.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s*from\s*(["'])([^"']+)\2/g)) {
    const clause = m[1];
    const specifier = m[3];
    const def = /^\s*([\w$]+)/.exec(clause);
    if (def) add({ local: def[1], imported: "default", specifier });
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns) add({ local: ns[1], imported: "*", specifier });
    for (const named of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const raw of named[1].split(",")) {
        const part = raw.trim().replace(/^type\s+/, "");
        if (!part) continue;
        const [imported, local = imported] = part.split(/\s+as\s+/).map((x) => x.trim());
        if (/^[\w$]+$/.test(imported) && /^[\w$]+$/.test(local)) add({ local, imported, specifier });
      }
    }
  }
  return imports;
}
