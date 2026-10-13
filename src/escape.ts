/** Escapes a value for a double-quoted HTML attribute (also safe as element text). */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
