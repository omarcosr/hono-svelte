// `prefetch: "hover"`: preloads a page's JS when a link to it is hovered.

/**
 * Manifest key of the hover script the client build emits: the map of every
 * client entry lives in that cached file instead of in each page's HTML.
 */
export const PREFETCH_ASSET = "hono-svelte/prefetch.js";

/** The hover script for an entry -> URL map. Links map to entries by path: "/" -> "index", "/a" -> "a" or "a/index". */
export function prefetchHoverCode(map: Record<string, string>): string {
  const json = JSON.stringify(map).replace(/</g, "\\u003c");
  return (
    `(function(){var m=${json};` +
    `function pre(u){if(document.querySelector('link[rel=\\"modulepreload\\"][href=\\"'+u+'\\"]'))return;` +
    `var l=document.createElement('link');l.rel='modulepreload';l.href=u;document.head.appendChild(l);}` +
    `document.addEventListener('mouseover',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;` +
    `if(!a)return;try{var p=new URL(a.href,location.origin).pathname.replace(/^\\/+|\\/+$/g,'');` +
    `var u=m[p]||m[p?p+'/index':'index'];if(u)pre(u);}catch(_){}},{passive:true});})();`
  );
}
