// Opaque IDs derived from the entryName. Pure, no runtime dependencies.
// (works on Node, Workers, Deno, Bun). Not a state secret:
// it just avoids exposing server internals in the HTML.

export type SharedIds = { rootId: string; dataId: string };

function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(12, '0').slice(0, 8);
}

export function getIds(entryName: string): SharedIds {
  return {
    rootId: 'r-' + hashString(entryName + ':root'),
    dataId: 'r-' + hashString(entryName + ':data'),
  };
}
