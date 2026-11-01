// Asset URL resolution (Vite manifest with hashed files) + cache helpers.
//
// Default behavior stays zero-config: `/static/<entry>.js` (unhashed names,
// as in the README example). Pass a Vite manifest object to `shell({ assets })`
// when the client build uses hashed file names.

export type ViteManifestChunk = {
  file: string;
  src?: string;
  name?: string;
  css?: string[];
  imports?: string[];
  dynamicImports?: string[];
  assets?: string[];
  isEntry?: boolean;
};

export type ViteManifest = Record<string, ViteManifestChunk>;

export type AssetsResolver = (entryName: string) => string;

export type ManifestAssetsOptions = {
  /** Prefix for manifest file paths. @default "/" */
  prefix?: string;
  /** Fallback base when the entry is missing from the manifest. @default "/static" */
  fallbackBase?: string;
};

const NULL = String.fromCharCode(0);

function joinPrefix(prefix: string, file: string): string {
  return prefix.replace(/\/$/, "") + "/" + file.replace(/^\//, "");
}

/** Manifest keys tried for an entry (virtual ids first, bare entry last). */
export function manifestKeysFor(entryName: string): string[] {
  return [
    NULL + "virtual:hono-svelte/entry/" + entryName,
    "virtual:hono-svelte/entry/" + entryName,
    entryName,
  ];
}

const VIRTUAL_ENTRY = "virtual:hono-svelte/entry/";

/**
 * Manifest key of an entry. Exact candidates first; then any key whose tail
 * is the virtual id: Vite writes virtual entries relative to the root, so
 * with a root below the cwd the key becomes `../../virtual:hono-svelte/entry/x`.
 */
export function manifestKeyFor(manifest: ViteManifest, entryName: string): string | undefined {
  for (const key of manifestKeysFor(entryName)) {
    if (manifest[key]) return key;
  }
  const tail = VIRTUAL_ENTRY + entryName;
  return Object.keys(manifest).find((key) => {
    const bare = key.startsWith(NULL) ? key.slice(1) : key;
    return bare.replace(/^(\.\.\/)+/, "") === tail;
  });
}

function findChunk(manifest: ViteManifest, entryName: string): ViteManifestChunk | undefined {
  const key = manifestKeyFor(manifest, entryName);
  return key === undefined ? undefined : manifest[key];
}

export function createManifestAssets(
  manifest: ViteManifest,
  opts: ManifestAssetsOptions = {},
): AssetsResolver {
  const prefix = opts.prefix ?? "/";
  const fallbackBase = (opts.fallbackBase ?? "/static").replace(/\/$/, "");
  return (entryName: string) => {
    const chunk = findChunk(manifest, entryName);
    if (chunk?.file) return joinPrefix(prefix, chunk.file);
    return `${fallbackBase}/${entryName}.js`;
  };
}

/**
 * The entry chunk plus every chunk it reaches through static `imports`,
 * dependencies first (the order the browser evaluates them). Vite attaches
 * a module's CSS to the chunk that owns the module — a layout or component
 * shared by several pages lives in its own chunk, so reading only the entry
 * chunk misses its styles. `dynamicImports` are not followed: they load
 * later, with their own CSS handling.
 */
function staticChunkGraph(manifest: ViteManifest, entryName: string): ViteManifestChunk[] {
  const entry = findChunk(manifest, entryName);
  if (!entry) return [];
  const ordered: ViteManifestChunk[] = [];
  const seen = new Set<ViteManifestChunk>();
  const visit = (chunk: ViteManifestChunk): void => {
    if (seen.has(chunk)) return;
    seen.add(chunk);
    for (const key of chunk.imports ?? []) {
      const dep = manifest[key];
      if (dep) visit(dep);
    }
    ordered.push(chunk);
  };
  visit(entry);
  return ordered;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Hashed CSS files for an entry, via the Vite manifest — including the CSS
 * of every statically imported chunk (shared layouts, components), shared
 * chunks first so the entry's own rules come last.
 */
export function manifestCssFor(
  manifest: ViteManifest,
  entryName: string,
  prefix = "/",
): string[] {
  return unique(
    staticChunkGraph(manifest, entryName).flatMap((chunk) => (chunk.css ?? []).map((f) => joinPrefix(prefix, f))),
  );
}

/**
 * Shared-chunk URLs (for `modulepreload`), via the Vite manifest: every chunk
 * the entry reaches through static imports, not only the direct ones.
 */
export function manifestImportsFor(
  manifest: ViteManifest,
  entryName: string,
  prefix = "/",
): string[] {
  const entry = findChunk(manifest, entryName);
  return unique(
    staticChunkGraph(manifest, entryName)
      .filter((chunk) => chunk !== entry && chunk.file)
      .map((chunk) => joinPrefix(prefix, chunk.file)),
  );
}

const PRIVATE_PREFETCH = "hono-svelte/prefetch/";

/** The page entry (or private prefetch map) a manifest key stands for: "admin/users", "hono-svelte/prefetch/admin.js" -> "admin". */
function rootEntryOf(key: string): string | undefined {
  const bare = (key.startsWith(NULL) ? key.slice(1) : key).replace(/^(\.\.\/)+/, "");
  if (bare.startsWith(VIRTUAL_ENTRY)) return bare.slice(VIRTUAL_ENTRY.length);
  if (bare.startsWith(PRIVATE_PREFETCH)) return bare.slice(PRIVATE_PREFETCH.length).replace(/\.js$/, "");
  return undefined;
}

/**
 * `privatePages` folders that reach each file of the client build only they use — their entries plus the
 * chunks, CSS and assets those reach (statically or dynamically) that no other entry reaches — keyed by URL
 * path ("/static/admin/users-x.js" -> ["admin"]). A file any public entry reaches stays public.
 */
export function privateAssetDirs(manifest: ViteManifest, privateDirs: string[], prefix = "/"): Map<string, string[]> {
  const reach = (keys: string[]): Set<string> => {
    const files = new Set<string>();
    const seen = new Set<string>();
    const visit = (key: string): void => {
      const chunk = manifest[key];
      if (!chunk || seen.has(key)) return;
      seen.add(key);
      for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) if (file) files.add(file);
      for (const dep of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) visit(dep);
    };
    keys.forEach(visit);
    return files;
  };
  const roots = Object.keys(manifest).filter((key) => manifest[key]?.isEntry || key.startsWith(PRIVATE_PREFETCH));
  const dirOf = (key: string): string | undefined => {
    const entry = rootEntryOf(key);
    return entry === undefined ? undefined : privateDirs.find((dir) => entry === dir || entry.startsWith(dir + "/"));
  };
  const publicFiles = reach(roots.filter((key) => dirOf(key) === undefined));
  const owners = new Map<string, string[]>();
  for (const dir of privateDirs) {
    for (const file of reach(roots.filter((key) => dirOf(key) === dir))) {
      if (publicFiles.has(file)) continue;
      const url = joinPrefix(prefix, file);
      owners.set(url, [...(owners.get(url) ?? []), dir]);
    }
  }
  return owners;
}

/** Long-term caching for hashed `/static` files. */
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

/** Safe default for HTML shell responses. */
export const CACHE_NO_STORE = "no-store";

export function immutableHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Cache-Control": CACHE_IMMUTABLE, ...extra };
}
