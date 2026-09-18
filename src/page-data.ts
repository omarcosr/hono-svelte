// Extraction of the per-page `Data` type used by the generated dts:
// `export type Data = ...` / `export interface Data { ... }` inside a page's
// `<script module lang="ts">` (legacy `<script context="module">` works too).
//
// The declaration is inlined verbatim into the dts, so it must be
// self-contained: references to imported types can't be resolved from the
// dts location and are reported through `importedRefs` (the caller skips the
// typed overload for that page and warns once).

export type PageDataExtraction = {
  /** Declaration text (`type Data = ...` / `interface Data { ... }`, `export` stripped). Null when the page declares no `Data`. */
  declaration: string | null;
  /** Imported identifiers referenced by the declaration (unusable for the dts). */
  importedRefs: string[];
};

const MODULE_SCRIPT_RE = /<script\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/script>/;
const DATA_DECL_RE = /(?:export\s+)?(type|interface)\s+Data\b/;

export function extractPageDataType(source: string): PageDataExtraction {
  const none: PageDataExtraction = { declaration: null, importedRefs: [] };
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
  const importedRefs = importedIdentifiers(script).filter((id) =>
    new RegExp(`\\b${id.replace(/\$/g, "\\$")}\\b`).test(declaration),
  );
  return { declaration, importedRefs };
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

/** Identifiers brought in by `import ... from "..."` clauses of the script. */
function importedIdentifiers(script: string): string[] {
  const ids = new Set<string>();
  for (const m of script.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s*from\s*["'][^"']+["']/g)) {
    const clause = m[1];
    const def = /^\s*([\w$]+)/.exec(clause);
    if (def) ids.add(def[1]);
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns) ids.add(ns[1]);
    for (const named of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const part of named[1].split(",")) {
        const asM = /\bas\s+([\w$]+)/.exec(part);
        const id = asM ? asM[1] : part.trim().split(/\s+/)[0];
        if (/^[\w$]+$/.test(id)) ids.add(id);
      }
    }
  }
  return [...ids];
}
