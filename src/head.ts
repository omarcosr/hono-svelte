// Per-page <head> tags (CSP-safe: meta/link tags plus an opt-in raw slot).
// No executable inline scripts are ever emitted here.

export type HeadMetaItem = {
  name?: string;
  property?: string;
  httpEquiv?: string;
  content: string;
};

export type HeadProps = {
  description?: string;
  canonical?: string;
  themeColor?: string;
  meta?: HeadMetaItem[];
  /** Open Graph tags: `{ title, description, image }` -> `property="og:*"`. */
  og?: Record<string, string>;
  /** Twitter tags: `{ card, title }` -> `name="twitter:*"`. */
  twitter?: Record<string, string>;
  /** Raw HTML appended as-is (fonts, ld+json, verification tags). */
  extra?: string;
};

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function renderHead(head: string | HeadProps | undefined): string {
  if (!head) return "";
  if (typeof head === "string") return head;
  const out: string[] = [];
  if (head.description !== undefined) {
    out.push(`<meta name="description" content="${escapeAttr(head.description)}" />`);
  }
  if (head.canonical !== undefined) {
    out.push(`<link rel="canonical" href="${escapeAttr(head.canonical)}" />`);
  }
  if (head.themeColor !== undefined) {
    out.push(`<meta name="theme-color" content="${escapeAttr(head.themeColor)}" />`);
  }
  for (const m of head.meta ?? []) {
    const attr = m.name
      ? `name="${escapeAttr(m.name)}"`
      : m.property
        ? `property="${escapeAttr(m.property)}"`
        : m.httpEquiv
          ? `http-equiv="${escapeAttr(m.httpEquiv)}"`
          : null;
    if (!attr) continue;
    out.push(`<meta ${attr} content="${escapeAttr(m.content)}" />`);
  }
  for (const [k, v] of Object.entries(head.og ?? {})) {
    out.push(`<meta property="og:${escapeAttr(k)}" content="${escapeAttr(v)}" />`);
  }
  for (const [k, v] of Object.entries(head.twitter ?? {})) {
    out.push(`<meta name="twitter:${escapeAttr(k)}" content="${escapeAttr(v)}" />`);
  }
  if (head.extra) out.push(head.extra);
  return out.join("");
}
