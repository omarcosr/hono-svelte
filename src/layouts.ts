// Layout chain resolution, shared by the Vite plugin (client entries, dts)
// and the shell (server rendering) so both sides always agree.

/** True for `layout` and `<dir>/layout` entry names. */
export function isLayoutEntry(entryName: string): boolean {
  return entryName === "layout" || entryName.endsWith("/layout");
}

/**
 * Layouts wrapping `entryName`, OUTERMOST FIRST: the root `layout`, then
 * `a/layout`, `a/b/layout`… for each directory of the entry. Only names in
 * `available` are returned; layouts themselves have no chain.
 */
export function layoutChain(entryName: string, available: Iterable<string>): string[] {
  if (isLayoutEntry(entryName)) return [];
  const known = new Set(available);
  if (known.size === 0) return [];
  const chain: string[] = known.has("layout") ? ["layout"] : [];
  const parts = entryName.split("/");
  for (let i = 1; i < parts.length; i++) {
    const layout = parts.slice(0, i).join("/") + "/layout";
    if (known.has(layout)) chain.push(layout);
  }
  return chain;
}
