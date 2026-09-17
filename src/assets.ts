// Asset URL resolution (Vite manifest with hashed files) + cache helpers.
//
// Default behavior stays zero-config: `/static/<entry>.js` (unhashed names,
// as in the README example). Pass a Vite manifest object to `shell({ assets })`
// when the client build uses hashed file names.

export type ViteManifestChunk = {
  file: string;
  css?: string[];
  imports?: string[];
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

function findChunk(manifest: ViteManifest, entryName: string): ViteManifestChunk | undefined {
  for (const key of manifestKeysFor(entryName)) {
    const chunk = manifest[key];
    if (chunk) return chunk;
  }
  return undefined;
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

/** Hashed CSS files for an entry, via the Vite manifest. */
export function manifestCssFor(
  manifest: ViteManifest,
  entryName: string,
  prefix = "/",
): string[] {
  const chunk = findChunk(manifest, entryName);
  return (chunk?.css ?? []).map((f) => joinPrefix(prefix, f));
}

/** Shared-chunk URLs (for `modulepreload`), via the Vite manifest. */
export function manifestImportsFor(
  manifest: ViteManifest,
  entryName: string,
  prefix = "/",
): string[] {
  const chunk = findChunk(manifest, entryName);
  if (!chunk) return [];
  const out: string[] = [];
  for (const imp of chunk.imports ?? []) {
    const dep = manifest[imp];
    if (dep?.file) out.push(joinPrefix(prefix, dep.file));
  }
  return out;
}

/** Long-term caching for hashed `/static` files. */
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

/** Safe default for HTML shell responses. */
export const CACHE_NO_STORE = "no-store";

export function immutableHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Cache-Control": CACHE_IMMUTABLE, ...extra };
}
